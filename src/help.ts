import { writable, get } from 'svelte/store';

// Interruttore globale dei "help bubbles" (attivo di default all'avvio).
export const helpEnabled = writable(true);

// Bolla attualmente visibile: testo + rettangolo (viewport) dell'elemento sorgente.
export const activeHelp = writable<{ text: string; rect: DOMRect } | null>(null);

// Testi di aiuto — SEGNAPOSTO: sostituiscili con le spiegazioni reali.
export const HELP: Record<string, string> = {
  live: "Toggles the audio engine state.",
  asset: 'Selects the cryptocurrency asset for sonification.',
  volume: "Adjusts the master volume level.",
  scale: 'Selects the musical scale for price-to-pitch mapping.',
  sensitivity: 'Adjusts how much the sound volume reacts to trading activity on the market. Low: Small trades are ignored; sound is triggered only by large buying or selling spikes. Mid: Standard market activity creates a natural sound response. High: Even the smallest trades will instantly change the sound volume.',
  recalibrate: 'Reconnects the stream and recalibrates the market dynamic range.',
  chart: "Displays the recent history of price movements and musical notes over the last 64 market updates.",
  waveform: "Displays the visual shape of the sound waves being generated right now.",
  vector: "Displays the balance and phase relationship between the left and right audio channels.",
  orderflow: "Shows the balance of power between aggressive buyers and sellers in the market.",
  density: 'Densità degli scambi: Displays how fast trades are hitting the market scaled from 0 to 100.',
  volatility: 'Displays the size of recent price movements scaled from 0 to 100.',
  theme: "Selects a new visual theme for the application interface and its internal sound generation matrix"
};

// Svelte action: mostra la bolla dopo 500ms di hover, solo se le bolle sono attive.
export function help(node: HTMLElement, text: string) {
  let current = text;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const onEnter = () => {
    if (!get(helpEnabled) || !current) return;
    clear();
    timer = setTimeout(() => {
      if (!get(helpEnabled)) return;
      activeHelp.set({ text: current, rect: node.getBoundingClientRect() });
    }, 500);
  };
  const onLeave = () => {
    clear();
    activeHelp.set(null);
  };

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('pointerdown', onLeave);

  return {
    update(newText: string) {
      current = newText;
    },
    destroy() {
      clear();
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('pointerdown', onLeave);
    }
  };
}
