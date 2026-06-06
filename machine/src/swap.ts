import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { connection, ata2022, getRawTokenBalance } from "./wallet";
import { config } from "./config";
import { logger } from "./logger";
import { SOL_MINT, type Stock } from "./rotation";

export interface SwapResult {
  signature: string;
  /** Stock actually received, in base units (decimals = stock.decimals). */
  receivedRaw: bigint;
  /** SOL actually spent (lamports, in) per the executed quote. */
  spentLamports: number;
  /** Stock received as a human UI amount (receivedRaw / 10^decimals). */
  receivedUi: number;
}

interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  [k: string]: unknown;
}

const MAX_ATTEMPTS = 3;

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!r.ok) {
      const msg = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`HTTP ${r.status}: ${msg?.slice(0, 300)}`);
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

/** Get a Jupiter ExactIn quote for SOL → stock. Returns null if no route. */
export async function quoteSolToStock(stock: Stock, solLamports: number): Promise<JupQuote | null> {
  if (solLamports <= 0) return null;
  const url =
    `${config.jupiterBaseUrl}/swap/v1/quote` +
    `?inputMint=${SOL_MINT}` +
    `&outputMint=${stock.mint}` +
    `&amount=${Math.floor(solLamports)}` +
    `&slippageBps=${config.swapSlippageBps}` +
    `&swapMode=ExactIn` +
    `&onlyDirectRoutes=false`;
  try {
    const q = await fetchJson(url);
    if (!q || !q.outAmount || q.error) {
      logger.warn(`No Jupiter route ${stock.symbol}: ${q?.error || "empty quote"}`);
      return null;
    }
    return q as JupQuote;
  } catch (e) {
    logger.warn(`Jupiter quote failed for ${stock.symbol}: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Buy `stock` with `solLamports` of SOL from the treasury wallet via Jupiter,
 * then measure the EXACT amount of stock received by diffing the treasury's
 * stock token account before/after (same measured-delta discipline as the SOL
 * claim ledger — we never trust a quoted number for accounting). Retries with
 * fresh quotes + escalating priority fee.
 */
export async function buyStock(
  treasury: Keypair,
  stock: Stock,
  solLamports: number
): Promise<SwapResult | null> {
  if (solLamports <= 0) return null;
  const stockMint = new PublicKey(stock.mint);
  const treasuryStockAta = ata2022(treasury.publicKey, stockMint);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const quote = await quoteSolToStock(stock, solLamports);
    if (!quote) { lastErr = new Error("no route"); break; }

    const priorityLamports = Math.floor(config.priorityFee * LAMPORTS_PER_SOL * Math.pow(2, attempt - 1));
    try {
      const swap = await fetchJson(`${config.jupiterBaseUrl}/swap/v1/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: treasury.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          // Cap the priority fee so a congested network can't drain the buffer.
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: priorityLamports,
              priorityLevel: "high",
            },
          },
        }),
      });
      if (!swap?.swapTransaction) throw new Error("swap endpoint returned no transaction");

      const before = await getRawTokenBalance(treasuryStockAta);

      const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
      tx.sign([treasury]);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
      });
      logger.info(
        `Swap submitted (attempt ${attempt}): ${(solLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL → ${stock.symbol} — ${sig.slice(0, 16)}…`
      );

      const ok = await confirm(sig);
      if (!ok) {
        logger.warn(`Swap ${stock.symbol} attempt ${attempt} did not confirm — re-quoting.`);
        lastErr = new Error("swap did not confirm");
        await sleep(1500);
        continue;
      }

      // Measured delta: how much stock actually landed.
      await sleep(2500);
      const after = await getRawTokenBalance(treasuryStockAta);
      const receivedRaw = after > before ? after - before : 0n;
      if (receivedRaw <= 0n) {
        logger.warn(`Swap ${stock.symbol} confirmed but no stock delta detected — retrying.`);
        lastErr = new Error("no stock delta");
        continue;
      }
      const receivedUi = Number(receivedRaw) / 10 ** stock.decimals;
      logger.info(
        `Bought ${receivedUi.toFixed(6)} ${stock.symbol} for ${(solLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL (tx ${sig.slice(0, 12)}…)`
      );
      return { signature: sig, receivedRaw, spentLamports: solLamports, receivedUi };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      logger.warn(`Swap ${stock.symbol} attempt ${attempt} threw: ${lastErr.message}`);
      await sleep(1500);
    }
  }
  logger.error(`Swap to ${stock.symbol} FAILED after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
  return null;
}

async function confirm(sig: string): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    try {
      const s = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
      const v = s.value;
      if (!v) continue;
      if (v.err) return false;
      if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return true;
    } catch { /* transient */ }
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
