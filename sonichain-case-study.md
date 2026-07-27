# Brief · Riscrittura case study SoniChain

> **Come usare questo file**: apri una chat nel progetto e scrivi
> *"leggi `.claude/briefs/sonichain-case-study.md` e lavoriamo alla sezione «Designing for low fatigue»"*.
> Il documento è autosufficiente: contiene diagnosi, ricerca, direzione di scrittura e le domande a cui devo rispondere io.

---

## 1. Dove sta il testo

`index.html`, overlay reader `#reader-soni` (~righe 322-366). La sezione sotto esame è l'ultima:

**Riga 361-362 — `<h3>Designing for low fatigue</h3>`**

> Prices move in musical intervals, never glissando; sell and buy pressure are split hard left and right to keep the stereo center clear; denser flow sounds closer and brighter; volatile markets leave a reverberant wake. An adaptive scaler re-ranges the display as regimes change, and a logarithmic volume curve lets you dial it from a discreet macro-event alarm all the way to full micro-structure immersion.

Contesto immediatamente sopra: `<h3>Overview</h3>`, `<h3>Architecture</h3>`, `<h3>Parameter mapping</h3>` (tabella `.map` con 5 metriche), `<h3>Three voices and a space</h3>`, blockquote `.pull`.

---

## 2. Cosa dice la ricerca (luglio 2026)

Criteri con cui i recruiter leggono una case study — valgono anche per un profilo audio-tech:

