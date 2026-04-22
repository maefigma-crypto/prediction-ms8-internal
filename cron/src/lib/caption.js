// Daily prediction caption builder.
//
// Matches the bilingual template the user approved:
//   📢 ScoreOcs8 Today's Predictions | 今日足球精选预测
//   📅 21 April 2026
//
//   Today's top AI picks | 今日推介:
//   👉 🏆 UCL · Man City vs Arsenal — Man City win @1.85
//   ...
//
//   📊 Accuracy this week | 本周准确率: 8/12 (67%)
//
//   View all today's predictions | 浏览更多推介:
//   👉 https://scoreocs8.pages.dev/
//
//   🎁 Claim welcome bonus | 领取新手礼金:
//   👉 🇲🇾 https://[affiliate-my]
//   👉 🇸🇬 https://[affiliate-sg]
//
//   #ScoreOcs8 #footballpredictions #AIpicks #足球预测 #今日推介

const LEAGUE_EMOJI = {
  39: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  2: '⭐',
  1: '🏆',
  278: '🇲🇾',
  140: '🇪🇸',
  78: '🇩🇪',
  135: '🇮🇹',
  61: '🇫🇷',
};

// Short codes to keep caption compact (Telegram captions cap at 1024 chars).
const LEAGUE_SHORT = {
  39: 'EPL',
  2: 'UCL',
  1: 'WC',
  278: 'MSL',
  140: 'LaLiga',
  78: 'BL',
  135: 'Serie A',
  61: 'Ligue 1',
};

// HTML escape for Telegram parse_mode=HTML.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function buildDailyCaption({
  date,
  picks = [],
  accuracy = null,
  siteUrl = 'https://scoreocs8.pages.dev',
  affiliates = [],
}) {
  const lines = [];
  lines.push(`📢 <b>ScoreOcs8 Today's Predictions</b> | 今日足球精选预测`);
  lines.push(`📅 ${esc(fmtDate(date))}`);
  lines.push('');

  if (picks.length) {
    lines.push(`<b>Today's top AI picks</b> | 今日推介:`);
    for (const p of picks.slice(0, 3)) {
      const leagueId = p.fx?.league?.id;
      const flag = LEAGUE_EMOJI[leagueId] || '⚽';
      const league = LEAGUE_SHORT[leagueId] || (p.fx?.league?.name || '');
      const home = p.fx?.teams?.home?.name || 'Home';
      const away = p.fx?.teams?.away?.name || 'Away';
      const pickLabel = p.pick?.pickLabel || p.pick?.pick || 'AI analysing';
      const conf = p.pick?.confidence != null ? ` (${p.pick.confidence}%)` : '';
      lines.push(`👉 ${flag} <b>${esc(league)}</b> · ${esc(home)} vs ${esc(away)} — <b>${esc(pickLabel)}</b>${conf}`);
    }
    lines.push('');
  }

  if (accuracy && accuracy.total > 0) {
    lines.push(
      `📊 <b>Accuracy this week</b> | 本周准确率: ${accuracy.hits}/${accuracy.total} (${accuracy.pct}%)`
    );
    lines.push('');
  }

  lines.push(`🔗 <b>View all predictions</b> | 浏览更多推介:`);
  lines.push(`👉 ${siteUrl}/`);
  lines.push('');

  if (affiliates.length) {
    lines.push(`🎁 <b>Welcome bonus</b> | 领取新手礼金:`);
    for (const a of affiliates) {
      lines.push(`👉 ${a.flag || ''} ${a.url}`);
    }
    lines.push('');
  }

  lines.push(
    `#ScoreOcs8 #footballpredictions #AIpicks #malaysianfootball #足球预测 #今日推介`
  );

  const out = lines.join('\n');
  // Telegram caption hard limit is 1024 chars — truncate defensively.
  return out.length > 1020 ? out.slice(0, 1017) + '...' : out;
}

// Caption for match result posts: "FT · Team A 2-1 Team B"
export function buildResultCaption({ fixture, pickCorrect = null, weekAcc = null, siteUrl = 'https://scoreocs8.pages.dev' }) {
  const home = fixture?.teams?.home?.name || 'Home';
  const away = fixture?.teams?.away?.name || 'Away';
  const hs = fixture?.goals?.home ?? '-';
  const as = fixture?.goals?.away ?? '-';
  const leagueId = fixture?.league?.id;
  const flag = LEAGUE_EMOJI[leagueId] || '⚽';
  const league = LEAGUE_SHORT[leagueId] || fixture?.league?.name || '';

  const lines = [];
  lines.push(`⚽ <b>FULL-TIME</b> | 比赛结束`);
  lines.push(`${flag} <b>${esc(league)}</b>`);
  lines.push('');
  lines.push(`<b>${esc(home)} ${hs} — ${as} ${esc(away)}</b>`);
  lines.push('');
  if (pickCorrect === true) lines.push(`✅ Our AI pick was <b>correct</b> · 预测正确`);
  else if (pickCorrect === false) lines.push(`❌ Our AI pick missed · 预测未中`);
  if (weekAcc && weekAcc.total > 0) {
    lines.push(`📊 This week: ${weekAcc.hits}/${weekAcc.total} (${weekAcc.pct}%)`);
  }
  lines.push('');
  lines.push(`🔗 Full analysis | 完整分析: ${siteUrl}/`);
  lines.push('');
  lines.push(`#ScoreOcs8 #${esc(league).replace(/\s+/g, '')} #足球预测`);

  return lines.join('\n');
}
