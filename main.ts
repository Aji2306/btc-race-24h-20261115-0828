import { runBars } from './vendor/makefun-bars.ts';

let entryPrice: bigint | null = null;
let entryBarSeq = -1;
let lastExitBarSeq = -999;
const closes: bigint[] = [];

await runBars({
  onBatch(state, batch) {
    const b = state.latest.get('CBBTC');
    if (!b) return [];
    const close = BigInt(b.c);
    closes.push(close);
    if (closes.length > 300) closes.shift();

    const pos = state.positions.get('CBBTC');
    const hasPosition = pos !== undefined && pos.qty > 0n;

    if (hasPosition && entryPrice === null) {
      entryPrice = close;
      entryBarSeq = state.seq;
    } else if (!hasPosition) {
      entryPrice = null;
      entryBarSeq = -1;
    }

    const orders = [];

    if (hasPosition && entryPrice !== null) {
      const pnlBps = ((close - entryPrice) * 10000n) / entryPrice;
      const barsHeld = state.seq - entryBarSeq;

      // Take profit at +400 bps, stop loss at -80 bps, or timeout after 60 bars
      if (pnlBps >= 400n || pnlBps <= -80n || barsHeld >= 60) {
        orders.push({
          side: 'sell',
          symbol: 'CBBTC',
          qty: pos.qty,
          max_slippage_bps: 200,
        });
        entryPrice = null;
        lastExitBarSeq = state.seq;
      }
    } else if (!hasPosition && closes.length >= 120 && state.seq - lastExitBarSeq >= 120) {
      // Find 120-bar high
      let high = closes[0];
      for (let i = closes.length - 120; i < closes.length; i++) {
        if (i >= 0 && closes[i] > high) high = closes[i];
      }
      const dropBps = ((high - close) * 10000n) / high;

      // Check that current bar is bouncing off the 10-bar low (stricter: bounce >= 50 bps)
      let low10 = closes[closes.length - 1];
      for (let i = closes.length - 10; i < closes.length; i++) {
        if (closes[i] < low10) low10 = closes[i];
      }
      const bounceBps = ((close - low10) * 10000n) / low10;

      // Buy on dip between 3.0% and 5.5%, bounce >= 50 bps
      if (dropBps >= 300n && dropBps <= 550n && bounceBps >= 50n) {
        const cashToUse = (state.cash * 95n) / 100n;
        const minNotional = 1_000_000n; // $1
        if (cashToUse >= minNotional && state.weightRoom('CBBTC') >= minNotional) {
          orders.push({
            side: 'buy',
            symbol: 'CBBTC',
            notional_quote_units: cashToUse,
            max_slippage_bps: 200,
          });
        }
      }
    }

    return orders;
  },
});
