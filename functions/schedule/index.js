// GET /schedule — public, SEO-indexable, bilingual (EN/简中) sports calendar,
// Jul 2026 → Apr 2027, covering Dota 2 / football / badminton.
//
// - Source of truth: /schedule-2026-27.json (static asset — the single edit
//   point; no dates live in this component).
// - Served on all three hosts: scoreocs8.com/schedule (all sports, filter
//   tabs), dota2.scoreocs8.com/schedule and badminton.scoreocs8.com/schedule
//   (pre-filtered by hostname, tabs hidden).
// - Status (completed/live/upcoming) is computed per-request from today's
//   date in Asia/Kuala_Lumpur — never hardcoded. The Workers cron can reuse
//   the same date-window logic to trigger AI content when an event goes live.
// - CONTENT PIPELINE NOTE: BWF switches to the new 3x15 scoring system from
//   4 Jan 2027 — this changes set-score prediction copy (21-point language
//   must go) and is a strong explainer-article topic before Malaysia Open.

function esc(s) {
  return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

const SPORT_META = {
  football: { icon: '⚽', pred: 'https://scoreocs8.com/predictions/' },
  dota2: { icon: '🎮', pred: 'https://dota2.scoreocs8.com/' },
  badminton: { icon: '🏸', pred: 'https://badminton.scoreocs8.com/' },
};

function todayKL() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// ISO date-string comparison — safe because YYYY-MM-DD sorts lexicographically.
function statusOf(ev, today) {
  const end = ev.date_end || ev.date_start;
  if (today > end) return 'completed';
  if (today >= ev.date_start) return 'live';
  return 'upcoming';
}

function daysUntil(iso, today) {
  const a = Date.parse(iso + 'T00:00:00+08:00');
  const b = Date.parse(today + 'T00:00:00+08:00');
  return Math.max(0, Math.round((a - b) / 86400000));
}

function fmtRange(ev, lang) {
  const opt = { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' };
  const loc = lang === 'zh' ? 'zh-CN' : 'en-MY';
  const s = new Date(ev.date_start + 'T12:00:00+08:00').toLocaleDateString(loc, opt);
  if (!ev.date_end || ev.date_end === ev.date_start) return s;
  const e = new Date(ev.date_end + 'T12:00:00+08:00').toLocaleDateString(loc, { ...opt, year: 'numeric' });
  return `${s} – ${e}`;
}

function monthKey(iso) { return iso.slice(0, 7); }
function monthLabel(key, lang) {
  const d = new Date(key + '-15T12:00:00+08:00');
  return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';

  // Host pre-filter (subdomains) or ?sport= tab (main site).
  const hostSport = host.startsWith('dota2.') ? 'dota2' : host.startsWith('badminton.') ? 'badminton' : null;
  const qSport = url.searchParams.get('sport');
  const sport = hostSport || (['football', 'dota2', 'badminton'].includes(qSport) ? qSport : 'all');

  const dataRes = await env.ASSETS.fetch(new URL('/schedule-2026-27.json', `https://${host}`)).catch(() => null);
  const data = dataRes && dataRes.ok ? await dataRes.json().catch(() => null) : null;
  if (!data) return new Response('Schedule data unavailable', { status: 503 });

  const S = data.meta?.i18n?.[lang] || data.meta?.i18n?.en || {};
  const tg = data.meta?.telegram || 'https://t.me/livebad';
  const today = todayKL();
  const nm = (o) => lang === 'zh' ? (o.name_zh || o.name_en) : o.name_en;
  const nt = (o) => lang === 'zh' ? (o.notes_zh || o.notes_en) : o.notes_en;

  const visible = ev => sport === 'all' || ev.sport === sport;
  const events = (data.events || []).filter(e => e.kind === 'event' && visible(e))
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  const seasons = (data.events || []).filter(e => e.kind === 'season' && visible(e))
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  const tba = (data.tba || []).filter(visible);

  // Countdown chip: next highlight:true upcoming event per sport (fixed-width
  // chip, server-rendered day count — zero CLS, no client timers needed).
  const nextHighlight = {};
  for (const ev of events) {
    if (ev.highlight && statusOf(ev, today) === 'upcoming' && !nextHighlight[ev.sport]) nextHighlight[ev.sport] = ev.id;
  }

  // Active marketing banners (ops toggles `enabled` in the JSON).
  const banners = (data.banners || []).filter(b => b.enabled && today >= b.window_start && today <= b.window_end);

  // Month groups
  const byMonth = new Map();
  for (const ev of events) {
    const k = monthKey(ev.date_start);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(ev);
  }

  const seasonRow = ev => {
    const st = statusOf(ev, today);
    return `<div class="ss-item" id="${esc(ev.id)}">
      <span class="ss-dot ${st === 'live' ? 'on' : ''}" title="${st === 'live' ? esc(S.in_season) : ''}"></span>
      <span class="ss-name">${SPORT_META[ev.sport]?.icon || ''} ${esc(nm(ev))}</span>
      <span class="ss-range">${esc(fmtRange(ev, lang))}</span>
    </div>`;
  };

  const evRow = ev => {
    const st = statusOf(ev, today);
    const m = SPORT_META[ev.sport] || {};
    const chip = nextHighlight[ev.sport] === ev.id
      ? `<span class="chip cd">${esc(S.starts_in)} ${daysUntil(ev.date_start, today)}${esc(S.days_to_go)}</span>`
      : st === 'live' ? `<span class="chip live">● ${esc(S.live_now)}</span>`
      : st === 'completed' ? `<span class="chip done">${esc(S.completed)}</span>` : '';
    const place = [ev.city, ev.country].filter(Boolean).join(', ');
    return `<details class="ev ${st}" id="${esc(ev.id)}">
      <summary>
        <span class="ev-ico">${m.icon || ''}</span>
        <span class="ev-main"><b>${esc(nm(ev))}</b><small>${esc(fmtRange(ev, lang))}${place ? ' · ' + esc(place) : ''}</small></span>
        <span class="ev-right"><span class="tier">${esc(ev.tier || '')}</span>${chip}</span>
      </summary>
      <div class="ev-body">
        <div class="ev-grid">
          <div><span>${esc(S.dates)}</span><b>${esc(fmtRange(ev, lang))}</b></div>
          ${ev.venue ? `<div><span>${esc(S.venue)}</span><b>${esc(ev.venue)}</b></div>` : ''}
        </div>
        ${nt(ev) ? `<p class="ev-notes">${esc(nt(ev))}</p>` : ''}
        <div class="ev-cta">
          <a class="btn solid" href="${esc(m.pred || '/')}">${esc(S.predictions_cta)} →</a>
          <a class="btn" href="${esc(tg)}" target="_blank" rel="noopener">📲 ${esc(S.telegram_cta)}</a>
        </div>
      </div>
    </details>`;
  };

  const tabs = hostSport ? '' : `<div class="tabs">
    ${[['all', S.all], ['football', '⚽'], ['dota2', '🎮'], ['badminton', '🏸']].map(([k, label]) =>
      `<a class="tab ${sport === k ? 'act' : ''}" href="/schedule?sport=${k}${lang === 'zh' ? '&lang=zh' : ''}">${esc(label)}</a>`).join('')}
  </div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': events.map(ev => ({
      '@type': 'SportsEvent',
      '@id': `${url.origin}/schedule#${ev.id}`,
      name: ev.name_en,
      startDate: ev.date_start,
      ...(ev.date_end ? { endDate: ev.date_end } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: [ev.venue, ev.city, ev.country].filter(Boolean).join(', ') || ev.country || 'TBA' },
    })),
  };

  const langUrl = l => `${url.origin}/schedule${sport !== 'all' && !hostSport ? `?sport=${sport}` : ''}${l === 'zh' ? (sport !== 'all' && !hostSport ? '&' : '?') + 'lang=zh' : ''}`;

  const html = `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en-MY'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(S.title)}</title>
<meta name="description" content="${esc(S.desc)}">
<link rel="canonical" href="${esc(langUrl(lang))}">
<link rel="alternate" hreflang="en" href="${esc(langUrl('en'))}">
<link rel="alternate" hreflang="zh" href="${esc(langUrl('zh'))}">
<link rel="alternate" hreflang="x-default" href="${esc(langUrl('en'))}">
<link rel="icon" href="/logo.png">
<meta property="og:title" content="${esc(S.title)}">
<meta property="og:description" content="${esc(S.desc)}">
<meta property="og:url" content="${esc(langUrl(lang))}">
<meta property="og:type" content="website">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#080b10;--card:#0f1620;--card2:#141e2a;--border:rgba(255,255,255,.08);--accent:#f97316;--gold:#e8b64a;--em:#00e5a0;--red:#ff4757;--text:#e8edf5;--text2:#8a9ab5;--text3:#4a5a72;--ff:'Rajdhani',sans-serif;--fb:'Outfit',sans-serif;--fm:'DM Mono',monospace;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:var(--fb);font-size:15px;line-height:1.6;}
body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(ellipse 900px 600px at 50% -8%,rgba(249,115,22,.10),transparent 60%),linear-gradient(180deg,#0a0e1c,#080b10 60%);}
nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;height:60px;background:rgba(8,11,16,.95);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);}
nav .logo{font-family:var(--ff);font-size:21px;font-weight:700;color:var(--text);text-decoration:none;}nav .logo b{color:var(--accent);}
.lang a{font-family:var(--fm);font-size:12px;color:var(--text2);text-decoration:none;padding:5px 10px;border:1px solid var(--border);border-radius:6px;margin-left:6px;}
.lang a.act{color:var(--accent);border-color:rgba(249,115,22,.45);}
.wrap{max-width:880px;margin:0 auto;padding:34px 1.1rem 70px;}
h1{font-family:var(--ff);font-size:clamp(34px,5vw,48px);font-weight:700;text-transform:uppercase;letter-spacing:.02em;}
.sub{color:var(--text2);font-size:14px;margin:4px 0 18px;}
.banner{margin:0 0 10px;padding:11px 15px;border-radius:10px;background:linear-gradient(135deg,rgba(249,115,22,.16),rgba(249,115,22,.05));border:1px solid rgba(249,115,22,.4);font-size:14px;}
.tabs{display:flex;gap:8px;margin:16px 0;}
.tab{font-family:var(--ff);font-size:16px;font-weight:700;padding:8px 18px;border-radius:8px;border:1px solid var(--border);color:var(--text2);text-decoration:none;}
.tab.act{background:var(--accent);color:#fff;border-color:transparent;}
.strip{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin:14px 0 6px;}
.strip-t{font-family:var(--ff);font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);margin-bottom:8px;}
.ss-item{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);}
.ss-item:last-child{border-bottom:none;}
.ss-dot{width:8px;height:8px;border-radius:50%;background:var(--text3);flex:none;}
.ss-dot.on{background:var(--em);box-shadow:0 0 8px rgba(0,229,160,.7);}
.ss-name{font-family:var(--ff);font-size:15px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ss-range{font-family:var(--fm);font-size:11px;color:var(--text3);white-space:nowrap;}
.month{position:sticky;top:60px;z-index:5;background:rgba(8,11,16,.96);backdrop-filter:blur(10px);font-family:var(--ff);font-size:19px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);padding:14px 2px 8px;border-bottom:1px solid var(--border);margin-top:18px;}
.ev{background:var(--card);border:1px solid var(--border);border-radius:12px;margin:10px 0;overflow:hidden;}
.ev[open]{border-color:rgba(249,115,22,.4);}
.ev.completed{opacity:.62;}
.ev summary{display:flex;align-items:center;gap:12px;padding:13px 15px;cursor:pointer;list-style:none;}
.ev summary::-webkit-details-marker{display:none;}
.ev-ico{font-size:20px;flex:none;}
.ev-main{flex:1;min-width:0;}
.ev-main b{display:block;font-family:var(--ff);font-size:17px;font-weight:700;line-height:1.2;}
.ev-main small{display:block;font-family:var(--fm);font-size:11px;color:var(--text3);margin-top:2px;}
.ev-right{display:flex;align-items:center;gap:8px;flex:none;}
.tier{font-family:var(--fm);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid rgba(232,182,74,.35);border-radius:999px;padding:3px 9px;white-space:nowrap;}
.chip{font-family:var(--fm);font-size:10px;letter-spacing:.05em;border-radius:999px;padding:3px 10px;white-space:nowrap;min-width:86px;text-align:center;}
.chip.live{color:var(--red);border:1px solid rgba(255,71,87,.4);background:rgba(255,71,87,.08);}
.chip.cd{color:var(--em);border:1px solid rgba(0,229,160,.35);background:rgba(0,229,160,.06);}
.chip.done{color:var(--text3);border:1px solid var(--border);}
.ev-body{padding:2px 15px 15px;border-top:1px solid rgba(255,255,255,.05);}
.ev-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:11px 0;}
.ev-grid div{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:9px;padding:8px 11px;}
.ev-grid span{display:block;font-family:var(--fm);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:2px;}
.ev-grid b{font-family:var(--ff);font-size:14px;}
.ev-notes{font-size:13.5px;color:var(--text2);line-height:1.65;margin-bottom:12px;}
.ev-cta{display:flex;gap:9px;flex-wrap:wrap;}
.btn{font-family:var(--ff);font-size:14px;font-weight:700;letter-spacing:.03em;padding:9px 18px;border-radius:8px;text-decoration:none;border:1px solid var(--border);color:var(--text);}
.btn.solid{background:var(--accent);color:#fff;border-color:transparent;}
.tba{margin-top:22px;}
.tba summary{font-family:var(--ff);font-size:16px;font-weight:700;color:var(--text2);cursor:pointer;padding:10px 0;}
.tba-note{font-size:12px;color:var(--text3);margin:2px 0 8px;}
.tba-item{display:flex;justify-content:space-between;gap:10px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:9px;margin:6px 0;font-size:14px;}
.tba-item small{color:var(--text3);font-family:var(--fm);font-size:11px;white-space:nowrap;}
footer{border-top:1px solid var(--border);padding:22px;text-align:center;color:var(--text3);font-size:12.5px;}
@media(max-width:560px){.ev-grid{grid-template-columns:1fr;}.ss-range{display:none;}.tier{display:none;}}
</style>
</head>
<body>
<nav>
  <a class="logo" href="/">Score<b>OCS8</b></a>
  <div class="lang">
    <a class="${lang === 'en' ? 'act' : ''}" href="${esc(langUrl('en'))}">EN</a>
    <a class="${lang === 'zh' ? 'act' : ''}" href="${esc(langUrl('zh'))}">中文</a>
  </div>
</nav>
<main class="wrap">
  <h1>${esc(S.h1)}</h1>
  <p class="sub">${esc(S.sub)}</p>
  ${banners.map(b => `<div class="banner">${esc(lang === 'zh' ? b.text_zh : b.text_en)}</div>`).join('')}
  ${tabs}
  ${seasons.length ? `<div class="strip"><div class="strip-t">${esc(S.leagues_strip)}</div>${seasons.map(seasonRow).join('')}</div>` : ''}
  ${[...byMonth.entries()].map(([k, list]) => `<div class="month">${esc(monthLabel(k, lang))}</div>${list.map(evRow).join('')}`).join('')}
  ${tba.length ? `<details class="tba"><summary>📌 ${esc(S.tba_strip)} (${tba.length})</summary><p class="tba-note">${esc(S.tba_note)}</p>${tba.map(t => `<div class="tba-item"><span>${SPORT_META[t.sport]?.icon || ''} ${esc(lang === 'zh' ? (t.name_zh || t.name_en) : t.name_en)}</span><small>${esc(lang === 'zh' ? (t.estimate_zh || t.estimate_en) : t.estimate_en)}</small></div>`).join('')}</details>` : ''}
</main>
<footer>© 2026 ScoreOCS8 · <a href="https://scoreocs8.com/" style="color:var(--text2);">⚽</a> · <a href="https://dota2.scoreocs8.com/" style="color:var(--text2);">🎮</a> · <a href="https://badminton.scoreocs8.com/" style="color:var(--text2);">🏸</a> · ${esc(data.meta?.last_verified ? 'Data verified ' + data.meta.last_verified : '')}</footer>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=600',
    },
  });
}
