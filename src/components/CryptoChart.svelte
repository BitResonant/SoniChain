<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let dataBuffer: number[] = [];
  // Etichetta dell'asset mostrata nell'intestazione del grafico.
  export let assetLabel: string = 'SIGNAL';
  // Stato della sorgente dati: 'live' | 'connecting' | 'idle'
  export let status: 'live' | 'connecting' | 'idle' = 'live';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let resizeObserver: ResizeObserver | null = null;

  // Cache delle dimensioni logiche per evitare letture DOM nel render loop.
  let logicalWidth = 0;
  let logicalHeight = 0;

  // Buffer realmente disegnato: insegue dataBuffer un frame alla volta con
  // smoothing esponenziale, smorzando lo "scatto" dei tick discreti.
  let renderBuffer: number[] = [];
  let lastFrameTime = 0;
  // Costante di tempo (s) dello smorzamento: più alta = più morbido (e più lento).
  const SMOOTH_TAU = 0.12;

  // Palette del grafico (allineata ai token globali del tema).
  const COL = {
    accent: '#cf7e36',
    accentSoft: '#df9b50',
    grid: 'rgba(190, 165, 135, 0.055)',
    gridStrong: 'rgba(190, 165, 135, 0.11)',
    axisText: 'rgba(190, 165, 135, 0.4)',
    bgTop: '#181410',
    bgBottom: '#110e0a'
  };

  // Geometria interna: lascia spazio per le etichette di prezzo sull'asse.
  const PAD = { top: 16, right: 66, bottom: 22, left: 14 };

  // Formattazione prezzo adattiva: la precisione segue il passo tra le linee
  // della griglia, così funziona sia per BTC (~60'000) che per coppie ~1.0000.
  function fmtPrice(v: number, step: number): string {
    let decimals: number;
    if (step >= 50) decimals = 0;
    else if (step >= 5) decimals = 1;
    else if (step >= 0.5) decimals = 2;
    else if (step >= 0.05) decimals = 3;
    else if (step >= 0.005) decimals = 4;
    else decimals = 5;
    return v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function calculateLayout(): void {
    if (!canvas || !canvas.parentElement) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    logicalWidth = rect.width;
    logicalHeight = rect.height;
    canvas.width = Math.max(1, Math.floor(logicalWidth * dpr));
    canvas.height = Math.max(1, Math.floor(logicalHeight * dpr));
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // Catmull-Rom -> Bézier: traccia una curva morbida passante per i punti.
  function tracePath(points: { x: number; y: number }[]): void {
    if (!ctx || points.length === 0) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
  }

  function renderLoop(now: number): void {
    if (!ctx) {
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // --- Interpolazione temporale (frame-rate independent) ---
    // dt clampato: dopo un tab in background non "salta" in un solo frame.
    const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0;
    lastFrameTime = now;

    if (renderBuffer.length !== dataBuffer.length) {
      // Prima sincronizzazione (o cambio dimensione): parti dai valori reali.
      renderBuffer = dataBuffer.slice();
    } else if (dt > 0) {
      // Ogni campione insegue il proprio target di una frazione per frame.
      // Quando il buffer scorre, i target diventano i valori adiacenti e
      // la curva "scivola" verso sinistra in modo continuo.
      const alpha = 1 - Math.exp(-dt / SMOOTH_TAU);
      for (let i = 0; i < renderBuffer.length; i++) {
        renderBuffer[i] += (dataBuffer[i] - renderBuffer[i]) * alpha;
      }
    }

    const W = logicalWidth;
    const H = logicalHeight;
    const plotX = PAD.left;
    const plotY = PAD.top;
    const plotW = Math.max(1, W - PAD.left - PAD.right);
    const plotH = Math.max(1, H - PAD.top - PAD.bottom);

    // --- Sfondo: gradiente verticale profondo ---
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COL.bgTop);
    bg.addColorStop(1, COL.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (renderBuffer.length < 2) {
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // --- Range dinamico con margine per non appiattire la traccia ---
    let min = Infinity;
    let max = -Infinity;
    for (const v of renderBuffer) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max)) {
      min = 0;
      max = 1;
    }
    // Margine sopra/sotto la traccia; se il buffer è piatto usa un margine
    // proporzionale alla grandezza del prezzo per non appiattire la linea.
    const range = max - min;
    const pad = range > 0 ? range * 0.12 : Math.abs(max) * 0.0015 || 0.05;
    const lo = min - pad;
    const hi = max + pad;
    const span = hi - lo || 1;

    const toY = (v: number) => plotY + plotH - ((v - lo) / span) * plotH;
    const gridStep = span / 4;

    // --- Griglia orizzontale + etichette percentuali a destra ---
    ctx.lineWidth = 1;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'middle';
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const y = plotY + plotH * t;
      ctx.strokeStyle = i === rows ? COL.gridStrong : COL.grid;
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();

      const val = hi - (hi - lo) * t;
      ctx.fillStyle = COL.axisText;
      ctx.textAlign = 'left';
      ctx.fillText(fmtPrice(val, gridStep), plotX + plotW + 8, y);
    }

    // --- Griglia verticale tenue ---
    const cols = 6;
    for (let i = 1; i < cols; i++) {
      const x = plotX + (plotW * i) / cols;
      ctx.strokeStyle = COL.grid;
      ctx.beginPath();
      ctx.moveTo(x, plotY);
      ctx.lineTo(x, plotY + plotH);
      ctx.stroke();
    }

    // --- Punti della serie ---
    const stepX = plotW / (renderBuffer.length - 1);
    const points = renderBuffer.map((v, i) => ({ x: plotX + i * stepX, y: toY(v) }));
    const last = points[points.length - 1];

    // --- Riempimento ad area sotto la curva (gradiente verticale) ---
    ctx.save();
    ctx.beginPath();
    tracePath(points);
    ctx.lineTo(last.x, plotY + plotH);
    ctx.lineTo(points[0].x, plotY + plotH);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
    fill.addColorStop(0, 'rgba(207, 126, 54, 0.20)');
    fill.addColorStop(0.5, 'rgba(207, 126, 54, 0.06)');
    fill.addColorStop(1, 'rgba(207, 126, 54, 0)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    // --- Linea principale con glow ---
    ctx.save();
    const stroke = ctx.createLinearGradient(plotX, 0, plotX + plotW, 0);
    stroke.addColorStop(0, COL.accentSoft);
    stroke.addColorStop(1, COL.accent);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(207, 126, 54, 0.45)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    tracePath(points);
    ctx.stroke();
    ctx.restore();

    // --- Linea guida verticale al punto corrente ---
    ctx.strokeStyle = 'rgba(207, 126, 54, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(last.x, plotY);
    ctx.lineTo(last.x, plotY + plotH);
    ctx.stroke();

    // --- Punto di testa con anello pulsante ---
    const pulse = (Math.sin(now / 420) + 1) / 2; // 0..1
    ctx.save();
    ctx.fillStyle = 'rgba(207, 126, 54, 0.14)';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.accent;
    ctx.shadowColor = 'rgba(207, 126, 54, 0.5)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Etichetta valore corrente accanto al punto di testa ---
    const curVal = renderBuffer[renderBuffer.length - 1];
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const tag = fmtPrice(curVal, gridStep);
    const tagW = ctx.measureText(tag).width + 14;
    let tagX = last.x + 10;
    if (tagX + tagW > plotX + plotW) tagX = last.x - 10 - tagW;
    const tagY = Math.min(Math.max(last.y, plotY + 10), plotY + plotH - 10);
    ctx.fillStyle = 'rgba(207, 126, 54, 0.14)';
    roundRect(ctx, tagX, tagY - 10, tagW, 20, 5);
    ctx.fill();
    ctx.fillStyle = COL.accent;
    ctx.fillText(tag, tagX + 7, tagY + 0.5);

    animationId = requestAnimationFrame(renderLoop);
  }

  function roundRect(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: false });
    calculateLayout();
    // Osserva direttamente il contenitore: gestisce ridimensionamenti della
    // finestra e cambi di larghezza della colonna senza falsare il layout.
    if (canvas.parentElement && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => calculateLayout());
      resizeObserver.observe(canvas.parentElement);
    }
    animationId = requestAnimationFrame(renderLoop);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
  });
