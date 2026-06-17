<script lang="ts">
  // Dichiarazione rigorosa delle props in Svelte 5 (Legacy compat mode per HTML)
  export let masterVolume: number;
  export let sensitivityStep: number;
  export let currentScale: number;

  export let onVolumeChange: (vol: number) => void;
  export let onScaleChange: (index: number) => void;
  export let onSensitivityChange: (step: number) => void;
  export let onTestClick: () => void;

  // Array di mappatura per la generazione dinamica della tendina (0 -> Scala 1, ecc.)
  const scaleNames = [
    "Scala 1",
    "Scala 2",
    "Scala 3",
    "Scala 4",
    "Scala 5",
    "Scala 6",
    "Scala 7",
    "Scala 8",
    "Scala 9"
  ];

  // Inizializzazione dello slider lineare a partire dal valore di volume master.
  let faderValue = Math.max(1.0, Math.min(10.0, Math.pow(10, masterVolume)));
  let isDraggingVolume = false;

  const masterVolumeAttribute = masterVolume;

  function dispatchVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    faderValue = parseFloat(target.value);

    const logMappedVolume = Math.log10(faderValue);
    console.debug(`[AudioControls] Volume slider: ${faderValue} -> ${logMappedVolume}`);
    onVolumeChange(logMappedVolume);
  }

  function onVolumeMouseDown(): void {
    isDraggingVolume = true;
  }

  function onVolumeMouseUp(): void {
    isDraggingVolume = false;
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
</script>

<div class="control-grid" data-master-volume={masterVolumeAttribute}>
  <div class="control-unit test-trigger">
    <button class="btn-test" on:click={onTestClick}>
      <span>TEST SIGNAL</span>
    </button>
    <div class="label">Impulse Generator</div>
  </div>

  <div class="control-unit volume-control">
    <div class="slider-header">
      <span class="label">Master Volume</span>
      <span class="value">{Math.round(Math.log10(faderValue) * 100)}%</span>
    </div>
    <input 
      type="range" 
      class="linear-fader"
      min="1.0" 
      max="10.0" 
      step="0.01" 
      bind:value={faderValue} 
      on:input={dispatchVolume}
      on:mousedown={onVolumeMouseDown}
      on:mouseup={onVolumeMouseUp}
      on:touchstart={onVolumeMouseDown}
      on:touchend={onVolumeMouseUp}
    />
  </div>

  <div class="control-unit scale-selector">
    <span class="label">Pitch Quantization Bank</span>
    <select class="dropdown" value={currentScale} on:change={dispatchScale}>
      {#each scaleNames as scale, index}
        <option value={index} selected={currentScale === index}>{scale}</option>
      {/each}
    </select>
  </div>

  <div class="control-unit sensitivity-knob">
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
        class="step-slider"
        min="0" 
        max="2" 
        step="1" 
        value={sensitivityStep} 
        on:input={dispatchSensitivity} 
      />
      <div class="step-markers">
        <span class="marker">L</span>
        <span class="marker">M</span>
        <span class="marker">H</span>
      </div>
    </div>
  </div>
</div>

<style>
  .control-grid {
    display: flex;
    flex-direction: column;
    gap: 24px;
    background: #0f0f13;
    padding: 24px;
    border-radius: 8px;
    border: 1px solid #1c1c24;
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.5);
  }

  .control-unit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    color: #8e8e9b;
    letter-spacing: 0.05em;
  }

  .value {
    font-size: 0.8rem;
    font-weight: 500;
    color: #ffffff;
    font-variant-numeric: tabular-nums;
  }

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* Styling Input Range */
  input[type="range"] {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    background: transparent;
  }

  input[type="range"]:focus {
    outline: none;
  }

  /* Traccia Slider Generale */
  input[type="range"]::-webkit-slider-runnable-track {
    width: 100%;
    height: 6px;
    cursor: pointer;
    background: #25252f;
    border-radius: 3px;
  }

  input[type="range"]::-webkit-slider-thumb {
    height: 18px;
    width: 18px;
    border-radius: 50%;
    background: #e2e2e9;
    cursor: pointer;
    -webkit-appearance: none;
    margin-top: -6px;
    border: 2px solid #0f0f13;
  }

  /* Discretizzazione Step (Sensitivity) */
  .step-container {
    position: relative;
    padding-bottom: 20px;
  }
  
  .step-markers {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
    box-sizing: border-box;
  }

  .marker {
    font-size: 0.65rem;
    color: #6a6a75;
    font-weight: bold;
  }

  /* Selettore Scala */
  .dropdown {
    width: 100%;
    background: #18181f;
    color: #ffffff;
    border: 1px solid #2a2a35;
    padding: 10px 12px;
    font-size: 0.9rem;
    border-radius: 6px;
    appearance: none;
    cursor: pointer;
  }

  .dropdown:focus {
    outline: none;
    border-color: #4a4a5a;
  }

  /* Pulsante Test */
  .btn-test {
    background: #2a2a35;
    border: 1px solid #3a3a4a;
    padding: 12px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.1s ease-in-out;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .btn-test span {
    font-size: 0.85rem;
    font-weight: 700;
    color: #ff9500;
    letter-spacing: 0.1em;
  }

  .btn-test:active {
    background: #ff9500;
    border-color: #ffaa33;
    transform: scale(0.98);
  }
  
  .btn-test:active span {
    color: #000000;
  }

  .test-trigger {
    border-bottom: 1px solid #1c1c24;
    padding-bottom: 20px;
    margin-bottom: 10px;
  }
</style>