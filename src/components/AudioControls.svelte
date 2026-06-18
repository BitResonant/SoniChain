<script lang="ts">
  // Dichiarazione rigorosa delle props in Svelte 5 (Legacy compat mode per HTML)
  export let masterVolume: number;
  export let sensitivityStep: number;
  export let currentScale: number;

  export let onVolumeChange: (vol: number) => void;
  export let onScaleChange: (index: number) => void;
  export let onSensitivityChange: (step: number) => void;
  export let onCryptoChange: (symbol: string) => void;
  export let currentCrypto: string;

  // Notifica il genitore di quale parametro è attualmente sotto al mouse (o null).
  export let onHelpHover: (id: string | null) => void = () => {};

  const cryptoOptions = [
    { label: 'Bitcoin',   symbol: 'btcusdt'  },
    { label: 'Ethereum',  symbol: 'ethusdt'  },
    { label: 'Tether',    symbol: 'usdtusdc' },
    { label: 'BNB',       symbol: 'bnbusdt'  },
    { label: 'USD Coin',  symbol: 'usdcusdt' },
  ];

  function dispatchCrypto(event: Event): void {
    const target = event.target as HTMLSelectElement;
    onCryptoChange(target.value);
  }

  // Array di mappatura per la generazione dinamica della tendina (0 -> Scala 1, ecc.)
  const scaleNames = [
    "Major",
    "Minor",
    "Major pentatonic",
    "Minor pentatonic",
    "Whole tone scale",
    "Lydian",
    "Mixolydian"
  ];

  // Reattivo al prop: si aggiorna sia al drag dell'utente che ai cambi programmatici dal genitore.
  let faderValue: number;
  $: faderValue = Math.max(1.0, Math.min(10.0, Math.pow(10, masterVolume)));

  function dispatchVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    faderValue = parseFloat(target.value);

    const logMappedVolume = Math.log10(faderValue);
    console.debug(`[AudioControls] Volume slider: ${faderValue} -> ${logMappedVolume}`);
    onVolumeChange(logMappedVolume);
  }

  function dispatchScale(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const scaleIndex = parseInt(target.value, 10);
    console.debug(`[AudioControls] Scale changed to index: ${scaleIndex}`);
    onScaleChange(scaleIndex);
  }

  function dispatchSensitivity(event: Event): void {
    const target = event.target as HTMLInputElement;
    const sensitivityValue = parseInt(target.value, 10);
    console.debug(`[AudioControls] Sensitivity changed to: ${sensitivityValue}`);
    onSensitivityChange(sensitivityValue);
  }

  // Percentuale per il riempimento visivo della traccia dei fader.
  $: volumePct = ((faderValue - 1) / 9) * 100;
  $: sensitivityPct = (sensitivityStep / 2) * 100;
</script>

