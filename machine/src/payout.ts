import {
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import { connection, ata2022 } from "./wallet";
import { config } from "./config";
import { logger } from "./logger";
import type { HolderEntry } from "./holders";
import type { Stock } from "./rotation";

export interface StockPayoutPlanEntry {
  owner: string;
  uiBalance: number;   // the holder's $XSTOCKS bag (drives the split)
  amountRaw: bigint;   // stock to send, in base units
}

export interface StockPayoutResult {
  owner: string;
  uiBalance: number;
  amountRaw: bigint;
  signature: string | null;
  relay: string | null; // the ephemeral wallet that actually paid this holder
}

const BATCH_SIZE = Math.max(1, config.payoutBatchSize);

/**
 * Proportional split of `totalStockRaw` base units across qualified holders,
 * weighted by each holder's $XSTOCKS balance. EVERY qualified holder is paid —
 * there is no minimum-value filter (a holder is only dropped if there is so
 * little stock that their floored slice is literally 0 base units, which the
 * cycle's minDispenseSol guard prevents in practice). If more than
 * `maxRecipients` qualify, the largest holders are paid first (safety bound).
 */
export function computeProportionalStockPayouts(
  qualified: HolderEntry[],
  totalStockRaw: bigint,
  maxRecipients: number
): StockPayoutPlanEntry[] {
  if (qualified.length === 0 || totalStockRaw <= 0n) return [];

  const sorted = qualified.slice().sort((a, b) => b.uiBalance - a.uiBalance);
  const capped = sorted.slice(0, maxRecipients);

  const totalBalance = capped.reduce((s, h) => s + h.uiBalance, 0);
  if (totalBalance <= 0) return [];

  // Work in integer base units: floor each holder's proportional slice.
  // Remainder dust simply stays in the treasury stock ATA and rolls into the
  // next time this stock comes back around.
  const out: StockPayoutPlanEntry[] = [];
  for (const h of capped) {
    const share = h.uiBalance / totalBalance;
    const amountRaw = BigInt(Math.floor(Number(totalStockRaw) * share));
    if (amountRaw > 0n) {
      out.push({ owner: h.owner, uiBalance: h.uiBalance, amountRaw });
    }
  }
  return out;
}

/**
 * Pay every entry in the plan in `stock`, routing each batch through a FRESH
 * ephemeral relay wallet so bubblemap-style clustering can't pin all holders to
 * one persistent paying wallet.
 *
 * Each batch is ONE atomic transaction. The relay pays for everything itself —
 * treasury just feeds the relay the SOL it needs, then sweeps the relay back to
 * zero — so the on-chain "funder" of every holder account is the relay (a
 * throwaway), not the treasury. After the tx the relay has 0 SOL and no token
 * accounts, so it's pruned and leaves no balance/wallet on the bubble map.
 *
 * Instruction order:
 *   1. treasury sends the relay exactly (1 + newAtaCount) × ataRent of SOL
 *      — enough for the relay's own ATA + each brand-new holder ATA's rent.
 *   2. relay opens its own stock ATA (rent paid by relay).
 *   3. treasury transfers the batch total of stock → relay's ATA.
 *   4. for each holder: relay opens their stock ATA (idempotent — rent paid by
 *      the relay) + relay sends them their slice.
 *   5. relay closes its now-empty ATA, refunding its rent back to the relay.
 *   6. relay sends that refund back to the treasury, ending the relay at 0 SOL.
 *
 * Net SOL out of treasury per batch = newAtaCount × ataRent + network fee.
 * Same total cost as before, but the funding chain is treasury → relay → holder
 * instead of treasury → holder, giving another hop of separation. A different
 * throwaway relay handles each batch (and each retry).
 */
export interface DispenseOptions {
  ataRentLamports: number;
  newAtaOwners: Set<string>;
}
export async function dispenseStock(
  funder: Keypair,
  stock: Stock,
  plan: StockPayoutPlanEntry[],
  opts: DispenseOptions
): Promise<StockPayoutResult[]> {
  const results: StockPayoutResult[] = [];
  const stockMint = new PublicKey(stock.mint);
  const treasuryAta = ata2022(funder.publicKey, stockMint);

  for (let i = 0; i < plan.length; i += BATCH_SIZE) {
    const batch = plan.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(plan.length / BATCH_SIZE);

    let outcome: { signature: string; relay: string } | null = null;
    try {
      outcome = await sendBatchWithRetries(funder, stock, stockMint, treasuryAta, batch, batchNum, totalBatches, opts);
    } catch (e) {
      logger.error(`Payout batch ${batchNum}/${totalBatches} (${stock.symbol}) failed: ${e instanceof Error ? e.message : e}`);
    }

    for (const p of batch) {
      results.push({
        owner: p.owner,
        uiBalance: p.uiBalance,
        amountRaw: outcome ? p.amountRaw : 0n,
        signature: outcome?.signature ?? null,
        relay: outcome?.relay ?? null,
      });
    }
  }
  return results;
}

async function sendBatchWithRetries(
  funder: Keypair,
  stock: Stock,
  stockMint: PublicKey,
  treasuryAta: PublicKey,
  batch: StockPayoutPlanEntry[],
  batchNum: number,
  totalBatches: number,
  opts: DispenseOptions
): Promise<{ signature: string; relay: string } | null> {
  const MAX_ATTEMPTS = 4;
  const batchTotal = batch.reduce((s, p) => s + p.amountRaw, 0n);
  const newInBatch = batch.reduce((n, p) => n + (opts.newAtaOwners.has(p.owner) ? 1 : 0), 0);
  // Relay needs SOL to cover: its own ATA rent (round-trips) + every new holder
  // ATA's rent it'll pay (permanent payment that lands inside the holder's
  // account). Existing holder ATAs cost nothing — the idempotent create is a
  // no-op. Treasury sends exactly this; nothing extra so the relay can be swept
  // to 0 with a single fixed-amount transfer at the end.
  const relayFunding = (1 + newInBatch) * opts.ataRentLamports;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh throwaway relay on every attempt so a stuck signature never reuses
    // an address and the on-chain graph stays fragmented.
    const relay = Keypair.generate();
    const relayAta = ata2022(relay.publicKey, stockMint);
    const priorityMicroLamports = 5_000 * Math.pow(2, attempt - 1);

    try {
      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
      );
      // 1) treasury funds the relay with EXACTLY the SOL it'll need. The relay
      //    pays its own ATA rent + every brand-new holder ATA's rent below.
      tx.add(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: relay.publicKey,
          lamports: relayFunding,
        })
      );
      // 2) relay opens its own stock ATA (rent paid by relay, refunded on close).
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          relay.publicKey, relayAta, relay.publicKey, stockMint,
          TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      // 3) treasury sends the batch total of stock into the relay's ATA.
      tx.add(
        createTransferCheckedInstruction(
          treasuryAta, stockMint, relayAta, funder.publicKey,
          batchTotal, stock.decimals, [], TOKEN_2022_PROGRAM_ID
        )
      );
      // 4) for each holder: RELAY opens their stock ATA (rent paid by relay)
      //    + relay sends them their slice. Idempotent create is a no-op if it
      //    already exists, so only "new" holders cost rent — exactly matching
      //    what step 1 funded the relay for.
      for (const p of batch) {
        const holder = new PublicKey(p.owner);
        const holderAta = ata2022(holder, stockMint);
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            relay.publicKey, holderAta, holder, stockMint,
            TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
          ),
          createTransferCheckedInstruction(
            relayAta, stockMint, holderAta, relay.publicKey,
            p.amountRaw, stock.decimals, [], TOKEN_2022_PROGRAM_ID
          )
        );
      }
      // 5) relay closes its now-empty ATA — rent refunds back to the relay.
      tx.add(
        createCloseAccountInstruction(
          relayAta, relay.publicKey, relay.publicKey, [], TOKEN_2022_PROGRAM_ID
        )
      );
      // 6) relay sweeps the refunded rent back to the treasury, ending at 0 SOL.
      //    Combined with the ATA close, the relay has 0 lamports + 0 token
      //    accounts after this tx — its system account is pruned, leaving no
      //    on-chain footprint at all.
      tx.add(
        SystemProgram.transfer({
          fromPubkey: relay.publicKey,
          toPubkey: funder.publicKey,
          lamports: opts.ataRentLamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = funder.publicKey;
      tx.sign(funder, relay);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 5,
      });
      logger.info(
        `Payout batch ${batchNum}/${totalBatches} (${stock.symbol}) submitted (attempt ${attempt}): ` +
        `${batch.length} holders, ${(Number(batchTotal) / 10 ** stock.decimals).toFixed(6)} ${stock.symbol} ` +
        `via relay ${relay.publicKey.toBase58().slice(0, 6)}… — ${sig.slice(0, 16)}…`
      );

      const ok = await confirmWithHistoryFallback(sig);
      if (ok) {
        if (attempt > 1) logger.info(`Payout batch ${batchNum}/${totalBatches} landed on attempt ${attempt}.`);
        return { signature: sig, relay: relay.publicKey.toBase58() };
      }
      logger.warn(`Payout batch ${batchNum}/${totalBatches} attempt ${attempt} did not confirm — escalating.`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      logger.warn(`Payout batch ${batchNum}/${totalBatches} attempt ${attempt} threw: ${lastErr.message}`);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500));
  }
  if (lastErr) throw lastErr;
  return null;
}

async function confirmWithHistoryFallback(sig: string): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const s = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
      const v = s.value;
      if (!v) continue;
      if (v.err) return false;
      if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return true;
    } catch {
      /* transient */
    }
  }
  try {
    const s = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
    const v = s.value;
    if (v && !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) return true;
  } catch {
    /* swallow */
  }
  return false;
}

export const PAYOUT_BATCH_SIZE = BATCH_SIZE;
