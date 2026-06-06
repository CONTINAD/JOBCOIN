/**
 * JOBCOIN pays out a SINGLE stock: McDonald's (MCDx).
 *
 * This module keeps the same shape the rest of the machine expects (a
 * "rotation"), but the rotation has exactly one entry — McDonald's xStock — so
 * every cycle buys + airdrops MCDx. The xstockscoin engine was a 12-stock
 * rotation; JOBCOIN collapses it to one ticker.
 *
 * MCDx is the VERIFIED Backed/xStocks Token-2022 token on Solana:
 *   mint     XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2
 *   name     "McDonald's xStock"   symbol MCDx   decimals 8
 * Cross-checked on-chain (program = spl-token-2022) and has a live Jupiter
 * SOL->MCDx swap route.
 *
 * Everything is overridable via env (STOCK_MINT / STOCK_SYMBOL / STOCK_TICKER /
 * STOCK_NAME / STOCK_DECIMALS) in case you ever point it at a different stock.
 */

export interface Stock {
  /** On-chain symbol, e.g. "MCDx". */
  symbol: string;
  /** Clean ticker for the UI, e.g. "MCD". */
  ticker: string;
  /** Company / fund name. */
  name: string;
  /** Token-2022 mint address. */
  mint: string;
  /** Token decimals (verified MCDx = 8). */
  decimals: number;
}

// The one stock JOBCOIN ships: McDonald's.
export const MCD_STOCK: Stock = {
  symbol: process.env.STOCK_SYMBOL?.trim() || "MCDx",
  ticker: process.env.STOCK_TICKER?.trim() || "MCD",
  name: process.env.STOCK_NAME?.trim() || "McDonald's",
  mint: process.env.STOCK_MINT?.trim() || "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
  decimals: Number(process.env.STOCK_DECIMALS || "8"),
};

// Keyed map kept for compatibility with anything that looked stocks up by symbol.
export const STOCKS: Record<string, Stock> = { [MCD_STOCK.symbol]: MCD_STOCK };

// The "rotation" is a single stock — MCDx, every cycle.
export const ROTATION: Stock[] = [MCD_STOCK];

/** Native SOL mint (Jupiter's wrapped-SOL input mint). */
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** The stock for a given cycle. Always MCDx. */
export function stockForCycle(_cycleNumber: number): Stock {
  return MCD_STOCK;
}

/** The stock paid NEXT cycle (also MCDx). */
export function nextStockForCycle(_cycleNumber: number): Stock {
  return MCD_STOCK;
}

export const ROTATION_LENGTH = ROTATION.length;