<div class="control-grid">
  <div class="panel-head">
    <span class="panel-title">Audio Engine</span>
    <span class="panel-sub">Sonification Parameters</span>
  </div>

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="control-unit"
    role="group"
    on:mouseenter={() => onHelpHover('asset')}
    on:mouseleave={() => onHelpHover(null)}
    on:focusin={() => onHelpHover('asset')}
    on:focusout={() => onHelpHover(null)}
  >
    <span class="label">Asset</span>
    <div class="select-wrap">
      <select class="dropdown" value={currentCrypto} on:change={dispatchCrypto}>
        {#each cryptoOptions as opt}
          <option value={opt.symbol} selected={currentCrypto === opt.symbol}>{opt.label}</option>
        {/each}
      </select>
      <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
    </div>
  </div>

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="control-unit"
    role="group"
    on:mouseenter={() => onHelpHover('volume')}
    on:mouseleave={() => onHelpHover(null)}
    on:focusin={() => onHelpHover('volume')}
    on:focusout={() => onHelpHover(null)}
  >
    <div class="slider-header">
      <span class="label">Master Volume</span>
      <span class="value">{Math.round(Math.log10(faderValue) * 100)}%</span>
    </div>
    <input
      type="range"
      class="fader"
      style="--fill: {volumePct}%"
      min="1.0"
      max="10.0"
      step="0.01"
      bind:value={faderValue}
      on:input={dispatchVolume}
    />
  </div>

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="control-unit"
    role="group"
    on:mouseenter={() => onHelpHover('scale')}
    on:mouseleave={() => onHelpHover(null)}
    on:focusin={() => onHelpHover('scale')}
    on:focusout={() => onHelpHover(null)}
  >
    <span class="label">Pitch Quantization Bank</span>
    <div class="select-wrap">
      <select class="dropdown" value={currentScale} on:change={dispatchScale}>
        {#each scaleNames as scale, index}
          <option value={index} selected={currentScale === index}>{scale}</option>
        {/each}
      </select>
      <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" /></svg>
    </div>
  </div>

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="control-unit"
    role="group"
    on:mouseenter={() => onHelpHover('sensitivity')}
    on:mouseleave={() => onHelpHover(null)}
    on:focusin={() => onHelpHover('sensitivity')}
    on:focusout={() => onHelpHover(null)}
  >
    <div class="slider-header">
      <span class="label">Price Sensitivity</span>
      <span class="value">
        {#if sensitivityStep === 0} Low
        {:else if sensitivityStep === 1} Med
        {:else} High
        {/if}
      </span>
    </div>
    <div class="step-container">
      <input
        type="range"
        class="fader step"
        style="--fill: {sensitivityPct}%"
        min="0"
        max="2"
        step="1"
        value={sensitivityStep}
        on:input={dispatchSensitivity}
      />
      <div class="step-markers">
        <span class="marker" class:active={sensitivityStep === 0}>LOW</span>
        <span class="marker" class:active={sensitivityStep === 1}>MED</span>
        <span class="marker" class:active={sensitivityStep === 2}>HIGH</span>
      </div>
    </div>
  </div>
</div>

<style>
  .control-grid {
    display: flex;
    flex-direction: column;
    gap: 22px;
    background: var(--bg-2, #141925);
    padding: 22px;
    border-radius: 14px;
    border: 1px solid var(--border, rgba(255, 255, 255, 0.07));
    box-shadow: 0 20px 50px -28px rgba(0, 0, 0, 0.9);
  }

  .panel-head {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.07));
  }

  .panel-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-hi, #eef1f7);
    letter-spacing: 0.01em;
  }

  .panel-sub {
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-lo, #5d6678);
    font-weight: 500;
  }

  .control-unit {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px;
    margin: -4px;
    border-radius: 10px;
    transition: background 0.18s ease;
  }
  .control-unit:hover {
    background: rgba(255, 255, 255, 0.025);
  }

  .label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-mid, #9aa3b5);
    letter-spacing: 0.08em;
  }

  .value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--accent, #2dd4bf);
    font-variant-numeric: tabular-nums;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* ---- Fader ---- */
  input[type='range'] {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    height: 22px;
    background: transparent;
    cursor: pointer;
  }
  input[type='range']:focus {
    outline: none;
  }

  .fader::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--accent, #2dd4bf) 0%,
      var(--accent-2, #38bdf8) var(--fill, 0%),
      var(--bg-3, #1b2230) var(--fill, 0%),
      var(--bg-3, #1b2230) 100%
    );
  }
  .fader::-moz-range-track {
    height: 6px;
    border-radius: 3px;
    background: var(--bg-3, #1b2230);
  }
  .fader::-moz-range-progress {
    height: 6px;
    border-radius: 3px;
    background: var(--accent, #2dd4bf);
  }

  .fader::-webkit-slider-thumb {
    -webkit-appearance: none;
    height: 16px;
    width: 16px;
    margin-top: -5px;
    border-radius: 50%;
    background: #f4f7fb;
    border: 2px solid var(--accent, #2dd4bf);
    box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.14), 0 2px 6px rgba(0, 0, 0, 0.5);
    transition: box-shadow 0.15s ease, transform 0.1s ease;
  }
  .fader::-webkit-slider-thumb:hover {
    box-shadow: 0 0 0 6px rgba(45, 212, 191, 0.2), 0 2px 8px rgba(0, 0, 0, 0.6);
  }
  .fader:active::-webkit-slider-thumb {
    transform: scale(1.08);
  }
  .fader::-moz-range-thumb {
    height: 16px;
    width: 16px;
    border-radius: 50%;
    background: #f4f7fb;
    border: 2px solid var(--accent, #2dd4bf);
    box-shadow: 0 0 0 4px rgba(45, 212, 191, 0.14);
  }

  /* ---- Step (Sensitivity) ---- */
  .step-container {
    position: relative;
    padding-bottom: 18px;
  }
  .step-markers {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    display: flex;
    justify-content: space-between;
  }
  .marker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    color: var(--text-lo, #5d6678);
    font-weight: 600;
    transition: color 0.15s ease;
  }
  .marker.active {
    color: var(--accent, #2dd4bf);
  }

  /* ---- Dropdown ---- */
  .select-wrap {
    position: relative;
  }
  .dropdown {
    width: 100%;
    background: var(--bg-3, #1b2230);
    color: var(--text-hi, #eef1f7);
    border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
    padding: 11px 36px 11px 13px;
    font-size: 0.88rem;
    font-family: inherit;
    border-radius: 9px;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .dropdown:hover {
    border-color: rgba(45, 212, 191, 0.4);
  }
  .dropdown:focus {
    outline: none;
    border-color: var(--accent, #2dd4bf);
    background: var(--bg-1, #0e1119);
  }
  .chevron {
    position: absolute;
    right: 13px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    pointer-events: none;
    fill: none;
    stroke: var(--text-mid, #9aa3b5);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
