import { screenshot } from './lib/screenshot.js';
import { sendPhoto, sendMessage } from './lib/telegram.js';
import { buildDailyCaption, buildResultCaption } from './lib/caption.js';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_PER_REQ = 2000;
const DAILY_TOKEN_BUDGET = 8000;
const SITE_URL = 'https://scoreocs8.pages.dev';

const LEAGUE_PRIORITY = [
  { key: 'UCL', id: 2 },
  { key: 'EPL', id: 39 },
  { key: 'WC', id: 1 },
  { key: 'MSL', id: 278 },
];
const DEFAULT_SEASON = '2025';

function today() { return new Date().toISOString().slice(0, 10); }

async function afGet(env, path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_FOOTBALL_BASE}${path}?${qs}`, {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY },
  });
  if (!res.ok) throw new Error(`API-Football ${path} ${res.status}`);
  return res.json();
}

async function claudeCall(env, prompt) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_PER_REQ,
      system: 'You are a ScoreOcs8 AI football writer. Respond ONLY with a single valid JSON object. No prose, no markdown code fences, no commentary before or after. Every requested field must be present.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const u = data.usage || {};
  return { text, tokens: (u.input_tokens || 0) + (u.output_tokens || 0), stopReason: data.stop_reason };
}

async function readBudget(env) {
  const used = parseInt(await env.CACHE.get(`usage:tokens:${today()}`) || '0', 10);
  return { used, remaining: DAILY_TOKEN_BUDGET - used };
}

async function spendBudget(env, amount) {
  const key = `usage:tokens:${today()}`;
  const used = parseInt(await env.CACHE.get(key) || '0', 10);
  await env.CACHE.put(key, String(used + amount), { expirationTtl: 2 * 24 * 3600 });
}

async function pickTopFixtures(env) {
  const all = [];
  for (let i = 0; i < LEAGUE_PRIORITY.length; i++) {
    const lg = LEAGUE_PRIORITY[i];
    try {
      const data = await afGet(env, '/fixtures', { league: lg.id, season: DEFAULT_SEASON, next: 5 });
      for (const fx of (data.response || [])) {
        all.push({ ...fx, _priority: i, _leagueKey: lg.key });
      }
    } catch (_) { /* keep going; one league failing shouldn't block the rest */ }
  }
  all.sort((a, b) => a._priority - b._priority || new Date(a.fixture.date) - new Date(b.fixture.date));
  return all.slice(0, 3);
}

function longPrompt(fx) {
  return `Write an SEO-optimised football match preview as JSON only (no prose outside the JSON).

Match: ${fx.teams.home.name} vs ${fx.teams.away.name}
League: ${fx.league.name}
Kickoff: ${fx.fixture.date}
Venue: ${fx.fixture.venue?.name || 'TBD'}

Shape (ALL fields required, double quotes, valid JSON):
{
  "title_en": "SEO headline, 50-70 chars, primary keyword at start, compelling, sentence-case",
  "title_bm": "Localised Bahasa Malaysia headline (for BM readers on listing pages)",
  "title_zh": "中文本地化标题 (for Chinese-Malaysian readers on listing pages)",
  "meta_description": "140-155 chars, natural English, includes match + league + key angle, action verb",
  "body_en": "500-600 words in markdown. Use H2/H3 subheadings, short paragraphs, scannable structure. Sections: intro with hook, recent form both teams, key player matchups, tactical analysis, injury/lineup notes, clear prediction with reasoning and confidence %. Include relevant keywords naturally."
}`;
}

function shortPrompt(fx) {
  return `Write a short SEO-optimised football match preview as JSON only.

Match: ${fx.teams.home.name} vs ${fx.teams.away.name}
League: ${fx.league.name}
Kickoff: ${fx.fixture.date}