- **"Show decisions, not deliverables"**: la differenza tra sezione debole e forte non è il dettaglio tecnico, è se si capisce *perché* così e non altrimenti — [designcase.app](https://designcase.app/blog/what-hiring-managers-look-for-ux-case-studies/)
- **Nascondere i vincoli è un errore classico**: *"Show where things broke. Explain why a feature was deprioritized. This is where your judgment becomes visible."* — e un altro errore è scrivere **liste/cronologie invece di argomentazioni** — [Bootcamp](https://medium.com/design-bootcamp/5-ux-portfolio-mistakes-that-are-costing-you-jobs-7231f529beaa)
- **La specificità è ciò che ferma il lettore**: *"a clear problem statement, an unexpected constraint, a decision they want to ask about"*. Tempo medio di lettura ~60 secondi: il problema difficile va nella prima frase.
- **Outcome senza overclaim**: mostra cosa è cambiato, ma non affermare impatti che non puoi sostenere — [uxfol.io](https://blog.uxfol.io/ux-case-study-structure/)
- **Portfolio audio**: le case study forti raccontano *"creative process, challenges faced, and how you overcame them"* — [Transverse Audio](https://transverseaudio.com/posts/how-to-make-a-better-audio-portfolio), [Academy93](https://academy93.com/blog/how-to-create-a-captivating-sound-design-portfolio)
- **Sonification**: nel campo, la valutazione **fa parte del design** — c'è un capitolo intero del Sonification Handbook sull'evaluation degli auditory display, incluso il fatto che i pilot con campione piccolo si dichiarano per quello che sono — [cap. 6](https://sonification.de/handbook/download/TheSonificationHandbook-chapter6.pdf)

---

## 3. Diagnosi della sezione

1. **Ripete la tabella `Parameter mapping`.** Pan L/R, pitch, brillantezza, riverbero sono già nella `.map` poche righe sopra. Il lettore rilegge la stessa informazione in forma peggiore (prosa invece di tabella).
2. **Verdetti senza rationale e senza alternativa scartata.** "Prices move in musical intervals, never glissando" è un'ottima decisione presentata come dato di fatto. L'alternativa (pitch continuo) è esattamente ciò che fa suonare le sonificazioni come sirene: senza nominarla, la scelta non si vede.
3. **L'adaptive scaler è sepolto in una subordinata** ed è il problema più interessante del progetto: il range dinamico cambia tra regimi di mercato (con scala fissa, un mercato calmo è inudibile e uno volatile satura la percezione). Ha anche un **trade-off vero da dichiarare**: la scala adattiva fa perdere la comparabilità assoluta nel tempo. Ammetterlo è il segnale di maturità più forte disponibile in quella pagina.
4. **"Low fatigue" è una claim ergonomica mai verificata**, ed è pure il titolo della sezione.
5. **Manca il task**: cosa decide concretamente chi ascolta, che non farebbe guardando un grafico.

---

## 4. Direzione di riscrittura

Trasformare la sezione da *elenco di caratteristiche* a **catena di decisioni**. Struttura per ogni punto: decisione → alternativa ovvia scartata → prezzo pagato.

Considerare anche di **cambiare il titolo**: "Designing for low fatigue" dichiara un risultato raggiunto e non dimostrato. Un titolo che nomina la decisione (es. *"Why intervals, not glissando"*, o *"The mappings I rejected"*) è più difendibile e più interessante.

Esempio prima/dopo, senza aggiungere un solo numero:

> **Oggi**: *"Prices move in musical intervals, never glissando."*
>
> **Dopo**: *"The obvious mapping — price straight to continuous pitch — is exactly what makes most sonifications sound like an alarm, and an alarm is unlistenable for hours. Quantising to intervals costs resolution on tiny moves; I took that trade because the display is meant to be worn, not watched."*

Da evitare: ripetere di nuovo i mapping già in tabella. Se un mapping torna nel testo, deve tornare **solo** come decisione discussa, non come descrizione.

---

## 5. Vincolo non negoziabile: nessun numero inventato

Distinzione operativa:

- **Parametri di progetto** (disponibili, sono nel codice): 5 metriche, 8 voci di polifonia, 3 motori, RNBO → WASM, Schroeder-Moorer reverb. Usarli **sempre con la ragione accanto**: un parametro senza motivo è arredamento, con il motivo è una decisione.
- **Misure** (NON disponibili): CPU %, latenza, "riduce l'affaticamento del X%". **Non inventarle.** In colloquio la prima domanda sarebbe "come l'hai misurato": un numero indifendibile brucia il credito costruito da tutto il resto della pagina.

Per l'evidenza qualitativa, **dichiarare i limiti è un vantaggio, non una debolezza**. Formule oneste utilizzabili: *"no formal listening test was run — this is what I observed over weeks of use"*, *"single-listener, informal"*. Nella letteratura di sonification si fa esattamente così, e vale più di un "low fatigue" nudo perché mostra che sai cosa sarebbe una prova vera.

---

## 6. Domande a cui rispondo io (tutte a memoria, niente da misurare)

1. Cosa ho provato **prima** che stancava o non funzionava? Che versione ho buttato e perché?
2. Quanto a lungo l'ho realmente ascoltato, e cosa ho cambiato dopo averlo ascoltato a lungo?
3. Qualcun altro l'ha ascoltato? Cosa ha detto?
4. Come funziona davvero l'adaptive scaler (finestra temporale? percentili? soglie?) e **cosa ho sacrificato** adottandolo?
5. Perché **tre** motori e non uno? Cosa cambia nell'uso reale passare da glassarmonica a FM pad a bowed string?
6. Cosa decide chi ascolta? Qual è il momento in cui il suono ti dice qualcosa **prima** che tu lo veda sul grafico?
7. Cosa ho deliberatamente rinunciato a fare (feature scartate, metriche non sonificate) e perché?

Rispondere anche a braccio e in disordine: la stesura in inglese la fa Claude.

---

## 7. Numeri recuperabili davvero, se servissero (opzionale)

- Logging del rate dei messaggi WebSocket Binance: poche righe nel worker, dà il rate reale e la sua irregolarità.
- Carico CPU del device RNBO in WASM: misurabile dal browser (performance profiler).

Non bloccano la riscrittura. La riscrittura può procedere a zero misure.

---

## 8. Vincoli tecnici del sito (da rispettare nelle modifiche)

- Contenuti del sito **in inglese**; conversazione in italiano.
- Gerarchia heading: **un solo `<h1>`** (hero). Nei reader i titoli sono `<h2>`, i sottotitoli **`<h3>`**. Non introdurre `<h4>` o `<h1>`.
- Nessun build step: HTML + CSS + JS vanilla. Verifica visiva nel browser (`python3 -m http.server 8000`).
- CSS in BEM, colori solo da token in `:root` di `css/main.css`. Blocchi riusabili: `.flow`, `.map` (`.map__head` / `.map__row`), `blockquote.pull` e **`.brief`** (`.brief__label` + `.brief__list`, il riquadro "At a glance" introdotto nel case study EV).
- **Il case study EV in `#reader-ev` è il modello di riferimento** — stessa struttura: riquadro `.brief` da ~140 parole in testa (ruolo, problema, decisioni col prezzo, evidenza, limiti), poi `<h3>` narrativi che raccontano l'argomento anche solo scorrendoli, e una sezione finale onesta sui limiti. Replicare quell'impianto, non inventarne uno nuovo.
- Gli overlay reader sono HTML statico nello stesso documento: Google li indicizza anche se `hidden`. Il testo conta per la SEO.
- Non committare né pushare senza richiesta esplicita.
