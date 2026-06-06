# 🚀 JOBCOIN — go-live playbook

Two things you do (they need a login or your wallet key). Everything else I do.

---

## ① Railway — deploy the machine  *(you do this)*

1. Go to **railway.app** → log in with your GitHub.
2. **New Project → Deploy from GitHub repo → `CONTINAD/JOBCOIN`**.
3. Open the service → **Settings**:
   - **Root Directory:** `machine`
   - (Build/start are already configured in `machine/railway.json` — nothing to type.)
4. **Variables** → add these two (paste the values yourself — never share them with me):
   | Name | Value |
   |---|---|
   | `SOLANA_RPC_URL` | your paid Helius / QuickNode / Triton URL |
   | `CREATOR_WALLET_PRIVATE_KEY` | base58 secret key of the **treasury** wallet |
5. *(Recommended)* **+ New → Database → Add PostgreSQL**, then add a variable
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` so stats survive redeploys.
6. **Settings → Networking → Generate Domain.**
   → Copy that URL (looks like `https://jobcoin-production-xxxx.up.railway.app`).
   **Send me that URL.**

> Leave `JOB_MINT=auto` (default) — it auto-detects your pump.fun token once $JOB launches.
> The McDonald's stock mint (MCDx) is already hardcoded.

---

## ② Porkbun — point jobcoin.tech  *(you do this)*

In Porkbun → `jobcoin.tech` → **DNS Records**, add:

| Type | Host | Answer / Value |
|---|---|---|
| A | (blank / `@`) | `185.199.108.153` |
| A | (blank / `@`) | `185.199.109.153` |
| A | (blank / `@`) | `185.199.110.153` |
| A | (blank / `@`) | `185.199.111.153` |
| CNAME | `www` | `continad.github.io` |
| CNAME | `machine` | *(the Railway domain from step ①, without `https://`)* |

- The four **A** records → the main site (`jobcoin.tech`) on GitHub Pages.
- `machine.jobcoin.tech` → the Railway machine (clean API URL).

Then **ping me: "DNS is set."**

---

## ③ What I do (once you send the Railway URL + "DNS is set")

- Add the `CNAME` file + enable the GitHub Pages custom domain → `https://jobcoin.tech` (HTTPS).
- Set `MACHINE_API = "https://machine.jobcoin.tech"` in `js/script.js` and push.
- Verify end-to-end: site loads on jobcoin.tech, Earnings + Recent Airdrops + the
  live "fees claimed / broke wallets" metrics pull real data from the machine.

---

## ④ Before real money — one test drop  *(strongly recommended)*

MCDx is a Token-2022 with some unusual extensions. Before holders rely on it, fund
the treasury with a tiny amount and run **one cycle** to confirm an MCDx airdrop
actually lands in a test wallet. Say the word and I'll set that up with you.
