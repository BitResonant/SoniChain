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

  // ---- Help / suggerimenti contestuali ----------------------------------
  // Testi fittizi: sostituiscili con le spiegazioni reali dei parametri.
  const helpContent: Record<string, { title: string; body: string }> = {
    asset: {
      title: 'Asset',
      body: 'Testo segnaposto per l’Asset. Qui scriverai la spiegazione della coppia di mercato selezionata e di come il suo flusso di prezzo alimenta il motore sonoro.'
    },
    volume: {
      title: 'Master Volume',
      body: 'Testo segnaposto per il Master Volume. Descrivi qui il controllo del livello d’uscita generale e la sua scala logaritmica.'
    },
    scale: {
      title: 'Pitch Quantization Bank',
      body: 'Testo segnaposto per il banco di quantizzazione. Spiega come le note generate vengono vincolate alla scala musicale scelta.'
    },
    sensitivity: {
      title: 'Price Sensitivity',
      body: 'Testo segnaposto per la Price Sensitivity. Indica come le variazioni di prezzo vengono mappate in modo più o meno marcato sui parametri sonori.'
    },
    recalibration: {
      title: 'Recalibration',
      body: 'Testo segnaposto per la Recalibration. Riconnette lo stream e ricalibra il range dinamico sul mercato corrente.'
    },
    chart: {
      title: 'Signal Monitor',
      body: 'Testo segnaposto per il grafico. Qui descriverai cosa rappresenta la curva del segnale e come leggerla.'
    }
  };

  const defaultHelp = {
    title: 'Suggerimenti',
    body: 'Passa il mouse su un parametro per visualizzarne la spiegazione in questo riquadro.'
  };

  let activeHelpId: string | null = null;
  function setHelp(id: string | null): void {
    activeHelpId = id;
  }
  $: activeHelp = activeHelpId ? helpContent[activeHelpId] ?? defaultHelp : defaultHelp;

  // ---- Etichette e stato derivati per l'header del grafico --------------
  const assetLabels: Record<string, string> = {
    btcusdt: 'BTC / USDT',
    ethusdt: 'ETH / USDT',
    usdtusdc: 'USDT / USDC',
    bnbusdt: 'BNB / USDT',
    usdcusdt: 'USDC / USDT'
  };
  $: assetLabel = assetLabels[currentCrypto] ?? currentCrypto.toUpperCase();

  let chartStatus: 'live' | 'connecting' | 'idle';
  $: chartStatus =
    calibrationPhase === 'idle' && streamIsReady
      ? 'live'
      : calibrationPhase === 'initial-connecting' ||
          calibrationPhase === 'recal-connecting' ||
          calibrationPhase === 'calibrating'
        ? 'connecting'
        : 'idle';
</script>

