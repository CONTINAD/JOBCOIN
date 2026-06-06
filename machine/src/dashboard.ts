import express, { Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { config } from "./config";
import { tracker } from "./activity";
import { logger } from "./logger";

export function startDashboard() {
  const app = express();

  // Resolve public/ relative to this file (dist/ at runtime → ../public), with a
  // cwd fallback. Works whether started from the repo root or the machine dir.
  const candidates = [
    path.join(__dirname, "..", "public"),
    path.join(process.cwd(), "public"),
  ];
  const publicDir = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  app.use(express.static(publicDir));

  // Allow the public website (different origin, e.g. GitHub Pages) to read the
  // /api endpoints so it can show "recent airdrops" and "check your earnings".
  app.use("/api", (_req: Request, res: Response, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Cache-Control", "no-store");
    next();
  });

  app.get("/api/state", (_req: Request, res: Response) => {
    // Polling endpoint — trim to what the dashboard actually renders. Full
    // recipients map is queried via /api/holder/:addr; historical winners arrays
    // and dispense rows aren't shown anywhere in the UI. Without this, the
    // payload grows to multiple MB over a day's cycles → slow polls.
    const s = tracker.snapshot();
    const slim: Record<string, unknown> = {
      ...s,
      // Count of unique wallets that have ever received an MCDx airdrop (the
      // "broke wallets paid" stat). Cheap to compute from the recipients map.
      uniqueRecipients: Object.keys(s.recipients || {}).length,
      recentWinners: (s.recentWinners || []).slice(0, 40),
      dispenses: (s.dispenses || []).slice(-10).map((d) => ({
        ts: d.ts, cycle: d.cycle, symbol: d.symbol, ticker: d.ticker,
        totalUi: d.totalUi, solSpent: d.solSpent, recipientCount: d.recipientCount,
      })),
      events: (s.events || []).slice(-60),
    };
    delete slim.recipients;
    res.json(slim);
  });

  // Lifetime airdrop lookup for any wallet (the "check your bag" feature).
  app.get("/api/holder/:address", (req: Request, res: Response) => {
    const addr = String(req.params.address || "").trim();
    if (addr.length < 32 || addr.length > 44) {
      res.status(400).json({ error: "Not a valid Solana address." });
      return;
    }
    res.json(tracker.getHolderSummary(addr));
  });

  // The bot's own live dashboard lives at /dashboard — the website's index.html
  // (copied into public/) is what serves at /.
  app.get("/dashboard", (_req: Request, res: Response) => {
    res.set("Content-Type", "text/html; charset=utf-8").send(renderHTML());
  });

  app.listen(config.port, "0.0.0.0", () => {
    logger.info(`Dashboard listening on 0.0.0.0:${config.port}`);
  });
}

export function renderHTML(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>JOBCOIN ($JOB) — get paid in McDonald's stock</title>
<meta name="description" content="You got cooked. Now get a job. Hold $JOB and the machine claims fees, buys real McDonald's stock (MCDx) on Jupiter, and airdrops it straight to every holder — automatically, every cycle. Hold 500k+ to qualify." />
<meta property="og:title" content="JOBCOIN ($JOB) — get paid in McDonald's stock" />
<meta property="og:description" content="Hold $JOB. Every cycle the machine buys real McDonald's stock (MCDx) and airdrops it to every holder, proportional to your bag. 🍟" />
<meta property="og:image" content="/logo.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#DA291C" />
<link rel="icon" type="image/png" href="/logo.png" />
<link rel="apple-touch-icon" href="/logo.png" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@500;700;900&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  :root{
    --red:#DA291C; --red-deep:#B0160B; --red-dark:#7e0f06;
    --yellow:#FFC72C; --yellow-deep:#F2A900;
    --ink:#1c1a16; --cream:#FFF8E7; --cream-2:#FFF1CF; --white:#fff;
    --txt:#1c1a16; --dim:rgba(28,26,22,.66); --faint:rgba(28,26,22,.42); --hair:rgba(28,26,22,.10);
    --line:#1c1a16; --line2:#1c1a16;
    --glass:#ffffff; --glass2:#FFF1CF;
    --up:#0e8a4f; --down:#c01b0c;
    --shadow:6px 6px 0 var(--ink);
    --shadow-sm:4px 4px 0 var(--ink);
    --fdisp:'Anton','Archivo',system-ui,sans-serif;
    --fhead:'Archivo',system-ui,sans-serif;
    --fbody:'Inter',system-ui,sans-serif;
    --fmono:'JetBrains Mono',monospace;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{
    font-family:var(--fbody);color:var(--txt);min-height:100vh;overflow-x:hidden;
    background:
      radial-gradient(1100px 560px at 84% -12%, rgba(255,199,44,.40), transparent 60%),
      var(--cream);
    background-attachment:fixed;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;letter-spacing:-0.008em;
  }
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.5;
    background-image:radial-gradient(rgba(28,26,22,.07) 2px, transparent 2px);background-size:34px 34px;
    mask-image:radial-gradient(ellipse 120% 90% at 50% -10%, #000 30%, transparent 80%);}
  body::after{display:none}
  #chartCanvas{display:none}
  .aurora{position:fixed;border-radius:50%;filter:blur(90px);pointer-events:none;z-index:0;opacity:.20}
  .aurora.a1{width:46vw;height:46vw;top:-16vw;left:-10vw;background:var(--yellow);opacity:.18;animation:drift1 26s ease-in-out infinite}
  .aurora.a2{width:40vw;height:40vw;top:4vw;right:-14vw;background:var(--red);opacity:.14;animation:drift2 32s ease-in-out infinite}
  .aurora.a3{width:34vw;height:34vw;bottom:-12vw;left:18vw;background:var(--yellow);opacity:.10;animation:drift1 40s ease-in-out infinite}
  @keyframes drift1{0%,100%{transform:translate(0,0)}50%{transform:translate(5vw,4vw)}}
  @keyframes drift2{0%,100%{transform:translate(0,0)}50%{transform:translate(-5vw,5vw)}}
  .vignette{display:none}
  a{color:var(--red)}
  .mono{font-family:var(--fmono)}
  ::selection{background:var(--yellow);color:var(--ink)}
  *:focus-visible{outline:3px solid var(--ink);outline-offset:2px;border-radius:6px}

  .glass{background:var(--white);border:3px solid var(--ink);box-shadow:var(--shadow)}

  /* logo tile */
  .lgw{position:relative;display:flex;align-items:center;justify-content:center;border-radius:12px;flex:none;overflow:hidden;
    background:var(--cream-2);border:2px solid var(--ink);transition:.18s}
  .lgw img{position:relative;z-index:1;width:78%;height:78%;object-fit:contain}
  .lgw:hover{transform:translateY(-2px)}

  /* ── ticker tape ──────────────────────────────────────── */
  .tape{position:relative;z-index:4;overflow:hidden;background:var(--ink);border-bottom:3px solid var(--yellow)}
  .tape .track{display:flex;width:max-content;padding:8px 0;animation:scroll 44s linear infinite;white-space:nowrap}
  .tape .it{display:inline-flex;gap:9px;align-items:center;padding:0 22px;font-family:var(--fhead);font-weight:700;
    font-size:12.5px;color:rgba(255,248,231,.62);border-right:1px solid rgba(255,199,44,.2);text-transform:uppercase}
  .tape .it .ic{width:18px;height:18px;display:flex;align-items:center;justify-content:center}
  .tape .it .ic img{width:16px;height:16px;object-fit:contain;border-radius:4px}
  .tape .it b{color:var(--yellow);font-weight:900}
  .tape .it .px{color:#fff;font-weight:700}
  .tape .it .up{color:#7DF3B0} .tape .it .dn{color:#FF8A7E}
  .tape .it .sh{color:var(--yellow);opacity:.85}
  .tape .it .sep{color:rgba(255,255,255,.3);margin:0 4px}
  .tape:hover .track{animation-play-state:paused}
  @keyframes scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}

  /* ── header ──────────────────────────────────────────── */
  .topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;justify-content:space-between;
    gap:16px;padding:11px 26px;border-bottom:3px solid var(--yellow);background:var(--red);
    box-shadow:0 6px 18px rgba(0,0,0,.15)}
  .brand{display:flex;align-items:center;gap:12px}
  .brand .xm{width:44px;height:44px;border-radius:50%;overflow:hidden;border:3px solid var(--yellow);
    box-shadow:0 0 0 2px var(--red-dark);flex:none}
  .brand .xm img{width:100%;height:100%;object-fit:cover;display:block}
  .brand .nm{font-family:var(--fdisp);font-size:26px;letter-spacing:.02em;color:#fff;line-height:1;text-shadow:2px 2px 0 var(--red-dark)}
  .nav{display:flex;gap:6px;align-items:center}
  .nav a{font-family:var(--fhead);font-size:13px;font-weight:700;text-decoration:none;color:#fff;
    padding:9px 13px;border-radius:10px;transition:.15s}
  .nav a:hover{background:rgba(255,255,255,.16)}
  .xbtn{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;
    text-decoration:none;color:var(--ink);font-size:15px;border:2px solid var(--ink);background:var(--yellow);transition:.15s}
  .xbtn:hover{transform:translateY(-1px);box-shadow:2px 2px 0 var(--ink)}
  .live{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border:2px solid var(--ink);
    background:#fff;font-family:var(--fhead);font-size:11px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--ink)}
  .live .dot{width:8px;height:8px;border-radius:50%;background:var(--up);box-shadow:0 0 8px var(--up);animation:pulse 1.5s ease-in-out infinite}
  .live .dot.amber{background:var(--yellow-deep);box-shadow:0 0 8px var(--yellow-deep)} .live .dot.red{background:var(--down);box-shadow:0 0 8px var(--down)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:999px;cursor:pointer;text-decoration:none;
    font-family:var(--fhead);font-weight:900;font-size:13.5px;text-transform:uppercase;letter-spacing:.02em;transition:.15s;
    border:3px solid var(--ink);white-space:nowrap}
  .btn.white{background:var(--yellow);color:var(--ink);box-shadow:var(--shadow-sm)}
  .btn.white:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink)}
  .btn.white:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--ink)}
  .btn.ghost{background:#fff;color:var(--ink);box-shadow:var(--shadow-sm)}
  .btn.ghost:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink);background:var(--cream-2)}
  .btn:active{transform:scale(.98)}
  .nav .btn.white{padding:9px 16px;font-size:12.5px;box-shadow:3px 3px 0 var(--red-dark)}
  @media(max-width:720px){.nav .hideSm{display:none}}

  .maint{display:none;margin:0;padding:12px 26px;background:var(--ink);border-bottom:3px solid var(--yellow);
    color:var(--yellow);font-family:var(--fhead);font-weight:700;font-size:13px;position:relative;z-index:9}
  .maint.show{display:block}

  .wrap{max-width:1320px;margin:0 auto;padding:40px 24px 110px;position:relative;z-index:2}

  /* ── hero ────────────────────────────────────────────── */
  .hero{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;margin-bottom:14px}
  @media(max-width:980px){.hero{grid-template-columns:1fr;gap:18px}}
  .kick{display:inline-flex;align-items:center;gap:10px;padding:7px 15px;border-radius:999px;
    background:var(--yellow);border:2px solid var(--ink);font-family:var(--fhead);font-size:11.5px;font-weight:900;
    letter-spacing:.04em;text-transform:uppercase;color:var(--ink);margin-bottom:20px;box-shadow:3px 3px 0 var(--ink)}
  .kick .dot{width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 8px var(--up);animation:pulse 1.3s infinite}
  .kick b{color:var(--red);font-weight:900}
  h1.title{font-family:var(--fdisp);font-weight:400;font-size:clamp(48px,7vw,92px);line-height:.92;margin:0;
    letter-spacing:.005em;text-transform:uppercase;color:var(--ink)}
  h1.title .muted{color:var(--red)}
  .lede{margin:22px 0 0;max-width:540px;font-size:16.5px;line-height:1.6;color:var(--dim);font-weight:450}
  .lede b{color:var(--ink);font-weight:700}
  .hero-cta{margin-top:28px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .hero-cta .btn{padding:14px 22px;font-size:14.5px}
  .ca{display:inline-flex;align-items:center;gap:10px;padding:12px 15px;border-radius:12px;cursor:pointer;
    background:#fff;border:2px dashed var(--ink);font-family:var(--fmono);font-size:12.5px;color:var(--ink);transition:.15s}
  .ca:hover{background:var(--cream-2)} .ca.copied{background:var(--yellow);border-style:solid}
  .ca .lab{font-family:var(--fhead);font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--red);font-weight:900}

  /* ── orbit ───────────────────────────────────────────── */
  .orbit-stage{position:relative;width:min(100%,460px);aspect-ratio:1;margin:0 auto;display:flex;align-items:center;justify-content:center}
  .orbit-stage .aura{position:absolute;inset:14%;border-radius:50%;z-index:0;
    background:radial-gradient(circle,rgba(255,199,44,.5),transparent 68%);filter:blur(18px);animation:pulse 6s ease-in-out infinite}
  .orbit-stage .dashring{position:absolute;border:2px dashed rgba(28,26,22,.18);border-radius:50%}
  .core{position:relative;z-index:3;width:38%;aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;
    border:4px solid var(--ink);box-shadow:6px 6px 0 var(--ink);overflow:hidden;background:#fff;animation:floaty 6s ease-in-out infinite}
  .core img{width:100%;height:100%;object-fit:cover}
  @keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
  .orbit{position:absolute;inset:0;z-index:2;animation:spin 50s linear infinite}
  .orbit.rev{animation:spin 70s linear infinite reverse}
  .o-item{position:absolute;top:50%;left:50%;width:0;height:0}
  .o-upright{position:absolute}
  .o-spin{animation:spinrev 50s linear infinite}
  .orbit.rev .o-spin{animation:spin 70s linear infinite}
  .o-ic{width:56px;height:56px;border-radius:15px;transform:translate(-50%,-50%);box-shadow:3px 3px 0 var(--ink)}
  .o-ic.sm{width:42px;height:42px;border-radius:12px}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes spinrev{from{transform:rotate(0)}to{transform:rotate(-360deg)}}
  @media(max-width:520px){.orbit-stage{width:330px}.o-ic{width:44px;height:44px}.o-ic.sm{width:32px;height:32px}}

  /* ── terminal ────────────────────────────────────────── */
  .terminal{margin:30px 0 8px;border-radius:20px;overflow:hidden}
  .term-grid{display:grid;grid-template-columns:1.1fr 1fr 1.1fr;gap:0;background:transparent}
  @media(max-width:860px){.term-grid{grid-template-columns:1fr}}
  .tcell{padding:24px 26px;background:#fff;border-right:3px solid var(--ink)}
  .term-grid .tcell:last-child{border-right:none}
  @media(max-width:860px){.tcell{border-right:none;border-bottom:3px solid var(--ink)}.term-grid .tcell:last-child{border-bottom:none}}
  .tlabel{font-family:var(--fhead);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--red);font-weight:900;display:flex;align-items:center;gap:8px}
  .count{display:flex;align-items:center;gap:6px;margin:14px 0 4px;font-family:var(--fdisp)}
  .count .digit{display:inline-flex;align-items:center;justify-content:center;min-width:46px;height:62px;border-radius:12px;
    background:var(--yellow);border:3px solid var(--ink);box-shadow:3px 3px 0 var(--ink);
    font-size:44px;color:var(--ink);letter-spacing:.01em}
  .count .colon{font-size:34px;color:var(--ink);margin:0 1px}
  .count .cword{font-size:40px;color:var(--red);letter-spacing:.01em}
  .count.soon .digit{background:var(--red);color:#fff}
  .count.paying .cword{color:var(--up);animation:pulse 1s infinite}
  .pbar{margin-top:14px;height:10px;border-radius:6px;background:var(--cream-2);border:2px solid var(--ink);overflow:hidden}
  .pbar>i{display:block;height:100%;width:0;background:var(--red);transition:width .9s linear}
  .dispNote{margin-top:9px;font-size:12px;color:var(--dim);font-family:var(--fmono);min-height:15px}
  .dispNote b{color:var(--ink);font-weight:700}
  .dispNote.warm{color:var(--up);font-weight:700}
  .stocknow{display:flex;align-items:center;gap:14px;margin-top:10px}
  .nowlogo{width:62px;height:62px;border-radius:15px}
  .nowlogo.lit{box-shadow:3px 3px 0 var(--ink)}
  .stocknow .meta .tk{font-family:var(--fdisp);font-size:26px;color:var(--ink)}
  .stocknow .meta .nm{font-size:12.5px;color:var(--dim);margin-top:2px;font-weight:500}
  .upnext .nowlogo{width:48px;height:48px;border-radius:13px}
  .upnext .meta .tk{font-size:20px}
  .ca-row{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}

  /* ── section heads ───────────────────────────────────── */
  .sec{margin:54px 0 18px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
  .sec .t{font-family:var(--fdisp);font-size:34px;text-transform:uppercase;color:var(--ink);letter-spacing:.01em;line-height:1}
  .sec .t b{color:var(--red);font-weight:400}
  .sec .s{font-size:13px;color:var(--faint);font-weight:500}

  /* ── how it works ────────────────────────────────────── */
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  @media(max-width:820px){.steps{grid-template-columns:1fr}}
  .step{position:relative;border-radius:16px;padding:24px;background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow);transition:.16s}
  .step:hover{transform:translate(-3px,-3px);box-shadow:9px 9px 0 var(--ink)}
  .step .num{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:11px;
    font-family:var(--fdisp);font-size:22px;color:var(--ink);background:var(--yellow);border:3px solid var(--ink)}
  .step .st-t{margin-top:16px;font-family:var(--fdisp);font-size:21px;color:var(--red);text-transform:uppercase;letter-spacing:.01em}
  .step .st-d{margin-top:9px;font-size:14px;line-height:1.6;color:var(--dim)}
  .step .st-d b{color:var(--ink);font-weight:700}

  /* ── wallet checker ──────────────────────────────────── */
  .checkwrap{border-radius:18px;padding:22px;background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow)}
  .checkbar{display:flex;gap:10px;flex-wrap:wrap}
  .addrIn{flex:1;min-width:240px;padding:14px 16px;border-radius:12px;background:var(--cream);border:3px solid var(--ink);
    color:var(--ink);font-family:var(--fmono);font-size:13px;outline:none;transition:.15s}
  .addrIn:focus{background:#fff;box-shadow:3px 3px 0 var(--ink)}
  .addrIn::placeholder{color:var(--faint)}
  .checkres{display:none}
  .checkres.show{display:block;margin-top:18px;border-top:3px solid var(--ink);padding-top:18px;animation:fade .35s ease}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .cr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px}
  .cr-addr{font-family:var(--fmono);font-size:12.5px;color:var(--dim);display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .cr-copy{cursor:pointer;font-family:var(--fhead);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);
    border:2px solid var(--ink);border-radius:7px;padding:4px 9px;font-weight:900;background:#fff}
  .cr-copy.copied{background:var(--yellow)}
  .cr-tot{font-family:var(--fdisp);font-size:34px;color:var(--red);line-height:1}
  .cr-tot small{font-size:13px;color:var(--dim);font-weight:500;font-family:var(--fbody)}
  .cr-q{font-size:12px;text-align:right;color:var(--dim)}
  .cr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:10px}
  .cr-cell{display:flex;align-items:center;gap:11px;padding:12px;border-radius:13px;background:var(--cream-2);border:2px solid var(--ink)}
  .cr-cell .lgw{width:38px;height:38px;border-radius:10px}
  .cr-cell .tk{font-family:var(--fhead);font-weight:900;font-size:12px;color:var(--ink)}
  .cr-cell .sh{font-family:var(--fmono);font-size:14px;color:var(--ink);font-weight:700}
  .cr-cell .sl{font-size:10px;color:var(--faint)}
  .cr-empty{padding:18px;text-align:center;color:var(--faint);font-size:13px}
  .qbadge{display:inline-block;font-family:var(--fhead);font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:999px;
    background:var(--up);color:#fff;border:2px solid var(--ink);font-weight:900}
  .qbadge.no{background:var(--cream-2);color:var(--faint)}

  /* ── single-stock rail ───────────────────────────────── */
  .rail{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
  @media(max-width:1100px){.rail{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:560px){.rail{grid-template-columns:repeat(2,1fr)}}
  .chip{position:relative;border-radius:14px;padding:15px 8px 12px;text-align:center;transition:.18s;cursor:default;
    background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow-sm)}
  .chip .lgw{width:44px;height:44px;margin:0 auto 9px}
  .chip .tk{font-family:var(--fhead);font-weight:900;font-size:13.5px;color:var(--ink)}
  .chip .st{font-family:var(--fhead);font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-top:4px;height:10px;font-weight:900}
  .chip:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--ink)}
  .chip.now{background:var(--yellow)} .chip.now .st{color:var(--red)}
  .chip.next .st{color:var(--dim)}

  /* ── board ───────────────────────────────────────────── */
  .board{border-radius:20px;padding:30px;position:relative;overflow:hidden;background:var(--red);border:3px solid var(--ink);box-shadow:var(--shadow);color:#fff}
  .board .hd{display:flex;align-items:center;gap:10px;font-family:var(--fhead);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.8);font-weight:900}
  .board .hd .dot{width:8px;height:8px;border-radius:50%;background:var(--yellow);box-shadow:0 0 9px var(--yellow);animation:pulse 1.3s infinite}
  .bignum{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:14px}
  .bignum .v{font-family:var(--fdisp);font-size:clamp(56px,9vw,108px);line-height:.82;color:var(--yellow);letter-spacing:.01em;text-shadow:4px 4px 0 var(--red-dark)}
  .bignum .u{font-family:var(--fdisp);font-size:clamp(20px,2.4vw,30px);color:#fff}
  .bignum .cap{font-size:12px;color:rgba(255,255,255,.75);margin-left:auto;font-weight:600}
  .stats{margin-top:26px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
  @media(max-width:1000px){.stats{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:560px){.stats{grid-template-columns:repeat(2,1fr)}}
  .stat{padding:16px;border-radius:13px;background:rgba(0,0,0,.18);border:2px solid var(--ink);transition:.16s}
  .stat:hover{transform:translateY(-2px)}
  .stat .k{font-family:var(--fhead);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.72);font-weight:900}
  .stat .v{font-family:var(--fdisp);font-size:28px;color:#fff;margin-top:7px;line-height:1}
  .stat .v small{font-size:12px;color:rgba(255,255,255,.7);font-weight:500;font-family:var(--fbody)}

  /* ── per-stock grid ──────────────────────────────────── */
  .stockgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:1000px){.stockgrid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:560px){.stockgrid{grid-template-columns:1fr}}
  .scard{position:relative;border-radius:16px;padding:18px;overflow:hidden;transition:.16s;background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow-sm)}
  .scard:hover{transform:translate(-3px,-3px);box-shadow:8px 8px 0 var(--ink)}
  .scard .top{display:flex;align-items:center;gap:12px}
  .scard .top .lgw{width:42px;height:42px}
  .scard .tk{font-family:var(--fhead);font-weight:900;font-size:16px;color:var(--ink)}
  .scard .nm{font-size:11px;color:var(--faint)}
  .scard .qty{font-family:var(--fdisp);font-size:26px;color:var(--ink);margin-top:14px;line-height:1}
  .scard .qtyUsd{font-size:13px;color:var(--dim);font-weight:500;font-family:var(--fbody);margin-left:6px}
  .scard .sub{font-size:11px;color:var(--dim);margin-top:7px}
  .scard .sub b{color:var(--ink);font-weight:700}

  /* ── winners grid ────────────────────────────────────── */
  .winners{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:14px}
  .ticket{position:relative;border-radius:16px;padding:17px;overflow:hidden;transition:.16s;animation:popin .4s ease;
    background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow-sm)}
  .ticket:hover{transform:translate(-3px,-3px);box-shadow:8px 8px 0 var(--ink)}
  @keyframes popin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .ticket .top{display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--faint)}
  .ticket .top .tkw{display:flex;align-items:center;gap:9px}
  .ticket .top .lgw{width:30px;height:30px;border-radius:9px}
  .ticket .top .tk{font-family:var(--fhead);font-weight:900;font-size:13px;color:var(--ink)}
  .ticket .amt{font-family:var(--fdisp);font-size:30px;color:var(--ink);line-height:1;margin:12px 0 2px}
  .ticket .amt small{font-size:13px;color:var(--dim);font-weight:500;font-family:var(--fbody)}
  .ticket .amt .usd{font-size:12px;color:var(--up);font-weight:600;margin-left:6px;font-family:var(--fbody)}
  .ticket .addr{font-family:var(--fmono);font-size:11px;color:var(--dim)}
  .ticket .meta{margin-top:10px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:var(--faint)}
  .ticket .meta a{color:var(--red);text-decoration:none;font-weight:700} .ticket .meta a:hover{text-decoration:underline}
  .empty{padding:30px;text-align:center;color:var(--faint);border:3px dashed var(--ink);border-radius:16px;font-size:13px;background:#fff}

  /* ── two-col ─────────────────────────────────────────── */
  .cols{display:grid;grid-template-columns:1.45fr 1fr;gap:20px;align-items:start}
  @media(max-width:940px){.cols{grid-template-columns:1fr}}
  .card{border-radius:16px;overflow:hidden;background:#fff;border:3px solid var(--ink);box-shadow:var(--shadow)}
  table{width:100%;border-collapse:collapse}
  th{font-family:var(--fhead);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);text-align:left;
    padding:14px 16px;border-bottom:3px solid var(--ink);font-weight:900;background:var(--cream-2)}
  td{padding:12px 16px;border-bottom:1px solid var(--hair);font-size:13px;font-family:var(--fmono);color:var(--txt)}
  tr:last-child td{border-bottom:none}
  tbody tr{transition:.12s} tbody tr:hover{background:var(--cream)}
  .rank{color:var(--faint)}
  .vaulttools{padding:13px 15px;border-bottom:3px solid var(--ink);background:var(--cream-2)}
  .vfilter{width:100%;padding:11px 13px;border-radius:10px;background:#fff;border:2px solid var(--ink);color:var(--ink);
    font-family:var(--fmono);font-size:12px;outline:none}
  .vfilter:focus{box-shadow:2px 2px 0 var(--ink)} .vfilter::placeholder{color:var(--faint)}
  .vaultmore{padding:13px;text-align:center;border-top:3px solid var(--ink);background:var(--cream-2)}
  .morebtn{cursor:pointer;background:var(--yellow);border:2px solid var(--ink);color:var(--ink);border-radius:10px;
    padding:9px 18px;font-family:var(--fhead);font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:900;transition:.15s}
  .morebtn:hover{transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--ink)}
  .feed{max-height:560px;overflow:auto}
  .ev{display:flex;gap:11px;padding:12px 16px;border-bottom:1px solid var(--hair);font-size:12.5px;align-items:center}
  .ev:last-child{border-bottom:none}
  .ev .ts{flex:none;font-family:var(--fmono);font-size:10px;color:var(--faint)}
  .ev .tx{flex:1;color:var(--txt);font-size:12.5px;line-height:1.45} .ev .tx a{color:var(--red);text-decoration:none;font-weight:700}
  .evic{flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;
    font-size:13px;font-weight:900;border:2px solid var(--ink);background:#fff;color:var(--ink)}
  .ev.claim .evic{background:var(--yellow)}
  .ev.swap .evic{background:#fff}
  .ev.dispense .evic{background:var(--up);color:#fff}
  .ev.error .evic{background:var(--down);color:#fff} .ev.error .tx{color:var(--down)}

  footer{margin-top:56px;text-align:center;color:var(--faint);font-size:11.5px;line-height:1.8}
  footer .dis{max-width:830px;margin:10px auto 0;opacity:.9}

  .btn .pf{width:20px;height:20px;object-fit:contain;flex:none;margin:-2px 0}
  .morebtn:active,.cr-copy:active,.ca:active,.lgw:active{transform:scale(.96)}
  @media(prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;animation-iteration-count:1!important}.tape .track{animation:none}}

  /* ── toast ───────────────────────────────────────────── */
  .toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(22px);z-index:60;
    padding:13px 22px;border-radius:13px;background:var(--ink);color:#fff;font-family:var(--fhead);font-weight:900;font-size:13px;
    border:3px solid var(--yellow);box-shadow:0 20px 50px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}
  .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

  .hdot{display:inline-block;width:18px;height:18px;border-radius:6px;vertical-align:middle;margin-right:10px;border:2px solid var(--ink)}
  .rank.r1{color:var(--yellow-deep);font-weight:900} .rank.r2{color:#9a958a;font-weight:900} .rank.r3{color:#c07a3a;font-weight:900}
  .sharecell{display:flex;flex-direction:column;gap:6px}
  .sbar-wrap{height:6px;border-radius:3px;background:var(--cream-2);border:1px solid var(--ink);max-width:96px;overflow:hidden}
  .sbar{display:block;height:100%;border-radius:3px;background:var(--red)}

  @media(max-width:900px){.wrap{padding:30px 16px 90px}.topbar{padding:10px 16px}}
  @media(max-width:560px){
    .topbar{flex-wrap:wrap;gap:10px}
    .nav{gap:4px;flex-wrap:wrap}.nav a{padding:8px 10px;font-size:12px}
    .brand .nm{font-size:22px}
    h1.title{font-size:42px}
    .lede{font-size:15px}
    .sec .t{font-size:26px}
    .hero-cta{gap:8px}
    .hero-cta .ca{order:3;width:100%;justify-content:space-between}
    .tcell{padding:18px}
  }

  /* ── flash + rain ────────────────────────────────────── */
  .flash{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity .3s}
  .flash.show{opacity:1}
  .flash .card2{padding:30px 48px;border-radius:22px;text-align:center;background:#fff;border:4px solid var(--ink);box-shadow:12px 12px 0 var(--ink)}
  .flash .card2 .lgw{width:78px;height:78px;border-radius:18px;margin:0 auto 12px}
  .flash .lab{font-family:var(--fhead);font-weight:900;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--red)}
  .flash .big{font-family:var(--fdisp);font-size:56px;color:var(--ink);line-height:1;margin:8px 0}
  .flash .big small{font-size:22px;color:var(--dim)}
  .flash .sub{font-size:13px;color:var(--dim)}
  #rain{position:fixed;inset:0;z-index:49;pointer-events:none;overflow:hidden}
  .drop{position:absolute;top:-60px;border-radius:13px;opacity:0;display:flex;align-items:center;justify-content:center;
    background:#fff;border:2px solid var(--ink)}
  .drop img{width:62%;height:62%;object-fit:contain}
  @keyframes fall{0%{opacity:0;transform:translateY(-60px) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(108vh) rotate(var(--r))}}

</style>
</head>
<body>
<canvas id="chartCanvas"></canvas>
<div class="aurora a1"></div><div class="aurora a2"></div><div class="aurora a3"></div>
<div class="vignette"></div>
<div class="toast" id="toast"></div>

<div class="tape"><div class="track" id="tape"></div></div>

<div class="topbar">
  <div class="brand">
    <span class="xm"><img src="/logo.png" alt="JOBCOIN"/></span>
    <span class="nm">JOB<span style="color:var(--yellow)">COIN</span></span>
  </div>
  <div class="nav">
    <a class="hideSm" href="#checker">Check earnings</a>
    <a class="hideSm" href="#how">How it works</a>
    <a class="hideSm" href="#airdrops">Airdrops</a>
    <a class="xbtn" href="https://x.com/GetAJobOnSolana" target="_blank" rel="noopener" aria-label="X / Twitter" title="Follow on X">𝕏</a>
    <a class="xbtn" href="https://t.me/jobisonsol" target="_blank" rel="noopener" aria-label="Telegram" title="Join Telegram"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></a>
    <span class="live"><span class="dot" id="stDot"></span><span id="stTxt">live</span></span>
    <a class="btn white" id="buyTop" href="#" target="_blank" rel="noopener"><img class="pf" src="/pumpfun.png" alt=""/>Buy</a>
  </div>
</div>

<div class="maint" id="maint"></div>

<div class="wrap">

  <section class="hero">
    <div>
      <div class="kick"><span class="dot"></span> Live · <b id="holdTxt">—</b> holders · <b id="qualTxt">—</b> qualified · MCDx drop every <b id="kickMin">5</b> min</div>
      <h1 class="title">You got cooked.<br>Get paid in <span class="muted" style="color:var(--yellow)">McDonald's stock.</span></h1>
      <p class="lede">
        Your charts didn't work out. The machine will. Every cycle it claims the
        creator fees, buys <b>real McDonald's stock (MCDx)</b> on Jupiter, and
        airdrops it <b>straight into every holder's wallet</b> — automatically, no
        claiming. Hold <b id="ledeMin">500,000</b>+ $JOB; the more you hold, the
        bigger your slice. 🍟
      </p>
      <div class="hero-cta">
        <a class="btn white" id="buyHero" href="#" target="_blank" rel="noopener"><img class="pf" src="/pumpfun.png" alt=""/>Buy on pump.fun</a>
        <a class="btn ghost" href="#checker">Check your earnings</a>
      </div>
    </div>
    <div class="orbit-stage" id="orbitStage">
      <div class="aura"></div>
      <div class="core"><img src="/logo.png" alt="$JOB"/></div>
      <div class="orbit" id="orbit1"></div>
      <div class="orbit rev" id="orbit2"></div>
    </div>
  </section>

  <section class="terminal glass">
    <div class="term-grid">
      <div class="tcell">
        <div class="tlabel"><span class="dot" style="width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 9px var(--up)"></span> Next airdrop in</div>
        <div class="count" id="count">--:--</div>
        <div class="pbar"><i id="bar"></i></div>
        <div class="dispNote" id="dispNote"></div>
      </div>
      <div class="tcell">
        <div class="tlabel" id="nowLabel">Dropping next</div>
        <div class="stocknow">
          <div class="lgw nowlogo lit" id="nowLogo"><img src="/mcd.png" alt=""/></div>
          <div class="meta"><div class="tk" id="nowTk">—</div><div class="nm" id="nowNm">waiting…</div></div>
        </div>
      </div>
      <div class="tcell">
        <div class="tlabel" id="nextLabel">Then</div>
        <div class="stocknow upnext">
          <div class="lgw nowlogo" id="nextLogo"><img src="/mcd.png" alt=""/></div>
          <div class="meta"><div class="tk" id="nextTk">—</div><div class="nm" id="nextNm">—</div></div>
        </div>
        <div class="ca-row"><a class="btn white" id="buyBtn" href="#" target="_blank" rel="noopener"><img class="pf" src="/pumpfun.png" alt=""/>Buy on pump.fun</a></div>
      </div>
    </div>
  </section>

  <div class="sec" id="how"><div class="t">How it <b>works</b></div><div class="s">Hold $JOB, get paid in McDonald's stock — automatically</div></div>
  <div class="steps">
    <div class="step glass"><span class="num">1</span>
      <div class="st-t">Hold <span id="stepMin">500k</span>+ $JOB</div>
      <div class="st-d">Hold at least <b id="stepMin2">500,000</b> $JOB to qualify. Your share of every airdrop is proportional to your bag — no claiming, no lockups, no callouts. It just shows up.</div></div>
    <div class="step glass"><span class="num">2</span>
      <div class="st-t">The machine buys McDonald's</div>
      <div class="st-d">Creator fees pile up on-chain. Each cycle the machine claims them and <b>buys real McDonald's stock (MCDx)</b> on Jupiter — the Backed/xStocks tokenized MCD share, 1 token ≈ 1 share.</div></div>
    <div class="step glass"><span class="num">3</span>
      <div class="st-t">Airdropped pro-rata</div>
      <div class="st-d">Every <b id="stepInt">5</b> minutes the MCDx is sent <b>straight to every qualified holder's wallet</b>, split by bag size. You got cooked — now you're on the payroll. 🍟</div></div>
  </div>

  <div class="sec" id="checker"><div class="t">Check your <b>earnings</b></div><div class="s">Paste your wallet · see how much McDonald's stock you've been paid</div></div>
  <section class="checkwrap glass">
    <div class="checkbar">
      <input id="addrInput" class="addrIn" placeholder="Paste your Solana wallet address…" spellcheck="false" autocomplete="off" />
      <button id="checkBtn" class="btn white">Check earnings</button>
      <button id="checkMe" class="btn ghost" title="Paste from clipboard">Paste</button>
    </div>
    <div id="checkResult" class="checkres"></div>
  </section>

  <div class="sec" id="rotation"><div class="t">Paid in <b>McDonald's</b></div><div class="s">Every cycle buys &amp; ships MCDx — the tokenized McDonald's share</div></div>
  <div class="rail" id="rail"></div>

  <div class="sec"><div class="t">Total <b>stock</b> shipped to holders</div></div>
  <section class="board glass">
    <div class="hd"><span class="dot"></span> Value airdropped to holders · SOL spent buying their stock</div>
    <div class="bignum"><span class="v" id="totalVal">0.000</span><span class="u">SOL</span><span class="cap" id="lastPaid">—</span></div>
    <div class="stats">
      <div class="stat"><div class="k">Fees claimed</div><div class="v"><span id="sClaimed">0</span> <small>SOL</small></div></div>
      <div class="stat"><div class="k">Holder payouts</div><div class="v" id="sPaid">0</div></div>
      <div class="stat"><div class="k">Airdrop cycles</div><div class="v" id="sCycles">0</div></div>
      <div class="stat"><div class="k">Min hold</div><div class="v" id="sStocks">500k</div></div>
      <div class="stat"><div class="k">Qualified</div><div class="v" id="sQual">0</div></div>
    </div>
  </section>

  <div class="sec"><div class="t">McDonald's <b>shipped</b></div><div class="s">Lifetime MCDx airdropped to the crew</div></div>
  <div class="stockgrid" id="stockGrid"></div>

  <div class="sec" id="airdrops"><div class="t">Recent <b>airdrops</b></div><div class="s">Live from the dispenser — newest first</div></div>
  <div class="winners" id="winnersGrid"></div>

  <div class="cols" style="margin-top:36px">
    <div>
      <div class="sec" id="holders" style="margin-top:0"><div class="t">The <b>vault</b></div><div class="s"><span id="vaultCount">—</span></div></div>
      <div class="card glass">
        <div class="vaulttools"><input id="vaultFilter" class="vfilter" placeholder="Filter holders by address…" spellcheck="false" autocomplete="off"/></div>
        <table>
          <thead><tr><th style="width:42px">#</th><th>Holder</th><th>$JOB</th><th>Share</th><th>Status</th></tr></thead>
          <tbody id="holdersBody"><tr><td colspan="5" class="rank" style="padding:22px;text-align:center">Waiting for first holder snapshot…</td></tr></tbody>
        </table>
        <div class="vaultmore"><button id="vaultMore" class="morebtn">Show all</button></div>
      </div>
    </div>
    <div>
      <div class="sec" style="margin-top:0"><div class="t">Live <b>feed</b></div><div class="s">Claims · buys · airdrops</div></div>
      <div class="card glass feed" id="feed"></div>
    </div>
  </div>

  <footer>
    <div><a href="https://x.com/GetAJobOnSolana" target="_blank" rel="noopener" style="color:#fff;text-decoration:none;border:1px solid var(--line2);padding:8px 16px;border-radius:10px;display:inline-block;margin-bottom:14px">𝕏 Follow @GetAJobOnSolana</a></div>
    <div>$JOBCOIN — the machine claims fees, buys real McDonald's stock (MCDx), and airdrops it to every holder, every cycle. Ba da ba ba ba.</div>
    <div class="dis">Memecoin. Entertainment only, not financial advice and not an offer of securities. Not affiliated with, endorsed by, or sponsored by McDonald's Corporation. The project buys the tokenized-equity token MCDx ("xStocks", issued by third parties / Backed) on the open market with claimed creator fees and distributes it proportionally to qualifying holders; amounts vary with fee volume and market liquidity and can be zero. McDonald's, MCDx and the underlying company are not affiliated with this project. No payout, value, or outcome is guaranteed.</div>
  </footer>
</div>

<div id="rain"></div>
<div class="flash" id="flash"><div class="card2">
  <div class="lgw" id="flashLogo"><img src="/mcd.png" alt=""/></div>
  <div class="lab" id="flashLab">Airdrop sent</div>
  <div class="big" id="flashAmt">0 <small>shares</small></div>
  <div class="sub" id="flashSub">paying every holder…</div>
</div></div>

<script>
var TICKERS=['MCD'];
var NAMES={MCD:"McDonald's"};
var ACCENT={MCD:'#FFC72C'};
var ac=function(tk){return ACCENT[tk]||'#FFC72C';};
var lg=function(tk){return '/mcd.png';};
var tile=function(tk,cls){return '<span class="lgw '+(cls||'')+'" style="--ac:'+ac(tk)+'"><img src="'+lg(tk)+'" alt="'+tk+'"/></span>';};

var SOL=function(n,d){d=(d==null?4:d);return (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});};
var SH=function(n,d){d=(d==null?4:d);n=Number(n)||0;return n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});};
var short=function(a){return a?a.slice(0,4)+'…'+a.slice(-4):'—';};
var fmtTok=function(n){n=Number(n)||0;
  if(n>=1e9)return (n/1e9).toFixed(2)+'B';if(n>=1e6)return (n/1e6).toFixed(2)+'M';
  if(n>=1e3)return (n/1e3).toFixed(1)+'K';return n.toLocaleString(undefined,{maximumFractionDigits:0});};
var ago=function(ts){if(!ts)return '—';var s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';return Math.floor(s/3600)+'h ago';};
var solscanTx=function(s){return 'https://solscan.io/tx/'+s;};
var solscanAcc=function(a){return 'https://solscan.io/account/'+a;};

var lastDispenseTs=0, disp={};
function animNum(id,target,dec){var c=(disp[id]==null?0:disp[id]);c+=(target-c)*0.28;if(Math.abs(target-c)<Math.pow(10,-(dec+1)))c=target;disp[id]=c;var el=document.getElementById(id);if(el)el.textContent=(dec>=3?SOL(c,dec):Math.round(c).toLocaleString());}

// orbit
(function(){
  var o1=document.getElementById('orbit1'),o2=document.getElementById('orbit2');
  var ring1=['MCD','MCD','MCD','MCD','MCD','MCD'],ring2=['MCD','MCD','MCD','MCD'];
  function build(host,arr,radius,sm){host.innerHTML='';
    arr.forEach(function(tk,i){var a=(360/arr.length)*i;
      var item=document.createElement('div');item.className='o-item';item.style.transform='rotate('+a+'deg) translate(0,-'+radius+'px)';
      var up=document.createElement('div');up.className='o-upright';up.style.transform='rotate('+(-a)+'deg)';
      var sp=document.createElement('div');sp.className='o-spin';
      sp.innerHTML='<span class="lgw o-ic'+(sm?' sm':'')+'" style="--ac:'+ac(tk)+'" title="'+NAMES[tk]+'"><img src="'+lg(tk)+'" alt="'+tk+'"/></span>';
      up.appendChild(sp);item.appendChild(up);host.appendChild(item);});}
  function layout(){var R=o1.parentElement.clientWidth/2;build(o1,ring1,Math.round(R*0.94),false);build(o2,ring2,Math.round(R*0.72),true);}
  layout();addEventListener('resize',layout);
})();

// monochrome candlesticks
(function(){
  var c=document.getElementById('chartCanvas'),x=c.getContext('2d');
  var W,H,cols=[],DPR=Math.min(2,window.devicePixelRatio||1);
  function rs(){W=innerWidth;H=innerHeight;c.width=W*DPR;c.height=H*DPR;c.style.width=W+'px';c.style.height=H+'px';x.setTransform(DPR,0,0,DPR,0,0);build();}
  function build(){cols=[];var step=46,n=Math.ceil(W/step)+2,price=H*0.55;
    for(var i=0;i<n;i++){var up=Math.random()>.5;var range=14+Math.random()*46;var body=6+Math.random()*30;
      var open=price;var close=up?open-body:open+body;
      cols.push({x:i*step,open:open,close:close,hi:Math.min(open,close)-Math.random()*range,lo:Math.max(open,close)+Math.random()*range,up:up});
      price=close+(Math.random()-.5)*22;price=Math.max(H*0.2,Math.min(H*0.8,price));}}
  var off=0;
  function draw(){x.clearRect(0,0,W,H);off-=0.4;if(off<=-46){off+=46;cols.push(cols.shift());for(var j=0;j<cols.length;j++)cols[j].x=j*46;}
    for(var i=0;i<cols.length;i++){var k=cols[i];var cx=k.x+off;var w=11;var a=k.up?'.55':'.32';
      x.strokeStyle='rgba(255,255,255,'+a+')';x.lineWidth=1.3;x.beginPath();x.moveTo(cx,k.hi);x.lineTo(cx,k.lo);x.stroke();
      x.fillStyle='rgba(255,255,255,'+a+')';var top=Math.min(k.open,k.close),h=Math.max(2,Math.abs(k.close-k.open));x.fillRect(cx-w/2,top,w,h);}
    requestAnimationFrame(draw);}
  rs();addEventListener('resize',rs);draw();
})();

function rainLogos(tk){var host=document.getElementById('rain');
  for(var i=0;i<24;i++){var d=document.createElement('div');d.className='drop';d.style.setProperty('--ac',ac(tk));
    d.innerHTML='<img src="'+lg(tk)+'" alt=""/>';d.style.left=(Math.random()*100)+'vw';
    d.style.setProperty('--r',((Math.random()-.5)*420)+'deg');var dur=1.7+Math.random()*1.6;
    d.style.animation='fall '+dur+'s cubic-bezier(.4,.1,.7,1) forwards';d.style.animationDelay=(Math.random()*.5)+'s';
    var sz=30+Math.random()*26;d.style.width=sz+'px';d.style.height=sz+'px';
    host.appendChild(d);setTimeout((function(el){return function(){el.remove();};})(d),(dur+.6)*1000);}}
function fireFlash(ticker,shares){var f=document.getElementById('flash');
  var fl=document.getElementById('flashLogo');fl.style.setProperty('--ac',ac(ticker));fl.innerHTML='<img src="'+lg(ticker)+'" alt=""/>';
  document.getElementById('flashLab').textContent='$'+ticker+' airdrop sent';
  document.getElementById('flashAmt').innerHTML=SH(shares,4)+' <small>'+ticker+'</small>';
  f.classList.add('show');rainLogos(ticker);setTimeout(function(){f.classList.remove('show');},3400);}

var GLYPH={claim:'◆',swap:'⇄',dispense:'↓',error:'!',info:'•'};
function showToast(msg){var t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window.__tt);window.__tt=setTimeout(function(){t.classList.remove('show');},1600);}
function idColor(a){var h=0;for(var i=0;i<a.length;i++)h=(h*31+a.charCodeAt(i))%360;return 'linear-gradient(135deg,hsl('+h+',72%,60%),hsl('+((h+48)%360)+',66%,46%))';}
function renderCount(el,t){if(/^[0-9]{2}:[0-9]{2}$/.test(t)){var h='';for(var i=0;i<t.length;i++){var c=t.charAt(i);h+=(c===':'?'<span class="colon">:</span>':'<span class="digit">'+c+'</span>');}el.innerHTML=h;}else{el.innerHTML='<span class="cword">'+t+'</span>';}}

function setLogo(elId,tk){var el=document.getElementById(elId);if(!el)return;el.style.setProperty('--ac',ac(tk));var img=el.querySelector('img');if(img)img.src=lg(tk);}

function tick(){
  fetch('/api/state',{cache:'no-store'}).then(function(r){return r.json();}).then(function(s){
    var dot=document.getElementById('stDot'),txt=document.getElementById('stTxt');
    var busy=(s.status==='dispensing'||s.status==='claiming'||s.status==='buying');
    dot.className='dot'+(s.status==='error'?' red':(busy?' amber':''));
    txt.textContent=s.maintenance?'maint':(s.status||'live');
    document.getElementById('maint').className='maint'+(s.maintenance?' show':'');
    if(s.maintenance)document.getElementById('maint').textContent='⚠ '+(s.maintenanceReason||'Bot not configured yet.');

    var min=s.minHolderBalance||500000;
    var lm=document.getElementById('ledeMin');if(lm)lm.textContent=Number(min).toLocaleString();
    var mins=Math.round((s.cycleSeconds||300)/60);
    document.getElementById('kickMin').textContent=mins;
    var sm=document.getElementById('stepMin');if(sm)sm.textContent=Math.round(min/1000)+'k';
    var sm2=document.getElementById('stepMin2');if(sm2)sm2.textContent=Number(min).toLocaleString();
    var si=document.getElementById('stepInt');if(si)si.textContent=mins;
    document.getElementById('qualTxt').textContent=(s.current&&s.current.qualifiedCount||0);
    document.getElementById('holdTxt').textContent=(s.current&&s.current.holderCount||0);

    var ca=s.xstocksMint||'';
    var buyUrl=ca?('https://pump.fun/'+ca):'https://pump.fun';
    document.getElementById('buyBtn').href=buyUrl;document.getElementById('buyTop').href=buyUrl;document.getElementById('buyHero').href=buyUrl;

    // The countdown is always to the NEXT cycle, which pays nextStock. So while
    // idle we show nextStock as what's dropping (matches the timer); only during
    // an active cycle is currentStock the one actually being paid right now.
    var cur=s.currentStock,nxt=s.nextStock,rot=s.rotation||[];
    var busy=(s.status==='dispensing'||s.status==='buying'||s.status==='claiming');
    function rotIdx(sym){for(var i=0;i<rot.length;i++){if(rot[i].symbol===sym)return i;}return -1;}
    var paying = busy ? (cur||nxt) : (nxt||cur);
    var after = null;
    if(paying && rot.length){var pi=rotIdx(paying.symbol); if(pi>=0) after=rot[(pi+1)%rot.length];}
    if(!after) after = busy ? nxt : cur;
    document.getElementById('nowLabel').textContent = busy ? 'Now paying' : 'Dropping next';
    document.getElementById('nextLabel').textContent = busy ? 'Up next' : 'Then';
    if(paying){setLogo('nowLogo',paying.ticker);document.getElementById('nowTk').textContent='$'+paying.ticker;document.getElementById('nowNm').textContent=paying.name;}
    if(after){setLogo('nextLogo',after.ticker);document.getElementById('nextTk').textContent='$'+after.ticker;document.getElementById('nextNm').textContent=after.name;}

    var cEl=document.getElementById('count');
    var cyc=(s.nextCycleAt&&s.nextCycleAt>Date.now())?Math.max(0,Math.floor((s.nextCycleAt-Date.now())/1000)):0;
    var mm=String(Math.floor(cyc/60)).padStart(2,'0'),ss=String(cyc%60).padStart(2,'0');
    var cstr,ccls;
    if(s.status==='dispensing'){cstr='PAYING';ccls='count paying';}
    else if(s.status==='buying'){cstr='BUYING';ccls='count paying';}
    else{cstr=mm+':'+ss;ccls='count'+((cyc<=10&&cyc>0)?' soon':'');}
    cEl.className=ccls;renderCount(cEl,cstr);
    var len=s.cycleSeconds||300;
    var bar=document.getElementById('bar');var note=document.getElementById('dispNote');
    if(s.status==='dispensing' && s.liveDispense){
      // active drop — bar fills from elapsed vs estimated batch time. The
      // "X of Y" is an estimate (we don't poke the payout pipeline mid-cycle),
      // so once we exceed the estimate we switch to a finalizing message
      // instead of pretending "~1s left" forever.
      var lv=s.liveDispense;
      var rc=lv.recipientCount||1;
      var batches=Math.ceil(rc/6);
      var est=Math.max(25, batches*7);          // ~7s per batch (build+send+confirm)
      var elapsed=Math.max(0,(Date.now()-(lv.startedAt||Date.now()))/1000);
      if(elapsed < est - 5){
        var frac=elapsed/est;
        bar.style.width=(frac*100).toFixed(1)+'%';
        var paid=Math.min(rc, Math.floor(frac*rc));
        var left=Math.max(1, Math.round(est-elapsed));
        note.className='dispNote';
        note.innerHTML='paying <b>'+paid+'</b> of <b>'+rc+'</b> holders · ~'+left+'s left';
      } else {
        // estimate exhausted — actual confirms are taking longer than the
        // average. Stop counting down; just show what's really happening.
        bar.style.width='97%';
        note.className='dispNote warm';
        note.textContent='finalizing last batches — confirming on chain…';
      }
    } else if(s.status==='buying'){
      bar.style.width='8%'; note.className='dispNote'; note.textContent='swapping SOL → $'+(cur?cur.ticker:'')+' on Jupiter…';
    } else if(s.status==='claiming'){
      bar.style.width='3%'; note.className='dispNote'; note.textContent='claiming creator fees…';
    } else {
      bar.style.width=Math.max(0,Math.min(100,100-(cyc/len*100)))+'%';
      if(ld && ld.ts && (Date.now()-ld.ts)<8000){ note.className='dispNote warm'; note.textContent='✓ just paid '+ld.recipientCount+' holders '+SH(ld.totalUi,4)+' $'+ld.ticker; }
      else { note.className='dispNote'; note.textContent=''; }
    }

    animNum('totalVal',Number((s.totals&&s.totals.solSpentOnStock)||0),3);
    animNum('sClaimed',Number((s.totals&&s.totals.solClaimed)||0),3);
    animNum('sPaid',Number((s.totals&&s.totals.recipientsPaid)||0),0);
    animNum('sCycles',Number((s.totals&&s.totals.dispenseCount)||0),0);
    document.getElementById('sStocks').textContent=fmtTok(min)+' $JOB';
    document.getElementById('sQual').textContent=(s.current&&s.current.qualifiedCount||0);
    var ld=s.lastDispense;
    document.getElementById('lastPaid').textContent=ld?('last: '+SH(ld.totalUi,3)+' $'+ld.ticker+' → '+ld.recipientCount+' holders · '+ago(ld.ts)):'no airdrops yet';
    if(ld&&ld.ts&&ld.ts!==lastDispenseTs){if(lastDispenseTs!==0)fireFlash(ld.ticker,ld.totalUi);lastDispenseTs=ld.ts;}

    var rail=document.getElementById('rail');var rot=s.rotation||[];
    var curSym=cur?cur.symbol:'',nxtSym=nxt?nxt.symbol:'';
    rail.innerHTML=rot.map(function(st){var cls='chip glass',state='';
      if(st.symbol===curSym){cls+=' now';state='now paying';}else if(st.symbol===nxtSym){cls+=' next';state='up next';}
      return '<div class="'+cls+'" style="--ac:'+ac(st.ticker)+'">'+tile(st.ticker)+'<div class="tk">'+st.ticker+'</div><div class="st">'+state+'</div></div>';
    }).join('');

    var sg=document.getElementById('stockGrid');var ps=s.perStock||{};
    var order=(rot.length?rot:Object.keys(ps).map(function(k){return ps[k];}));
    sg.innerHTML=order.map(function(st){var d=ps[st.symbol]||{totalUi:0,solSpent:0,cycles:0};
      var px=((typeof PRICES!=='undefined'?PRICES:{})[st.ticker]||{}).usd||0;
      var usd=(px>0&&d.totalUi>0)?' <span class="qtyUsd">≈ $'+Math.round(px*d.totalUi).toLocaleString()+'</span>':'';
      return '<div class="scard glass" style="--ac:'+ac(st.ticker)+'"><div class="top">'+tile(st.ticker)+'<div><div class="tk">$'+st.ticker+'</div><div class="nm">'+st.name+'</div></div></div>'+
        '<div class="qty">'+SH(d.totalUi,4)+usd+'</div><div class="sub">shares shipped · <b>'+SOL(d.solSpent,3)+' SOL</b> · '+(d.cycles||0)+'×</div></div>';
    }).join('');

    var wg=document.getElementById('winnersGrid');var ws=(s.recentWinners||[]).slice(0,18);
    if(ws.length===0){wg.innerHTML='<div class="empty">No airdrops yet — the first drop fires once fees are claimed, the stock is bought, and holders qualify.</div>';}
    else{wg.innerHTML=ws.map(function(w){
      var link=w.signature?('<a href="'+solscanTx(w.signature)+'" target="_blank" rel="noopener">receipt ▸</a>'):'<span>pending</span>';
      var px=((typeof PRICES!=='undefined'?PRICES:{})[w.ticker]||{}).usd||0;
      var usd=px>0?'<span class="usd"> ≈ $'+SOL(px*w.amountUi,2)+'</span>':'';
      return '<div class="ticket glass" style="--ac:'+ac(w.ticker)+'"><div class="top"><span class="tkw">'+tile(w.ticker)+'<span class="tk">$'+w.ticker+'</span></span><span>'+ago(w.ts)+'</span></div>'+
        '<div class="amt">'+SH(w.amountUi,4)+' <small>'+w.ticker+'</small>'+usd+'</div>'+
        '<div class="addr"><a href="'+solscanAcc(w.owner)+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">'+short(w.owner)+'</a></div>'+
        '<div class="meta"><span>≈ '+SOL(w.solValue,4)+' SOL</span>'+link+'</div></div>';
    }).join('');}

    LAST_STATE=s;renderVault(s);

    var fe=document.getElementById('feed');var ev=(s.events||[]).slice(-60).reverse();
    fe.innerHTML=ev.map(function(e){var tx=e.txSignature?(' <a href="'+solscanTx(e.txSignature)+'" target="_blank" rel="noopener">tx▸</a>'):'';
      return '<div class="ev '+e.type+'"><span class="evic">'+(GLYPH[e.type]||'•')+'</span><span class="tx">'+(e.message||'')+tx+'</span><span class="ts">'+ago(e.ts)+'</span></div>';
    }).join('');
  }).catch(function(){});
}

// vault
var LAST_STATE=null, vaultShowAll=false, vaultFilter='';
function renderVault(s){var hb=document.getElementById('holdersBody');var all=(s.topHolders||[]);
  var f=vaultFilter.trim().toLowerCase();
  var rows=f?all.filter(function(h){return h.owner.toLowerCase().indexOf(f)>=0;}):all;
  var cap=vaultShowAll?rows.length:Math.min(rows.length,50);var shown=rows.slice(0,cap);
  document.getElementById('vaultCount').textContent=(s.current&&s.current.holderCount||0)+' holders · top '+all.length+' shown · ✓ qualified';
  var maxShare=(all[0]&&all[0].share)||1;
  if(!shown.length){hb.innerHTML='<tr><td colspan="5" class="rank" style="padding:22px;text-align:center">'+(f?'No holder matches that filter.':'Waiting for first holder snapshot…')+'</td></tr>';}
  else{hb.innerHTML=shown.map(function(h){var rk=all.indexOf(h)+1;var pct=h.share*100;var bw=Math.max(6,Math.min(100,(h.share/maxShare)*100));
    return '<tr><td class="rank'+(rk<=3?' r'+rk:'')+'">'+(rk<=3?['','①','②','③'][rk]:rk)+'</td>'+
      '<td><span class="hdot" style="background:'+idColor(h.owner)+'"></span><a href="'+solscanAcc(h.owner)+'" target="_blank" rel="noopener" style="color:var(--txt);text-decoration:none">'+short(h.owner)+'</a></td>'+
      '<td>'+fmtTok(h.uiBalance)+'</td>'+
      '<td><div class="sharecell"><span>'+pct.toFixed(2)+'%</span><div class="sbar-wrap"><i class="sbar" style="width:'+bw+'%"></i></div></div></td>'+
      '<td>'+(h.qualified?'<span class="qbadge">✓ qualified</span>':'<span class="qbadge no">below min</span>')+'</td></tr>';
  }).join('');}
  var mb=document.getElementById('vaultMore');if(mb){mb.style.display=(rows.length>50)?'inline-block':'none';mb.textContent=vaultShowAll?'Show less':('Show all ('+rows.length+')');}}
document.getElementById('vaultFilter').addEventListener('input',function(e){vaultFilter=e.target.value;vaultShowAll=false;if(LAST_STATE)renderVault(LAST_STATE);});
document.getElementById('vaultMore').addEventListener('click',function(){vaultShowAll=!vaultShowAll;if(LAST_STATE)renderVault(LAST_STATE);});

// wallet checker
function doCheck(addr){addr=(addr||'').trim();var box=document.getElementById('checkResult');
  if(addr.length<32||addr.length>44){box.className='checkres show';box.innerHTML='<div class="cr-empty">That does not look like a Solana wallet address.</div>';return;}
  box.className='checkres show';box.innerHTML='<div class="cr-empty">Looking up '+short(addr)+'…</div>';
  fetch('/api/holder/'+addr,{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
    if(d.error){box.innerHTML='<div class="cr-empty">'+d.error+'</div>';return;}
    var qual=d.holding?(d.holding.qualified?'<span class="qbadge">✓ qualified</span>':'<span class="qbadge no">below '+Number(d.minHolderBalance).toLocaleString()+'</span>'):'<span class="qbadge no">not in top holders</span>';
    var holdLine=d.holding?('holds '+fmtTok(d.holding.uiBalance)+' $JOB'):'holding unknown';
    var head='<div class="cr-head"><div><div class="cr-addr">'+short(addr)+' <span class="cr-copy" id="crCopy">copy</span></div>'+
      '<div class="cr-tot">'+SOL(d.totalSol,4)+' <small>SOL received · '+(d.count||0)+' airdrops</small></div></div>'+
      '<div class="cr-q">'+qual+'<div style="margin-top:7px">'+holdLine+'</div></div></div>';
    var grid='';
    if(d.byStock&&d.byStock.length){grid='<div class="cr-grid">'+d.byStock.map(function(b){
      return '<div class="cr-cell">'+tile(b.ticker)+'<div><div class="tk">$'+b.ticker+'</div><div class="sh">'+SH(b.shares,4)+'</div><div class="sl">≈ '+SOL(b.sol,4)+' SOL · '+b.count+'×</div></div></div>';
    }).join('')+'</div>';}
    else{grid='<div class="cr-empty">No McDonald\\'s stock paid to this wallet yet'+(d.holding&&!d.holding.qualified?' — top up to '+Number(d.minHolderBalance).toLocaleString()+'+ $JOB to start earning.':'.')+'</div>';}
    box.innerHTML=head+grid;
    var cc=document.getElementById('crCopy');
    if(cc)cc.addEventListener('click',function(){navigator.clipboard.writeText(addr).then(function(){cc.classList.add('copied');cc.textContent='copied';showToast('Wallet address copied');setTimeout(function(){cc.classList.remove('copied');cc.textContent='copy';},1200);}).catch(function(){});});
  }).catch(function(){box.innerHTML='<div class="cr-empty">Lookup failed — try again.</div>';});}
document.getElementById('checkBtn').addEventListener('click',function(){doCheck(document.getElementById('addrInput').value);});
document.getElementById('addrInput').addEventListener('keydown',function(e){if(e.key==='Enter')doCheck(e.target.value);});
document.getElementById('checkMe').addEventListener('click',function(){
  navigator.clipboard.readText().then(function(t){var el=document.getElementById('addrInput');el.value=(t||'').trim();doCheck(el.value);}).catch(function(){document.getElementById('addrInput').focus();});});

// ticker tape
// real ticker tape — Jupiter v2 prices + 24h change + lifetime shipped per stock.
var MINTS={MCD:'XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2'};
var PRICES={};
var tapeBuilt=false;
function buildTape(){
  var ps=(LAST_STATE&&LAST_STATE.perStock)||{};
  var items=TICKERS.map(function(k){
    var p=PRICES[k]||{};
    var sh=(ps[k+'x']&&ps[k+'x'].totalUi)||0;
    var hasPrice=p.usd && p.usd>0;
    var up=(p.chg||0)>=0;
    var pxBit=hasPrice?'<span class="px">$'+p.usd.toFixed(2)+'</span> <span class="'+(up?'up':'dn')+'">'+(up?'▲':'▼')+Math.abs(p.chg||0).toFixed(2)+'%</span>':'<span class="px">'+NAMES[k]+'</span>';
    var shBit=sh>0?'<span class="sep">·</span><span class="sh">'+SH(sh,3)+' shipped</span>':'';
    return '<span class="it"><span class="ic"><img src="'+lg(k)+'" alt=""/></span><b>'+k+'</b> '+pxBit+' '+shBit+'</span>';
  });
  items=items.concat([
    '<span class="it"><b>$JOB</b> you got cooked — now get paid</span>',
    '<span class="it"><b>MCDx</b> airdropped straight to your wallet 🍟</span>',
    '<span class="it"><b>HOLD 500K+ $JOB</b> · clock in</span>'
  ]);
  document.getElementById('tape').innerHTML=(items.concat(items)).join('');
  tapeBuilt=true;
}
function fetchPrices(){
  var ids=TICKERS.map(function(t){return MINTS[t];}).join(',');
  return fetch('https://lite-api.jup.ag/tokens/v2/search?query='+ids,{cache:'no-store'}).then(function(r){return r.json();}).then(function(data){
    if(!Array.isArray(data))return;
    var byMint={};data.forEach(function(t){if(t&&t.id)byMint[t.id]=t;});
    TICKERS.forEach(function(tk){var t=byMint[MINTS[tk]]||null;
      if(t)PRICES[tk]={usd:Number(t.usdPrice)||0, chg:Number(t.stats24h&&t.stats24h.priceChange)||0};});
    buildTape();
  }).catch(function(){if(!tapeBuilt)buildTape();});
}
buildTape();          // initial render (no prices yet)
fetchPrices();        // then populate
setInterval(fetchPrices, 90000);  // refresh every 90s

tick();setInterval(tick,2500);
</script>
</body>
</html>`;
}
