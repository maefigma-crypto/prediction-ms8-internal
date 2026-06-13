import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
const R = (p) => resolve(__dirname, '..', p);

const cap = await import(R('cron/src/lib/caption.js'));

const SITE = 'https://scoreocs8.com';
const today = '2026-06-13';

// --- Sample WC fixture (real-ish): Brazil vs Morocco, Group C ---------------
const braMor = {
  teams: { home: { name: 'Brazil' }, away: { name: 'Morocco' } },
  league: { id: 1, name: 'FIFA World Cup' },
  fixture: { date: '2026-06-13T22:00:00+00:00', venue: { name: 'NY/NJ Stadium', city: 'East Rutherford' } },
};
const braMorFT = { ...braMor, goals: { home: 2, away: 1 } };
const pick = { pickLabel: 'Brazil to win', pick: 'HOME', confidence: 72 };

// --- Build every caption ----------------------------------------------------
const captions = {
  'Daily WC group card (10:00 MYT)': cap.buildWcCardCaption({ date: today, siteUrl: SITE }),
  'Pre-match update — no AI pick (every WC match, ~KO-30)': cap.buildMatchUpdateCaption({ fixture: braMor, pick: null, siteUrl: SITE }),
  'Pre-match update — with AI pick': cap.buildMatchUpdateCaption({ fixture: braMor, pick, siteUrl: SITE }),
  'Match of the Day pre-match slip (when WC match is MOTD + pick ready)': cap.buildPreMatchMotdCaption({ fixture: braMor, pick, siteUrl: SITE }),
  'Full-time result (every WC match) — caption under the image card': cap.buildResultCaption({ fixture: braMorFT, pickCorrect: true, weekAcc: { hits: 7, total: 10, pct: 70 }, siteUrl: SITE }),
};

// --- Render the /og/tg-result card SVG (no logos -> initials fallback) ------
const tgResult = await import(R('functions/og/tg-result.js'));
const params = new URLSearchParams({ home: 'Brazil', away: 'Morocco', league: 'FIFA World Cup', score: '2-1', date: braMor.fixture.date, pick_was: 'correct' });
const resp = await tgResult.onRequestGet({ request: { url: `${SITE}/og/tg-result?${params}` } });
const resultSvg = await resp.text();
writeFileSync(R('previews/wc-result-card.svg'), resultSvg);

// --- Render the /wc-card/ group card with MOCKED live data ------------------
const scheduleSample = { matches: [
  { home: { id: 10, name: 'Qatar' }, away: { id: 11, name: 'Switzerland' }, date: '2026-06-13T19:00:00+00:00', status: 'FT', goals: { home: 0, away: 2 }, group: 'B' },
  { home: { id: 1, name: 'Brazil' }, away: { id: 2, name: 'Morocco' }, date: '2026-06-13T22:00:00+00:00', status: 'NS', goals: {}, group: 'C' },
  { home: { id: 3, name: 'Haiti' }, away: { id: 4, name: 'Scotland' }, date: '2026-06-14T01:00:00+00:00', status: 'NS', goals: {}, group: 'C' },
]};
const standingsSample = { response: [ { league: { standings: [ [
  { team: { id: 1, name: 'Brazil' }, all: { played: 0 }, goalsDiff: 0, points: 0, group: 'Group C' },
  { team: { id: 4, name: 'Scotland' }, all: { played: 0 }, goalsDiff: 0, points: 0, group: 'Group C' },
  { team: { id: 2, name: 'Morocco' }, all: { played: 0 }, goalsDiff: 0, points: 0, group: 'Group C' },
  { team: { id: 3, name: 'Haiti' }, all: { played: 0 }, goalsDiff: 0, points: 0, group: 'Group C' },
] ] } } ] };
global.fetch = async (url) => ({ ok: true, json: async () => (String(url).includes('standings') ? standingsSample : scheduleSample) });
const wcCard = await import(R('functions/wc-card/index.js'));
const wcResp = await wcCard.onRequestGet({ request: { url: `${SITE}/wc-card/?group=C&date=2026-06-13` } });
const wcHtml = await wcResp.text();
writeFileSync(R('previews/wc-group-card.html'), wcHtml);

