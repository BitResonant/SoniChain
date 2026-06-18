<script lang="ts">
  import { onMount } from 'svelte';

  export let assets: { symbol: string; label: string; sym: string }[] = [];
  export let currentCrypto: string;
  export let volume: number; // 0..1 (= master_volume RNBO)
  export let scales: string[] = [];
  export let currentScale: number;
  export let sensitivityStep: number;
  export let playing: boolean = true;
  export let meterL: number = 0; // 0..1, livello reale d'uscita
  export let meterR: number = 0;
  export let statusText: string = '';
  export let calibrated: boolean = false;

  export let onVolumeChange: (v: number) => void;
  export let onScaleChange: (index: number) => void;
  export let onSensitivityChange: (step: number) => void;
  export let onCryptoChange: (symbol: string) => void;
  export let onTogglePlay: () => void = () => {};
  export let onRecalibrate: () => void = () => {};

  const SENS = ['Low', 'Med', 'High'];

  let assetMenuOpen = false;
  let scaleMenuOpen = false;

  function closeMenus(): void {
    assetMenuOpen = false;
    scaleMenuOpen = false;
  }
  function toggleAssetMenu(): void {
    scaleMenuOpen = false;
    assetMenuOpen = !assetMenuOpen;
  }
  function toggleScaleMenu(): void {
    assetMenuOpen = false;
    scaleMenuOpen = !scaleMenuOpen;
  }

  function selectAsset(symbol: string): void {
    closeMenus();
    onCryptoChange(symbol);
  }
  function selectScale(i: number): void {
    closeMenus();
    onScaleChange(i);
  }

  function onFaderDown(e: PointerEvent): void {
    const track = e.currentTarget as HTMLElement;
    const apply = (clientX: number) => {
      const r = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      onVolumeChange(v);
    };
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  $: currentAsset = assets.find((a) => a.symbol === currentCrypto) ?? { label: '—', sym: '', symbol: '' };
  $: scaleName = scales[currentScale] ?? '—';
  $: volPct = Math.round(volume * 100) + '%';
  $: dbText = volume <= 0.001 ? '−∞ dB' : Math.round(20 * Math.log10(volume)) + ' dB';

  onMount(() => {
    const h = () => closeMenus();
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  });
</script>

<div class="panel">
  <!-- header -->
  <div class="panel-head">
    <span class="head-title">Engine</span>
    <button class="play-btn" class:on={playing} on:click={onTogglePlay}>
      <span class="play-dot"></span>{playing ? 'Live' : 'Paused'}
    </button>
  </div>

  <!-- body -->
  <div class="panel-body">
    <!-- ASSET -->
    <div class="field">
      <span class="label">Asset</span>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="dd" on:click|stopPropagation>
        <button class="dd-trigger" on:click={toggleAssetMenu}>
          <span class="dd-trigger-main">
            <span class="dd-label">{currentAsset.label}</span>
            <span class="dd-sym">{currentAsset.sym}</span>
          </span>
          <span class="chev">▾</span>
        </button>
        {#if assetMenuOpen}
          <div class="dd-menu">
            {#each assets as a}
              <button class="dd-item" class:active={a.symbol === currentCrypto} on:click={() => selectAsset(a.symbol)}>
                <span class="dd-trigger-main">
                  <span class="dd-label sm">{a.label}</span>
                  <span class="dd-sym">{a.sym}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="divider"></div>

    <!-- MASTER VOLUME -->
    <div class="field">
      <div class="row">
        <span class="label">Master Volume</span>
        <span class="mono-val">{volPct}</span>
      </div>
      <div
        class="fader"
        role="slider"
        tabindex="0"
        aria-label="Master Volume"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(volume * 100)}
        on:pointerdown={onFaderDown}
      >
        <div class="fader-track"></div>
        <div class="fader-fill" style="width:{volPct}"></div>
        <div class="fader-thumb" style="left:{volPct}"></div>
      </div>
      <!-- stereo meters -->
      <div class="meters">
        <div class="meter-row">
          <span class="meter-ch">L</span>
          <div class="meter-track"><div class="meter-fill" style="width:{Math.min(100, meterL * 100)}%"></div></div>
        </div>
        <div class="meter-row">
          <span class="meter-ch">R</span>
          <div class="meter-track"><div class="meter-fill" style="width:{Math.min(100, meterR * 100)}%"></div></div>
        </div>
        <div class="db">{dbText}</div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- PITCH BANK -->
    <div class="field">
      <span class="label">Pitch Quantization Bank</span>
      <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
      <div class="dd" on:click|stopPropagation>
        <button class="dd-trigger" on:click={toggleScaleMenu}>
          <span class="dd-label">{scaleName}</span>
          <span class="chev">▾</span>
        </button>
        {#if scaleMenuOpen}
          <div class="dd-menu scroll">
            {#each scales as s, i}
              <button class="dd-item scale" class:active={i === currentScale} on:click={() => selectScale(i)}>{s}</button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="divider"></div>

    <!-- SENSITIVITY -->
    <div class="field">
      <div class="row">
        <span class="label">Price Sensitivity</span>
        <span class="mono-val sm">{SENS[sensitivityStep]}</span>
      </div>
      <div class="seg">
        {#each SENS as label, i}
          <button class="seg-btn" class:active={i === sensitivityStep} on:click={() => onSensitivityChange(i)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>

  <!-- footer -->
  <div class="panel-foot">
    <span class="status"><span class="status-dot" class:on={calibrated}></span>{statusText}</span>
    <button class="recal-btn" on:click={onRecalibrate}>Recalibrate</button>
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
    min-height: 0;
  }

  /* header */
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--lineSoft);
    flex: none;
  }
  .head-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .play-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 12px;
    border-radius: 7px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .play-btn.on {
    border-color: var(--up);
    color: var(--up);
  }
  .play-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  /* body */
  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .panel-body::-webkit-scrollbar {
    width: 8px;
  }
  .panel-body::-webkit-scrollbar-thumb {
    background: var(--line);
    border-radius: 8px;
  }
  .panel-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 11px;
    position: relative;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
  }
  .mono-val {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }
  .mono-val.sm {
    font-size: 12px;
  }

  .divider {
    height: 1px;
    background: var(--lineSoft);
  }

  /* dropdowns */
  .dd {
    position: relative;
  }
  .dd-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 11px 13px;
    background: var(--elev);
    border: 1px solid var(--line);
    border-radius: 9px;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .dd-trigger:hover {
    border-color: var(--accent);
  }
  .dd-trigger-main {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .dd-label {
    font-size: 14px;
    font-weight: 600;
  }
  .dd-label.sm {
    font-size: 13px;
  }
  .dd-sym {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--faint);
    letter-spacing: 0.08em;
  }
  .chev {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--muted);
  }
  .dd-menu {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 6px;
    z-index: 40;
    background: var(--elev);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 5px;
    box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dd-menu.scroll {
    max-height: 230px;
    overflow-y: auto;
  }
  .dd-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 11px;
    border: none;
    border-radius: 7px;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    background: transparent;
    color: var(--text);
    transition: background 0.12s;
  }
  .dd-item:hover {
    background: var(--accentSoft);
  }
  .dd-item.active {
    background: var(--accentSoft);
  }
  .dd-item.scale {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
  }
  .dd-item.scale.active {
    color: var(--text);
  }

  /* fader */
  .fader {
    position: relative;
    height: 26px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }
  .fader-track {
    position: absolute;
    left: 0;
    right: 0;
    height: 6px;
    background: var(--panel2);
    border: 1px solid var(--lineSoft);
    border-radius: 4px;
  }
  .fader-fill {
    position: absolute;
    left: 0;
    height: 6px;
    background: var(--accent);
    border-radius: 4px;
  }
  .fader-thumb {
    position: absolute;
    transform: translateX(-50%);
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--text);
    border: 3px solid var(--panel);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  /* meters */
  .meters {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }
  .meter-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .meter-ch {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    color: var(--faint);
    width: 10px;
  }
  .meter-track {
    flex: 1;
    height: 5px;
    background: var(--panel2);
    border-radius: 3px;
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
  }
  .db {
    text-align: right;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9.5px;
    color: var(--faint);
    letter-spacing: 0.1em;
  }

  /* segmented sensitivity */
  .seg {
    display: flex;
    gap: 6px;
    padding: 4px;
    background: var(--panel2);
    border: 1px solid var(--lineSoft);
    border-radius: 9px;
  }
  .seg-btn {
    flex: 1;
    padding: 8px 0;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    font-weight: 600;
    transition: all 0.15s;
    background: transparent;
    color: var(--muted);
  }
  .seg-btn.active {
    background: var(--accent);
    color: #1a1108;
  }

  /* footer */
  .panel-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 13px 18px;
    border-top: 1px solid var(--lineSoft);
    flex: none;
    background: var(--panel2);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    background: var(--faint);
  }
  .status-dot.on {
    background: var(--up);
  }
  .recal-btn {
    padding: 8px 15px;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--accent);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .recal-btn:hover {
    background: var(--accentSoft);
    border-color: var(--accent);
  }
</style>
