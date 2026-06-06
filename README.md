# 🍟 JOBCOIN ($JOB)

**You got cooked. Time to get a job.**

The leading network of *tokenized employment* on Solana — an xStocks parody that "delivers
McDonald's stock straight to your wallet" because the charts won't. A meme-coin landing page
in McDonald's red & yellow, built as a single static site (no build step, no dependencies).

---

## 📂 Project structure

```
JOBCOIN/
├── index.html                # the whole landing page
├── css/styles.css            # McDonald's theme, layout, animations, responsive
├── js/script.js              # interactions (copy CA, reveals, counters, confetti)
├── assets/img/
│   ├── hero-wojak.png        # the main artwork (your image) — used in the hero
│   └── logo.png              # same image, used as the round logo / favicon / OG image
├── README.md
└── .claude/                  # local dev preview helper (safe to ignore / delete)
```

> The original upload (`ChatGPT_Image_*.png`) is kept at the root as a backup. It is not used
> by the site — `assets/img/hero-wojak.png` is.

---

## ✏️ Customize it (the only file you need to touch)

Open **`js/script.js`** and edit the `CONFIG` block at the very top:

```js
const CONTRACT_ADDRESS = "";   // paste your token's contract address here
const LINKS = {
  twitter:     "",             // https://x.com/yourhandle
  telegram:    "",             // https://t.me/yourgroup
  dexscreener: "",             // https://dexscreener.com/solana/...
  raydium:     "",             // https://raydium.io/swap/?...
};
```

- **Empty values** are safe: the contract pill shows `COMING SOON` and the social/buy buttons
  show a friendly "drops at launch" toast instead of going nowhere.
- **Fill them in** and the COPY button copies your real address, and every link opens correctly
  in a new tab. No other edits needed.

**Swap the art:** drop a new square image in `assets/img/` and replace both `hero-wojak.png`
and `logo.png` (or update the `src` paths in `index.html`). Square images look best.

**Tweak the colors:** they're CSS variables at the top of `css/styles.css`
(`--red`, `--yellow`, `--black`, …) — official McDonald's brand values.

---

## ▶️ Run locally

It's plain HTML/CSS/JS — just open `index.html` in a browser. For a proper local server
(so fonts/paths resolve exactly like production):

```bash
# Node (already on this machine)
node .claude/static-server.mjs      # → http://localhost:5510

# or, if you have Python
python -m http.server 5510
```

---

## 🚀 Deploy (pick one)

**GitHub Pages** — same as your other coins (ATM, etc.):
1. Create a new repo and push these files (`index.html` must be at the repo root).
2. Repo → **Settings → Pages → Source: Deploy from a branch → `main` / `root`**.
3. Your site goes live at `https://<username>.github.io/<repo>/`.

**Drag-and-drop** (fastest): zip the folder and drop it on
[netlify.com/drop](https://app.netlify.com/drop) or import the repo on
[vercel.com](https://vercel.com). No settings required — it's a static site.

---

## 🧩 What's on the page

- Scrolling **stock ticker** (your bags ▼ REKT, $JOB ▲ NOW HIRING)
- Hero with the artwork, a **NOW HIRING** badge, and a copy-able contract pill
- Animated **metrics** banner ("billions cooked")
- **The Menu** — xStocks parody cards (MCDx, FRYx, MCFLURRYx, NUGGETx…)
- **Honest comparison** table: your trading account vs. a job at McDonald's
- **Tokenomics** ("the value menu") with animated allocation bars
- **Career Path** roadmap: Crew Member → Shift Manager → Franchise Owner → CEO
- **How to Buy** in 4 steps, FAQ, community links, footer
- Easter egg: type **`job`** anywhere on the page 🍟

---

## ⚖️ Disclaimer

$JOBCOIN is a community meme coin made for entertainment. It is **not affiliated with,
endorsed by, or sponsored by McDonald's Corporation**. All trademarks belong to their
respective owners and are used for parody/commentary. Nothing here is financial advice;
$JOB has no intrinsic value. You will not receive McDonald's stock or a Happy Meal.

*Made with 🍟 and regret on Solana.*
