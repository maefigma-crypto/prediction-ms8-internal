// GET /wc-upcoming/  — screenshot-ready "Upcoming Matches" digest card.
//
// Renders a 1080x1350 portrait card listing the NEXT day's upcoming World Cup
// fixtures (group, flags, teams, kickoff in MYT) in the MatchDay style. The
// cron screenshots this and posts it once a day's matches have all finished.
//
// Query params:
//   date   YYYY-MM-DD (MYT) to feature. Default: the MYT date of the next
//          upcoming (not-yet-kicked-off) match.
//   n      max matches to show (default 6).
//
// Pure server-rendered HTML + inline CSS, no client JS, for a clean shot.

const SITE = 'https://scoreocs8.com';

function esc(s) {
  return String(s ?? '').replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]));
}

function mytDateKey(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); }
  catch { return ''; }
}

function fmtHeaderDate(ymd) {
  try {
    return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long',
    });
  } catch { return ymd; }
}

function fmtWhen(iso) {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: true });
    return `${day} · ${time}`;
  } catch { return ''; }
}

async function getJSON(url) {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 60 } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const wantDate = url.searchParams.get('date') || '';
  const maxN = Math.max(1, Math.min(6, parseInt(url.searchParams.get('n') || '6', 10) || 6));

  const [sched, standings] = await Promise.all([
    getJSON(`${SITE}/api/wc-schedule`),
    getJSON(`${SITE}/api/standings?league=1&season=2026`),
  ]);
  const matches = sched?.matches || [];
  const groups = standings?.response?.[0]?.league?.standings || [];

  // team -> group letter, so we can label each match even when the schedule's
  // own group join is briefly empty.
  const teamGroup = {};
  for (const g of groups) {
    for (const row of g) {
      if (row?.team?.id) teamGroup[row.team.id] = (row.group || '').replace(/^Group\s*/i, '').toUpperCase();
    }
  }
  const groupOf = m =>
    (m.group || '').replace(/^Group\s*/i, '').toUpperCase()
    || teamGroup[m.home?.id] || teamGroup[m.away?.id] || '';

  const now = Date.now();
  // Upcoming = not finished AND kickoff still ahead (small grace so a match
  // that just kicked off doesn't vanish mid-render).
  const upcoming = matches
    .filter(m => !FINISHED.has(m.status) && new Date(m.date).getTime() > now - 15 * 60 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  // Target day = explicit param, else the MYT date of the next upcoming match.
  const dayKey = wantDate || (upcoming.length ? mytDateKey(upcoming[0].date) : '');
  const dayMatches = upcoming.filter(m => mytDateKey(m.date) === dayKey).slice(0, maxN);

  const flagTile = (u, name) => u
    ? `<img src="${esc(u)}" alt="">`
    : `<span class="ph">${esc((name || '?').slice(0, 1))}</span>`;

  const rows = dayMatches.map(m => {
    const g = groupOf(m);
    return `<div class="m">
      ${g ? `<div class="grp">Group ${esc(g)}</div>` : ''}
      <div class="row">
        <div class="flag">${flagTile(m.home?.logo, m.home?.name)}</div>
        <div class="mid">
          <div class="teams"><span>${esc(m.home?.name || 'TBD')}</span><em>vs</em><span>${esc(m.away?.name || 'TBD')}</span></div>
          <div class="when">🗓️ ${esc(fmtWhen(m.date))} <b>MYT</b></div>
        </div>
        <div class="flag">${flagTile(m.away?.logo, m.away?.name)}</div>
      </div>
    </div>`;
  }).join('') || `<div class="empty">Next fixtures coming up — full schedule on scoreocs8.com</div>`;

  const headerDate = dayKey ? fmtHeaderDate(dayKey) : 'Next Matches';

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=1080, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>WC Upcoming · ${esc(headerDate)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Outfit:wght@400;500;600;700;800&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{width:1080px;height:1350px;}
  body{font-family:'Outfit',sans-serif;color:#eef3fb;background:#05070f;overflow:hidden;position:relative;}
  .bg{position:absolute;inset:0;background:
      radial-gradient(120% 60% at 50% -8%, rgba(60,143,255,.32), transparent 60%),
      radial-gradient(90% 50% at 12% 4%, rgba(0,229,160,.10), transparent 55%),
      radial-gradient(90% 50% at 88% 4%, rgba(249,115,22,.12), transparent 55%),
      linear-gradient(180deg,#0a1430 0%,#070b1c 46%,#05070f 100%);}
  .bg::before{content:'';position:absolute;inset:0;
      background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
      background-size:54px 54px;mask-image:linear-gradient(180deg,rgba(0,0,0,.9),transparent 45%);}
  .lights{position:absolute;top:0;left:0;right:0;height:120px;display:flex;justify-content:space-around;align-items:flex-start;opacity:.55;}
  .lights i{width:6px;height:64px;background:linear-gradient(180deg,#cfe4ff,transparent);filter:blur(3px);transform:rotate(8deg);}
  .lights i:nth-child(even){transform:rotate(-8deg);height:80px;}
  .wrap{position:relative;padding:52px 56px;height:100%;display:flex;flex-direction:column;}
  .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
  .brand{display:flex;align-items:center;gap:14px;font-family:'Rajdhani';font-weight:700;font-size:30px;letter-spacing:.04em;}
  .brand .o{color:#fff;}.brand .x{color:#7d8aa6;font-size:22px;}
  .brand .s{color:#fff;}.brand .s b{color:#f97316;}
  .datepill{font-family:'DM Mono';font-size:18px;color:#cfe0ff;background:rgba(61,143,255,.16);border:1px solid rgba(61,143,255,.4);padding:8px 18px;border-radius:999px;}
  .title{text-align:center;margin:6px 0 22px;}
  .title .t1{font-family:'Rajdhani';font-weight:700;font-size:62px;line-height:.96;letter-spacing:.02em;}
  .title .t2{font-family:'Outfit';font-weight:700;font-size:32px;color:#3d8fff;margin-top:4px;letter-spacing:.08em;text-transform:uppercase;}
  .matches{flex:1 1 auto;display:flex;flex-direction:column;gap:18px;min-height:0;justify-content:center;}
  .m{flex:1 1 0;display:flex;flex-direction:column;justify-content:center;gap:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:18px 26px;backdrop-filter:blur(6px);}
  .grp{align-self:center;font-family:'Rajdhani';font-weight:700;font-size:20px;letter-spacing:.16em;color:#9fb6dd;text-transform:uppercase;background:rgba(61,143,255,.14);border:1px solid rgba(61,143,255,.3);padding:3px 18px;border-radius:999px;}
  .row{display:grid;grid-template-columns:96px 1fr 96px;align-items:center;gap:18px;}
  .flag{display:flex;align-items:center;justify-content:center;}
  .flag img{width:92px;height:92px;border-radius:16px;object-fit:cover;background:rgba(255,255,255,.08);box-shadow:0 4px 14px rgba(0,0,0,.4);}
  .ph{width:92px;height:92px;border-radius:16px;background:rgba(255,255,255,.10);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:38px;}
  .mid{text-align:center;min-width:0;}
  .teams{display:flex;align-items:center;justify-content:center;gap:14px;font-family:'Rajdhani';font-weight:700;font-size:36px;line-height:1.05;flex-wrap:wrap;}
  .teams span{white-space:nowrap;}
  .teams em{font-style:normal;font-size:22px;color:#7d8aa6;font-weight:600;}
  .when{font-family:'DM Mono';font-size:18px;color:#aebfd9;margin-top:10px;letter-spacing:.02em;}
  .when b{color:#00e5a0;font-weight:500;}
  .empty{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:#8a9ab5;font-size:24px;}
  .foot{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:22px;font-family:'Rajdhani';font-weight:700;font-size:22px;letter-spacing:.04em;color:#cfe0ff;}
  .foot .dot{width:6px;height:6px;border-radius:50%;background:#f97316;}
  .foot b{color:#f97316;}
  .foot .tag{color:#8a9ab5;font-weight:600;font-size:18px;font-family:'Outfit';}
</style></head>
<body>
  <div class="bg"></div>
  <div class="lights"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="wrap">
    <div class="head">
      <div class="brand"><span class="o">OCS8</span><span class="x">✕</span><span class="s">Score<b>OCS8</b></span></div>
      <div class="datepill">${esc(headerDate)}</div>
    </div>
    <div class="title">
      <div class="t1">2026 WORLD CUP</div>
      <div class="t2">Upcoming Matches</div>
    </div>
    <div class="matches">${rows}</div>
    <div class="foot"><span style="color:#fff;font-family:'Rajdhani';">OCS8</span> ✕ <span style="color:#fff;">Score<b>OCS8</b></span><span class="dot"></span><span class="tag">All times MYT 🇲🇾 · scoreocs8.com</span></div>
  </div>
</body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=120',
      'x-robots-tag': 'noindex',
    },
  });
}
