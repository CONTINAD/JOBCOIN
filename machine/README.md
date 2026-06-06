# 🍟 JOBCOIN — the machine

The backend that actually pays $JOB holders in **real McDonald's stock (MCDx)**.

Same engine as the ATM / xStocks coins, set to a **single stock**: McDonald's.

Every `CYCLE_INTERVAL_SECONDS` (default **5 min**) it:

1. **Claims** pump.fun creator fees (SOL) on the treasury (dev) wallet.
2. **Buys MCDx** on Jupiter with the spendable share of the claim.
   (MCDx = `XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2`, the Backed/xStocks
   tokenized McDonald's share — Token-2022, 8 decimals.)
3. **Snapshots holders** and keeps every wallet holding **≥ 500,000 $JOB**.
4. **Airdrops the MCDx** to every qualified holder, **proportional to their bag**,
   straight into their wallet through fresh, single-use relay wallets. No claiming.

The dev's principal is never touched — the bot can only ever spend SOL it has
provably **claimed** (a decoupled `claimPoolLamports` ledger reconciled to the
real on-chain balance delta each cycle).

It also serves two JSON endpoints the public website reads:

- `GET /api/state` → recent airdrops, totals, qualified holder count
- `GET /api/holder/:address` → that wallet's lifetime MCDx earnings

(CORS is open on `/api/*` so the GitHub Pages site can call it.) A full live
dashboard is also served at `/`.

---

## Deploy on Railway (same as your other coins)

1. **New Project → Deploy from GitHub repo** → pick this repo.
2. **Settings → Root Directory: `machine`** (the app lives in this subfolder).
3. **Variables** — set exactly these two secrets:
   - `SOLANA_RPC_URL` — a paid Helius / QuickNode / Triton URL (free RPCs can't
     snapshot holders).
   - `CREATOR_WALLET_PRIVATE_KEY` — base58 secret key of the treasury (dev) wallet
     that owns the pump.fun $JOB token.
4. (Recommended) **Add a Postgres database** and set
   `DATABASE_URL=${{Postgres.DATABASE_URL}}` so lifetime numbers survive redeploys.
5. **Networking → Generate Domain** to expose it. That URL is your machine API.

`JOB_MINT=auto` (the default) watches the treasury and adopts the next pump.fun
token it launches. Once $JOB is live you can hardcode `JOB_MINT=<mint>`.

See [.env.example](.env.example) for every tunable.

### Run locally

```bash
cd machine
npm install
cp .env.example .env     # paste SOLANA_RPC_URL + CREATOR_WALLET_PRIVATE_KEY
npm run build && npm start
# dashboard + API at http://localhost:3000
```

---

## Connect it to the website

Once the machine has a public URL, open the site's `js/script.js` and set:

```js
const MACHINE_API = "https://your-machine.up.railway.app";
```

The site's **Recent Airdrops** and **Check Your Earnings** sections will then go
live automatically. Until it's set, those sections show a friendly
"goes live at launch" placeholder.

---

## ⚖️ Disclaimer

Memecoin. Entertainment only — not financial advice and not an offer of
securities. **Not affiliated with, endorsed by, or sponsored by McDonald's
Corporation.** MCDx is a third-party tokenized equity (issued by Backed /
xStocks). Payouts come from claimed creator fees, vary with volume and
liquidity, and can be zero. No payout, value, or outcome is guaranteed.
