<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Theme } from '../themes';
  import { help, HELP } from '../help';

  export let theme: Theme;
  // Real analysis nodes on the audio output bus.
  export let analyserMain: AnalyserNode | null = null;
  export let analyserL: AnalyserNode | null = null;
  export let analyserR: AnalyserNode | null = null;
  // Raw market values; the adaptive normalization with thresholds is below.
  // tickSeq changes on each new tick; calibrating = min/max capture window
  // (applies to both the initial calibration and the recalibrate).
  export let volatilityRaw: number = 0;
  export let densityRaw: number = 0;
  export let tickSeq: number = 0;
  export let calibrating: boolean = false;
  // Raw maker_side, identical to the RNBO patch: 0 = taker buyer, 1 = taker seller.
  // 0.5 = neutral (no data yet).
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

  // Order Flow Imbalance: linear ramp toward maker_side that reaches the
  // target in 1000ms (same logic as the RNBO patch). flowRamp ∈ [0,1]:
  // 0 => bullish, 1 => bearish. Shows the "tug of war" between the two extremes.
  let flowRamp = 0.5;
  let flowImbalance = 0; // +1 = bullish, -1 = bearish (derived from the ramp)
  const FLOW_RAMP_MS = 3000;

  // Reused buffers for the time-domain reads.
  let bufMain = new Float32Array(2048);
  let bufL = new Float32Array(2048);
  let bufR = new Float32Array(2048);

  let stereoWidth = 0; // 0 = mono, ~1 = wide

  // Gain for the visualization ONLY (does not affect the audio): the real
  // signal has a tiny amplitude, here we amplify it to fill the usable range.
  const SCOPE_GAIN = 8;
  const GONIO_GAIN = 8;

  // ---- Adaptive normalization with thresholds (density & volatility) ----
  // During calibration it captures min/max within the time window. At steady
  // state the thresholds decay linearly toward 0 over 60s and "snap" to the new peak
  // when the value exceeds them. Output rescaled to 0..100.
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
      // Capture: update the window extremes and use them as the current range.
      if (newTick) {
        if (raw < s.min) s.min = raw;
        if (raw > s.max) s.max = raw;
      }
      s.lo = s.min === Infinity ? 0 : s.min;
      s.hi = s.max === -Infinity ? Math.max(raw, 1e-9) : s.max;
    } else {
      // Steady state: snap to the new peak + linear decay toward 0 over 60s.
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

  // Derived labels/colors for the order flow bar and the model parameters.
  $: flowText = (flowImbalance >= 0 ? '+' : '') + flowImbalance.toFixed(2);
  $: flowColor =
    flowImbalance > 0.1 ? 'var(--up)' : flowImbalance < -0.1 ? 'var(--down)' : 'var(--accent)';
  // Fill from the center: bullish toward the right, bearish toward the left.
  $: flowFill =
    flowImbalance >= 0
      ? `left:50%; right:${50 - flowImbalance * 50}%;`
      : `left:${50 - Math.abs(flowImbalance) * 50}%; right:50%;`;

  $: modelParams = [
    { label: 'Volatility', pct: Math.round(volPctVal), help: HELP.volatility },
    { label: 'Density', pct: Math.round(densPctVal), help: HELP.density }
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

  function readTimeDomain(a: AnalyserNode | null, buf: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> | null {
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

    // Graticule: circles + L/R diagonals.
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

    // Stereo width from side/mid energy.
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

    // Goniometer trace: (L,R) samples rotated 45° (mono => vertical).
    const step = Math.max(1, Math.floor(n / 160));
    const k = R * 0.7; // samples clamped to [-1,1] stay inside the circle
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

    // Linear ramp toward the target (0/1) at a speed of 1 unit / FLOW_RAMP_MS.
    const stepMax = dtMs / FLOW_RAMP_MS;
    const diff = makerTarget - flowRamp;
    flowRamp += Math.max(-stepMax, Math.min(stepMax, diff));
    flowImbalance = 1 - 2 * flowRamp; // 0 => +1 bullish, 1 => -1 bearish

    // Adaptive density/volatility normalization.
    if (calibrating && !prevCalibrating) {
      // Capture start: reset the window extremes.
      normVol.min = normDens.min = Infinity;
      normVol.max = normDens.max = -Infinity;
    } else if (!calibrating && prevCalibrating) {
      // Capture end: start the decay of the thresholds toward 0 over 60s.
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
    // Update the width label via DOM ref (no re-render) every ~8 frames.
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
    <div class="osc" use:help={HELP.waveform}>
      <span class="micro-label">Output · Waveform</span>
      <div class="osc-wrap"><canvas bind:this={scopeCanvas}></canvas></div>
    </div>
    <div class="gonio" use:help={HELP.vector}>
      <div class="gonio-head">
        <span class="micro-label">Vector</span>
        <span class="width-label" bind:this={widthLabelEl}>0% W</span>
      </div>
      <div class="gonio-wrap"><canvas bind:this={gonioCanvas}></canvas></div>
    </div>
  </div>

  <div class="bottom-row">
    <div class="flow" use:help={HELP.orderflow}>
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
        <div class="param" use:help={m.help}>
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
