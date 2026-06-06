import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  ParsedInstruction,
} from "@solana/web3.js";
import { logger } from "./logger";

export const PUMP_FUN_PROGRAM = new PublicKey(
  "6EF8rrechWkTBHkXZcjRPjm4ZYhLaQpgmhCwyLSThKpY"
);
export const PUMP_FUN_PROGRAM_ALT = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const PUMP_PROGRAM_IDS = new Set([
  PUMP_FUN_PROGRAM.toBase58(),
  PUMP_FUN_PROGRAM_ALT.toBase58(),
]);

/**
 * Find the most recent pump.fun mint this wallet *created* (fee payer + mint
 * initialized in same tx). Avoids false positives where the wallet merely
 * bought a pump.fun token.
 */
export async function findCreatedMint(
  connection: Connection,
  wallet: PublicKey,
  limit = 100
): Promise<string | null> {
  let sigs: { signature: string; err: unknown }[] = [];
  try {
    sigs = await connection.getSignaturesForAddress(wallet, { limit });
  } catch (e) {
    logger.warn(`getSignaturesForAddress failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  for (const sigInfo of sigs) {
    if (sigInfo.err) continue;
    let tx: ParsedTransactionWithMeta | null = null;
    try {
      tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      continue;
    }
    if (!tx) continue;

    const mint = extractCreatedMint(tx, wallet);
    if (mint) return mint;
  }
  return null;
}

function extractCreatedMint(
  tx: ParsedTransactionWithMeta,
  wallet: PublicKey
): string | null {
  const feePayer = tx.transaction.message.accountKeys[0]?.pubkey?.toBase58();
  if (feePayer !== wallet.toBase58()) return null;

  const outer = tx.transaction.message.instructions || [];
  const inner = (tx.meta?.innerInstructions || []).flatMap((i) => i.instructions);
  const allIxs: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
    ...outer,
    ...inner,
  ];

  const touchedPumpFun = allIxs.some((ix) =>
    PUMP_PROGRAM_IDS.has(ix.programId.toBase58())
  );
  if (!touchedPumpFun) return null;

  for (const ix of allIxs) {
    if (!("parsed" in ix) || !ix.parsed) continue;
    const parsed = ix.parsed as { type?: string; info?: { mint?: string } };
    if (
      (parsed.type === "initializeMint" || parsed.type === "initializeMint2") &&
      parsed.info?.mint &&
      parsed.info.mint.endsWith("pump")
    ) {
      return parsed.info.mint;
    }
  }
  return null;
}

export async function waitForCreatedMint(
  connection: Connection,
  wallet: PublicKey,
  pollSeconds: number,
  onPoll?: (attempt: number) => void
): Promise<string> {
  let attempt = 0;
  while (true) {
    attempt++;
    onPoll?.(attempt);
    const found = await findCreatedMint(connection, wallet);
    if (found) return found;
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
}
