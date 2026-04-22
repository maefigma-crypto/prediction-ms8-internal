// ScoreOcs8 — /slip/?fixture_id=X virtual bet slip page.
//
// Designed to be screenshotted by the FT checker cron and posted to
// Telegram/X when a featured match finishes. Visual style mimics a
// Malaysian bookmaker bet slip (RM currency, stake + payout, ticket ID)
// but uses FAKE money — this is DEMONSTRATIVE content, not a betting tip.
//
// Status rendering:
//   before FT     → grey "Running"
//   FT + correct  → green "Won RM{payout}"
//   FT + wrong    → red "Lost"
//
// Portrait 1080×1350 aspect (4:5) — the "square-ish tall" format that
// works across Telegram, IG feed, X, Threads without cropping.

const LEAGUE_EMOJI = {
  39: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 2: '⭐', 1: '🏆', 278: '🇲🇾',
  140: '🇪🇸', 78: '🇩🇪', 135: '🇮🇹', 61: '🇫🇷',
};

const LEAGUE_SHORT = {
  39: 'PREMIER LEAGUE', 2: 'UEFA CHAMPIONS LEAGUE',
  1: 'FIFA WORLD CUP', 278: 'MALAYSIA SUPER LEAGUE',
  140: 'LA LIGA', 78: 'BUNDESLIGA',
  135: 'SERIE A', 61: 'LIGUE 1',
};

function esc(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]));
}

// Deterministic-looking ticket id from fixture id so the same match always
// renders the same ticket string. Obviously not cryptographic.
function ticketId(fxId) {
  const seed = String(fxId || 0);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += alpha[h % alpha.length];
    h = (h * 16777619) >>> 0;
  }
  return `${out.slice(0, 2)}-${out.slice(2)}`;
}

// Map AI pick shape to a human-readable market label + implied odds.
// Odds are MOCK — to be replaced with real bookmaker feed later. We derive
// a plausible-looking number from confidence so high-confidence picks show
// lower odds (what real bookies do).
function pickToMarket(pick, homeName, awayName) {
  if (!pick) {
    return {
      marketLabel: 'FT.1X2',
      selection: '—',
      odds: '—',
      status: 'pending',
    };
  }
  const conf = pick.confidence || 50;
  // odds ≈ 1 + (1 - confidence/100) × 2.5  → 78% → 1.55, 50% → 2.25, 85% → 1.37
  const odds = +(1 + (1 - conf / 100) * 2.5).toFixed(2);

  let marketLabel = 'FT.1X2';
  let selection = pick.pickLabel || pick.pick || '—';
  if (pick.pick === 'HOME') selection = homeName;
  else if (pick.pick === 'AWAY') selection = awayName;
  else if (pick.pick === 'DRAW') selection = 'Draw';

  return { marketLabel, selection, odds, status: 'running' };
}

function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const time = d.toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    return `${date} ${time}`;
  } catch { return '—'; }
}

// Parse optional overrides from query string:
//   status  = running | won | lost
//   stake   = integer RM (default 100)
async function loadFixture(env, fixtureId, dateOverride) {
  // First try content cache so we have league info etc. even if the fixture
  // isn't in today's daily set.
  const mytDate = dateOverride || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const keys = [`content:${mytDate}`, `content:${new Date().toISOString().slice(0, 10)}`];
  for (const k of keys) {
    const c = await env.CACHE.get(k, 'json');
    if (!c) continue;
    if (c.top?.fixture?.fixture?.id === fixtureId) return c.top.fixture;
    if (Array.isArray(c.previews)) {
      for (const p of c.previews) {
        if (p.fixture?.fixture?.id === fixtureId) return p.fixture;
      }
    }
  }
  return null;
}

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const fixtureId = parseInt(url.searchParams.get('fixture_id') || '0', 10);
  const statusOverride = url.searchParams.get('status');           // won | lost | running
  const stake = parseInt(url.searchParams.get('stake') || '100', 10);
  const debug = url.searchParams.get('debug') === '1';

  if (!fixtureId) {
    return new Response('fixture_id required', { status: 400 });
  }

  const fx = await loadFixture(env, fixtureId);
  const pick = await env.CACHE.get(`prediction:${fixtureId}`, 'json').catch(() => null);

  const home = fx?.teams?.home?.name || 'Home';
  const away = fx?.teams?.away?.name || 'Away';
  const leagueId = fx?.league?.id;
  const market = pickToMarket(pick, home, away);
  const kickoff = fmtDateTime(fx?.fixture?.date);

  // Final status & payout
  let status = statusOverride || market.status;   // running | won | lost | pending
  let payout = +(stake * Number(market.odds || 0)).toFixed(2);
  if (!Number.isFinite(payout) || payout < 0) payout = 0;

  // Score (only if FT data present)
  const homeScore = fx?.goals?.home ?? null;
  const awayScore = fx?.goals?.away ?? null;
  const hasScore = homeScore !== null && awayScore !== null;

  const html = renderHtml({
    fixtureId,
    leagueId,
    home,
    away,
    homeLogo: fx?.teams?.home?.logo,
    awayLogo: fx?.teams?.away?.logo,
    kickoff,
    market,
    status,
    stake,
    payout,
    homeScore,
    awayScore,
    hasScore,
    ticket: ticketId(fixtureId),
    debug,
  });

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function statusBadge(status) {
  if (status === 'won') return { text: 'WON', className: 'b-won' };
  if (status === 'lost') return { text: 'LOST', className: 'b-lost' };
  if (status === 'running') return { text: 'RUNNING', className: 'b-run' };
  return { text: 'PENDING', className: 'b-pend' };
}