Shape (ALL fields required, valid JSON):
{
  "title_en": "SEO headline, 50-70 chars, keyword-forward",
  "title_bm": "Bahasa Malaysia headline",
  "title_zh": "中文标题",
  "meta_description": "140-155 chars, compelling English snippet",
  "body_en": "300-400 words in markdown. One or two H2 subheadings, form snapshot, key angle, prediction with reasoning."
}`;
}

function parseJsonLoose(text, context = {}) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    const preview = (text || '').slice(0, 300).replace(/\n/g, ' ');
    throw new Error(`no JSON in response (stop=${context.stopReason || '?'}, preview="${preview}")`);
  }
  try {
    return JSON.parse(m[0]);
  } catch (err) {
    const preview = m[0].slice(0, 200).replace(/\n/g, ' ');
    throw new Error(`invalid JSON (${err.message}, preview="${preview}")`);
  }
}

async function generateDaily(env) {
  const date = today();
  const existing = await env.CACHE.get(`content:${date}`);
  if (existing) return { status: 'skipped', reason: 'already generated', date };

  const fixtures = await pickTopFixtures(env);
  if (!fixtures.length) return { status: 'skipped', reason: 'no upcoming fixtures', date };

  const estimate = 4000;
  const { remaining } = await readBudget(env);
  if (remaining < estimate) {
    return { status: 'skipped', reason: `budget exhausted: ${remaining} tokens left`, date };
  }

  const output = { date, generatedAt: Date.now(), top: null, previews: [], tokensUsed: 0 };

  try {
    const topCall = await claudeCall(env, longPrompt(fixtures[0]));
    output.top = { fixture: fixtures[0], content: parseJsonLoose(topCall.text, { stopReason: topCall.stopReason }) };
    output.tokensUsed += topCall.tokens;
    await spendBudget(env, topCall.tokens);
  } catch (e) {
    return { status: 'error', stage: 'top', detail: String(e.message || e), date };
  }

  for (const fx of fixtures.slice(1, 3)) {
    try {
      const { remaining: rem } = await readBudget(env);
      if (rem < 1000) break;
      const call = await claudeCall(env, shortPrompt(fx));
      output.previews.push({ fixture: fx, content: parseJsonLoose(call.text, { stopReason: call.stopReason }) });
      output.tokensUsed += call.tokens;
      await spendBudget(env, call.tokens);
    } catch (_) { /* skip this preview, keep others */ }
  }

  await env.CACHE.put(`content:${date}`, JSON.stringify(output), { expirationTtl: 48 * 3600 });

  // Warm the /api/predictions cache for each featured fixture so the
  // /daily/ screenshot page always shows real AI picks (not "analysing").
  // Each hit populates prediction:<fixture_id> in KV via the Pages Function.
  const warmerReport = await warmPredictions(output).catch(e => ({ error: String(e.message || e) }));

  // Queue FT checks — one scheduled lookup per featured fixture at
  // kickoff + 100 min. Drives step 5 (result posting + virtual bet slip).
  const queueReport = await queueFtChecks(env, output, date).catch(e => ({ error: String(e.message || e) }));

  // Ping IndexNow (Bing/Yandex) so fresh posts get crawled fast. Google
  // removed their sitemap ping in 2023; IndexNow is the modern equivalent.
  const indexNowResult = await pingIndexNow(output, date).catch(e => ({ error: String(e.message || e) }));

  return {
    status: 'ok',
    date,
    tokensUsed: output.tokensUsed,
    items: 1 + output.previews.length,
    warmed: warmerReport,
    ftQueue: queueReport,
    indexnow: indexNowResult,
  };
}

const SITE_HOST = 'scoreocs8.pages.dev';
const INDEXNOW_KEY = '8c4e6d9f2b7a1e3f5c8d0a9b2e4f7c1d';

async function pingIndexNow(bundle, date) {
  const urls = [];
  if (bundle.top) urls.push(`https://${SITE_HOST}/blog/daily-${date}-top/`);
  for (let i = 0; i < (bundle.previews || []).length; i++) {
    urls.push(`https://${SITE_HOST}/blog/daily-${date}-p${i + 1}/`);
  }
  // Also ping the listing pages that changed
  urls.push(`https://${SITE_HOST}/blog/`, `https://${SITE_HOST}/sitemap.xml`);
  if (!urls.length) return { submitted: 0 };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: SITE_HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`,
      urlList: urls,
    }),
  });
  return { submitted: urls.length, status: res.status };
}

// --- Prediction cache warmer ------------------------------------------------
//
// /api/predictions?fixture_id=X is cached on-demand for 12h. We proactively
// call it for each featured fixture so the /daily/ screenshot page always
// shows the actual AI pick instead of the "AI analysing" placeholder.

async function warmPredictions(output) {
  const ids = [];
  if (output.top?.fixture?.fixture?.id) ids.push(output.top.fixture.fixture.id);
  if (Array.isArray(output.previews)) {
    for (const p of output.previews) {
      if (p.fixture?.fixture?.id) ids.push(p.fixture.fixture.id);
    }
  }
  const results = await Promise.all(
    ids.map(async id => {
      try {
        const res = await fetch(`${SITE_URL}/api/predictions?fixture_id=${id}`);
        return { id, ok: res.ok, status: res.status };
      } catch (e) {
        return { id, ok: false, error: String(e.message || e) };
      }
    })
  );
  return { count: results.length, results };
}

// --- FT-check queue (step 5 foundation) -------------------------------------
//
// Writes ft-queue:YYYY-MM-DD holding one entry per featured fixture with
// the computed check_at timestamp (kickoff + 100 min). The checker cron
// scans this queue every 15 min and only hits API-Football for entries
// whose check_at is in the past AND which haven't been posted yet.
//
// Cost: ~0 API-Football calls on match-less days; 3-10/day on busy days.

async function queueFtChecks(env, output, date) {
  const fixtures = [];
  if (output.top?.fixture) fixtures.push(output.top.fixture);
  if (Array.isArray(output.previews)) {
    for (const p of output.previews) if (p.fixture) fixtures.push(p.fixture);
  }

  const queue = fixtures.map(fx => {
    const kickoffMs = new Date(fx.fixture.date).getTime();
    return {
      fixture_id: fx.fixture.id,
      home: fx.teams?.home?.name,
      away: fx.teams?.away?.name,
      league_id: fx.league?.id,
      kickoff_iso: fx.fixture.date,
      check_at_ms: kickoffMs + 100 * 60 * 1000,  // FT typically ~100 min after KO
      attempts: 0,
      posted: false,
    };
  });

  await env.CACHE.put(`ft-queue:${date}`, JSON.stringify(queue), { expirationTtl: 48 * 3600 });
  return { count: queue.length };
}

// --- Daily social posting pipeline (Step 2 + 3) -----------------------------
//
// 1. Screenshot the /daily/ page via CF Browser Rendering REST API
// 2. Load the 3 featured picks from KV (content + prediction caches)
// 3. Build bilingual caption from template
// 4. sendPhoto to the configured Telegram channel
// 5. Cache the message_id + photo so later steps (result reconcile, cross-
//    posting) can reference the same post.

async function loadFeaturedWithPicks(env) {
  // Try MYT today, then UTC today (handles cron running in UTC window).
  const mytDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const utcDate = today();
  const keys = [`content:${mytDate}`, `content:${utcDate}`];
  let content = null;
  let usedKey = null;
  for (const k of keys) {
    content = await env.CACHE.get(k, 'json');
    if (content) { usedKey = k; break; }
  }
  if (!content) return { date: mytDate, picks: [], sourceKey: null };

  const fixtures = [];
  if (content.top?.fixture) fixtures.push(content.top.fixture);
  if (Array.isArray(content.previews)) {
    for (const p of content.previews) if (p.fixture) fixtures.push(p.fixture);
  }

  const picks = await Promise.all(
    fixtures.slice(0, 3).map(async fx => ({
      fx,
      pick: await env.CACHE.get(`prediction:${fx.fixture?.id}`, 'json').catch(() => null),
    }))
  );

  return { date: mytDate, picks, sourceKey: usedKey };
}

async function loadWeeklyAccuracy(env) {
  try {
    const raw = await env.CACHE.get('accuracy:week:current');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.total) return null;
    return {
      hits: data.hits,
      total: data.total,
      pct: Math.round((data.hits / data.total) * 100),
    };
  } catch { return null; }
}

// Main daily post flow. Returns a JSON-serialisable report.
async function postDailyToTelegram(env) {
  const started = Date.now();
  const report = { stage: 'init', startedAt: started };

  try {
    // 1. Gather data for the caption.
    report.stage = 'load-featured';
    const { date, picks, sourceKey } = await loadFeaturedWithPicks(env);
    report.date = date;
    report.sourceKey = sourceKey;
    report.pickCount = picks.length;

    if (!picks.length) {
      report.status = 'skipped';
      report.reason = 'no featured picks in KV yet';
      return report;
    }

    const accuracy = await loadWeeklyAccuracy(env);
    report.accuracy = accuracy;

    // 2. Screenshot /daily/ (always pass ?v= to bust any stale CDN cache).
    report.stage = 'screenshot';
    const pngBytes = await screenshot(env, {
      url: `${SITE_URL}/daily/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1920 },
      waitUntil: 'networkidle0',
      timeoutMs: 30000,
    });
    report.screenshotBytes = pngBytes.byteLength;

    // 3. Build caption from template.
    report.stage = 'build-caption';
    const affiliates = [];
    if (env.AFFILIATE_URL_MY) affiliates.push({ flag: '🇲🇾', url: env.AFFILIATE_URL_MY });
    if (env.AFFILIATE_URL_SG) affiliates.push({ flag: '🇸🇬', url: env.AFFILIATE_URL_SG });
    const caption = buildDailyCaption({
      date,
      picks,
      accuracy,
      siteUrl: SITE_URL,
      affiliates,
    });
    report.captionChars = caption.length;

    // 4. Post to Telegram.
    report.stage = 'telegram';
    const msg = await sendPhoto(env, { photoBytes: pngBytes, caption });
    report.messageId = msg.message_id;
    report.chatId = msg.chat?.id;

    // 5. Cache the post record so downstream flows can reference it.
    report.stage = 'cache';
    await env.CACHE.put(
      `post:telegram:daily:${date}`,
      JSON.stringify({
        date,
        chatId: msg.chat?.id,
        messageId: msg.message_id,
        postedAt: Date.now(),
        captionChars: caption.length,
        pickCount: picks.length,
      }),
      { expirationTtl: 14 * 24 * 3600 }
    );

    report.stage = 'done';
    report.status = 'ok';
    report.durationMs = Date.now() - started;
    return report;
  } catch (err) {
    report.status = 'error';
    report.error = String(err.message || err);
    report.durationMs = Date.now() - started;
    return report;
  }
}