<main class="workspace">
  {#if calibrationPhase !== 'idle'}
    <div class="calibration-overlay">
      <div class="calibration-dialog">
        <div class="cal-glyph">
          <span class="cal-ring"></span>
          <span class="cal-core"></span>
        </div>
        {#if calibrationPhase === 'initial-connecting'}
          <p class="calibration-text">Connecting to websocket</p>
          <p class="calibration-subtext">Establishing market data stream…</p>
        {:else if calibrationPhase === 'pending-calibrate'}
          <p class="calibration-text">Ready to Calibrate</p>
          <p class="calibration-subtext">Tune the engine to the current market range.</p>
          <button class="btn-calibrate" on:click={startCalibration}>Calibrate</button>
        {:else}
          <p class="calibration-text">
            {calibrationPhase === 'recal-connecting' ? 'Connecting to websocket' : 'Calibration in progress'}
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
    <div class="brand">
      <div class="brand-mark">
        <span class="bar b1"></span>
        <span class="bar b2"></span>
        <span class="bar b3"></span>
        <span class="bar b4"></span>
      </div>
      <div class="brand-text">
        <h1>SoniFyer<span class="brand-accent">Core</span></h1>
        <span class="brand-sub">Engine Standalone</span>
      </div>
    </div>

    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <button
      class="btn-recal"
      on:click={triggerCalibration}
      on:mouseenter={() => setHelp('recalibration')}
      on:mouseleave={() => setHelp(null)}
      on:focus={() => setHelp('recalibration')}
      on:blur={() => setHelp(null)}
    >
      <span class="recal-dot"></span>
      Recalibration
    </button>
  </header>

  <div class="interface-layout">
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <section
      class="visual-viewport"
      on:mouseenter={() => setHelp('chart')}
      on:mouseleave={() => setHelp(null)}
    >
      <CryptoChart dataBuffer={cryptoData} {assetLabel} status={chartStatus} />
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
        onHelpHover={setHelp}
      />
    </section>
  </div>

  <footer class="help-bar" class:active={activeHelpId !== null}>
    <div class="help-icon">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6" />
        <line x1="12" y1="16.5" x2="12" y2="16.6" />
      </svg>
    </div>
    <div class="help-body">
      <span class="help-title">{activeHelp.title}</span>
      <p class="help-text">{activeHelp.body}</p>
    </div>
  </footer>
</main>

<style>
  :global(:root) {
    --bg-0: #080b12;
    --bg-1: #0b0f18;
    --bg-2: #141925;
    --bg-3: #1b2230;
    --border: rgba(148, 163, 184, 0.1);
    --border-strong: rgba(148, 163, 184, 0.18);
    --text-hi: #eef1f7;
    --text-mid: #9aa3b5;
    --text-lo: #5d6678;
    --accent: #2dd4bf;
    --accent-2: #38bdf8;
    --warn: #f5b53f;
    --danger: #fb7185;
  }

  :global(body) {
    background:
      radial-gradient(1100px 600px at 18% -10%, rgba(56, 189, 248, 0.07), transparent 60%),
      radial-gradient(900px 500px at 100% 0%, rgba(45, 212, 191, 0.06), transparent 55%),
      var(--bg-0);
    color: var(--text-hi);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    margin: 0;
    padding: 26px;
    min-height: 100vh;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }

  .workspace {
    position: relative;
    max-width: 1240px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* ---- Header ---- */
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .brand-mark {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 34px;
    width: 34px;
    padding: 6px;
    border-radius: 10px;
    background: linear-gradient(160deg, rgba(45, 212, 191, 0.16), rgba(56, 189, 248, 0.08));
    border: 1px solid var(--border-strong);
    box-sizing: border-box;
  }
  .brand-mark .bar {
    flex: 1;
    border-radius: 2px;
    background: linear-gradient(180deg, var(--accent-2), var(--accent));
    animation: eq 1.2s ease-in-out infinite;
  }
  .brand-mark .b1 { height: 40%; animation-delay: 0s; }
  .brand-mark .b2 { height: 85%; animation-delay: 0.15s; }
  .brand-mark .b3 { height: 60%; animation-delay: 0.3s; }
  .brand-mark .b4 { height: 95%; animation-delay: 0.45s; }

  @keyframes eq {
    0%, 100% { transform: scaleY(0.55); transform-origin: bottom; }
    50% { transform: scaleY(1); transform-origin: bottom; }
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  h1 {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.015em;
    margin: 0;
    color: var(--text-hi);
  }
  .brand-accent {
    color: var(--accent);
    margin-left: 2px;
  }
  .brand-sub {
    font-size: 0.66rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--text-lo);
    font-weight: 600;
  }

  .btn-recal {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    background: var(--bg-2);
    color: var(--text-hi);
    border: 1px solid var(--border-strong);
    padding: 10px 18px;
    border-radius: 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: all 0.18s ease;
  }
  .btn-recal:hover {
    border-color: var(--danger);
    background: rgba(251, 113, 133, 0.08);
  }
  .recal-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
  }

  /* ---- Layout ---- */
  .interface-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 22px;
  }

  @media (min-width: 860px) {
    .interface-layout {
      grid-template-columns: 1.85fr 1fr;
      align-items: stretch;
    }
  }

  .visual-viewport {
    min-height: 380px;
    display: flex;
  }
  .visual-viewport :global(.chart-card) {
    flex: 1;
  }

  .control-viewport {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ---- Help bar ---- */
  .help-bar {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 20px;
    min-height: 78px;
    box-sizing: border-box;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .help-bar.active {
    border-color: rgba(45, 212, 191, 0.35);
    box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.12), 0 18px 40px -28px rgba(45, 212, 191, 0.5);
  }

  .help-icon {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: rgba(45, 212, 191, 0.1);
    border: 1px solid rgba(45, 212, 191, 0.22);
  }
  .help-icon svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .help-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .help-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .help-text {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--text-mid);
    max-width: 90ch;
  }

  /* ---- Calibration overlay ---- */
  .calibration-overlay {
    position: fixed;
    inset: 0;
    background: rgba(6, 9, 14, 0.86);
    backdrop-filter: blur(14px);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .calibration-dialog {
    background: linear-gradient(180deg, var(--bg-2), var(--bg-1));
    border: 1px solid var(--border-strong);
    padding: 38px 40px;
    border-radius: 18px;
    text-align: center;
    width: 340px;
    box-shadow: 0 40px 80px -30px rgba(0, 0, 0, 0.9);
  }

  .cal-glyph {
    position: relative;
    width: 54px;
    height: 54px;
    margin: 0 auto 22px;
  }
  .cal-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid rgba(45, 212, 191, 0.25);
    border-top-color: var(--accent);
    animation: spin 1s linear infinite;
  }
  .cal-core {
    position: absolute;
    inset: 18px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 18px var(--accent);
    animation: pulse-core 1.6s ease-in-out infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse-core {
    0%, 100% { opacity: 0.5; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1); }
  }

  .calibration-text {
    font-size: 1.08rem;
    font-weight: 600;
    color: var(--text-hi);
    margin: 0 0 8px;
    letter-spacing: 0.01em;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: var(--bg-3);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 18px;
  }
  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 3px;
    transition: width 0.1s linear;
    box-shadow: 0 0 12px rgba(45, 212, 191, 0.6);
  }

  .calibration-subtext {
    margin: 12px 0 0;
    color: var(--text-lo);
    font-size: 0.84rem;
  }

  .btn-calibrate {
    margin-top: 22px;
    width: 100%;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: #06231f;
    border: none;
    padding: 13px 32px;
    border-radius: 10px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    transition: transform 0.12s ease, box-shadow 0.18s ease;
    box-shadow: 0 10px 26px -10px rgba(45, 212, 191, 0.7);
  }
  .btn-calibrate:hover {
    transform: translateY(-1px);
    box-shadow: 0 14px 32px -10px rgba(45, 212, 191, 0.85);
  }
  .btn-calibrate:active {
    transform: translateY(0);
  }
</style>
