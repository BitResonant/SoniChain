<script lang="ts">
  import { onMount } from 'svelte';
  import CryptoChart from '../components/CryptoChart.svelte';
  import AudioControls from '../components/AudioControls.svelte';

  let cryptoData: number[] = Array(64).fill(0.5);
  let isCalibrating: boolean = false;
  let calibrationProgress: number = 0;
  let calibrationInterval: number;
  let remainingSeconds: number = 30;

  let audioContext: AudioContext | null = null;
  let rnboDevice: any = null;

  let masterVolume: number = 0.8;
  let currentScale: number = 0;
  let sensitivityStep: number = 1;

  onMount(() => {
    const bootstrap = async () => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });

      try {
        const response = await fetch('/DSP.export.json');
        const patcher = await response.json();

        if ((window as any).RNBO) {
          rnboDevice = await (window as any).RNBO.createDevice({ context: audioContext, patcher });
          rnboDevice.node.connect(audioContext.destination);
          setRnboParam('master_volume', masterVolume);
        }
      } catch (err) {
        console.error('[DSP Fault] Impossibile istanziare la patch RNBO:', err);
      }

      const CryptoWorker = new Worker(new URL('../crypto.worker.ts', import.meta.url), { type: 'module' });
      CryptoWorker.postMessage({ type: 'START', symbol: 'btcusdt' });

      CryptoWorker.onmessage = (event: MessageEvent) => {
        if (event.data.type === 'TICK') {
          const { price, market_volume, density, maker_side, volatility } = event.data.data;

          if (rnboDevice) {
            setRnboParam('price', price);
            setRnboParam('market_volume', market_volume);
            setRnboParam('density', density);
            setRnboParam('maker_side', maker_side);
            setRnboParam('volatility', volatility);
          }

          const displayNormalized = Math.max(0.0, Math.min(1.0, (price % 1000) / 1000));
          cryptoData = [...cryptoData.slice(1), displayNormalized];
        }
      };

      triggerCalibration();
    };

    bootstrap();

    return () => {
      if (calibrationInterval) clearInterval(calibrationInterval);
    };
  });

  function setRnboParam(paramName: string, value: number): void {
    if (!rnboDevice) return;
    try {
      const param = rnboDevice.parametersById.get(paramName);
      if (param) {
        param.value = value;
      }
    } catch (e) {
      console.warn(`[DSP Target Error] Parametro non trovato: ${paramName}`, e);
    }
  }

  function triggerCalibration(): void {
    if (isCalibrating) return;

    isCalibrating = true;
    calibrationProgress = 0;
    remainingSeconds = 30;

    setRnboParam('recalibration', 1);
    setTimeout(() => setRnboParam('recalibration', 0), 50);

    const totalDurationMs = 30000;
    const updateIntervalMs = 100;
    const step = (updateIntervalMs / totalDurationMs) * 100;

    calibrationInterval = window.setInterval(() => {
      calibrationProgress += step;
      remainingSeconds = Math.ceil((30 * (100 - calibrationProgress)) / 100);

      if (calibrationProgress >= 100) {
        clearInterval(calibrationInterval);
        isCalibrating = false;
        calibrationProgress = 0;
      }
    }, updateIntervalMs);
  }

  function handleVolume(linear: number) {
    masterVolume = linear;
    setRnboParam('master_volume', masterVolume);
  }

  function handleScale(index: number) {
    currentScale = index;
    setRnboParam('scale_selector', currentScale);
  }

  function handleSensitivity(step: number) {
    sensitivityStep = step;
    setRnboParam('sensitivity', sensitivityStep);
  }

  function handleTestTrigger() {
    setRnboParam('TEST', 1);
    setTimeout(() => setRnboParam('TEST', 0), 100);
  }
</script>

<main class="workspace">
  {#if isCalibrating}
    <div class="calibration-overlay">
      <div class="calibration-dialog">
        <p class="calibration-text">Calibration in progress...</p>
        <div class="progress-bar-container">
          <div class="progress-bar-fill" style="width: {calibrationProgress}%"></div>
        </div>
        <p class="calibration-subtext">{remainingSeconds}s rimanenti</p>
      </div>
    </div>
  {/if}

  <header class="app-header">
    <h1>SoniFyer Core - Engine Standalone</h1>
    <button class="btn-recal" on:click={triggerCalibration}>Recalibration</button>
  </header>

  <div class="interface-layout">
    <section class="visual-viewport">
      <CryptoChart dataBuffer={cryptoData} />
    </section>

    <section class="control-viewport">
      <AudioControls
        {masterVolume}
        {sensitivityStep}
        {currentScale}
        onVolumeChange={handleVolume}
        onScaleChange={handleScale}
        onSensitivityChange={handleSensitivity}
        onTestClick={handleTestTrigger}
      />
    </section>
  </div>
</main>

<style>
  :global(body) {
    background-color: #08080a;
    color: #e2e2e9;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    margin: 0;
    padding: 20px;
    user-select: none;
  }

  .workspace {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #1a1a24;
    padding-bottom: 15px;
    margin-bottom: 20px;
  }

  h1 {
    font-size: 1.4rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .btn-recal {
    background: #1a1a24;
    color: #ff3b30;
    border: 1px solid #3a3a4c;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .btn-recal:hover {
    background: #2a2a3c;
    border-color: #ff3b30;
  }

  .interface-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }

  @media (min-width: 768px) {
    .interface-layout {
      grid-template-columns: 2fr 1fr;
    }
  }

  .calibration-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(5, 5, 8, 0.94);
    backdrop-filter: blur(10px);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .calibration-dialog {
    background: #121218;
    border: 1px solid #222230;
    padding: 40px;
    border-radius: 12px;
    text-align: center;
    width: 320px;
  }

  .calibration-text {
    font-size: 1.1rem;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 20px;
    letter-spacing: 0.05em;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: #1c1c24;
    border-radius: 3px;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #00ff88, #0a8ef0);
    border-radius: 3px;
    transition: width 0.1s linear;
  }

  .calibration-subtext {
    margin-top: 16px;
    color: #8e8e9b;
    font-size: 0.9rem;
  }

  .visual-viewport {
    min-height: 360px;
  }

  .control-viewport {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
</style>
