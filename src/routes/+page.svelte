<script lang="ts">
  import { onMount } from 'svelte';
  import * as RNBO from '@rnbo/js';
  import CryptoChart from '../components/CryptoChart.svelte';
  import AudioControls from '../components/AudioControls.svelte';

  let cryptoData: number[] = Array(64).fill(0.5);

  type CalibrationPhase = 'initial-connecting' | 'pending-calibrate' | 'recal-connecting' | 'calibrating' | 'idle';
  let calibrationPhase: CalibrationPhase = 'initial-connecting';
  let calibrationProgress: number = 0;
  let calibrationInterval: number;
  let remainingSeconds: number = 30;

  let audioContext: AudioContext | null = null;
  let rnboDevice: any = null;
  let isRnboReady: boolean = false;
  let streamIsReady: boolean = false;
  let hasCalibrated: boolean = false;

  // Both must be true before the Calibrate button appears on first load.
  let initialConnectStreamReady: boolean = false;
  let initialConnectTimerDone: boolean = false;

  let masterVolume: number = 0;
  let currentScale: number = 0;
  let sensitivityStep: number = 1;
  let currentCrypto: string = 'btcusdt';

  let cryptoWorker: Worker | null = null;

  function maybeShowCalibrate(): void {
    if (!isRnboReady || !initialConnectStreamReady || !initialConnectTimerDone) return;
    if (calibrationPhase === 'initial-connecting') {
      calibrationPhase = 'pending-calibrate';
    }
  }

  onMount(() => {
    // Minimum 3-second "Connecting..." display on first load.
    setTimeout(() => {
      initialConnectTimerDone = true;
      maybeShowCalibrate();
    }, 3000);

    const bootstrap = async () => {
      try {
        console.log('[Bootstrap] Starting RNBO initialization...');

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });
        console.log('[AudioContext] Created with state:', audioContext?.state);

        const response = await fetch(`/DSP.export.json?v=${Date.now()}`);
        if (!response.ok) throw new Error(`Failed to fetch DSP.export.json: ${response.status}`);
        const patcher = await response.json();
        console.log('[Bootstrap] DSP patcher loaded');

        rnboDevice = await RNBO.createDevice({ context: audioContext, patcher });
        console.log('[RNBO] Device created successfully');
        console.log('[RNBO] Available parameters:', Array.from(rnboDevice.parametersById.keys()));

        rnboDevice.node.connect(audioContext.destination);

        if (audioContext?.state === 'suspended') {
          await audioContext.resume();
          console.log('[AudioContext] Resumed from suspended state');
        }

        isRnboReady = true;
        console.log('[Bootstrap] RNBO initialization complete - device ready');

        setRnboParam('master_volume', masterVolume);
        setRnboParam('scaling/sensitivity', sensitivityStep);
        setRnboParam('resonators/scales/scale_selector', currentScale);

        maybeShowCalibrate();
      } catch (err) {
        console.error('[Bootstrap] Initialization failed:', err);
      }
    };

    const initCryptoWorker = () => {
      try {
        cryptoWorker = new Worker(new URL('../crypto.worker.ts', import.meta.url), { type: 'module' });
        cryptoWorker.postMessage({ type: 'START', symbol: currentCrypto });
        console.log('[Bootstrap] Crypto worker started');

        cryptoWorker.onmessage = (event: MessageEvent) => {
          if (event.data.type === 'STREAM_READY') {
            console.debug('[Worker -> Main] Stream ready');
            streamIsReady = true;

            if (!hasCalibrated) {
              initialConnectStreamReady = true;
              if (isRnboReady) maybeShowCalibrate();
            } else {
              // Recalibration reconnect: switch phase and fire RNBO signal.
              if (calibrationPhase === 'recal-connecting') {
                calibrationPhase = 'calibrating';
                triggerRnboRecalibration();
              }
            }
            return;
          }

          if (event.data.type === 'TICK') {
            const { price, market_volume, density, maker_side, volatility } = event.data.data;
            console.debug('[Worker -> Main] Tick received', { price, market_volume, density, maker_side, volatility });

            if (isRnboReady && rnboDevice && streamIsReady) {
              logRnboMessage('WORKER', 'price', price);
              setRnboParam('price', price);
              logRnboMessage('WORKER', 'market_volume', market_volume);
              setRnboParam('market_volume', market_volume);
              logRnboMessage('WORKER', 'density', density);
              setRnboParam('density', density);
              logRnboMessage('WORKER', 'maker_side', maker_side);
              setRnboParam('maker_side', maker_side);
              logRnboMessage('WORKER', 'volatility', volatility);
              setRnboParam('volatility', volatility);
            }

            const displayNormalized = Math.max(0.0, Math.min(1.0, (price % 1000) / 1000));
            cryptoData = [...cryptoData.slice(1), displayNormalized];
          }
        };
      } catch (err) {
        console.error('[Bootstrap] Failed to initialize crypto worker:', err);
      }
    };

    bootstrap();
    initCryptoWorker();

    return () => {
      if (calibrationInterval) clearInterval(calibrationInterval);
    };
  });

  function logRnboMessage(source: string, paramName: string, value: number): void {
    console.info(`[RNBO MESSAGE] [${source}] ${paramName} = ${value}`);
  }

  function setRnboParam(paramName: string, value: number): void {
    if (!isRnboReady || !rnboDevice) {
      console.warn(`[RNBO] Device not ready when setting ${paramName}`);
      return;
    }
    logRnboMessage('SET', paramName, value);
    try {
      const param = rnboDevice.parametersById.get(paramName);
      if (param) {
        param.value = value;
        console.debug(`[RNBO] ✓ Set ${paramName} = ${value}`);
      } else {
        console.warn(`[RNBO] ✗ Parameter not found: ${paramName}. Available:`, Array.from(rnboDevice.parametersById.keys()));
      }
    } catch (e) {
      console.error(`[RNBO] Error setting ${paramName} = ${value}:`, e);
    }
  }

  function rampVolume(target: number, durationMs: number): void {
    const start = masterVolume;
    const t0 = performance.now();
    function tick(now: number) {
      const progress = Math.min((now - t0) / durationMs, 1);
      masterVolume = start + (target - start) * progress;
      setRnboParam('master_volume', masterVolume);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function startCalibrationTimer(): void {
    if (calibrationInterval) clearInterval(calibrationInterval);
    calibrationProgress = 0;
    remainingSeconds = 30;
    const totalDurationMs = 30000;
    const updateIntervalMs = 100;
    const step = (updateIntervalMs / totalDurationMs) * 100;
    calibrationInterval = window.setInterval(() => {
      calibrationProgress += step;
      remainingSeconds = Math.ceil((30 * (100 - calibrationProgress)) / 100);
      if (calibrationProgress >= 100) {
        clearInterval(calibrationInterval);
        calibrationPhase = 'idle';
        calibrationProgress = 0;
        rampVolume(0.5, 100);
      }
    }, updateIntervalMs);
  }

  function triggerRnboRecalibration(): void {
    setRnboParam('scaling/recalibration', 0);
    setTimeout(() => {
      setRnboParam('scaling/recalibration', 1);
      setTimeout(() => setRnboParam('scaling/recalibration', 0), 200);
    }, 50);
  }

  // Called by the "Calibrate" button on first load.
  function startCalibration(): void {
    audioContext?.resume();
    hasCalibrated = true;
    calibrationPhase = 'calibrating';
    startCalibrationTimer();
    triggerRnboRecalibration();
  }

  // Called by the "Recalibration" header button.
  // Reconnects the websocket so STREAM_READY fires the RNBO signal once data is clean.
  // The visual timer starts immediately so the progress bar is visible during the connect phase.
  function triggerCalibration(): void {
    if (!isRnboReady) {
      console.warn('[Calibration] Deferred - RNBO not ready yet');
      return;
    }
    masterVolume = 0;
    setRnboParam('master_volume', 0);
    streamIsReady = false;
    calibrationPhase = 'recal-connecting';
    startCalibrationTimer();
    cryptoWorker?.postMessage({ type: 'SWITCH', symbol: currentCrypto });
  }

  function handleVolume(linear: number) {
    masterVolume = linear;
    console.debug(`[UI] Volume changed to: ${linear}`);
    logRnboMessage('UI', 'master_volume', linear);
    setRnboParam('master_volume', masterVolume);
  }

  function handleScale(index: number) {
    currentScale = index;
    const scaleValue = Number(index);
    console.debug(`[UI] Scale changed to: ${scaleValue}`);
    logRnboMessage('UI', 'resonators/scales/scale_selector', scaleValue);
    if (isRnboReady) setRnboParam('resonators/scales/scale_selector', scaleValue);
  }

  function handleSensitivity(step: number) {
    sensitivityStep = step;
    const sensitivityValue = Number(step);
    console.debug(`[UI] Sensitivity changed to: ${sensitivityValue}`);
    logRnboMessage('UI', 'scaling/sensitivity', sensitivityValue);
    if (isRnboReady) setRnboParam('scaling/sensitivity', sensitivityValue);
  }

  function handleCryptoChange(symbol: string) {
    if (symbol === currentCrypto) return;
    currentCrypto = symbol;
    streamIsReady = false;

    if (hasCalibrated) {
      masterVolume = 0;
      setRnboParam('master_volume', 0);
      calibrationPhase = 'recal-connecting';
      startCalibrationTimer();
    } else {
      // Still in initial flow — go back to connecting state for the new symbol.
      initialConnectStreamReady = false;
      calibrationPhase = 'initial-connecting';
    }

    cryptoWorker?.postMessage({ type: 'SWITCH', symbol });
  }
</script>

<main class="workspace">
  {#if calibrationPhase !== 'idle'}
    <div class="calibration-overlay">
      <div class="calibration-dialog">
        {#if calibrationPhase === 'initial-connecting'}
          <p class="calibration-text">Connecting to websocket...</p>
        {:else if calibrationPhase === 'pending-calibrate'}
          <p class="calibration-text">Ready to Calibrate</p>
          <button class="btn-calibrate" on:click={startCalibration}>Calibrate</button>
        {:else}
          <p class="calibration-text">
            {calibrationPhase === 'recal-connecting' ? 'Connecting to websocket...' : 'Calibration in progress...'}
          </p>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: {calibrationProgress}%"></div>
          </div>
          <p class="calibration-subtext">{remainingSeconds}s remaining</p>
        {/if}
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
        {currentCrypto}
        onVolumeChange={handleVolume}
        onScaleChange={handleScale}
        onSensitivityChange={handleSensitivity}
        onCryptoChange={handleCryptoChange}
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

  .btn-calibrate {
    margin-top: 8px;
    background: transparent;
    color: #00ff88;
    border: 1px solid #00ff88;
    padding: 12px 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    transition: all 0.2s ease;
  }

  .btn-calibrate:hover {
    background: #00ff8820;
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