</script>

<div class="chart-card">
  <div class="chart-head">
    <div class="chart-title">
      <span class="dot {status}"></span>
      <span class="asset">{assetLabel}</span>
    </div>
    <div class="chart-meta">
      <span class="meta-label">SIGNAL FEED</span>
      <span class="meta-status {status}">
        {status === 'live' ? 'LIVE' : status === 'connecting' ? 'SYNC' : 'IDLE'}
      </span>
    </div>
  </div>

  <div class="render-viewport">
    <canvas bind:this={canvas}></canvas>
  </div>
</div>

<style>
  .chart-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-width: 0;
    background: var(--bg-2, #141925);
    border: 1px solid var(--border, rgba(255, 255, 255, 0.07));
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 20px 50px -28px rgba(0, 0, 0, 0.9);
  }

  .chart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.07));
  }

  .chart-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .asset {
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-hi, #eef1f7);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent, #cf7e36);
    box-shadow: 0 0 6px rgba(207, 126, 54, 0.5);
  }
  .dot.live {
    animation: pulse 1.6s ease-in-out infinite;
  }
  .dot.connecting {
    background: var(--warn, #d3a749);
    box-shadow: 0 0 6px rgba(211, 167, 73, 0.5);
  }
  .dot.idle {
    background: var(--text-lo, #6f655a);
    box-shadow: none;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .chart-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .meta-label {
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    color: var(--text-lo, #5d6678);
    font-weight: 600;
  }

  .meta-status {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border-radius: 5px;
    color: var(--accent, #cf7e36);
    background: rgba(207, 126, 54, 0.12);
    border: 1px solid rgba(207, 126, 54, 0.24);
  }
  .meta-status.connecting {
    color: var(--warn, #d3a749);
    background: rgba(211, 167, 73, 0.12);
    border-color: rgba(211, 167, 73, 0.24);
  }
  .meta-status.idle {
    color: var(--text-lo, #6f655a);
    background: rgba(190, 165, 135, 0.08);
    border-color: rgba(190, 165, 135, 0.15);
  }

  .render-viewport {
    position: relative;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 240px;
  }

  /* Posizionamento assoluto: il canvas non contribuisce alla dimensione
     intrinseca del layout, evitando che la griglia si "incastri" allargandosi. */
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
