import { writable, get } from 'svelte/store';

// Interruttore globale dei "help bubbles" (attivo di default all'avvio).
export const helpEnabled = writable(true);

// Bolla attualmente visibile: testo + rettangolo (viewport) dell'elemento sorgente.
export const activeHelp = writable<{ text: string; rect: DOMRect } | null>(null);

// Testi di aiuto — SEGNAPOSTO: sostituiscili con le spiegazioni reali.
export const HELP: Record<string, string> = {
  live: "Avvia o mette in pausa il motore audio: in pausa l'uscita viene azzerata ma lo stream di mercato continua. (testo segnaposto)",
  asset: 'Coppia di mercato da sonificare; al cambio parte una nuova calibrazione. (testo segnaposto)',
  volume: "Livello d'uscita generale del motore audio. (testo segnaposto)",
  scale: 'Banco di quantizzazione: vincola le note generate alla scala musicale scelta. (testo segnaposto)',
  sensitivity: 'Quanto marcatamente le variazioni di prezzo modulano i parametri sonori. (testo segnaposto)',
  recalibrate: 'Riconnette lo stream e ri-misura il range dinamico del mercato corrente. (testo segnaposto)',
  chart: "Andamento del prezzo sull'ultima finestra di 64 tick. (testo segnaposto)",
  waveform: "Forma d'onda dell'uscita audio in tempo reale. (testo segnaposto)",
  vector: "Vettorscopio: correlazione di fase e ampiezza stereo dell'uscita. (testo segnaposto)",
  orderflow: "Squilibrio del flusso ordini: tendenza fra pressione d'acquisto (bullish) e di vendita (bearish). (testo segnaposto)",
  density: 'Densità degli scambi: frequenza di arrivo dei trade, normalizzata sul range calibrato. (testo segnaposto)',
  volatility: 'Volatilità: ampiezza delle oscillazioni di prezzo, normalizzata sul range calibrato. (testo segnaposto)',
  theme: "Cambia la palette di colori dell'interfaccia. (testo segnaposto)"
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
