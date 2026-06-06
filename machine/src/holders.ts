import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection } from "./wallet";
import { logger } from "./logger";

export interface HolderEntry {
  owner: string;
  uiBalance: number;
}

const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();

/**
 * Snapshot every wallet currently holding $ATM. Requires a paid RPC
 * (Helius/QuickNode/Triton) because free RPCs disable getProgramAccounts.
 * Sums balances per owner across multiple token accounts.
 */
export async function snapshotHolders(mintBase58: string): Promise<HolderEntry[]> {
  const mint = new PublicKey(mintBase58);
  const owner = await detectOwner(mint);
  const programs = owner ? [owner] : [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

  const merged = new Map<string, number>();
  for (const program of programs) {
    try {
      // Filter ONLY by the mint at offset 0 (first field of every token-account
      // layout). Token-2022 accounts vary in size with extensions — pump.fun's
      // carry ImmutableOwner and are 170 bytes, not 165/182 — so a hardcoded
      // dataSize filter silently drops nearly every real holder.
      const accs = await gpaWithRetry(program, mint);
      for (const acc of accs) {
        const data = acc.account.data as { parsed?: { info?: { owner?: string; tokenAmount?: { uiAmount?: number } } } };
        const info = data?.parsed?.info;
        const ownerStr = info?.owner;
        const ui = info?.tokenAmount?.uiAmount ?? 0;
        if (!ownerStr || ui <= 0) continue;
        merged.set(ownerStr, (merged.get(ownerStr) || 0) + ui);
      }
    } catch (e) {
      logger.warn(
        `Holder snapshot via ${program.toBase58().slice(0, 4)}… failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  const payable = await dropProgramOwnedAccounts(Array.from(merged.keys()));
  return payable
    .map((owner) => ({ owner, uiBalance: merged.get(owner) ?? 0 }))
    .sort((a, b) => b.uiBalance - a.uiBalance);
}

/**
 * getProgramAccounts is the heaviest RPC call we make (it scans the token
 * program for every account holding the mint). Cheap/free RPC tiers rate-limit
 * it hard (HTTP 429 / "compute units per second"). Retry with exponential
 * backoff — longer on a rate-limit — so a transient throttle never silently
 * skips a payout cycle. Throws after the last attempt so the caller carries the
 * pool over (never pays a partial/empty holder set).
 */
async function gpaWithRetry(program: PublicKey, mint: PublicKey, attempts = 4) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await connection.getParsedProgramAccounts(program, {
        filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
      });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const rateLimited = /429|rate|compute unit|too many/i.test(msg);
      const wait = rateLimited ? 2000 * Math.pow(2, i) : 1000 * (i + 1);
      if (i < attempts - 1) {
        logger.warn(`getProgramAccounts ${program.toBase58().slice(0, 4)}… attempt ${i + 1}/${attempts} failed (${msg.slice(0, 90)}) — retry in ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * Drop owners whose account is owned by a program — pumpswap/Raydium pools,
 * escrows, PDAs. Paying SOL there is wasted (they can't spend it) and a pool
 * would otherwise swallow a huge proportional share. Real user wallets are
 * System-owned, or don't exist on-chain yet (unfunded) — both are kept.
 */
async function dropProgramOwnedAccounts(owners: string[]): Promise<string[]> {
  const keep: string[] = [];
  const BATCH = 100;
  for (let i = 0; i < owners.length; i += BATCH) {
    const slice = owners.slice(i, i + BATCH);
    try {
      const infos = await connection.getMultipleAccountsInfo(slice.map((o) => new PublicKey(o)));
      slice.forEach((o, idx) => {
        const info = infos[idx];
        if (!info || info.owner.toBase58() === SYSTEM_PROGRAM) keep.push(o);
      });
    } catch (e) {
      // On a lookup failure, keep the batch rather than silently dropping real holders.
      logger.warn(`Owner-type check failed for a batch — keeping it: ${e instanceof Error ? e.message : e}`);
      keep.push(...slice);
    }
  }
  return keep;
}

async function detectOwner(mint: PublicKey): Promise<PublicKey | null> {
  try {
    const info = await connection.getParsedAccountInfo(mint);
    return info.value ? info.value.owner : null;
  } catch {
    return null;
  }
}
