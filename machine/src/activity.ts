import {
  initStore,
  loadStateAsync,
  loadStateFile,
  saveStateAsync,
  saveStateFile,
  hasDatabase,
} from "./store";
import { logger } from "./logger";

export interface CycleEvent {
  ts: number;
  type: "info" | "claim" | "swap" | "dispense" | "marketing" | "error";
  message: string;
  txSignature?: string;
  stock?: string;
}

export interface StockRef { symbol: string; ticker: string; name: string }

export interface StockWinner {
  ts: number;
  cycle: number;
  owner: string;
  symbol: string;
  ticker: string;
  amountUi: number;   // shares of stock received
  solValue: number;   // approx SOL value of that slice (cycle solSpent × share)
  signature: string | null;
}

export interface StockDispense {
  ts: number;
  cycle: number;
  symbol: string;
  ticker: string;
  totalUi: number;        // total shares distributed this cycle
  solSpent: number;       // SOL spent buying the stock this cycle
  recipientCount: number;
  winners: Array<{ owner: string; amountUi: number; solValue: number; signature: string | null }>;
}

export interface PerStock {
  symbol: string;
  ticker: string;
  name: string;
  totalUi: number;   // lifetime shares distributed
  solSpent: number;  // lifetime SOL spent buying this stock
  cycles: number;    // times this stock paid out
  recipients: number;
  lastTs: number;
}

/** Lifetime per-wallet airdrop ledger — powers the "check your wallet" lookup. */
export interface RecipientHolding {
  symbol: string;
  ticker: string;
  shares: number;   // lifetime shares of this stock received
  sol: number;      // lifetime SOL value received in this stock
  count: number;    // number of airdrops of this stock
}
export interface Recipient {
  owner: string;
  totalSol: number;
  count: number;    // total airdrops received (all stocks)
  lastTs: number;
  byStock: Record<string, RecipientHolding>;
}

/** Live dispense payload — the dashboard polls this to animate the payout. */
export interface LiveDispense {
  startedAt: number;
  cycle: number;
  status: "buying" | "dispensing" | "done" | "failed";
  symbol: string;
  ticker: string;
  totalUi: number;
  solSpent: number;
  recipientCount: number;
  winners?: Array<{ owner: string; amountUi: number; solValue: number; signature: string | null }>;
  error?: string;
}

export interface DashboardState {
  status: "idle" | "running" | "claiming" | "buying" | "dispensing" | "error" | "stopped" | "watching";
  startedAt: number;
  lastCycleAt: number;
  nextCycleAt: number;
  cycleCount: number;

  treasuryWallet: string;
  marketingWallet: string;
  xstocksMint: string;
  totalSupplyUi: number;
  decimals: number;

  minHolderBalance: number;
  reservePercent: number;
  cycleSeconds: number;

  rotation: StockRef[];
  currentStock: StockRef | null;
  nextStock: StockRef | null;

  totals: {
    solClaimed: number;
    solSpentOnStock: number;  // SOL converted into stock and shipped to holders
    solOnCosts: number;       // SOL spent on ATA rent + network fees
    dispenseCount: number;    // cycles that paid out
    recipientsPaid: number;   // total holder-payments across all cycles
  };

  perStock: Record<string, PerStock>;
  recipients: Record<string, Recipient>;

  // Spendable SOL budget. Grows only from measured claim deltas; shrinks only
  // from measured spend (swap + costs). Decoupled from on-chain balance so the
  // dev's principal is provably never spent.
  claimPoolLamports: number;
  lastClaimLamports: number;
  lastClaimAt: number;
  lastTopupApplied?: string;
  poolResetVersion?: string;

  current: {
    treasurySol: number;
    holderCount: number;
    qualifiedCount: number;
  };

  topHolders: Array<{ owner: string; uiBalance: number; share: number; qualified: boolean }>;
  lastHolderSnapshotAt: number;

  maintenance: boolean;
  maintenanceReason: string;

  liveDispense?: LiveDispense;
  lastDispense?: StockDispense;

  recentWinners: StockWinner[];
  events: CycleEvent[];
  dispenses: StockDispense[];
}

const MAX_EVENTS = 500;
const MAX_DISPENSES = 300;
const MAX_WINNERS = 500;
const FLUSH_INTERVAL_MS = 2000;

