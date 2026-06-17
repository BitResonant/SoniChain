// src/crypto.worker.ts

interface BinanceTick {
  e: string;  // Event type
  E: number;  // Event time
  s: string;  // Symbol
  a: number;  // Aggregate trade ID
  p: string;  // Price
  q: string;  // Quantity
  f: number;  // First trade ID
  l: number;  // Last trade ID
  T: number;  // Trade time
  m: boolean; // Is the buyer the market maker?
  M: boolean; // Ignore
}

const WINDOW_SIZE = 64;
const priceHistory: number[] = [];
let lastTimestamp: number | null = null;

// Gestione dell'handshake e dello stream WebSocket con backoff asincrono
function connectStream(symbol: string = 'btcusdt') {
  const uri = `wss://stream.binance.com:9443/ws/${symbol}@aggTrade`;
  console.log(`[Worker] Connecting to WebSocket: ${uri}`);
  const ws = new WebSocket(uri);

  ws.onopen = () => {
    console.log(`[Worker] Handshake stabilito. Stream per ${symbol.toUpperCase()} connesso.`);
  };

  ws.onmessage = (event: MessageEvent) => {
    const payload: BinanceTick = JSON.parse(event.data);
    processTick(payload);
  };

  ws.onerror = (error) => {
    console.error("[Worker] Stream Fault di rete:", error);
  };

  ws.onclose = () => {
    console.warn("[Worker] Connessione interrotta. Tentativo di riconnessione in corso...");
    setTimeout(() => connectStream(symbol), 3000);
  };
}

function processTick(payload: BinanceTick): void {
  // 1. Raw Extraction
  const currentPrice = parseFloat(payload.p);
  const volume = parseFloat(payload.q);
  const tradeTime = payload.T;
  const isBuyerMaker = payload.m ? 1 : 0; // Cast a intero 0/1 per routing DSP o inversione di fase

  // 2. Inter-Onset Interval (IOI) in millisecondi
  let timeDeltaMs = 0;
  if (lastTimestamp !== null) {
    timeDeltaMs = tradeTime - lastTimestamp;
  }
  lastTimestamp = tradeTime;

  // 3. Calcolo della Volatilità tramite Log-Returns (Standard Deviation)
  let volatilityRaw = 0.0;
  priceHistory.push(currentPrice);

  if (priceHistory.length > WINDOW_SIZE + 1) {
    priceHistory.shift(); // Mantiene la dimensione fissa del ring buffer
  }

  if (priceHistory.length > 1) {
    const logReturns: number[] = [];
    for (let i = 1; i < priceHistory.length; i++) {
      logReturns.push(Math.log(priceHistory[i] / priceHistory[i - 1]));
    }

    const meanReturn = logReturns.reduce((sum, val) => sum + val, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, val) => sum + Math.pow(val - meanReturn, 2), 0) / logReturns.length;
    volatilityRaw = Math.sqrt(variance);
  }

  // 4. Trasferimento asincrono dei dati grezzi alla UI e al motore DSP
  const tickData = {
    type: 'TICK' as const,
    data: {
      price: currentPrice,
      market_volume: volume,
      density: timeDeltaMs,
      maker_side: isBuyerMaker,
      volatility: volatilityRaw
    }
  };
  console.debug('[Worker] Sending tick:', tickData.data);
  self.postMessage(tickData);
}

// In ascolto di comandi dal thread principale (es. cambio asset)
self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'START') {
    connectStream(e.data.symbol);
  }
};