function renderHtml(d) {
  const flag = LEAGUE_EMOJI[d.leagueId] || '⚽';
  const leagueName = LEAGUE_SHORT[d.leagueId] || 'FOOTBALL';
  const badge = statusBadge(d.status);
  const scoreLine = d.hasScore
    ? `<div class="score">FT  ${esc(d.homeScore)} — ${esc(d.awayScore)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ScoreOcs8 Virtual Bet Slip</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --accent:#F97316;--accent2:#EA580C;
  --bg:#080B10;--card:#131821;--card2:#0C1119;
  --border:rgba(255,255,255,0.08);--border2:rgba(255,255,255,0.14);
  --text:#F1F5F9;--text2:#CBD5E1;--text3:#94A3B8;
  --green:#00E5A0;--red:#FF4757;--amber:#FFB020;
  --ff:'Oswald',system-ui,sans-serif;
  --fm:'Rajdhani',sans-serif;
  --fb:'Inter',sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:1080px;height:1350px;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--fb);-webkit-font-smoothing:antialiased;}
body::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(circle at 15% 15%,rgba(249,115,22,0.12) 0%,transparent 45%),
    radial-gradient(circle at 85% 85%,rgba(0,229,160,0.06) 0%,transparent 45%);
}
.wrap{position:relative;z-index:1;padding:60px;display:flex;flex-direction:column;gap:22px;height:100%;}

/* Brand bar */
.brand{display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:1px solid var(--border);}
.logo{height:60px;width:auto;display:block;}
.disclaimer{font-family:var(--fm);font-size:16px;font-weight:600;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;}

/* Slip tabs (cosmetic) */
.tabs{display:flex;}
.tab{flex:1;text-align:center;font-family:var(--ff);font-size:28px;font-weight:700;padding:22px 0;color:var(--text3);letter-spacing:.04em;}
.tab.active{color:var(--text);border-bottom:3px solid var(--accent);}

/* Slip card */
.slip{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;flex:1;display:flex;flex-direction:column;}
.slip-head{display:flex;justify-content:space-between;align-items:center;padding:26px 36px;background:var(--card2);border-bottom:1px solid var(--border);}
.slip-title{display:flex;align-items:center;gap:14px;font-family:var(--ff);font-size:34px;font-weight:700;color:var(--text);}
.slip-title .i{width:32px;height:32px;border-radius:50%;border:2px solid var(--accent);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--fm);font-size:18px;font-weight:700;}
.slip-title .sn{color:var(--accent);margin-right:6px;}
.slip-title .sl{color:var(--text);}
.badge{font-family:var(--ff);font-size:22px;font-weight:700;letter-spacing:.06em;padding:8px 20px;border-radius:4px;}
.b-run{background:rgba(249,115,22,.12);color:var(--accent);border:1px solid rgba(249,115,22,.3);}
.b-won{background:rgba(0,229,160,.14);color:var(--green);border:1px solid rgba(0,229,160,.34);}
.b-lost{background:rgba(255,71,87,.14);color:var(--red);border:1px solid rgba(255,71,87,.34);}
.b-pend{background:rgba(148,163,184,.1);color:var(--text3);border:1px solid rgba(148,163,184,.25);}

/* Body */
.sb{padding:40px 36px;display:flex;flex-direction:column;gap:16px;flex:1;}
.row{display:flex;justify-content:space-between;align-items:flex-start;}
.sel{font-family:var(--ff);font-size:44px;font-weight:700;color:var(--text);letter-spacing:.02em;line-height:1.1;max-width:75%;}
.odds{font-family:var(--ff);font-size:44px;font-weight:700;color:var(--accent);}
.market{font-family:var(--fm);font-size:22px;font-weight:600;color:var(--text3);letter-spacing:.04em;}
.sport{font-family:var(--fm);font-size:22px;font-weight:600;color:var(--text2);letter-spacing:.03em;}
.sport .lg{color:var(--accent);}
.match-box{background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.24);border-radius:6px;padding:18px 24px;font-family:var(--ff);font-size:32px;font-weight:700;color:var(--accent);letter-spacing:.02em;margin-top:6px;}
.kickoff{font-family:var(--fm);font-size:22px;font-weight:500;color:var(--text2);}
.kickoff .k{color:var(--text3);}
.ticket{font-family:monospace;font-size:18px;color:var(--text3);letter-spacing:.04em;}
.score{font-family:var(--ff);font-size:46px;font-weight:700;color:var(--text);margin:18px 0 4px;letter-spacing:.04em;text-align:center;padding:16px;background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.26);border-radius:8px;}

/* Stake / payout footer */
.sf{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border);padding:30px 36px 30px;}
.sfc{}
.sfl{font-family:var(--fm);font-size:22px;font-weight:600;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;}
.sfv{font-family:var(--ff);font-size:52px;font-weight:700;color:var(--text);margin-top:4px;letter-spacing:.02em;}
.sfv.pay{color:var(--green);}
.sfv.pay-lost{color:var(--red);text-decoration:line-through;}
.sfv.pay-run{color:var(--amber);}

/* CTA */
.cta{text-align:center;padding:14px 0 0;border-top:1px solid var(--border);}
.cta-t{font-family:var(--fm);font-size:22px;font-weight:600;color:var(--text2);letter-spacing:.04em;}
.cta-l{font-family:var(--ff);font-size:30px;font-weight:700;color:var(--accent);letter-spacing:.05em;margin-top:2px;}
.cta-d{font-family:var(--fm);font-size:16px;color:var(--text3);margin-top:8px;letter-spacing:.04em;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <img class="logo" src="https://scoreocs8.pages.dev/logo.png" alt="ScoreOcs8">
      <div class="disclaimer">Virtual · For Demonstration</div>
    </div>

    <div class="tabs">
      <div class="tab">Bet Slip</div>
      <div class="tab active">My Bets</div>
    </div>

    <div class="slip">
      <div class="slip-head">
        <div class="slip-title">
          <span class="i">i</span>
          <span class="sn">RM ${esc(d.stake)}</span>
          <span class="sl">Single</span>
        </div>
        <div class="badge ${badge.className}">${badge.text}</div>
      </div>

      <div class="sb">
        <div class="row">
          <div class="sel">${esc(d.market.selection)}</div>
          <div class="odds">${esc(d.market.odds)}</div>
        </div>
        <div class="market">${esc(d.market.marketLabel)}</div>
        <div class="sport">Soccer · <span class="lg">${flag} ${esc(leagueName)}</span></div>
        <div class="match-box">${esc(d.home)} vs ${esc(d.away)}</div>
        <div class="kickoff"><span class="k">Event Time:</span> ${esc(d.kickoff)}</div>
        ${scoreLine}
        <div class="ticket">${esc(d.ticket)}</div>
      </div>

      <div class="sf">
        <div class="sfc">
          <div class="sfl">Stake</div>
          <div class="sfv">${esc(d.stake)}</div>
        </div>
        <div class="sfc">
          <div class="sfl">Payout</div>
          <div class="sfv pay${d.status === 'lost' ? ' pay-lost' : (d.status === 'running' ? ' pay-run' : '')}">${esc(d.payout.toFixed(2))}</div>
        </div>
      </div>
    </div>

    <div class="cta">
      <div class="cta-t">More predictions & analysis · 更多预测分析</div>
      <div class="cta-l">scoreocs8.pages.dev</div>
      <div class="cta-d">⚠ Virtual currency · No real betting · 18+</div>
    </div>
  </div>
</body>
</html>`;
}