function emptyState(): DashboardState {
  return {
    status: "idle",
    startedAt: Date.now(),
    lastCycleAt: 0,
    nextCycleAt: 0,
    cycleCount: 0,
    treasuryWallet: "",
    marketingWallet: "",
    xstocksMint: "",
    totalSupplyUi: 0,
    decimals: 6,
    minHolderBalance: 0,
    reservePercent: 0,
    cycleSeconds: 300,
    rotation: [],
    currentStock: null,
    nextStock: null,
    totals: {
      solClaimed: 0,
      solSpentOnStock: 0,
      solOnCosts: 0,
      dispenseCount: 0,
      recipientsPaid: 0,
    },
    perStock: {},
    recipients: {},
    claimPoolLamports: 0,
    lastClaimLamports: 0,
    lastClaimAt: 0,
    current: { treasurySol: 0, holderCount: 0, qualifiedCount: 0 },
    topHolders: [],
    lastHolderSnapshotAt: 0,
    maintenance: false,
    maintenanceReason: "",
    recentWinners: [],
    events: [],
    dispenses: [],
  };
}

function normalizeState(raw: unknown): DashboardState {
  const base = emptyState();
  if (!raw || typeof raw !== "object") return base;
  const parsed = raw as Partial<DashboardState>;
  return {
    ...base,
    ...parsed,
    totals: { ...base.totals, ...(parsed.totals || {}) },
    current: { ...base.current, ...(parsed.current || {}) },
    perStock: (parsed.perStock && typeof parsed.perStock === "object") ? parsed.perStock : {},
    recipients: (parsed.recipients && typeof parsed.recipients === "object") ? parsed.recipients : {},
    rotation: Array.isArray(parsed.rotation) ? parsed.rotation : [],
    recentWinners: Array.isArray(parsed.recentWinners) ? parsed.recentWinners : [],
    events: Array.isArray(parsed.events) ? parsed.events : [],
    dispenses: Array.isArray(parsed.dispenses) ? parsed.dispenses : [],
  };
}

