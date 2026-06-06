import dotenv from "dotenv";
dotenv.config();

const isAuto = (v: string | undefined) =>
  !v || v.trim() === "" || v.trim().toLowerCase() === "auto";

// CREATOR_WALLET_PRIVATE_KEY is INTENTIONALLY non-fatal at boot. If it's
// missing or still the placeholder, the payout loop just won't start — but the
// dashboard still boots so the operator can see what to fix.
const rawCreatorKey = process.env.CREATOR_WALLET_PRIVATE_KEY?.trim() || "";
const placeholderDetected = rawCreatorKey.includes("PASTE_");
const creatorKey = placeholderDetected ? "" : rawCreatorKey;

let configError: string | null = null;
if (!creatorKey) {
  configError = placeholderDetected
    ? "CREATOR_WALLET_PRIVATE_KEY is still the .env placeholder — paste your dev wallet's base58 private key in Railway → Variables."
    : "CREATOR_WALLET_PRIVATE_KEY is not set — paste your dev wallet's base58 private key in Railway → Variables.";
}

// The $JOB token mint (the coin holders must hold to qualify). JOB_MINT is the
// canonical name; XSTOCKS_MINT is still read as a fallback for older configs.
const mintRaw = (process.env.JOB_MINT ?? process.env.XSTOCKS_MINT)?.trim();

const rawRpc = process.env.SOLANA_RPC_URL?.trim() || "";
const rpcPlaceholder = rawRpc.includes("PASTE_");
const rpcUrl = rpcPlaceholder || !rawRpc ? "https://api.mainnet-beta.solana.com" : rawRpc;
if ((!rawRpc || rpcPlaceholder) && !configError) {
  configError = rpcPlaceholder
    ? "SOLANA_RPC_URL is still the placeholder — paste your Helius/QuickNode URL in Railway → Variables."
    : "SOLANA_RPC_URL not set — using public RPC (rate-limited). Paste a Helius/QuickNode URL in Railway → Variables.";
}

export const config = {
  rpcUrl,

  // ── Wallets ──────────────────────────────────────────────────────────
  // The ONLY key the operator provides. The treasury (dev/creator) wallet owns
  // the pump.fun $JOB mint, claims creator fees (SOL), buys McDonald's stock
  // (MCDx) on Jupiter, and funds the airdrop. Every relay wallet is freshly
  // generated at runtime — no other key is ever stored.
  creatorPrivateKey: creatorKey,

  botReady: !!creatorKey,
  configError,

  // Optional: keep a slice of each SOL claim back on the treasury for marketing
  // (held, never auto-sent — withdraw manually). 0 = 100% goes to buying stock.
  marketingWallet: process.env.MARKETING_WALLET?.trim() || "",
  marketingPercent: Number(process.env.MARKETING_PERCENT || "0"),

  // The project's own pump.fun token ($JOB). auto = watch the treasury and
  // adopt the next pump.fun token it launches.
  xstocksMint: isAuto(mintRaw) ? "" : mintRaw!,
  autoDetectMint: isAuto(mintRaw),
  mintWatchPollSeconds: Number(process.env.MINT_WATCH_POLL_SECONDS || "20"),

  pumpPortalApiKey: process.env.PUMPPORTAL_API_KEY || "",

  // ── Jupiter (the SOL → stock swap) ───────────────────────────────────
  jupiterBaseUrl: (process.env.JUPITER_BASE_URL?.trim() || "https://lite-api.jup.ag").replace(/\/$/, ""),
  // Slippage tolerance for the swap, in basis points. xStock pools are thinner
  // than majors, so a touch more headroom than a bluechip swap. 150 = 1.5%.
  swapSlippageBps: Math.max(10, Number(process.env.SWAP_SLIPPAGE_BPS || "150")),

  // ── The mechanic ──────────────────────────────────────────────────────
  // Every CYCLE_INTERVAL_SECONDS: claim SOL fees → buy McDonald's stock (MCDx)
  // on Jupiter → airdrop it to EVERY wallet holding ≥ MIN_HOLDER_BALANCE $JOB,
  // proportional to how much they hold. RESERVE_PERCENT of every claim is kept
  // back as a SOL buffer so the machine never runs out of gas/rent.
  cycleIntervalSeconds: Number(process.env.CYCLE_INTERVAL_SECONDS || "300"), // 300 = 5 min

  // Qualification threshold — only wallets holding at least this many $JOB (UI
  // amount) get paid. Pay EVERY wallet that clears this bar, every cycle.
  minHolderBalance: Number(process.env.MIN_HOLDER_BALANCE || "500000"),

  // Keep this % of every SOL claim back as reserve; spend the remainder on the
  // stock buy + airdrop costs.
  reservePercent: Math.max(0, Math.min(100, Number(process.env.RESERVE_PERCENT || "10"))),

  // Skip a cycle (carry the SOL pool over) if the spendable pool is below this.
  // Sized so a cycle only fires when there's enough to buy meaningful stock AND
  // cover the ATA rent for the holder set.
  minDispenseSol: Number(process.env.MIN_DISPENSE_SOL || "0.02"),

  // Hard cap on recipients paid in a single cycle (bounds tx count + rent). If
  // more holders qualify, the largest holders are paid first.
  maxRecipientsPerCycle: Math.max(1, Number(process.env.MAX_RECIPIENTS_PER_CYCLE || "600")),

  // Holders paid per ephemeral relay wallet (and per tx). Lower than the SOL
  // version because each holder transfer also carries an idempotent Token-2022
  // ATA creation, which is account-heavy. 6 keeps the tx comfortably under the
  // 1232-byte limit even when every ATA in the batch is brand new.
  payoutBatchSize: Math.min(10, Math.max(1, Number(process.env.PAYOUT_BATCH_SIZE || "6"))),

  priorityFee: Number(process.env.PRIORITY_FEE || "0.0005"),

  // Rough Token-2022 ATA rent used for budgeting how much SOL to keep aside for
  // account creation before the swap. The REAL rent is measured on-chain at
  // creation time; this is only the pre-swap reserve estimate. ImmutableOwner
  // ATA ≈ 0.00204 SOL; xStock ATAs run a hair larger, so we budget 0.0023.
  ataRentEstimateSol: Number(process.env.ATA_RENT_ESTIMATE_SOL || "0.0023"),

  port: Number(process.env.PORT || "3000"),
  logLevel: process.env.LOG_LEVEL || "info",
} as const;
