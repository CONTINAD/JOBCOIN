/* ============================================================
   JOBCOIN ($JOB) — interactions
   ============================================================ */
(function () {
  "use strict";

  /* ---------- CONFIG: fill these in when you launch ---------- */
  // Paste your real contract address here when the token is live.
  const CONTRACT_ADDRESS = ""; // e.g. "7xKX...pump"
  // Paste your real links here. Empty links show a "soon" toast.
  const LINKS = {
    twitter: "",
    telegram: "",
    dexscreener: "",
    raydium: "",
  };
  const PLACEHOLDER_CA = "COMING SOON — DON'T BUY A FAKE, SER";

  // Base URL of the distribution machine (the /machine app on Railway) that
  // powers "Recent Airdrops" and "Check Your Earnings". This points at the
  // pretty subdomain; resolves once the DNS CNAME is in Porkbun.
  const MACHINE_API = "https://machine.jobcoin.tech";

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ---------- contract address wiring ---------- */
  const caDisplay = CONTRACT_ADDRESS || PLACEHOLDER_CA;
  $$("#caValue, #caValue2").forEach((el) => (el.textContent = caDisplay));

  function copyCA() {
    if (!CONTRACT_ADDRESS) {
      toast("🍟 Contract drops at launch — follow X so you don't miss it.");
      return;
    }
    const done = () => toast("✅ Contract address copied. Now clock in.");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CONTRACT_ADDRESS).then(done).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      const t = document.createElement("textarea");
      t.value = CONTRACT_ADDRESS;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Couldn't copy — long-press to select."); }
      document.body.removeChild(t);
    }
  }
  $$("#caBox, #caBox2, #caCopy, #caCopy2").forEach((el) =>
    el.addEventListener("click", (e) => { e.preventDefault(); copyCA(); fryBurst(e); })
  );

  /* ---------- external links (placeholder-aware) ---------- */
  $$("[data-link]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const key = el.getAttribute("data-link");
      const url = LINKS[key];
      if (url) {
        // real link: open in new tab
        window.open(url, "_blank", "noopener");
      } else {
        e.preventDefault();
        toast("🚧 " + key.toUpperCase() + " link drops at launch. Stay tuned, ser.");
      }
    });
  });

  /* ---------- mobile nav ---------- */
  const nav = $(".nav");
  const toggle = $("#navToggle");
  if (toggle) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
    $$("#navLinks a").forEach((a) =>
      a.addEventListener("click", () => nav.classList.remove("open"))
    );
  }

  /* ---------- scroll reveal ---------- */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            // counters / bars triggers
            if (en.target.classList.contains("metric")) runCounter(en.target);
            if (en.target.classList.contains("alloc")) en.target.classList.remove("alloc--init");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.18 }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- animated counters ---------- */
  function runCounter(metric) {
    const numEl = metric.querySelector(".metric__num");
    if (!numEl) return;
    const target = parseFloat(numEl.getAttribute("data-count"));
    if (isNaN(target)) return; // e.g. the ∞ one
    const suffix = numEl.getAttribute("data-suffix") || "";
    const dur = 1400;
    const start = performance.now();
    const fmt = (n) => Math.floor(n).toLocaleString("en-US");
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      numEl.textContent = fmt(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else numEl.textContent = fmt(target) + suffix;
    }
    requestAnimationFrame(tick);
  }

  // mark alloc for animation start
  const alloc = $(".alloc");
  if (alloc) alloc.classList.add("alloc--init");

  /* ---------- fry confetti 🍟 ---------- */
  const FOODS = ["🍟", "🍔", "🥤", "🍗", "🪙"];
  function fryBurst(e) {
    const x = (e && e.clientX) || window.innerWidth / 2;
    const y = (e && e.clientY) || window.innerHeight / 2;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.textContent = FOODS[i % FOODS.length];
      s.style.cssText =
        "position:fixed;left:" + x + "px;top:" + y + "px;font-size:" +
        (16 + Math.floor(Math.random() * 18)) +
        "px;pointer-events:none;z-index:300;will-change:transform,opacity;";
      document.body.appendChild(s);
      const ang = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 120;
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist - 80;
      const rot = (Math.random() * 720 - 360) + "deg";
      s.animate(
        [
          { transform: "translate(0,0) rotate(0)", opacity: 1 },
          { transform: "translate(" + dx + "px," + dy + "px) rotate(" + rot + ")", opacity: 0 },
        ],
        { duration: 900 + Math.random() * 500, easing: "cubic-bezier(.2,.7,.3,1)" }
      ).onfinish = () => s.remove();
    }
  }
  // confetti on every primary buy button
  $$(".btn--buy").forEach((b) =>
    b.addEventListener("click", (e) => fryBurst(e))
  );

  /* ---------- konami-lite: type "job" for a surprise ---------- */
  let buf = "";
  window.addEventListener("keydown", (e) => {
    if (!/^[a-z]$/i.test(e.key)) return;
    buf = (buf + e.key.toLowerCase()).slice(-3);
    if (buf === "job") {
      toast("🧑‍🍳 Welcome to the crew. Your shift starts now.");
      fryBurst({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 3 });
    }
  });

  /* ============================================================
     LIVE FROM THE MACHINE — Recent Airdrops + Check Your Earnings
     ============================================================ */
  const MCD_LOGO =
    "https://xstocks-metadata.backed.fi/logos/tokens/MCDx.png";
  const api = (p) => (MACHINE_API || "").replace(/\/$/, "") + p;
  const shortAddr = (a) => (a ? a.slice(0, 4) + "…" + a.slice(-4) : "—");
  const ago = (ts) => {
    if (!ts) return "—";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  };
  const num = (n, d = 4) =>
    (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  const solscanTx = (s) => "https://solscan.io/tx/" + s;
  const solscanAcc = (a) => "https://solscan.io/account/" + a;

  const notLiveMsg =
    "The machine goes live at launch — your MCDx airdrops show up here automatically. 🍟";

  /* ---------- Recent Airdrops ---------- */
  function renderAirdrops(state) {
    const grid = $("#airdropGrid");
    const stats = $("#airdropStats");
    if (!grid) return;
    const winners = (state.recentWinners || []).slice(0, 12);
    const t = state.totals || {};
    const cur = state.current || {};
    // live metrics banner: total fees claimed + unique "broke" wallets paid
    const mFees = $("#mFees");
    const mBroke = $("#mBroke");
    if (mFees) mFees.textContent = num(t.solClaimed, 2);
    if (mBroke) mBroke.textContent = (state.uniqueRecipients || 0).toLocaleString();
    if (stats) {
      stats.innerHTML =
        statCell(num(t.solSpentOnStock, 2) + "◎", "SOL of MCDx shipped") +
        statCell((t.recipientsPaid || 0).toLocaleString(), "Holder payouts") +
        statCell((t.dispenseCount || 0).toLocaleString(), "Airdrop cycles") +
        statCell((cur.qualifiedCount || 0).toLocaleString(), "Qualified holders");
    }
    if (!winners.length) {
      grid.innerHTML =
        '<div class="airdrop-empty">No airdrops yet — the first MCDx drop fires once fees are claimed and holders qualify. 🍟</div>';
      return;
    }
    grid.innerHTML = winners
      .map(function (w) {
        const link = w.signature
          ? '<a href="' + solscanTx(w.signature) + '" target="_blank" rel="noopener">receipt ▸</a>'
          : "<span>pending</span>";
        return (
          '<div class="airdrop-card">' +
          '<div class="top"><span class="tkw"><img src="' + MCD_LOGO + '" alt="MCDx"/><b>$MCD</b></span>' +
          '<span class="when">' + ago(w.ts) + "</span></div>" +
          '<div class="amt">' + num(w.amountUi, 4) + ' <small>MCDx</small></div>' +
          '<div class="row"><a href="' + solscanAcc(w.owner) + '" target="_blank" rel="noopener">' + shortAddr(w.owner) + "</a>" + link + "</div>" +
          "</div>"
        );
      })
      .join("");
  }
  function statCell(v, k) {
    return '<div class="airdrop-stat"><span class="v">' + v + '</span><span class="k">' + k + "</span></div>";
  }

  let airdropTimer = null;
  function loadAirdrops() {
    const grid = $("#airdropGrid");
    if (!grid) return;
    if (!MACHINE_API) {
      grid.innerHTML = '<div class="airdrop-empty">' + notLiveMsg + "</div>";
      return;
    }
    fetch(api("/api/state"), { cache: "no-store" })
      .then((r) => r.json())
      .then(renderAirdrops)
      .catch(function () {
        grid.innerHTML =
          '<div class="airdrop-empty">Couldn\'t reach the machine right now — try again in a moment.</div>';
      });
  }

  /* ---------- Check Your Earnings ---------- */
  function renderEarnings(addr, d) {
    const box = $("#earnResult");
    if (!box) return;
    box.classList.add("show");
    if (d.error) {
      box.innerHTML = '<div class="earn-empty">' + d.error + "</div>";
      return;
    }
    const min = Number(d.minHolderBalance || 500000).toLocaleString();
    const qualified = d.holding
      ? d.holding.qualified
        ? '<span class="earn-badge">✓ Qualified</span>'
        : '<span class="earn-badge no">Below ' + min + " $JOB</span>"
      : '<span class="earn-badge no">Not in holder snapshot</span>';
    const holdLine = d.holding
      ? "holds " + Math.round(d.holding.uiBalance).toLocaleString() + " $JOB"
      : "holding unknown";
    const head =
      '<div class="earn-head"><div>' +
      '<div class="earn-addr">' + shortAddr(addr) + "</div>" +
      '<div class="earn-total">' + num(d.totalSol, 4) + ' <small>SOL of MCDx · ' + (d.count || 0) + " airdrops</small></div></div>" +
      '<div style="text-align:right">' + qualified + '<div class="earn-sub">' + holdLine + "</div></div></div>";
    let body;
    if (d.byStock && d.byStock.length) {
      body =
        '<div class="earn-cells">' +
        d.byStock
          .map(function (b) {
            return (
              '<div class="earn-cell"><img src="' + MCD_LOGO + '" alt="MCDx"/>' +
              '<div><div class="tk">$' + (b.ticker || "MCD") + '</div>' +
              '<div class="sh">' + num(b.shares, 4) + '</div>' +
              '<div class="sl">≈ ' + num(b.sol, 4) + " SOL · " + b.count + "×</div></div></div>"
            );
          })
          .join("") +
        "</div>";
    } else {
      body =
        '<div class="earn-empty">No MCDx paid to this wallet yet' +
        (d.holding && !d.holding.qualified
          ? " — top up to " + min + "+ $JOB to start earning."
          : ".") +
        "</div>";
    }
    box.innerHTML = head + body;
  }

  function checkEarnings(addr) {
    addr = (addr || "").trim();
    const box = $("#earnResult");
    if (!box) return;
    if (addr.length < 32 || addr.length > 44) {
      box.classList.add("show");
      box.innerHTML = '<div class="earn-empty">That doesn\'t look like a Solana wallet address.</div>';
      return;
    }
    if (!MACHINE_API) {
      box.classList.add("show");
      box.innerHTML = '<div class="earn-empty">' + notLiveMsg + "</div>";
      return;
    }
    box.classList.add("show");
    box.innerHTML = '<div class="earn-empty">Looking up ' + shortAddr(addr) + "…</div>";
    fetch(api("/api/holder/" + addr), { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => renderEarnings(addr, d))
      .catch(function () {
        box.innerHTML = '<div class="earn-empty">Lookup failed — try again in a moment.</div>';
      });
  }

  const earnBtn = $("#earnBtn");
  const earnAddr = $("#earnAddr");
  if (earnBtn && earnAddr) {
    earnBtn.addEventListener("click", (e) => { checkEarnings(earnAddr.value); fryBurst(e); });
    earnAddr.addEventListener("keydown", (e) => { if (e.key === "Enter") checkEarnings(earnAddr.value); });
  }

  // kick off airdrops feed (and refresh every 20s while the page is open)
  loadAirdrops();
  if (MACHINE_API) airdropTimer = setInterval(loadAirdrops, 20000);

  /* ---------- footer year ---------- */
  // (kept static 2026 in markup; nothing to do)
})();