// --- Master Telegram-style mockup ------------------------------------------
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// captions already contain safe Telegram HTML (<b>,<a>) from our own templates
const bubble = (title, html, extra='') => `
  <div class="msg">
    <div class="tag">${esc(title)}</div>
    ${extra}
    <div class="body">${html.replace(/\n/g,'<br>')}</div>
  </div>`;

const master = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ScoreOCS8 — Telegram post previews</title>
<style>
  body{margin:0;background:#0e1621;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#e8eef5;}
  .head{position:sticky;top:0;background:#17212b;padding:14px 18px;border-bottom:1px solid #0a1119;font-weight:600;}
  .head small{color:#8aa0b6;font-weight:400;}
  .feed{max-width:560px;margin:0 auto;padding:18px 12px 60px;}
  .msg{background:#182533;border-radius:14px;padding:14px 16px;margin:14px 0;box-shadow:0 1px 0 rgba(0,0,0,.3);}
  .tag{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#5fa8e6;margin-bottom:10px;font-weight:700;}
  .body{font-size:15px;line-height:1.5;word-wrap:break-word;}
  .body b{color:#fff;} .body a{color:#6fb4ef;text-decoration:none;}
  img.card{width:100%;border-radius:10px;display:block;margin-bottom:10px;border:1px solid #0a1119;}
  iframe.card{width:100%;height:540px;border:1px solid #0a1119;border-radius:10px;display:block;margin-bottom:10px;background:#05070f;}
  .card svg{width:100%;height:auto;display:block;border-radius:10px;border:1px solid #0a1119;margin-bottom:10px;}
  .note{color:#8aa0b6;font-size:12px;margin:4px 0 0;}
</style></head><body>
<div class="head">📣 ScoreOCS8 Channel — post previews <small>· sample data · 2026 World Cup</small></div>
<div class="feed">
  ${bubble('1 · Daily WC group card (image post)', captions['Daily WC group card (10:00 MYT)'],
    `<iframe class="card" srcdoc="${esc(wcHtml).replace(/"/g,'&quot;')}"></iframe><p class="note">↑ the /wc-card/ screenshot (group auto-selected). Logos load live; shown here with initials.</p>`)}
  ${bubble('2 · Pre-match update — no AI pick (text post, every WC match)', captions['Pre-match update — no AI pick (every WC match, ~KO-30)'])}
  ${bubble('3 · Pre-match update — with AI pick', captions['Pre-match update — with AI pick'])}
  ${bubble('4 · Match of the Day slip (when a WC match is the featured pick)', captions['Match of the Day pre-match slip (when WC match is MOTD + pick ready)'])}
  ${bubble('5 · Full-time result (image card + caption)', captions['Full-time result (every WC match) — caption under the image card'],
    `<div class="card">${resultSvg}</div><p class="note">↑ the /og/tg-result card (logos live; shown with initials).</p>`)}
</div></body></html>`;
writeFileSync(R('previews/telegram-preview.html'), master);

// Plain-text captions too
let md = '# ScoreOCS8 — Telegram caption previews (2026 World Cup)\n\n';
for (const [k,v] of Object.entries(captions)) md += `\n## ${k}\n\n\`\`\`\n${v.replace(/<\/?b>/g,'').replace(/<a href="([^"]+)">([^<]+)<\/a>/g,'$2 ($1)')}\n\`\`\`\n`;
writeFileSync(R('previews/captions.md'), md);

console.log('Generated:');
console.log(' - previews/telegram-preview.html  (open this — full feed mockup)');
console.log(' - previews/wc-group-card.html     (the group card alone)');
console.log(' - previews/wc-result-card.svg     (the FT result card alone)');
console.log(' - previews/captions.md            (plain captions)');
