<script lang="ts">
  import { onMount } from 'svelte';
  import * as RNBO from '@rnbo/js';
  import CryptoChart from '../components/CryptoChart.svelte';
  import AudioControls from '../components/AudioControls.svelte';
  import OutputScope from '../components/OutputScope.svelte';
  import { THEMES, THEME_LABELS, type ThemeName } from '../themes';
  import { fade } from 'svelte/transition';
  import { help, HELP, helpEnabled, activeHelp } from '../help';

  // Positions the help bubble near the source element (viewport coords).
  function bubbleStyle(rect: DOMRect): string {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const half = 130;
    const cx = Math.max(half + 8, Math.min(vw - half - 8, rect.left + rect.width / 2));
    return rect.top > vh * 0.5
      ? `left:${cx}px; top:${rect.top - 8}px; transform:translate(-50%,-100%);`
      : `left:${cx}px; top:${rect.bottom + 8}px; transform:translate(-50%,0);`;
  }

  // ---- Asset / scale tables ----
  const ASSETS = [
    { symbol: 'btcusdt', label: 'Bitcoin', sym: 'BTC', quote: 'USDT', dec: 2 },
    { symbol: 'ethusdt', label: 'Ethereum', sym: 'ETH', quote: 'USDT', dec: 2 },
    { symbol: 'solusdt', label: 'Solana', sym: 'SOL', quote: 'USDT', dec: 2 },
    { symbol: 'bnbusdt', label: 'BNB', sym: 'BNB', quote: 'USDT', dec: 2 },
    { symbol: 'usdcusdt', label: 'USD Coin', sym: 'USDC', quote: 'USDT', dec: 4 }
  ];
  const SCALES = ['Major', 'Minor', 'Major pentatonic', 'Minor pentatonic', 'Whole tone', 'Lydian', 'Mixolydian'];

  // Chart buffer: real prices.
  let cryptoData: number[] = Array(64).fill(0);
  let priceBufferInitialized = false;

  type CalibrationPhase = 'initial-connecting' | 'pending-calibrate' | 'recal-connecting' | 'calibrating' | 'idle';
  let calibrationPhase: CalibrationPhase = 'initial-connecting';
  let calibrationProgress = 0;
  let calibrationInterval: number;
  let remainingSeconds = 30;

  // Calibrate button: briefly non-interactive when the prompt first appears,
  // so it can't be clicked by accident the instant the screen shows up.
  let calibBtnEnabled = false;
  let calibBtnTimer: number | undefined;

  let audioContext: AudioContext | null = null;
  let rnboDevice: any = null;
  let isRnboReady = false;
  let streamIsReady = false;
  let hasCalibrated = false;

  let initialConnectStreamReady = false;
  let initialConnectTimerDone = false;

  // RNBO master_volume ∈ [0,1], matches the fader position.
  let masterVolume = 0;
  let currentScale = 0;
  let sensitivityStep = 1;
  let currentCrypto = 'btcusdt';
  let playing = true;

  // Scale-switching gate: blocks TICK → RNBO for 100 ms after a scale change
  // to prevent bichords caused by price events arriving mid-transition.
  let scaleSwitching = false;
  let scaleSwitchTimeout: number | undefined;

  let cryptoWorker: Worker | null = null;

  // ---- Theme ----
  let themeName: ThemeName = 'graphite';
  // Each skin has its own synthesis model (RNBO "instrument" parameter).
  const THEME_INSTRUMENT: Record<ThemeName, number> = { graphite: 1, slate: 2, bone: 3 };
  function selectTheme(key: ThemeName): void {
    themeName = key;
    if (isRnboReady) setRnboParam('resonators/note_changer/instrument', THEME_INSTRUMENT[key]);
  }
  $: theme = THEMES[themeName];
  $: rootStyle = Object.entries(theme)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');

  // ---- Market readouts (real, smoothed) ----
  let lastPrice = 0;
  let sessionOpen = 0;
  let changePct = 0;
  // Raw maker_side (0/1) forwarded to the UI; the ramp lives in OutputScope.
  let makerSide = 0.5;
  // Raw density/volatility values + tick counter: the adaptive
  // normalization (threshold capture during calibration + decay) lives in OutputScope.
  let densityRaw = 0;
  let volatilityRaw = 0;
  let tickSeq = 0;

  // ---- Audio analysis ----
  let analyserMain: AnalyserNode | null = null;
  let analyserL: AnalyserNode | null = null;
  let analyserR: AnalyserNode | null = null;
  let meterL = 0;
  let meterR = 0;
  let meterRAF = 0;

  function maybeShowCalibrate(): void {
    if (!isRnboReady || !initialConnectStreamReady || !initialConnectTimerDone) return;
    if (calibrationPhase === 'initial-connecting') {
      calibrationPhase = 'pending-calibrate';
      // Lock the Calibrate button for 1s after the prompt appears.
      calibBtnEnabled = false;
      if (calibBtnTimer !== undefined) clearTimeout(calibBtnTimer);
      calibBtnTimer = window.setTimeout(() => {
        calibBtnEnabled = true;
        calibBtnTimer = undefined;
      }, 1000);
    }
  }

  onMount(() => {
    setTimeout(() => {
      initialConnectTimerDone = true;
      maybeShowCalibrate();
    }, 3000);

    const bootstrap = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });

        const response = await fetch(`/DSP.export.json?v=${Date.now()}`);
        if (!response.ok) throw new Error(`Failed to fetch DSP.export.json: ${response.status}`);
        const patcher = await response.json();

        rnboDevice = await RNBO.createDevice({ context: audioContext, patcher });
        console.log('[RNBO] Available parameters:', Array.from(rnboDevice.parametersById.keys()));

        // Output bus with real analysers (oscilloscope, meter, goniometer).
        analyserMain = audioContext.createAnalyser();
        analyserMain.fftSize = 2048;
        rnboDevice.node.connect(analyserMain);
        analyserMain.connect(audioContext.destination);

        // Stereo taps for the goniometer; kept "alive" by a zero-gain sink.
        try {
          const splitter = audioContext.createChannelSplitter(2);
          analyserL = audioContext.createAnalyser();
          analyserR = audioContext.createAnalyser();
          analyserL.fftSize = 2048;
          analyserR.fftSize = 2048;
          rnboDevice.node.connect(splitter);
          splitter.connect(analyserL, 0);
          splitter.connect(analyserR, 1);
          const sink = audioContext.createGain();
          sink.gain.value = 0;
          analyserL.connect(sink);
          analyserR.connect(sink);
          sink.connect(audioContext.destination);
        } catch (e) {
          console.warn('[Audio] Stereo analysis unavailable, falling back to mono:', e);
          analyserL = null;
          analyserR = null;
        }

        if (audioContext?.state === 'suspended') await audioContext.resume();

        isRnboReady = true;
        pushVolume();
        setRnboParam('scaling/sensitivity', sensitivityStep);
        setRnboParam('resonators/scales/scale_selector', currentScale);
        setRnboParam('resonators/note_changer/instrument', THEME_INSTRUMENT[themeName]);

        startMeters();
        maybeShowCalibrate();
      } catch (err) {
        console.error('[Bootstrap] Initialization failed:', err);
      }
    };

    const initCryptoWorker = () => {
      try {
        cryptoWorker = new Worker(new URL('../crypto.worker.ts', import.meta.url), { type: 'module' });
        cryptoWorker.postMessage({ type: 'START', symbol: currentCrypto });

        cryptoWorker.onmessage = (event: MessageEvent) => {
          if (event.data.type === 'STREAM_READY') {
            streamIsReady = true;
            // Transition driven by phase, not hasCalibrated, so the recal-connecting →
            // calibrating handoff stays robust regardless of calibration history.
            if (calibrationPhase === 'recal-connecting') {
              calibrationPhase = 'calibrating';
              triggerRnboRecalibration();
            } else if (!hasCalibrated) {
              initialConnectStreamReady = true;
              if (isRnboReady) maybeShowCalibrate();
            }
            return;
          }

          if (event.data.type === 'TICK') {
            const { price, market_volume, density, maker_side, volatility } = event.data.data;

            if (isRnboReady && rnboDevice && streamIsReady && !scaleSwitching) {
              setRnboParam('price', price);
              setRnboParam('market_volume', market_volume);
              setRnboParam('density', density);
              setRnboParam('maker_side', maker_side);
              setRnboParam('volatility', volatility);
            }

            // Forward the raw values to the UI: adaptive normalization is in OutputScope.
            volatilityRaw = volatility;
            densityRaw = density;
            makerSide = maker_side; // 0 => bullish, 1 => bearish
            tickSeq++;

            lastPrice = price;
            changePct = sessionOpen ? ((price - sessionOpen) / sessionOpen) * 100 : 0;

            if (!priceBufferInitialized) {
              cryptoData = Array(cryptoData.length).fill(price);
              priceBufferInitialized = true;
              sessionOpen = price;
            } else {
              cryptoData = [...cryptoData.slice(1), price];
            }
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
      if (meterRAF) cancelAnimationFrame(meterRAF);
      if (scaleSwitchTimeout !== undefined) clearTimeout(scaleSwitchTimeout);
      if (calibBtnTimer !== undefined) clearTimeout(calibBtnTimer);
    };
  });

  function rms(buf: Float32Array): number {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function startMeters(): void {
    const bufA = new Float32Array(1024);
    const bufB = new Float32Array(1024);
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let l = 0;
      let r = 0;
      if (analyserL) {
        analyserL.getFloatTimeDomainData(bufA);
        l = rms(bufA);
      } else if (analyserMain) {
        analyserMain.getFloatTimeDomainData(bufA);
        l = rms(bufA);
      }
      if (analyserR) {
        analyserR.getFloatTimeDomainData(bufB);
        r = rms(bufB);
      } else {
        r = l;
      }
      // UI-only gain: the real levels are tiny, here we amplify them
      // to fill the meters (clamped to 1, does not affect the output volume).
      const gain = 11;
      meterL = Math.max(Math.min(1, l * gain), meterL - dt * 1.6);
      meterR = Math.max(Math.min(1, r * gain), meterR - dt * 1.6);
      meterRAF = requestAnimationFrame(tick);
    };
    meterRAF = requestAnimationFrame(tick);
  }

  function setRnboParam(paramName: string, value: number): void {
    if (!isRnboReady || !rnboDevice) return;
    try {
      const param = rnboDevice.parametersById.get(paramName);
      if (param) param.value = value;
      else console.warn(`[RNBO] Parameter not found: ${paramName}`);
    } catch (e) {
      console.error(`[RNBO] Error setting ${paramName} = ${value}:`, e);
    }
  }

  // Applies the volume, respecting the play/pause gate.
  function pushVolume(): void {
    setRnboParam('master_volume', playing ? masterVolume : 0);
  }

  function rampVolume(target: number, durationMs: number): void {
    const start = masterVolume;
    const t0 = performance.now();
    function tick(now: number) {
      const progress = Math.min((now - t0) / durationMs, 1);
      masterVolume = start + (target - start) * progress;
      pushVolume();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function startCalibrationTimer(): void {
    if (calibrationInterval) clearInterval(calibrationInterval);
    calibrationProgress = 0;
    remainingSeconds = 30;
    const step = (100 / 30000) * 100;
    calibrationInterval = window.setInterval(() => {
      calibrationProgress += step;
      remainingSeconds = Math.ceil((30 * (100 - calibrationProgress)) / 100);
      if (calibrationProgress >= 100) {
        clearInterval(calibrationInterval);
        calibrationPhase = 'idle';
        calibrationProgress = 0;
        rampVolume(0.5, 100);
      }
    }, 100);
  }

  function triggerRnboRecalibration(): void {
    setRnboParam('scaling/recalibration', 0);
    setTimeout(() => {
      setRnboParam('scaling/recalibration', 1);
      setTimeout(() => setRnboParam('scaling/recalibration', 0), 200);
    }, 50);
  }

  function startCalibration(): void {
    audioContext?.resume();
    hasCalibrated = true;
    calibrationPhase = 'calibrating';
    startCalibrationTimer();
    triggerRnboRecalibration();
  }

  function cancelCalibration(): void {
    if (calibrationInterval) clearInterval(calibrationInterval);
    calibrationPhase = 'idle';
    rampVolume(0.5, 200);
  }

  function triggerCalibration(): void {
    // Recalibration only makes sense after the first calibration has run; guarding
    // here prevents the stream handler from getting stuck in recal-connecting.
    if (!isRnboReady || !hasCalibrated) return;
    masterVolume = 0;
    pushVolume();
    streamIsReady = false;
    calibrationPhase = 'recal-connecting';
    startCalibrationTimer();
    cryptoWorker?.postMessage({ type: 'SWITCH', symbol: currentCrypto });
  }

  function handleVolume(v: number) {
    masterVolume = v;
    pushVolume();
  }

  function togglePlay() {
    playing = !playing;
    audioContext?.resume();
    pushVolume();
  }

  function handleScale(index: number) {
    if (index === currentScale) return;
    currentScale = index;
    if (!isRnboReady) return;

    scaleSwitching = true;
    if (scaleSwitchTimeout !== undefined) clearTimeout(scaleSwitchTimeout);
    setRnboParam('resonators/scales/scale_selector', index);
    scaleSwitchTimeout = window.setTimeout(() => {
      scaleSwitching = false;
      scaleSwitchTimeout = undefined;
    }, 100);
  }

  function handleSensitivity(step: number) {
    sensitivityStep = step;
    if (isRnboReady) setRnboParam('scaling/sensitivity', Number(step));
  }

  function handleCryptoChange(symbol: string) {
    if (symbol === currentCrypto) return;
    currentCrypto = symbol;
    streamIsReady = false;
    priceBufferInitialized = false;

    if (hasCalibrated) {
      masterVolume = 0;
      pushVolume();
      calibrationPhase = 'recal-connecting';
      startCalibrationTimer();
    } else {
      initialConnectStreamReady = false;
      calibrationPhase = 'initial-connecting';
    }
    cryptoWorker?.postMessage({ type: 'SWITCH', symbol });
  }

  // ---- Derived UI ----
  $: currentAsset = ASSETS.find((a) => a.symbol === currentCrypto) ?? ASSETS[0];
  $: priceText = lastPrice
    ? '$' + lastPrice.toLocaleString('en-US', { minimumFractionDigits: currentAsset.dec, maximumFractionDigits: currentAsset.dec })
    : '—';
  $: changeText = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  $: up = changePct >= 0;
  $: scaleName = SCALES[currentScale];
  $: sensLabel = ['Low', 'Med', 'High'][sensitivityStep];

  $: calibActive = calibrationPhase !== 'idle';
  $: calibReady = calibrationPhase === 'pending-calibrate';
  $: calibRunning = calibrationPhase === 'calibrating';
  // Threshold capture window (applies to both the initial calibration and the recalibrate).
  $: calibratingNow = calibrationPhase === 'calibrating';
  $: calibConnecting = calibrationPhase === 'initial-connecting' || calibrationPhase === 'recal-connecting';
  $: calibDeg = ((calibrationProgress / 100) * 360).toFixed(1) + 'deg';
  $: calibrated = calibrationPhase === 'idle' && hasCalibrated;
  $: statusText = calibrationPhase === 'idle' ? (playing ? 'Calibrated · streaming' : 'Calibrated · paused') : 'Awaiting calibration';
  $: liveLabel = !streamIsReady ? 'SYNC' : playing ? 'LIVE' : 'PAUSED';
  $: liveColor = !streamIsReady ? 'var(--accent)' : playing ? 'var(--up)' : 'var(--muted)';
</script>

<div class="desk" style={rootStyle}>
  <div class="window">
    <!-- TITLE BAR -->
    <div class="titlebar">
      <div class="tb-left">
        <div class="tb-brand">
          <span class="tb-name">SoniChain</span>
          <span class="tb-sub">DSP · Crypto data sonification</span>
        </div>
      </div>
      <div class="tb-right">
        <label class="help-toggle">
          <input type="checkbox" bind:checked={$helpEnabled} />
          <span class="toggle-track"><span class="toggle-knob"></span></span>
          <span class="toggle-text">Show help bubbles</span>
        </label>
        <div class="theme-switch" use:help={HELP.theme}>
          {#each THEME_LABELS as t}
            <button class:active={themeName === t.key} on:click={() => selectTheme(t.key)}>{t.label}</button>
          {/each}
        </div>
      </div>
    </div>

    <!-- BODY -->
    <div class="body">
      <!-- LEFT -->
      <div class="left">
        <!-- market header -->
        <div class="market">
          <div class="m-left">
            <div class="m-top">
              <span class="m-pair">{currentAsset.sym} · {currentAsset.quote}</span>
              <span class="m-live" style="color:{liveColor}">
                <span class="m-livedot" class:pulse={liveLabel === 'LIVE'} style="background:{liveColor}"></span>{liveLabel}
              </span>
            </div>
            <div class="m-price-row">
              <span class="m-price">{priceText}</span>
              <span class="m-change" style="color:{up ? 'var(--up)' : 'var(--down)'}">{changeText}</span>
            </div>
          </div>
          <div class="m-right">
            <div class="m-stat">
              <span class="m-stat-label">Scale</span>
              <span class="m-stat-val">{scaleName}</span>
            </div>
            <div class="m-stat-div"></div>
            <div class="m-stat">
              <span class="m-stat-label">Sens</span>
              <span class="m-stat-val">{sensLabel}</span>
            </div>
          </div>
        </div>

        <CryptoChart dataBuffer={cryptoData} {theme} />

        <OutputScope
          {theme}
          {analyserMain}
          {analyserL}
          {analyserR}
          makerTarget={makerSide}
          {densityRaw}
          {volatilityRaw}
          {tickSeq}
          calibrating={calibratingNow}
        />
      </div>

      <!-- RIGHT -->
      <AudioControls
        assets={ASSETS}
        scales={SCALES}
        {currentCrypto}
        volume={masterVolume}
        {currentScale}
        {sensitivityStep}
        {playing}
        {meterL}
        {meterR}
        {statusText}
        {calibrated}
        onVolumeChange={handleVolume}
        onScaleChange={handleScale}
        onSensitivityChange={handleSensitivity}
        onCryptoChange={handleCryptoChange}
        onTogglePlay={togglePlay}
        onRecalibrate={triggerCalibration}
      />

      <!-- CALIBRATION OVERLAY -->
      {#if calibActive}
        <div class="overlay">
          <div class="cal-card">
            {#if calibRunning}
              <div class="cal-stack">
                <div class="conic" style="background: conic-gradient(var(--accent) {calibDeg}, var(--lineSoft) 0)">
                  <div class="conic-inner">
                    <span class="cal-num">{remainingSeconds}</span>
                    <span class="cal-sec">sec</span>
                  </div>
                </div>
                <div class="cal-text">
                  <span class="cal-title">Calibrating</span>
                  <span class="cal-sub mono">Learning {currentAsset.sym} dynamic range</span>
                </div>
                <button class="cal-cancel" on:click={cancelCalibration}>Cancel</button>
              </div>
            {:else if calibReady}
              <div class="cal-stack">
                <div class="ring"><div class="ring-spin"></div></div>
                <div class="cal-text">
                  <span class="cal-title big">Calibrate Audio Engine</span>
                  <span class="cal-sub">The audio engine learns this asset's dynamic range before mapping price to sound.</span>
                </div>
                <button class="cal-go" disabled={!calibBtnEnabled} on:click={startCalibration}>Calibrate</button>
                <span class="cal-hint">≈ 30 seconds</span>
              </div>
            {:else if calibConnecting}
              <div class="cal-stack">
                <div class="ring"><div class="ring-spin"></div></div>
                <div class="cal-text">
                  <span class="cal-title big">Connecting</span>
                  <span class="cal-sub mono">Establishing market data stream…</span>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if $helpEnabled && $activeHelp}
    <div class="help-bubble" style={bubbleStyle($activeHelp.rect)} transition:fade={{ duration: 120 }}>
      {$activeHelp.text}
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    background: #080706;
    font-family: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    user-select: none;
  }
  :global(*) {
    box-sizing: border-box;
  }

  .desk {
    position: fixed;
    inset: 0;
    display: flex;
    background: var(--bg);
    color: var(--text);
  }

  .window {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  /* title bar */
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 50px;
    flex: none;
    padding: 0 16px;
    background: var(--titlebar);
    border-bottom: 1px solid var(--lineSoft);
  }
  .tb-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .tb-brand {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .tb-name {
    font-weight: 700;
    font-size: 14px;
    letter-spacing: -0.01em;
  }
  .tb-sub {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .tb-right {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .help-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .help-toggle input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-track {
    position: relative;
    width: 30px;
    height: 16px;
    flex: none;
    border-radius: 8px;
    background: var(--elev);
    border: 1px solid var(--lineSoft);
    transition: background 0.15s, border-color 0.15s;
  }
  .toggle-knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--faint);
    transition: transform 0.15s, background 0.15s;
  }
  .help-toggle input:checked + .toggle-track {
    background: var(--accentSoft);
    border-color: var(--accent);
  }
  .help-toggle input:checked + .toggle-track .toggle-knob {
    transform: translateX(14px);
    background: var(--accent);
  }
  .toggle-text {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--muted);
  }

  .help-bubble {
    position: fixed;
    z-index: 200;
    max-width: 260px;
    padding: 9px 12px;
    background: var(--elev);
    border: 1px solid var(--line);
    border-radius: 9px;
    box-shadow: 0 12px 30px -10px rgba(0, 0, 0, 0.7);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
    pointer-events: none;
  }

  .theme-switch {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    background: var(--bg);
    border: 1px solid var(--lineSoft);
    border-radius: 9px;
  }
  .theme-switch button {
    padding: 5px 11px;
    border: none;
    border-radius: 6px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: all 0.15s;
    background: transparent;
    color: var(--faint);
    font-weight: 500;
  }
  .theme-switch button.active {
    background: var(--elev);
    color: var(--text);
    font-weight: 600;
  }

  /* body */
  .body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: grid;
    grid-template-columns: 1.62fr 1fr;
    gap: 16px;
    padding: 18px;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  /* market header */
  .market {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
    flex: none;
  }
  .m-left {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .m-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .m-pair {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .m-live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.14em;
  }
  .m-livedot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .m-livedot.pulse {
    animation: sf-pulse 1.6s ease-in-out infinite;
  }
  @keyframes sf-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.35;
      transform: scale(0.82);
    }
  }
  .m-price-row {
    display: flex;
    align-items: baseline;
    gap: 13px;
  }
  .m-price {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 32px;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .m-change {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 14px;
    font-weight: 500;
  }
  .m-right {
    display: flex;
    gap: 22px;
    padding-bottom: 3px;
  }
  .m-stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: right;
  }
  .m-stat-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .m-stat-val {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .m-stat-div {
    width: 1px;
    background: var(--lineSoft);
  }

  /* calibration overlay */
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(8, 7, 6, 0.78);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .cal-card {
    width: 360px;
    padding: 40px 38px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 30px 70px -16px rgba(0, 0, 0, 0.8);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .cal-stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }
  .ring {
    width: 66px;
    height: 66px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ring-spin {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    animation: sf-spin 0.9s linear infinite;
  }
  @keyframes sf-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .conic {
    position: relative;
    width: 108px;
    height: 108px;
    border-radius: 50%;
  }
  .conic-inner {
    position: absolute;
    inset: 9px;
    border-radius: 50%;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
  }
  .cal-num {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 30px;
    font-weight: 500;
    line-height: 1;
  }
  .cal-sec {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .cal-text {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .cal-title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .cal-title.big {
    font-size: 17px;
  }
  .cal-sub {
    font-size: 13px;
    line-height: 1.5;
    color: var(--muted);
    max-width: 250px;
  }
  .cal-sub.mono {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
  }
  .cal-go {
    margin-top: 4px;
    padding: 13px 40px;
    background: var(--accent);
    border: none;
    border-radius: 10px;
    color: #1a1108;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: filter 0.15s;
  }
  .cal-go:hover {
    filter: brightness(1.08);
  }
  .cal-go:disabled {
    opacity: 0.4;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .cal-hint {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .cal-cancel {
    background: transparent;
    border: none;
    color: var(--faint);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.15s;
  }
  .cal-cancel:hover {
    color: var(--muted);
  }
</style>
