<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Theme } from '../themes';

  export let theme: Theme;
  // Nodi di analisi reali sul bus d'uscita audio.
  export let analyserMain: AnalyserNode | null = null;
  export let analyserL: AnalyserNode | null = null;
  export let analyserR: AnalyserNode | null = null;
  // Valori grezzi di mercato; la normalizzazione adattiva con soglie è qui sotto.
  // tickSeq cambia a ogni nuovo tick; calibrating = finestra di cattura min/max
  // (vale sia per la calibrazione iniziale che per il recalibrate).
  export let volatilityRaw: number = 0;
  export let densityRaw: number = 0;
  export let tickSeq: number = 0;
  export let calibrating: boolean = false;
  // maker_side grezzo identico alla patch RNBO: 0 = compratore taker, 1 = venditore taker.
  // 0.5 = neutro (nessun dato ancora).
  export let makerTarget: number = 0.5;

  let scopeCanvas: HTMLCanvasElement;
  let gonioCanvas: HTMLCanvasElement;
  let widthLabelEl: HTMLSpanElement;

  let scope = { w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null };
  let gonio = { w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null };

  let animationId: number;
  let resizeObserver: ResizeObserver | null = null;
  let frame = 0;
  let lastT = 0;

  // Order Flow Imbalance: rampa lineare verso maker_side che raggiunge il
  // target in 1000ms (stessa logica della patch RNBO). flowRamp ∈ [0,1]:
  // 0 => bullish, 1 => bearish. Mostra il "tira e molla" fra i due estremi.
  let flowRamp = 0.5;
  let flowImbalance = 0; // +1 = bullish, -1 = bearish (derivato dalla rampa)
  const FLOW_RAMP_MS = 3000;

  // Buffer riutilizzati per le letture time-domain.
  let bufMain = new Float32Array(2048);
  let bufL = new Float32Array(2048);
  let bufR = new Float32Array(2048);

  let stereoWidth = 0; // 0 = mono, ~1 = ampio

  // Guadagno SOLO per la visualizzazione (non influisce sull'audio): il segnale
  // reale ha ampiezza minuscola, qui lo amplifichiamo per riempire il range utile.
  const SCOPE_GAIN = 8;
  const GONIO_GAIN = 8;

  // ---- Normalizzazione adattiva con soglie (density & volatility) ----
  // Durante la calibrazione cattura min/max nella finestra temporale. A regime
  // le soglie decadono linearmente verso 0 in 60s e "scattano" sul nuovo picco
  // quando il valore le supera. Uscita riscalata in 0..100.
  const DECAY_MS = 60000;
  interface NormState {
    hi: number;
    lo: number;
    hiRate: number;
    loRate: number;
    min: number;
    max: number;
  }
  const makeNorm = (): NormState => ({ hi: 1, lo: 0, hiRate: 0, loRate: 0, min: Infinity, max: -Infinity });
  const normVol = makeNorm();
  const normDens = makeNorm();
  let prevCalibrating = false;
  let lastSeq = -1;
  let volPctVal = 0;
  let densPctVal = 0;

  function stepNorm(s: NormState, raw: number, newTick: boolean, dtMs: number): number {
    if (calibrating) {
      // Cattura: aggiorna gli estremi della finestra e usali come range corrente.
      if (newTick) {
        if (raw < s.min) s.min = raw;
        if (raw > s.max) s.max = raw;
      }
      s.lo = s.min === Infinity ? 0 : s.min;
      s.hi = s.max === -Infinity ? Math.max(raw, 1e-9) : s.max;
    } else {
      // Regime: scatto sul nuovo picco + decadimento lineare verso 0 in 60s.
      if (newTick) {
        if (raw > s.hi) {
          s.hi = raw;
          s.hiRate = raw / DECAY_MS;
        }
        if (raw < s.lo) {
          s.lo = raw;
          s.loRate = raw / DECAY_MS;
        }
      }
      s.hi = Math.max(0, s.hi - s.hiRate * dtMs);
      s.lo = Math.max(0, s.lo - s.loRate * dtMs);
    }
    const range = s.hi - s.lo;
    if (range < 1e-9) return 0;
    return Math.max(0, Math.min(100, ((raw - s.lo) / range) * 100));
  }

  // Etichette/colori derivati per la barra di order flow e i parametri del modello.
  $: flowText = (flowImbalance >= 0 ? '+' : '') + flowImbalance.toFixed(2);
  $: flowColor =
    flowImbalance > 0.1 ? 'var(--up)' : flowImbalance < -0.1 ? 'var(--down)' : 'var(--accent)';
  // Riempimento dal centro: bullish verso destra, bearish verso sinistra.
  $: flowFill =
    flowImbalance >= 0
      ? `left:50%; right:${50 - flowImbalance * 50}%;`
      : `left:${50 - Math.abs(flowImbalance) * 50}%; right:50%;`;

  $: modelParams = [
    { label: 'Volatility', pct: Math.round(volPctVal) },
    { label: 'Density', pct: Math.round(densPctVal) }
  ];

  function fit(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const [el, c] of [
      [scopeCanvas, scope],
      [gonioCanvas, gonio]
    ] as [HTMLCanvasElement, typeof scope][]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      c.w = r.width;
      c.h = r.height;
      el.width = Math.max(1, Math.floor(r.width * dpr));
      el.height = Math.max(1, Math.floor(r.height * dpr));
      c.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function readTimeDomain(a: AnalyserNode | null, buf: Float32Array): Float32Array | null {
    if (!a) return null;
    if (buf.length !== a.fftSize) buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    return buf;
  }

  function rms(buf: Float32Array): number {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function drawScope(): void {
    const c = scope;
    if (!c.ctx || !c.w) return;
    const { ctx, w, h } = c;
    const th = theme;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;

    ctx.strokeStyle = th.lineSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    const data = readTimeDomain(analyserMain, bufMain);
    if (analyserMain) bufMain = data ?? bufMain;
    if (!data) return;

    const amp = h * 0.46;
    const n = data.length;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 1) {
      const idx = Math.floor((x / w) * (n - 1));
      const v = Math.max(-1, Math.min(1, data[idx] * SCOPE_GAIN));
      const y = mid - v * amp;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function drawGonio(): void {
    const c = gonio;
    if (!c.ctx || !c.w) return;
    const { ctx, w, h } = c;
    const th = theme;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) / 2 - 4;

    // Graticola: cerchi + diagonali L/R.
    ctx.strokeStyle = th.lineSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.707, cy - R * 0.707);
    ctx.lineTo(cx + R * 0.707, cy + R * 0.707);
    ctx.moveTo(cx - R * 0.707, cy + R * 0.707);
    ctx.lineTo(cx + R * 0.707, cy - R * 0.707);
    ctx.stroke();

    ctx.fillStyle = th.faint;
    ctx.font = "8px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('L', cx - R * 0.78, cy - R * 0.78);
    ctx.fillText('R', cx + R * 0.78, cy - R * 0.78);
    ctx.fillText('+', cx, cy - R + 9);

    const dl = readTimeDomain(analyserL, bufL);
    const dr = readTimeDomain(analyserR, bufR);
    if (analyserL) bufL = dl ?? bufL;
    if (analyserR) bufR = dr ?? bufR;
    if (!dl || !dr) return;

    // Larghezza stereo da energia side/mid.
    let midE = 0;
    let sideE = 0;
    const n = Math.min(dl.length, dr.length);
    for (let i = 0; i < n; i++) {
      const m = (dl[i] + dr[i]) * 0.5;
      const s = (dl[i] - dr[i]) * 0.5;
      midE += m * m;
      sideE += s * s;
    }
    const wTarget = Math.sqrt(sideE) / (Math.sqrt(midE) + Math.sqrt(sideE) + 1e-6);
    stereoWidth += (wTarget - stereoWidth) * 0.1;

    // Traccia goniometro: campioni (L,R) ruotati 45° (mono => verticale).
    const step = Math.max(1, Math.floor(n / 160));
    const k = R * 0.7; // i campioni clampati [-1,1] restano dentro il cerchio
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i += step) {
      const L = Math.max(-1, Math.min(1, dl[i] * GONIO_GAIN));
      const Rr = Math.max(-1, Math.min(1, dr[i] * GONIO_GAIN));
      const x = cx + ((Rr - L) / Math.SQRT2) * k;
      const y = cy - ((L + Rr) / Math.SQRT2) * k;
      started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      started = true;
    }
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function loop(now: number): void {
    const dtMs = lastT ? Math.min(80, now - lastT) : 0;
    lastT = now;

    // Rampa lineare verso il target (0/1) a velocità 1 unità / FLOW_RAMP_MS.
    const stepMax = dtMs / FLOW_RAMP_MS;
    const diff = makerTarget - flowRamp;
    flowRamp += Math.max(-stepMax, Math.min(stepMax, diff));
    flowImbalance = 1 - 2 * flowRamp; // 0 => +1 bullish, 1 => -1 bearish

    // Normalizzazione adattiva density/volatility.
    if (calibrating && !prevCalibrating) {
      // Inizio cattura: azzera gli estremi della finestra.
      normVol.min = normDens.min = Infinity;
      normVol.max = normDens.max = -Infinity;
    } else if (!calibrating && prevCalibrating) {
      // Fine cattura: avvia il decadimento delle soglie verso 0 in 60s.
      normVol.hiRate = normVol.hi / DECAY_MS;
      normVol.loRate = normVol.lo / DECAY_MS;
      normDens.hiRate = normDens.hi / DECAY_MS;
      normDens.loRate = normDens.lo / DECAY_MS;
    }
    prevCalibrating = calibrating;
    const newTick = tickSeq !== lastSeq;
    lastSeq = tickSeq;
    volPctVal = stepNorm(normVol, volatilityRaw, newTick, dtMs);
    densPctVal = stepNorm(normDens, densityRaw, newTick, dtMs);

    drawScope();
    drawGonio();
    // Aggiorna l'etichetta di larghezza via DOM ref (no re-render) ogni ~8 frame.
    if (widthLabelEl && frame % 8 === 0) {
      widthLabelEl.textContent = Math.round(stereoWidth * 100) + '% W';
    }
    frame++;
    animationId = requestAnimationFrame(loop);
  }

  onMount(() => {
    scope.ctx = scopeCanvas.getContext('2d');
    gonio.ctx = gonioCanvas.getContext('2d');
    fit();
    resizeObserver = new ResizeObserver(() => fit());
    if (scopeCanvas.parentElement) resizeObserver.observe(scopeCanvas.parentElement);
    animationId = requestAnimationFrame(loop);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
  });
</script>

<div class="scope-panel">
  <div class="scope-row">
    <div class="osc">
      <span class="micro-label">Output · Waveform</span>
      <div class="osc-wrap"><canvas bind:this={scopeCanvas}></canvas></div>
    </div>
    <div class="gonio">
      <div class="gonio-head">
        <span class="micro-label">Vector</span>
        <span class="width-label" bind:this={widthLabelEl}>0% W</span>
      </div>
      <div class="gonio-wrap"><canvas bind:this={gonioCanvas}></canvas></div>
    </div>
  </div>

  <div class="bottom-row">
    <div class="flow">
      <div class="flow-head">
        <span class="nano-label">Order Flow Imbalance</span>
        <span class="flow-val" style="color:{flowColor}">{flowText}</span>
      </div>
      <div class="flow-bar">
        <div class="flow-center"></div>
        <div class="flow-fill" style="{flowFill} background:{flowColor}"></div>
      </div>
      <div class="flow-labels">
        <span>BEARISH</span><span>STAGNANT</span><span>BULLISH</span>
      </div>
    </div>

    <div class="v-divider"></div>

    <div class="model-params">
      {#each modelParams as m}
        <div class="param">
          <span class="nano-label">{m.label}</span>
          <span class="param-val">{m.pct}</span>
          <div class="param-track"><div class="param-fill" style="width:{m.pct}%"></div></div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .scope-panel {
    flex: none;
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: inset 0 1px 14px rgba(0, 0, 0, 0.35);
  }

  .scope-row {
    display: flex;
    gap: 14px;
    padding: 11px 14px 10px;
  }
  .osc {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .osc-wrap {
    position: relative;
    flex: 1;
    min-height: 108px;
  }
  .osc-wrap canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  .gonio {
    flex: none;
    width: 128px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gonio-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .gonio-wrap {
    width: 128px;
    height: 108px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gonio-wrap canvas {
    width: 108px;
    height: 108px;
    display: block;
  }
  .width-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .micro-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .nano-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--faint);
  }

  .bottom-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0 14px 12px;
    padding-top: 11px;
    border-top: 1px solid var(--lineSoft);
  }

  .flow {
    flex: none;
    width: 170px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .flow-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .flow-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    font-weight: 500;
  }
  .flow-bar {
    position: relative;
    height: 6px;
    background: var(--panel);
    border: 1px solid var(--lineSoft);
    border-radius: 4px;
  }
  .flow-center {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--faint);
  }
  .flow-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 3px;
    transition: left 0.18s ease, right 0.18s ease, background 0.18s ease;
  }
  .flow-labels {
    display: flex;
    justify-content: space-between;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 8px;
    color: var(--faint);
    letter-spacing: 0.08em;
  }

  .v-divider {
    width: 1px;
    align-self: stretch;
    background: var(--lineSoft);
  }

  .model-params {
    flex: 1;
    display: flex;
    gap: 18px;
  }
  .param {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .param-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    line-height: 1;
  }
  .param-track {
    height: 3px;
    background: var(--panel);
    border-radius: 2px;
    overflow: hidden;
  }
  .param-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.2s ease;
  }
</style>
