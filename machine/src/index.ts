import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "./config";
import {
  loadTreasuryWallet,
  getSolBalance,
  getMintSupplyUi,
  connection,
  ata2022,
  whichAtasExist,
  discoverAtaRent,
  txLamportDelta,
} from "./wallet";
import { RewardsClaimer } from "./claim-rewards";
import { tracker } from "./activity";
import { startDashboard } from "./dashboard";
import { waitForCreatedMint } from "./mint-watcher";
import { snapshotHolders, type HolderEntry } from "./holders";
import {
  computeProportionalStockPayouts,
  dispenseStock,
  PAYOUT_BATCH_SIZE,
} from "./payout";
import { buyStock } from "./swap";
import { ROTATION, stockForCycle } from "./rotation";
import { logger } from "./logger";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Keep a hard SOL floor on the treasury at all times so a fee can always be
// paid. The claim-pool ledger already guarantees we only spend claimed SOL;
// this is a second, physical guard against ever zeroing the wallet.
const MIN_WALLET_KEEP_LAMPORTS = Math.floor(0.01 * LAMPORTS_PER_SOL);
// Rough network fee per batch tx, used only to pre-reserve SOL before the swap.
const TX_FEE_RESERVE_LAMPORTS = 15_000;

async function main() {
  logger.info("=== $JOBCOIN — claim SOL fees → buy McDonald's stock (MCDx) → airdrop it to every $JOB holder → repeat ===");

  startDashboard();
  logger.info(`Dashboard live on PORT=${config.port}`);

  await tracker.init();
  tracker.setRules({ minHolderBalance: config.minHolderBalance, reservePercent: config.reservePercent, cycleSeconds: config.cycleIntervalSeconds });
  tracker.setRotation(ROTATION.map((s) => ({ symbol: s.symbol, ticker: s.ticker, name: s.name })));

  if (!config.botReady) {
    const msg = config.configError || "Bot is not configured.";
    logger.error(`Payout loop NOT starting: ${msg}`);
    tracker.setStatus("error");
    tracker.recordError(msg);
    tracker.setMaintenance(true, msg);
    return;
  }
  tracker.setMaintenance(false);

  const treasury = loadTreasuryWallet();
  const marketingPubkey = config.marketingWallet ? new PublicKey(config.marketingWallet) : null;

  logger.info(`Treasury wallet:   ${treasury.publicKey.toBase58()}`);
  logger.info(`Payout routing:    treasury → fresh relay wallet (per batch) → holders`);
  logger.info(`Cycle:             every ${config.cycleIntervalSeconds}s · pays McDonald's stock (MCDx)`);
  logger.info(`Stock:             ${ROTATION.map((s) => `${s.ticker} (${s.symbol})`).join(", ")}`);
  logger.info(`Qualify:           hold ≥ ${config.minHolderBalance.toLocaleString()} $JOB`);
  logger.info(`Split:             buy with ${100 - config.reservePercent}% of claim · reserve ${config.reservePercent}% · proportional to holdings`);

  if (tracker.resetIfWalletChanged(treasury.publicKey.toBase58())) {
    logger.info("Treasury wallet differs from persisted state — wiped dashboard counters for a fresh start.");
    tracker.setRules({ minHolderBalance: config.minHolderBalance, reservePercent: config.reservePercent, cycleSeconds: config.cycleIntervalSeconds });
    tracker.setRotation(ROTATION.map((s) => ({ symbol: s.symbol, ticker: s.ticker, name: s.name })));
  }

  if (process.env.RESET_STATE === "1") {
    tracker.forceReset();
    logger.info("RESET_STATE=1 — wiped all persisted state. Unset this env var now or it will wipe on every boot.");
  }

  {
    const topup = tracker.applyPoolTopup(process.env.TOPUP_POOL_LAMPORTS);
    if (topup.applied) {
      logger.info(`TOPUP_POOL_LAMPORTS applied: +${topup.lamports} lamports (${(topup.lamports / 1e9).toFixed(4)} SOL) added to claim pool.`);
    }
  }

  if (tracker.resetClaimPoolOnce("v1-stock-pool")) {
    logger.info("Pool initialized: spendable pool zeroed once; future claims credit the holder share.");
  }

  let xstocksMintStr = config.xstocksMint;
  const cached = tracker.snapshot().xstocksMint;
  if (!xstocksMintStr && cached && cached.length > 32) {
    xstocksMintStr = cached;
    logger.info(`Resuming with previously detected $XSTOCKS: ${xstocksMintStr}`);
  }

  tracker.setIdentity({
    treasuryWallet: treasury.publicKey.toBase58(),
    marketingWallet: config.marketingWallet || "",
    xstocksMint: xstocksMintStr || "",
  });

  if (!xstocksMintStr) {
    tracker.setStatus("watching");
    tracker.recordInfo(`Watching ${treasury.publicKey.toBase58()} for the pump.fun $JOB launch…`);
    logger.info(`Auto-detect mode: polling for token creation every ${config.mintWatchPollSeconds}s`);
    xstocksMintStr = await waitForCreatedMint(
      connection,
      treasury.publicKey,
      config.mintWatchPollSeconds,
      (n) => { if (n === 1 || n % 5 === 0) tracker.recordInfo(`Still watching for token creation… (poll #${n})`); }
    );
    tracker.recordInfo(`Detected $JOB mint: ${xstocksMintStr} — the machine is online.`);
    tracker.setIdentity({
      treasuryWallet: treasury.publicKey.toBase58(),
      marketingWallet: config.marketingWallet || "",
      xstocksMint: xstocksMintStr,
    });
  }

  const xstocksMint = new PublicKey(xstocksMintStr);
  logger.info(`$XSTOCKS mint:     ${xstocksMint.toBase58()}`);

  const claimer = new RewardsClaimer(treasury);

  const excludes = new Set<string>([treasury.publicKey.toBase58()]);
  if (marketingPubkey) excludes.add(marketingPubkey.toBase58());

  const updateBalances = async () => {
    const treasurySol = await getSolBalance(treasury.publicKey);
    tracker.updateBalances({ treasurySol });
    return { treasurySol };
  };

  const refreshSupply = async () => {
    try {
      const s = await getMintSupplyUi(xstocksMint);
      tracker.setSupply(s.uiAmount, s.decimals);
    } catch { /* next cycle retries */ }
  };

  const snapshotAndStore = async (): Promise<HolderEntry[]> => {
    const rows = await snapshotHolders(xstocksMint.toBase58());
    tracker.setHolders(rows, excludes, config.minHolderBalance, 250);
    return rows;
  };

  await updateBalances();
  await refreshSupply();

  const runCycle = async () => {
    // The stock this cycle pays out (rotation advances by cycle number).
    const cycleNumber = tracker.snapshot().cycleCount + 1;
    const stock = stockForCycle(cycleNumber);
    const nextStock = stockForCycle(cycleNumber + 1);
    try {
      tracker.cycleStart({ symbol: stock.symbol, ticker: stock.ticker, name: stock.name });
      tracker.setNextStock({ symbol: nextStock.symbol, ticker: nextStock.ticker, name: nextStock.name });

      // ── 1. Claim creator fees (SOL) on the treasury wallet ───────────────
      // Safety: we credit the spendable pool ONLY by what the claim tx itself
      // transferred to the treasury (parsed from the tx's own pre/post lamport
      // balances), NOT by the wall-clock wallet delta. So any other tx that
      // happens to land in the same window — a dev sell, a manual transfer,
      // anything — cannot be misread as part of the claim, and the bot can
      // NEVER spend funds it didn't itself claim.
      const claimSig = await claimer.claim();
      if (claimSig) {
        const txDelta = await txLamportDelta(claimSig, treasury.publicKey);
        // Fallback: if the tx can't be fetched (RPC lag), credit 0 — better to
        // skip a cycle than to over-credit. Next cycle we'll catch up.
        const claimedLamports = Math.max(0, txDelta ?? 0);
        if (claimedLamports > 0) {
          tracker.recordClaim(claimedLamports / LAMPORTS_PER_SOL, claimSig);
          const marketingKeep = Math.floor((claimedLamports * Math.min(100, config.marketingPercent)) / 100);
          const toHolders = Math.max(0, claimedLamports - marketingKeep);
          tracker.creditClaimPool(toHolders);
          tracker.addMarketingKept(marketingKeep / LAMPORTS_PER_SOL);
          logger.info(
            `Claimed ${(claimedLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL — ` +
            `${(toHolders / LAMPORTS_PER_SOL).toFixed(6)} to pool ` +
            `(pool now ${(tracker.getClaimPool() / LAMPORTS_PER_SOL).toFixed(6)} SOL).`
          );
        } else {
          tracker.recordInfo("Claim tx submitted but no SOL delta detected.");
        }
      } else {
        tracker.recordInfo("No creator fees to claim this cycle.");
      }

      const { treasurySol: walletSol } = await updateBalances();

      // ── 2. Decide the spendable budget for this cycle ────────────────────
      const pool = tracker.getClaimPool();
      const poolSol = pool / LAMPORTS_PER_SOL;
      let dispensable = Math.floor((pool * (100 - config.reservePercent)) / 100);

      // Physical clamp: never plan to spend more SOL than the wallet holds,
      // minus the hard floor.
      const walletLamports = Math.floor(walletSol * LAMPORTS_PER_SOL);
      const walletSpendable = Math.max(0, walletLamports - MIN_WALLET_KEEP_LAMPORTS);
      if (walletSpendable < dispensable) {
        logger.info(`Dispense clamped to wallet balance: ${(walletSpendable / LAMPORTS_PER_SOL).toFixed(6)} SOL.`);
        dispensable = walletSpendable;
      }

      if (dispensable / LAMPORTS_PER_SOL < config.minDispenseSol) {
        tracker.recordInfo(`Spendable ${(dispensable / LAMPORTS_PER_SOL).toFixed(6)} SOL below min ${config.minDispenseSol} — carrying over (pool ${poolSol.toFixed(6)} SOL).`);
        return;
      }

      // ── 3. Snapshot holders, qualify, find brand-new ATAs ────────────────
      let holders: HolderEntry[] = [];
      try {
        holders = await snapshotAndStore();
      } catch (e) {
        tracker.recordError(`Holder snapshot failed: ${e instanceof Error ? e.message : e} — skipping, pool carries over.`);
        return;
      }

      const qualified = holders
        .filter((h) => !excludes.has(h.owner) && h.uiBalance >= config.minHolderBalance)
        .sort((a, b) => b.uiBalance - a.uiBalance)
        .slice(0, config.maxRecipientsPerCycle);

      if (qualified.length === 0) {
        tracker.recordInfo(`No wallets hold ≥ ${config.minHolderBalance.toLocaleString()} $JOB yet — pool carries over.`);
        return;
      }

      // How many of these holders need a fresh stock ATA this cycle (the only
      // real per-holder SOL cost). Only that many rents must be reserved.
      const stockMint = new PublicKey(stock.mint);
      const holderAtas = qualified.map((h) => ata2022(new PublicKey(h.owner), stockMint));
      const exist = await whichAtasExist(holderAtas);
      const newAtaCount = exist.filter((e) => !e).length;

      const batches = Math.ceil(qualified.length / PAYOUT_BATCH_SIZE);
      const reservedCostLamports =
        newAtaCount * Math.floor(config.ataRentEstimateSol * LAMPORTS_PER_SOL) +
        (batches + 1) * TX_FEE_RESERVE_LAMPORTS; // +1 covers the swap tx fee

      const swapLamports = dispensable - reservedCostLamports;
      if (swapLamports <= 0) {
        tracker.recordInfo(
          `Spendable ${(dispensable / LAMPORTS_PER_SOL).toFixed(5)} SOL all consumed by ATA rent ` +
          `(${newAtaCount} new accounts) — carrying over to build a bigger buy.`
        );
        return;
      }

      logger.info(
        `Cycle #${cycleNumber} $${stock.ticker}: pool ${poolSol.toFixed(5)} SOL · spend ${(dispensable / LAMPORTS_PER_SOL).toFixed(5)} ` +
        `(buy ${(swapLamports / LAMPORTS_PER_SOL).toFixed(5)}, reserve ${(reservedCostLamports / LAMPORTS_PER_SOL).toFixed(5)} for ${newAtaCount} new ATAs) · ${qualified.length} holders`
      );

      // ── 4. Buy the stock on Jupiter ──────────────────────────────────────
      const balBeforeSpend = Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
      const swap = await buyStock(treasury, stock, swapLamports);
      if (!swap || swap.receivedRaw <= 0n) {
        const spentNow = balBeforeSpend - Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
        if (spentNow > 0) tracker.debitClaimPool(spentNow); // account any tx fee burned
        tracker.recordError(`Could not buy $${stock.ticker} this cycle — pool carries over.`);
        return;
      }
      tracker.recordSwap({ stock, solSpent: swap.spentLamports / LAMPORTS_PER_SOL, receivedUi: swap.receivedUi, txSignature: swap.signature });

      // ── 5. Build the proportional plan over the stock we actually got ────
      const plan = computeProportionalStockPayouts(qualified, swap.receivedRaw, config.maxRecipientsPerCycle);
      if (plan.length === 0) {
        const spent = balBeforeSpend - Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
        if (spent > 0) tracker.debitClaimPool(spent);
        tracker.recordInfo("Bought stock but every slice rounded to 0 — stock rolls into next time this ticker comes up.");
        return;
      }

      const totalPlanRaw = plan.reduce((s, p) => s + p.amountRaw, 0n);
      const totalPlanUi = Number(totalPlanRaw) / 10 ** stock.decimals;

      // ── 6. Airdrop the stock to every qualified holder ───────────────────
      // Build the "new ATA" set (only these holders need rent paid this cycle)
      // and discover the exact ATA rent for this mint. Passed into dispenseStock
      // so each batch can fund its relay with EXACTLY the SOL it needs, then
      // sweep the relay back to 0 — no on-chain wallet survives the batch.
      const newAtaOwners = new Set<string>();
      qualified.forEach((h, i) => { if (!exist[i]) newAtaOwners.add(h.owner); });
      const ataRentLamports = await discoverAtaRent(stockMint);
      tracker.startDispenseAnimation({ stock, recipientCount: plan.length, totalUi: totalPlanUi, solSpent: swap.spentLamports / LAMPORTS_PER_SOL });
      try {
        const results = await dispenseStock(treasury, stock, plan, { ataRentLamports, newAtaOwners });
        const winners = results.map((r) => {
          const amountUi = Number(r.amountRaw) / 10 ** stock.decimals;
          const share = totalPlanRaw > 0n ? Number(r.amountRaw) / Number(totalPlanRaw) : 0;
          return {
            owner: r.owner,
            amountUi,
            solValue: (swap.spentLamports / LAMPORTS_PER_SOL) * share,
            signature: r.signature,
          };
        });
        tracker.recordDispense({ stock, solSpent: swap.spentLamports / LAMPORTS_PER_SOL, winners });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Dispense failed: ${msg}`);
        tracker.markDispenseFailed(msg);
      }

      // ── 7. Reconcile the ledger to REAL SOL spent (measured delta) ───────
      const balAfterSpend = Math.floor((await getSolBalance(treasury.publicKey)) * LAMPORTS_PER_SOL);
      const realSpent = Math.max(0, balBeforeSpend - balAfterSpend);
      tracker.debitClaimPool(realSpent);
      tracker.recordCosts(Math.max(0, (realSpent - swap.spentLamports)) / LAMPORTS_PER_SOL);

      await updateBalances();
      await refreshSupply();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error && e.stack ? `\n${e.stack}` : "";
      tracker.recordError(`Cycle error: ${msg}`);
      logger.error(`Cycle error: ${msg}${stack}`);
    } finally {
      tracker.setStatus("idle");
      tracker.setNextCycleAt(Date.now() + config.cycleIntervalSeconds * 1000);
    }
  };

  let stopping = false;
  const loop = async () => {
    while (!stopping) {
      await runCycle();
      if (stopping) break;
      await sleep(config.cycleIntervalSeconds * 1000);
    }
  };
  const startLoop = async () => {
    while (!stopping) {
      try {
        await loop();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Loop crashed: ${msg} — auto-restarting in 10s`);
        tracker.recordError(`Loop crashed: ${msg} — auto-restarting in 10s`);
        await sleep(10_000);
      }
    }
  };
  startLoop().catch((e) => logger.error(`startLoop crashed: ${e}`));

  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    tracker.setStatus("stopped");
    logger.info(`${sig} received — flushing state and shutting down...`);
    try { await tracker.flush(); } catch { /* best-effort */ }
    process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
}

process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  logger.error(`UNCAUGHT EXCEPTION: ${msg}`);
  try { tracker.recordError(`Uncaught: ${err instanceof Error ? err.message : err}`); } catch { /* nothing */ }
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  logger.error(`UNHANDLED REJECTION: ${msg}`);
  try { tracker.recordError(`Unhandled: ${reason instanceof Error ? reason.message : reason}`); } catch { /* nothing */ }
});

main().catch((e) => {
  const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  logger.error(`Fatal in main(): ${msg}`);
  try { tracker.recordError(`Fatal: ${e instanceof Error ? e.message : e}`); } catch { /* nothing */ }
});
