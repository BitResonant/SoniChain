<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let dataBuffer: number[] = [];

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number;
  
  // Cache delle dimensioni per evitare chiamate DOM costose nel render loop
  let logicalWidth: number = 0;
  let logicalHeight: number = 0;

  // Ricalcolo vettoriale triggerato solo dagli eventi di resize della finestra
  function calculateLayout(): void {
    if (!canvas || !canvas.parentElement) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    
    logicalWidth = rect.width;
    logicalHeight = rect.height;
    
    // Allocazione buffer pixel fisici
    canvas.width = logicalWidth * dpr;
    canvas.height = logicalHeight * dpr;
    
    if (ctx) {
      // Normalizzazione dello spazio di coordinate vettoriali
      ctx.scale(dpr, dpr);
    }
  }

  // Loop di rasterizzazione dedicato
  function renderLoop(): void {
    if (!ctx || dataBuffer.length === 0) {
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // Fast clear del frame buffer
    ctx.fillStyle = '#0a0a0c'; 
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    // Setup raster line style
    ctx.strokeStyle = '#00ff88'; // Verde fluorescente ad alto contrasto
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();
    
    // Pre-calcolo dello step sull'asse X per evitare divisioni ad ogni iterazione
    const stepX = logicalWidth / (dataBuffer.length - 1 || 1);

    for (let i = 0; i < dataBuffer.length; i++) {
      const x = i * stepX;
      // Inversione geometrica dell'asse Y (origine in alto a sinistra nel Canvas)
      const y = logicalHeight - (dataBuffer[i] * logicalHeight);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.stroke();
    animationId = requestAnimationFrame(renderLoop);
  }

  onMount(() => {
    // Flag alpha:false istruisce la GPU a ignorare i canali di trasparenza per questo layer
    ctx = canvas.getContext('2d', { alpha: false });
    
    calculateLayout();
    window.addEventListener('resize', calculateLayout);
    
    // Iniezione nel ciclo di refresh del display
    animationId = requestAnimationFrame(renderLoop);
  });

  onDestroy(() => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', calculateLayout);
  });
</script>

<div class="render-viewport">
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .render-viewport {
    width: 100%;
    height: 100%;
    min-height: 280px;
    background-color: #0a0a0c;
    border: 1px solid #1c1c24;
    border-radius: 8px;
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>