// --- FT checker + virtual bet slip poster (Step 5) --------------------------
//
// Runs every 15 min via cron. Reads ft-queue:YYYY-MM-DD, picks up entries
// whose check_at_ms is in the past and posted=false. Hits API-Football for
// live status. If FT, screenshots /slip/?fixture_id=X&status=won|lost and
// sends it to the Telegram channel with a bilingual result caption. Also
// updates the weekly accuracy counter.

const LIVE_UNFINISHED = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);
const FINISHED = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

function todayMYT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function isoWeekKey(d = new Date()) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tgt.getUTCDay() || 7;
  tgt.setUTCDate(tgt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((tgt - yearStart) / 86400000) + 1) / 7);
  return `${tgt.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Decide if an AI pick was correct given the final score.
// Covers HOME/DRAW/AWAY (1X2). Over/under and BTTS markets will be added
// when the prediction schema expands.
function pickWasCorrect(pick, goalsHome, goalsAway) {
  if (!pick || !pick.pick) return null;
  if (goalsHome == null || goalsAway == null) return null;
  const p = String(pick.pick).toUpperCase();
  if (p === 'HOME') return goalsHome > goalsAway;
  if (p === 'AWAY') return goalsAway > goalsHome;
  if (p === 'DRAW') return goalsHome === goalsAway;
  return null;
}

async function bumpAccuracy(env, correct) {
  const weekKey = `accuracy:week:${isoWeekKey()}`;
  const curKey = `accuracy:week:current`;
  const raw = await env.CACHE.get(weekKey);
  let data = { hits: 0, total: 0 };
  if (raw) { try { data = JSON.parse(raw); } catch {} }
  data.total += 1;
  if (correct === true) data.hits += 1;
  const payload = JSON.stringify(data);
  await env.CACHE.put(weekKey, payload, { expirationTtl: 45 * 24 * 3600 });
  await env.CACHE.put(curKey, payload, { expirationTtl: 10 * 24 * 3600 });
  return data;
}

async function checkFinishedMatches(env) {
  const date = todayMYT();
  const raw = await env.CACHE.get(`ft-queue:${date}`);
  if (!raw) return { status: 'skipped', reason: 'no queue for today', date };

  let queue;
  try { queue = JSON.parse(raw); } catch { return { status: 'error', reason: 'bad queue json', date }; }

  const now = Date.now();
  const due = queue.filter(q => !q.posted && q.check_at_ms <= now);
  if (!due.length) return { status: 'ok', due: 0, date, total: queue.length };

  const report = { date, checked: due.length, posted: 0, still_live: 0, errors: [] };

  for (const item of due) {
    try {
      const fxData = await afGet(env, '/fixtures', { id: item.fixture_id });
      const fx = fxData.response?.[0];
      const short = fx?.fixture?.status?.short;
      item.attempts = (item.attempts || 0) + 1;

      if (!short || LIVE_UNFINISHED.has(short)) {
        // Match still ongoing — retry in 15 min
        item.check_at_ms = now + 15 * 60 * 1000;
        report.still_live += 1;
        continue;
      }
      if (!FINISHED.has(short)) {
        // Postponed / cancelled / unknown — mark posted to stop retries
        item.posted = true;
        item.note = `non-terminal status ${short}`;
        continue;
      }

      // FT reached — post the virtual bet slip.
      const pick = await env.CACHE.get(`prediction:${item.fixture_id}`, 'json').catch(() => null);
      const goalsHome = fx.goals?.home;
      const goalsAway = fx.goals?.away;
      const correct = pickWasCorrect(pick, goalsHome, goalsAway);
      const accAfter = correct === null ? null : await bumpAccuracy(env, correct);

      const slipStatus = correct === true ? 'won' : (correct === false ? 'lost' : 'running');
      const slipUrl = `${SITE_URL}/slip/?fixture_id=${item.fixture_id}&status=${slipStatus}&stake=100&v=${Date.now()}`;
      const png = await screenshot(env, {
        url: slipUrl,
        viewport: { width: 1080, height: 1350 },
        waitUntil: 'networkidle0',
      });

      const weekAcc = accAfter
        ? { hits: accAfter.hits, total: accAfter.total, pct: Math.round((accAfter.hits / accAfter.total) * 100) }
        : null;
      const caption = buildResultCaption({
        fixture: fx,
        pickCorrect: correct,
        weekAcc,
        siteUrl: SITE_URL,
      });

      const msg = await sendPhoto(env, { photoBytes: png, caption });
      item.posted = true;
      item.posted_at = Date.now();
      item.message_id = msg.message_id;
      item.correct = correct;
      report.posted += 1;
    } catch (e) {
      report.errors.push({ fixture_id: item.fixture_id, error: String(e.message || e) });
      // Retry in 30 min on transient error
      item.check_at_ms = Date.now() + 30 * 60 * 1000;
    }
  }

  // Persist queue with updated states
  await env.CACHE.put(`ft-queue:${date}`, JSON.stringify(queue), { expirationTtl: 48 * 3600 });
  return { status: 'ok', ...report, total: queue.length };
}

export default {
  async scheduled(event, env, ctx) {
    // Dispatch by cron pattern:
    //   23:00 UTC  = 07:00 MYT → generate tomorrow's content
    //   02:00 UTC  = 10:00 MYT → post today's predictions to Telegram
    //   */15 * UTC → check FT queue and post result slips
    const cron = event.cron || '';
    if (cron.startsWith('0 2 ')) {
      ctx.waitUntil(postDailyToTelegram(env));
    } else if (cron.startsWith('*/15 ')) {
      ctx.waitUntil(checkFinishedMatches(env));
    } else {
      ctx.waitUntil(generateDaily(env));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    // Manual triggers: &task=generate | post | check
    const task = url.searchParams.get('task') || 'generate';
    let result;
    if (task === 'post') result = await postDailyToTelegram(env);
    else if (task === 'check') result = await checkFinishedMatches(env);
    else result = await generateDaily(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