class Tracker {
  private state: DashboardState;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    const f = loadStateFile();
    this.state = f ? normalizeState(f) : emptyState();
  }

  async init(): Promise<void> {
    await initStore();
    if (hasDatabase) {
      const db = await loadStateAsync();
      if (db) {
        this.state = normalizeState(db);
        logger.info("Restored dashboard state from Postgres — lifetime numbers preserved.");
      } else {
        await saveStateAsync(this.state);
      }
    }
    if (!this.flushTimer) {
      this.flushTimer = setInterval(() => {
        if (this.dirty) {
          this.dirty = false;
          saveStateAsync(this.state).then((ok) => { if (!ok) this.dirty = true; });
        }
      }, FLUSH_INTERVAL_MS);
      this.flushTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    this.dirty = false;
    saveStateFile(this.state);
    await saveStateAsync(this.state);
  }

  private persist() {
    saveStateFile(this.state);
    this.dirty = true;
  }

  private push(event: CycleEvent) {
    this.state.events.push(event);
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS);
    }
  }

  setIdentity(p: { treasuryWallet: string; marketingWallet: string; xstocksMint: string }) {
    Object.assign(this.state, p);
    this.persist();
  }

  setRules(p: { minHolderBalance: number; reservePercent: number; cycleSeconds?: number }) {
    this.state.minHolderBalance = p.minHolderBalance;
    this.state.reservePercent = p.reservePercent;
    if (typeof p.cycleSeconds === "number") this.state.cycleSeconds = p.cycleSeconds;
    this.persist();
  }

  setRotation(stocks: StockRef[]) {
    this.state.rotation = stocks;
    this.persist();
  }

  setCurrentStock(s: StockRef | null) { this.state.currentStock = s; this.persist(); }
  setNextStock(s: StockRef | null) { this.state.nextStock = s; this.persist(); }

  setSupply(uiAmount: number, decimals: number) {
    this.state.totalSupplyUi = uiAmount;
    this.state.decimals = decimals;
    this.persist();
  }

  resetIfWalletChanged(currentTreasury: string): boolean {
    const persisted = this.state.treasuryWallet;
    if (persisted && persisted !== currentTreasury) {
      this.state = emptyState();
      this.persist();
      return true;
    }
    return false;
  }

  forceReset() {
    this.state = emptyState();
    this.persist();
  }

  applyPoolTopup(envValue: string | undefined): { applied: boolean; lamports: number } {
    const v = (envValue || "").trim();
    if (!v || v === "0") {
      this.state.lastTopupApplied = v || "0";
      this.persist();
      return { applied: false, lamports: 0 };
    }
    if (this.state.lastTopupApplied === v) return { applied: false, lamports: 0 };
    const lamports = Math.max(0, Math.floor(Number(v)));
    if (!Number.isFinite(lamports) || lamports <= 0) return { applied: false, lamports: 0 };
    this.state.claimPoolLamports += lamports;
    this.state.lastTopupApplied = v;
    this.persist();
    return { applied: true, lamports };
  }

  setStatus(status: DashboardState["status"]) { this.state.status = status; this.persist(); }

  setMaintenance(maintenance: boolean, reason: string = "") {
    this.state.maintenance = maintenance;
    this.state.maintenanceReason = reason;
    this.persist();
  }

  setNextCycleAt(t: number) { this.state.nextCycleAt = t; this.persist(); }

  updateBalances(p: { treasurySol?: number }) {
    if (typeof p.treasurySol === "number") this.state.current.treasurySol = p.treasurySol;
    this.persist();
  }

  setHolders(
    rows: Array<{ owner: string; uiBalance: number }>,
    excluded: Set<string>,
    minQualify: number,
    maxTop = 100
  ) {
    const filtered = rows.filter((r) => !excluded.has(r.owner) && r.uiBalance > 0);
    const total = filtered.reduce((sum, r) => sum + r.uiBalance, 0) || 1;
    this.state.current.holderCount = filtered.length;
    this.state.current.qualifiedCount = filtered.filter((r) => r.uiBalance >= minQualify).length;
    this.state.topHolders = filtered.slice(0, maxTop).map((r) => ({
      owner: r.owner,
      uiBalance: r.uiBalance,
      share: r.uiBalance / total,
      qualified: r.uiBalance >= minQualify,
    }));
    this.state.lastHolderSnapshotAt = Date.now();
    this.persist();
  }

  cycleStart(stock: StockRef) {
    this.state.cycleCount++;
    this.state.lastCycleAt = Date.now();
    this.state.status = "claiming";
    this.state.currentStock = stock;
    this.push({ ts: Date.now(), type: "info", message: `Cycle #${this.state.cycleCount} — today's ticker is $${stock.ticker}`, stock: stock.symbol });
    this.persist();
  }

  recordClaim(solAmount: number, txSignature: string) {
    this.state.totals.solClaimed += solAmount;
    this.state.lastClaimLamports = Math.floor(solAmount * 1e9);
    this.state.lastClaimAt = Date.now();
    this.push({ ts: Date.now(), type: "claim", message: `Claimed ${solAmount.toFixed(6)} SOL of creator fees`, txSignature });
    this.persist();
  }

  creditClaimPool(lamports: number) { this.state.claimPoolLamports += lamports; this.persist(); }
  debitClaimPool(lamports: number) { this.state.claimPoolLamports = Math.max(0, this.state.claimPoolLamports - lamports); this.persist(); }
  getClaimPool(): number { return this.state.claimPoolLamports; }

  addMarketingKept(_solAmount: number) { /* held on treasury; counter omitted in v1 */ }

  resetClaimPoolOnce(version: string): boolean {
    if (this.state.poolResetVersion === version) return false;
    this.state.claimPoolLamports = 0;
    this.state.poolResetVersion = version;
    this.persist();
    return true;
  }

  recordSwap(p: { stock: StockRef; solSpent: number; receivedUi: number; txSignature: string }) {
    this.state.status = "buying";
    this.push({
      ts: Date.now(), type: "swap",
      message: `Bought ${p.receivedUi.toFixed(4)} $${p.stock.ticker} for ${p.solSpent.toFixed(5)} SOL`,
      txSignature: p.txSignature, stock: p.stock.symbol,
    });
    this.persist();
  }

  startDispenseAnimation(p: { stock: StockRef; recipientCount: number; totalUi: number; solSpent: number }) {
    this.state.status = "dispensing";
    this.state.liveDispense = {
      startedAt: Date.now(),
      cycle: this.state.cycleCount,
      status: "dispensing",
      symbol: p.stock.symbol,
      ticker: p.stock.ticker,
      totalUi: p.totalUi,
      solSpent: p.solSpent,
      recipientCount: p.recipientCount,
    };
    this.push({
      ts: Date.now(), type: "dispense",
      message: `Airdropping ${p.totalUi.toFixed(4)} $${p.stock.ticker} to ${p.recipientCount} holders`,
      stock: p.stock.symbol,
    });
    this.persist();
  }

  recordDispense(p: {
    stock: StockRef;
    solSpent: number;
    winners: Array<{ owner: string; amountUi: number; solValue: number; signature: string | null }>;
  }) {
    const paid = p.winners.filter((w) => w.signature && w.amountUi > 0);
    const totalUi = paid.reduce((s, w) => s + w.amountUi, 0);

    this.state.totals.solSpentOnStock += p.solSpent;
    this.state.totals.dispenseCount += 1;
    this.state.totals.recipientsPaid += paid.length;

    // per-stock lifetime rollup
    const key = p.stock.symbol;
    const ps = this.state.perStock[key] || {
      symbol: p.stock.symbol, ticker: p.stock.ticker, name: p.stock.name,
      totalUi: 0, solSpent: 0, cycles: 0, recipients: 0, lastTs: 0,
    };
    ps.totalUi += totalUi;
    ps.solSpent += p.solSpent;
    ps.cycles += 1;
    ps.recipients += paid.length;
    ps.lastTs = Date.now();
    this.state.perStock[key] = ps;

    const rec: StockDispense = {
      ts: Date.now(),
      cycle: this.state.cycleCount,
      symbol: p.stock.symbol,
      ticker: p.stock.ticker,
      totalUi,
      solSpent: p.solSpent,
      recipientCount: paid.length,
      winners: p.winners,
    };
    this.state.dispenses.push(rec);
    if (this.state.dispenses.length > MAX_DISPENSES) {
      this.state.dispenses = this.state.dispenses.slice(-MAX_DISPENSES);
    }
    this.state.lastDispense = rec;

    // Per-wallet lifetime ledger (powers the wallet lookup).
    for (const w of paid) {
      const r = this.state.recipients[w.owner] || { owner: w.owner, totalSol: 0, count: 0, lastTs: 0, byStock: {} };
      r.totalSol += w.solValue;
      r.count += 1;
      r.lastTs = Date.now();
      const bs = r.byStock[p.stock.symbol] || { symbol: p.stock.symbol, ticker: p.stock.ticker, shares: 0, sol: 0, count: 0 };
      bs.shares += w.amountUi;
      bs.sol += w.solValue;
      bs.count += 1;
      r.byStock[p.stock.symbol] = bs;
      this.state.recipients[w.owner] = r;
    }

    const ts = Date.now();
    const cycle = this.state.cycleCount;
    const newWinners: StockWinner[] = paid
      .slice()
      .sort((a, b) => b.amountUi - a.amountUi)
      .map((w) => ({ ts, cycle, owner: w.owner, symbol: p.stock.symbol, ticker: p.stock.ticker, amountUi: w.amountUi, solValue: w.solValue, signature: w.signature }));
    this.state.recentWinners.unshift(...newWinners);
    if (this.state.recentWinners.length > MAX_WINNERS) {
      this.state.recentWinners = this.state.recentWinners.slice(0, MAX_WINNERS);
    }

    if (this.state.liveDispense) {
      this.state.liveDispense.status = "done";
      this.state.liveDispense.winners = p.winners;
    }

    this.push({
      ts: Date.now(), type: "dispense",
      message: `Paid ${paid.length} holders ${totalUi.toFixed(4)} $${p.stock.ticker}`,
      stock: p.stock.symbol,
    });
    this.persist();
  }

  /** Record SOL actually consumed this cycle (swap + rent + fees) for the cost tally. */
  recordCosts(solOnCosts: number) {
    if (solOnCosts > 0) this.state.totals.solOnCosts += solOnCosts;
    this.persist();
  }

  markDispenseFailed(reason: string) {
    if (this.state.liveDispense) {
      this.state.liveDispense.status = "failed";
      this.state.liveDispense.error = reason;
    }
    this.push({ ts: Date.now(), type: "error", message: `Dispense failed: ${reason}` });
    this.persist();
  }

  recordInfo(message: string) { this.push({ ts: Date.now(), type: "info", message }); this.persist(); }

  recordError(message: string) {
    this.state.status = "error";
    this.push({ ts: Date.now(), type: "error", message });
    this.persist();
  }

  snapshot(): DashboardState { return this.state; }

  /**
   * Lifetime airdrop summary for any wallet — what they've received per stock,
   * total SOL value, their recent drops, and their current $XSTOCKS holding /
   * qualified status if they're in the top-holder snapshot.
   */
  getHolderSummary(address: string) {
    const addr = (address || "").trim();
    const r = this.state.recipients[addr];
    const holding = this.state.topHolders.find((h) => h.owner === addr) || null;
    const recent = this.state.recentWinners.filter((w) => w.owner === addr).slice(0, 25);
    return {
      address: addr,
      found: !!r || !!holding || recent.length > 0,
      totalSol: r?.totalSol || 0,
      count: r?.count || 0,
      lastTs: r?.lastTs || 0,
      byStock: r ? Object.values(r.byStock).sort((a, b) => b.sol - a.sol) : [],
      recent,
      holding: holding ? { uiBalance: holding.uiBalance, share: holding.share, qualified: holding.qualified } : null,
      minHolderBalance: this.state.minHolderBalance,
    };
  }
}

export const tracker = new Tracker();
