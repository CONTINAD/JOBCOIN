import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "./config";

export const connection = new Connection(config.rpcUrl, "confirmed");

function decodeKey(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error("Wallet private key is empty — set CREATOR_WALLET_PRIVATE_KEY in Railway → Variables.");
  }
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

/**
 * The treasury (dev/creator) wallet — the only key the operator provides. Owns
 * the pump.fun $XSTOCKS mint, claims creator fees, buys the rotating xStock on
 * Jupiter, and funds the airdrop (routed through freshly generated relay
 * wallets created at runtime).
 */
export function loadTreasuryWallet(): Keypair {
  return decodeKey(config.creatorPrivateKey);
}

export async function getSolBalance(pk: PublicKey): Promise<number> {
  return (await connection.getBalance(pk)) / LAMPORTS_PER_SOL;
}

export async function getMintSupplyUi(mint: PublicKey): Promise<{
  uiAmount: number;
  decimals: number;
}> {
  try {
    const s = await connection.getTokenSupply(mint);
    return {
      uiAmount: s.value.uiAmount ?? 0,
      decimals: s.value.decimals,
    };
  } catch {
    return { uiAmount: 0, decimals: 6 };
  }
}

/** The Token-2022 associated token account for (owner, mint). */
export function ata2022(owner: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
}

/**
 * Raw (base-unit) balance of a Token-2022 account. Returns 0 if the account
 * doesn't exist. Used to measure exactly how much stock the swap delivered.
 */
export async function getRawTokenBalance(tokenAccount: PublicKey): Promise<bigint> {
  try {
    const r = await connection.getTokenAccountBalance(tokenAccount);
    return BigInt(r.value.amount);
  } catch {
    return 0n;
  }
}

/**
 * Resolve the exact rent-exempt minimum for an ATA of this mint. Token-2022
 * ATA sizes vary with the mint's required account-level extensions, so we look
 * up a sample on-chain holder account once per mint and compute rent from its
 * actual size — guarantees the relay funds the create instructions correctly
 * (no over/under-pay, so the relay can be swept to exactly zero each batch).
 */
const _ataRentCache = new Map<string, number>();
export async function discoverAtaRent(mint: PublicKey): Promise<number> {
  const key = mint.toBase58();
  const cached = _ataRentCache.get(key);
  if (cached) return cached;
  try {
    const r = await connection.getTokenLargestAccounts(mint);
    const sample = r.value[0]?.address;
    if (sample) {
      const info = await connection.getAccountInfo(sample);
      if (info?.data && info.data.length > 0) {
        const rent = await connection.getMinimumBalanceForRentExemption(info.data.length);
        _ataRentCache.set(key, rent);
        return rent;
      }
    }
  } catch { /* fall through to fallback */ }
  // Fallback: Token-2022 ATA with ImmutableOwner = 170 bytes.
  const fallback = await connection.getMinimumBalanceForRentExemption(170);
  _ataRentCache.set(key, fallback);
  return fallback;
}

/**
 * Which of these holder ATAs already exist on-chain. Lets the cycle budget the
 * REAL rent cost (only brand-new accounts cost rent) before deciding how much
 * SOL to spend on the stock buy.
 */
export async function whichAtasExist(atas: PublicKey[]): Promise<boolean[]> {
  const exists: boolean[] = new Array(atas.length).fill(false);
  const BATCH = 100;
  for (let i = 0; i < atas.length; i += BATCH) {
    const slice = atas.slice(i, i + BATCH);
    try {
      const infos = await connection.getMultipleAccountsInfo(slice);
      infos.forEach((info, idx) => { exists[i + idx] = !!info; });
    } catch {
      // On lookup failure, assume they DON'T exist (budget rent for them) — the
      // idempotent create is a no-op if they actually do, so we only ever
      // over-reserve, never under-reserve.
    }
  }
  return exists;
}
