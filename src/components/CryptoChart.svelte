<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Theme } from '../themes';
  import { help, HELP } from '../help';

  export let dataBuffer: number[] = [];
  export let theme: Theme;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  let resizeObserver: ResizeObserver | null = null;

  let logicalWidth = 0;
  let logicalHeight = 0;

  // Buffer realmente disegnato: insegue dataBuffer con smoothing esponenziale,
  // smorzando lo "scatto" dei tick discreti del websocket.
  let renderBuffer: number[] = [];
  let lastFrameTime = 0;
  const SMOOTH_TAU = 0.12;

  function calculateLayout(): void {
    if (!canvas || !canvas.parentElement) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    logicalWidth = rect.width;
    logicalHeight = rect.height;
    canvas.width = Math.max(1, Math.floor(logicalWidth * dpr));
    canvas.height = Math.max(1, Math.floor(logicalHeight * dpr));
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Catmull-Rom -> Bézier: curva morbida passante per i punti.
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

    const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0;
    lastFrameTime = now;

    if (renderBuffer.length !== dataBuffer.length) {
      renderBuffer = dataBuffer.slice();
    } else if (dt > 0) {
      const alpha = 1 - Math.exp(-dt / SMOOTH_TAU);
      for (let i = 0; i < renderBuffer.length; i++) {
        renderBuffer[i] += (dataBuffer[i] - renderBuffer[i]) * alpha;
      }
    }

    const W = logicalWidth;
    const H = logicalHeight;
    const th = theme;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = th.panel2;
    ctx.fillRect(0, 0, W, H);

    if (renderBuffer.length < 2) {
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // Range dinamico con margine.
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
    const range = max - min;
    const pad = range > 0 ? range * 0.18 : Math.abs(max) * 0.0015 || 1;
    min -= pad;
    max += pad;
    const span = max - min || 1;

    const X = (i: number) => (i / (renderBuffer.length - 1)) * W;
    const Y = (v: number) => H - ((v - min) / span) * (H - 16) - 8;

    // Griglia orizzontale.
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (H / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    const points = renderBuffer.map((v, i) => ({ x: X(i), y: Y(v) }));
    const last = points[points.length - 1];

    // Area sotto la curva.
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(points[0].x, points[0].y);
    tracePath(points);
    ctx.lineTo(W, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.accentSoft);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Linea principale.
    ctx.beginPath();
    tracePath(points);
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Guida orizzontale tratteggiata al valore corrente + punto di testa.
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = th.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, last.y);
    ctx.lineTo(W, last.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(last.x - 2, last.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = th.accent;
    ctx.fill();

    animationId = requestAnimationFrame(renderLoop);
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: false });
    calculateLayout();
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

<div class="chart-panel" use:help={HELP.chart}>
  <canvas bind:this={canvas}></canvas>
  <span class="corner-label">Price · 64-tick window</span>
</div>

<style>
  .chart-panel {
    flex: 1;
    min-height: 170px;
    position: relative;
    overflow: hidden;
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: inset 0 1px 14px rgba(0, 0, 0, 0.35);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .corner-label {
    position: absolute;
    top: 12px;
    left: 14px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
    pointer-events: none;
  }
</style>
