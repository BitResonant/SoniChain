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

  // Cache delle dimensioni logiche per evitare letture DOM nel render loop.
  let logicalWidth = 0;
  let logicalHeight = 0;

  // Palette del grafico (allineata ai token globali del tema).
  const COL = {
    accent: '#2dd4bf',
    accentSoft: '#38bdf8',
    grid: 'rgba(148, 163, 184, 0.07)',
    gridStrong: 'rgba(148, 163, 184, 0.14)',
    axisText: 'rgba(148, 163, 184, 0.45)',
    bgTop: '#0d1320',
    bgBottom: '#0a0e18'
  };

  // Geometria interna: lascia spazio per le etichette dell'asse.
  const PAD = { top: 16, right: 52, bottom: 22, left: 14 };

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

    if (dataBuffer.length < 2) {
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // --- Range dinamico con margine per non appiattire la traccia ---
    let min = Infinity;
    let max = -Infinity;
    for (const v of dataBuffer) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max)) {
      min = 0;
      max = 1;
    }
    const pad = (max - min) * 0.12 || 0.05;
    const lo = Math.max(0, min - pad);
    const hi = Math.min(1, max + pad) || lo + 0.1;
    const span = hi - lo || 1;

    const toY = (v: number) => plotY + plotH - ((v - lo) / span) * plotH;

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

      const val = Math.round((hi - (hi - lo) * t) * 100);
      ctx.fillStyle = COL.axisText;
      ctx.textAlign = 'left';
      ctx.fillText(`${val}%`, plotX + plotW + 8, y);
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
    const stepX = plotW / (dataBuffer.length - 1);
    const points = dataBuffer.map((v, i) => ({ x: plotX + i * stepX, y: toY(v) }));
    const last = points[points.length - 1];

    // --- Riempimento ad area sotto la curva (gradiente verticale) ---
    ctx.save();
    ctx.beginPath();
    tracePath(points);
    ctx.lineTo(last.x, plotY + plotH);
    ctx.lineTo(points[0].x, plotY + plotH);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, plotY, 0, plotY + plotH);
    fill.addColorStop(0, 'rgba(45, 212, 191, 0.30)');
    fill.addColorStop(0.5, 'rgba(45, 212, 191, 0.08)');
    fill.addColorStop(1, 'rgba(45, 212, 191, 0)');
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
    ctx.shadowColor = COL.accent;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    tracePath(points);
    ctx.stroke();
    ctx.restore();

    // --- Linea guida verticale al punto corrente ---
    ctx.strokeStyle = 'rgba(45, 212, 191, 0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(last.x, plotY);
    ctx.lineTo(last.x, plotY + plotH);
    ctx.stroke();

    // --- Punto di testa con anello pulsante ---
    const pulse = (Math.sin(now / 420) + 1) / 2; // 0..1
    ctx.save();
    ctx.fillStyle = 'rgba(45, 212, 191, 0.18)';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 6 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.accent;
    ctx.shadowColor = COL.accent;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- Etichetta valore corrente accanto al punto di testa ---
    const curVal = Math.round(dataBuffer[dataBuffer.length - 1] * 100);
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const tag = `${curVal}%`;
    const tagW = ctx.measureText(tag).width + 14;
    let tagX = last.x + 10;
    if (tagX + tagW > plotX + plotW) tagX = last.x - 10 - tagW;
    const tagY = Math.min(Math.max(last.y, plotY + 10), plotY + plotH - 10);
    ctx.fillStyle = 'rgba(45, 212, 191, 0.14)';
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
    window.addEventListener('resize', calculateLayout);
    animationId = requestAnimationFrame(renderLoop);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', calculateLayout);
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
    background: var(--accent, #2dd4bf);
    box-shadow: 0 0 10px var(--accent, #2dd4bf);
  }
  .dot.live {
    animation: pulse 1.6s ease-in-out infinite;
  }
  .dot.connecting {
    background: #f5b53f;
    box-shadow: 0 0 10px #f5b53f;
  }
  .dot.idle {
    background: var(--text-lo, #5d6678);
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
    color: var(--accent, #2dd4bf);
    background: rgba(45, 212, 191, 0.12);
    border: 1px solid rgba(45, 212, 191, 0.25);
  }
  .meta-status.connecting {
    color: #f5b53f;
    background: rgba(245, 181, 63, 0.12);
    border-color: rgba(245, 181, 63, 0.25);
  }
  .meta-status.idle {
    color: var(--text-lo, #5d6678);
    background: rgba(148, 163, 184, 0.08);
    border-color: rgba(148, 163, 184, 0.15);
  }

  .render-viewport {
    position: relative;
    flex: 1;
    width: 100%;
    min-height: 300px;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
