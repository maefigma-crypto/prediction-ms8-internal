import { screenshot } from './lib/screenshot.js';
import { sendPhoto, sendMessage, sendPoll } from './lib/telegram.js';
import { broadcastPush } from './lib/webpush.js';
import {
  buildDailyCaption,
  buildDailyCaptionX,
  buildDailyCaptionThreads,
  buildDailyCaptionIG,
  buildResultCaption,
  buildPreMatchMotdCaption,
  buildMatchUpdateCaption,
  buildWcCardCaption,
  buildWcUpcomingCaption,
} from './lib/caption.js';
import { saveSnap } from './lib/snap.js';
import { googleIndexUrls } from './lib/google-indexing.js';
import * as X from './lib/x.js';
import * as IG from './lib/instagram.js';
import * as Threads from './lib/threads.js';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const YOUTUBE_SEARCH_API = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_CHANNELS_API = 'https://www.googleapis.com/youtube/v3/channels';
const DEFAULT_YOUTUBE_CHANNELS = '@stadiumastro,@beINSPORTSAsia';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_PER_REQ = 2000;
const DAILY_TOKEN_BUDGET = 8000;
const SITE_URL = 'https://scoreocs8.com';
const PUBLIC_SITE_URL = 'https://scoreocs8.com';

const LEAGUE_PRIORITY = [
  { key: 'UCL', id: 2 },
  { key: 'EPL', id: 39 },
  { key: 'WC', id: 1 },
];

// Slug helper for pretty /slip/ + /match/ URLs.
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
function slipPath(fixtureId, home, away) {
  const slug = slugify(`${home}-vs-${away}`);
  return slug ? `/slip/${fixtureId}-${slug}/` : `/slip/${fixtureId}/`;
}
const DEFAULT_SEASON = '2026';
// API-Football tags tournaments by start year — the 2026 World Cup is season 2026.
const LEAGUE_SEASONS = { 1: '2026' };
const seasonFor = id => LEAGUE_SEASONS[String(id)] || DEFAULT_SEASON;

// Today's date in MYT (Asia/Kuala_Lumpur, UTC+8). Cron fires at 23:00 UTC
// which is 07:00 MYT next day — using UTC here would write content under
// yesterday's key and /daily/ would never find it.
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

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
      const data = await afGet(env, '/fixtures', { league: lg.id, season: seasonFor(lg.id), next: 5 });
      for (const fx of (data.response || [])) {
        all.push({ ...fx, _priority: i, _leagueKey: lg.key });
      }
    } catch (_) { /* keep going; one league failing shouldn't block the rest */ }
  }
  all.sort((a, b) => a._priority - b._priority || new Date(a.fixture.date) - new Date(b.fixture.date));
  return all.slice(0, 3);
}

// Shared writing-style rules injected into every content prompt. Kills the
// tells that make text read as machine-written (em dashes, stock AI vocab,
// uniform sentence rhythm) so posts read like a pundit typed them.
const STYLE_RULES = `Writing style (strict, applies to every field):
- NEVER use em dashes (—) or semicolons. Use commas, colons or full stops instead.
- Never use these words/phrases: delve, moreover, furthermore, additionally, crucial, pivotal, landscape, testament, showcase, elevate, unleash, "it's worth noting", "in conclusion", "overall,".
- Vary sentence length. Mix short punchy lines with longer ones. Do not start consecutive sentences the same way.
- Write like an experienced football pundit talking to Malaysian fans, not like an essay. Concrete facts and numbers over adjectives.
- No hype filler ("thrilling clash", "epic showdown", "eagerly anticipated"). If a fact is unknown, skip it rather than pad.`;

function longPrompt(fx) {
  return `Write an SEO-optimised football match preview as JSON only (no prose outside the JSON).

Match: ${fx.teams.home.name} vs ${fx.teams.away.name}
League: ${fx.league.name}
Kickoff: ${fx.fixture.date}
Venue: ${fx.fixture.venue?.name || 'TBD'}

${STYLE_RULES}

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

${STYLE_RULES}

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

  // Refresh full World Cup coverage first — this is independent of the AI
  // preview pipeline, so it must run even when today's content already exists
  // (otherwise re-runs would skip queueing the day's WC matches).
  const wcQueue = await queueWorldCupFixtures(env).catch(e => ({ status: 'error', error: String(e.message || e) }));

  const existing = await env.CACHE.get(`content:${date}`);
  if (existing) return { status: 'skipped', reason: 'already generated', date, wcQueue };

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
  // /daily/ screenshot page always shows real pro picks (not "analysing").
  // Each hit populates prediction:<fixture_id> in KV via the Pages Function.
  const warmerReport = await warmPredictions(output).catch(e => ({ error: String(e.message || e) }));

  // Queue FT checks — one scheduled lookup per featured fixture at
  // kickoff + 100 min. Drives step 5 (result posting + virtual bet slip).
  const queueReport = await queueFtChecks(env, output, date).catch(e => ({ error: String(e.message || e) }));

  // Ping IndexNow (Bing/Yandex) so fresh posts get crawled fast. Google
  // removed their sitemap ping in 2023; IndexNow is the modern equivalent.
  const indexNowResult = await pingIndexNow(env, output, date).catch(e => ({ error: String(e.message || e) }));

  return {
    status: 'ok',
    date,
    tokensUsed: output.tokensUsed,
    items: 1 + output.previews.length,
    warmed: warmerReport,
    ftQueue: queueReport,
    wcQueue,
    indexnow: indexNowResult,
  };
}

const SITE_HOST = 'scoreocs8.com';
const INDEXNOW_KEY = '8c4e6d9f2b7a1e3f5c8d0a9b2e4f7c1d';

async function pingIndexNow(env, bundle, date) {
  const pageUrls = [];
  if (bundle.top) pageUrls.push(`https://${SITE_HOST}/blog/daily-${date}-top/`);
  for (let i = 0; i < (bundle.previews || []).length; i++) {
    pageUrls.push(`https://${SITE_HOST}/blog/daily-${date}-p${i + 1}/`);
  }
  // IndexNow (Bing/Yandex) also gets the listing + sitemap.
  const urls = [...pageUrls, `https://${SITE_HOST}/blog/`, `https://${SITE_HOST}/sitemap.xml`];

  let indexnow;
  try {
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
    indexnow = { submitted: urls.length, status: res.status };
  } catch (e) {
    indexnow = { error: String(e.message || e) };
  }

  // Google Indexing API — submit the actual page URLs (skip the listing/sitemap;
  // Google wants real page URLs). No-op when GOOGLE_SA_* secrets aren't set.
  const google = await googleIndexUrls(env, pageUrls).catch(e => ({ status: 'error', error: String(e.message || e) }));

  return { indexnow, google };
}

// --- Prediction cache warmer ------------------------------------------------
//
// /api/predictions?fixture_id=X is cached on-demand for 12h. We proactively
// call it for each featured fixture so the /daily/ screenshot page always
// shows the actual pro pick instead of the "Pro analysis pending" placeholder.

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

  // First fixture in the generated set is the "Match of the Day" — it
  // gets the prominent pre-match + post-match virtual bet slip posts.
  // The other featured fixtures only track silently (accuracy + history)
  // so the channel isn't flooded with 3 result posts per day.
  //
  // Entries are bucketed under their KICKOFF MYT date, not the generation
  // date: the KO-30 / FT / recap readers all look up ft-queue:<todayMYT>,
  // and World Cup matches mostly kick off 01:00-09:00 MYT the morning
  // after the 07:00 MYT generation run — a generation-dated queue would
  // hide them from every reader.
  const byDate = {};
  fixtures.forEach((fx, i) => {
    const kickoffMs = new Date(fx.fixture.date).getTime();
    let kickoffDate = date;
    try { kickoffDate = new Date(fx.fixture.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); } catch {}
    (byDate[kickoffDate] = byDate[kickoffDate] || []).push({
      fixture_id: fx.fixture.id,
      home: fx.teams?.home?.name,
      away: fx.teams?.away?.name,
      league_id: fx.league?.id,
      kickoff_iso: fx.fixture.date,
      check_at_ms: kickoffMs + 100 * 60 * 1000,  // FT typically ~100 min after KO
      attempts: 0,
      posted: false,
      is_motd: i === 0,
    });
  });

  let count = 0;
  for (const [kd, entries] of Object.entries(byDate)) {
    // Merge with any queue already written for that date (an earlier run
    // may have queued other fixtures kicking off the same day).
    const existing = (await env.CACHE.get(`ft-queue:${kd}`, 'json').catch(() => null)) || [];
    const seen = new Set(existing.map(e => e.fixture_id));
    const fresh = entries.filter(e => !seen.has(e.fixture_id));
    if (!fresh.length) continue;
    await env.CACHE.put(`ft-queue:${kd}`, JSON.stringify(existing.concat(fresh)), { expirationTtl: 72 * 3600 });
    count += fresh.length;
  }
  return { count };
}

// --- World Cup full-coverage queue ------------------------------------------
//
// Unlike queueFtChecks (which only tracks the 3 featured AI fixtures and posts
// for the single Match-of-the-Day), this enqueues EVERY upcoming World Cup
// fixture in the next `daysAhead` days and tags them is_wc. The heartbeat then
// fires a pre-match update (~KO-30) and a full-time result for each, so the
// channel covers the whole tournament — not just one match a day.
//
// Cost: one API-Football /fixtures list call per daily run. The per-match
// FT lookups still only happen at KO+100min via the existing checker.
const WC_LEAGUE_ID = 1;

async function queueWorldCupFixtures(env, daysAhead = 2) {
  let data;
  try {
    data = await afGet(env, '/fixtures', { league: WC_LEAGUE_ID, season: seasonFor(WC_LEAGUE_ID), next: 30 });
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
  }
  const fixtures = data.response || [];
  const now = Date.now();
  const horizon = now + daysAhead * 86400000;

  const byDate = {};
  for (const fx of fixtures) {
    const kickoffMs = new Date(fx.fixture?.date).getTime();
    if (!Number.isFinite(kickoffMs) || kickoffMs > horizon) continue;
    let kd = todayMYT();
    try { kd = new Date(fx.fixture.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); } catch {}
    (byDate[kd] = byDate[kd] || []).push({
      fixture_id: fx.fixture.id,
      home: fx.teams?.home?.name,
      away: fx.teams?.away?.name,
      league_id: fx.league?.id,
      kickoff_iso: fx.fixture.date,
      check_at_ms: kickoffMs + 100 * 60 * 1000,
      attempts: 0,
      posted: false,
      is_motd: false,
      is_wc: true,
    });
  }

  let added = 0, tagged = 0;
  for (const [kd, entries] of Object.entries(byDate)) {
    const existing = (await env.CACHE.get(`ft-queue:${kd}`, 'json').catch(() => null)) || [];
    const byId = new Map(existing.map(e => [e.fixture_id, e]));
    for (const e of entries) {
      const cur = byId.get(e.fixture_id);
      if (cur) {
        // Already queued (e.g. as the MOTD) — just flag it for WC coverage.
        if (!cur.is_wc) { cur.is_wc = true; tagged += 1; }
      } else {
        existing.push(e);
        byId.set(e.fixture_id, e);
        added += 1;
      }
    }
    await env.CACHE.put(`ft-queue:${kd}`, JSON.stringify(existing), { expirationTtl: 72 * 3600 });
  }
  return { status: 'ok', added, tagged, dates: Object.keys(byDate) };
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

// Fan out one daily post to every configured platform. Each platform is
// independent — one failure doesn't block others. Report collects per-
// platform outcomes so you can see at a glance what worked.
async function postDailyToAll(env) {
  const started = Date.now();
  const report = { stage: 'init', startedAt: started, platforms: {} };

  try {
    // 1. Gather featured picks.
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

    // 2. Screenshot /daily/.
    report.stage = 'screenshot';
    const pngBytes = await screenshot(env, {
      url: `${SITE_URL}/daily/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1920 },
      waitUntil: 'networkidle0',
      timeoutMs: 30000,
    });
    report.screenshotBytes = pngBytes.byteLength;

    // 3. Host the PNG publicly so IG + Threads can fetch it by URL.
    report.stage = 'snap';
    const snap = await saveSnap(env, pngBytes);
    report.snapUrl = snap.url;

    // 4. Build platform-specific captions.
    const affiliates = [];
    if (env.AFFILIATE_URL_MY) affiliates.push({ flag: '🇲🇾', url: env.AFFILIATE_URL_MY });
    if (env.AFFILIATE_URL_SG) affiliates.push({ flag: '🇸🇬', url: env.AFFILIATE_URL_SG });
    const captions = {
      telegram: buildDailyCaption({ date, picks, accuracy, siteUrl: SITE_URL, affiliates }),
      x: buildDailyCaptionX({ date, picks, accuracy, siteUrl: SITE_URL }),
      ig: buildDailyCaptionIG({ date, picks, accuracy, siteUrl: SITE_URL, affiliates }),
      threads: buildDailyCaptionThreads({ date, picks, accuracy, siteUrl: SITE_URL, affiliates }),
    };

    // 5. Fan out daily predictions in parallel — each platform isolated.
    // Telegram intentionally skipped here: the 09:00 sportsbook batch
    // already posts the daily AI pick on Telegram, so this 10:00 fan-out
    // would duplicate it on the same channel. X/IG/Threads still need it.
    report.stage = 'fanout';
    const results = await Promise.allSettled([
      Promise.resolve({ status: 'skipped', reason: 'telegram daily handled by 09:00 sportsbook batch' }),
      postToX(env, pngBytes, captions.x, date),
      postToIG(env, snap.url, captions.ig, date),
      postToThreads(env, snap.url, captions.threads, date),
    ]);
    report.platforms.telegram = unwrap(results[0]);
    report.platforms.x = unwrap(results[1]);
    report.platforms.instagram = unwrap(results[2]);
    report.platforms.threads = unwrap(results[3]);

    // 6. Match of the Day pre-match virtual bet slip. Posted right after
    // the daily list so the channel has: (a) list of today's 3 picks,
    // (b) the featured bet slip with RM100 virtual stake for the top
    // match. Only goes to Telegram for now — a single slip per day on
    // the loudest channel is enough. IG/X/Threads can be wired later.
    // MOTD single-pick post intentionally skipped — it duplicated the
    // 3-pick daily fanout above and the virtual-stake framing didn't add
    // value for members. Saves one screenshot render + one Telegram POST
    // per day. Keep the stage entry in the report for observability.
    report.motd = { status: 'skipped', reason: 'motd-prematch single-pick post removed' };

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

function unwrap(settled) {
  if (settled.status === 'fulfilled') return settled.value;
  return { status: 'error', error: String(settled.reason?.message || settled.reason) };
}

// Each platform gets its own thin wrapper so loadFeaturedWithPicks +
// snap + caption building aren't duplicated.

async function postToTelegram(env, photoBytes, caption, date) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) return { status: 'skipped', reason: 'not configured' };
  try {
    const msg = await sendPhoto(env, { photoBytes, caption });
    await env.CACHE.put(
      `post:telegram:daily:${date}`,
      JSON.stringify({ date, chatId: msg.chat?.id, messageId: msg.message_id, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: 'ok', messageId: msg.message_id };
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
  }
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMYT(iso) {
  try {
    return new Date(iso).toLocaleString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return 'MYT';
  }
}

async function sendTemplateMessage(env, { text, buttonText, buttonUrl, imageUrl, imageBytes }) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'TG_BOT_TOKEN/TG_CHANNEL_ID not configured' };
  }

  const useUrlImage = imageUrl && /^https?:\/\//i.test(imageUrl);
  const useBytesImage = imageBytes && imageBytes.byteLength > 0;
  const replyMarkup = (buttonText && buttonUrl)
    ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] }
    : undefined;

  // Telegram caps: sendMessage 4096 / sendPhoto caption 1024.
  const captionMax = 1024;
  const captionText = (useUrlImage || useBytesImage) && text.length > captionMax
    ? text.slice(0, captionMax - 3) + '...'
    : text;

  // sendPhoto path A: PNG bytes via multipart (used for live screenshots)
  if (useBytesImage) {
    const form = new FormData();
    form.append('chat_id', env.TG_CHANNEL_ID);
    form.append('parse_mode', 'HTML');
    if (captionText) form.append('caption', captionText);
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
    form.append('photo', new Blob([imageBytes], { type: 'image/png' }), 'snap.png');
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) return { status: 'ok', messageId: data.result?.message_id };
    // fall through to text-only fallback below
    var bytesFailReason = data.description || `Telegram ${res.status}`;
  }

  // sendPhoto path B: image URL via JSON
  if (useUrlImage) {
    const body = {
      chat_id: env.TG_CHANNEL_ID,
      photo: imageUrl,
      caption: captionText,
      parse_mode: 'HTML',
    };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) return { status: 'ok', messageId: data.result?.message_id };
    var urlFailReason = data.description || `Telegram ${res.status}`;
  }

  // Text-only fallback (either no image was requested, or all photo attempts failed)
  const body = {
    chat_id: env.TG_CHANNEL_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) return { status: 'error', error: data.description || `Telegram ${res.status}` };
  const fallback = (typeof bytesFailReason !== 'undefined' || typeof urlFailReason !== 'undefined')
    ? `photo→text: ${bytesFailReason || urlFailReason}`
    : undefined;
  return { status: 'ok', messageId: data.result?.message_id, ...(fallback ? { fallback } : {}) };
}

function absolutizeImageUrl(raw, baseUrl) {
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('/')) return PUBLIC_SITE_URL + raw;
  return baseUrl.replace(/\/[^\/]*$/, '/') + raw;
}

async function fetchWebsitePage(path = '/') {
  const url = `${PUBLIC_SITE_URL}${path}`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'ScoreOCS8-Cron/1.0' } });
    const html = await res.text();
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || 'ScoreOCS8';
    const description = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]
      || '';
    // og:image first, twitter:image fallback, then first <img> in page.
    const rawImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)?.[1]
      || html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]
      || '';
    return {
      url,
      title: title.replace(/&amp;/g, '&').trim(),
      description: description.replace(/&amp;/g, '&').trim(),
      ogImage: absolutizeImageUrl(rawImage, url),
    };
  } catch {
    return { url, title: 'ScoreOCS8', description: 'Latest football predictions, highlights, proof, and blog updates are live.', ogImage: '' };
  }
}

function firstPickLine(item) {
  const fx = item?.fx;
  if (!fx) return 'Latest AI pick is ready on ScoreOCS8.';
  const home = fx.teams?.home?.name || 'Home';
  const away = fx.teams?.away?.name || 'Away';
  const league = fx.league?.name || 'Football';
  const pick = item.pick?.pickLabel || item.pick?.pick || 'Pro analysis pending';
  const conf = item.pick?.confidence != null ? ` (${item.pick.confidence}%)` : '';
  return `${league} · ${home} vs ${away}\nKickoff: ${fmtMYT(fx.fixture?.date)} MYT\nPick: ${pick}${conf}`;
}

// ─── Sportsbook autopost ─────────────────────────────────────────────────────
// Templates come from KV `sportsbook:config` (written by the panel Worker).
// Hardcoded defaults are used for any missing template keys, or when KV is
// empty — so this endpoint always returns a usable preview.

// 'proof' (What Our Users Say) intentionally dropped — sample testimonials
// don't fit the World Cup focus. Re-add it here to bring the template back.
const SPORTSBOOK_TEMPLATE_KEYS = ['prediction', 'upcoming', 'reminder', 'result', 'blog'];

// Affiliate signup URL — appended via {signupCta} to every default template
// and exposed as a placeholder so user-customized templates can reuse it.
const SIGNUP_URL = 'https://ocs8my.com/signup?ref=OCSFMZ6HVI';
const SIGNUP_CTA = `🆕 Sign up · OCS8 Sports · 立即注册:\n🔗 ${SIGNUP_URL}`;

const SPORTSBOOK_DEFAULTS = {
  prediction: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `⚽🔥 <b>AI Match Prediction · AI 智能预测</b> 🔥⚽\n⭐ {firstPickLeague}\n\n🏟️ {firstPickName}\n🕐 Kickoff · 开赛: {firstPickKickoff}\n\n⚡ Pro Pick · 智能推荐: <b>{firstPickLabel}</b> 🎯 ({firstPickConfidence})\n\n📊 Full breakdown · 完整分析:\n🔗 {websiteUrl}\n\n{signupCta}\n\n⚠️ 18+ · AI analysis\n#AIPrediction #ScoreOcs8 #足球预测 ⚽`,
  },
  upcoming: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `📅⚡ <b>Upcoming Matches · 近期赛事预告</b> ⚡📅\n\n{upcomingList}\n\n🕐 All times in Malaysia Time 🇲🇾 (MYT) · 马来西亚时间\n📊 Full list · 完整赛程:\n🔗 {websiteUrl}\n\n{signupCta}\n\n#UpcomingMatches #ScoreOcs8 #足球预测 ⚽`,
  },
  reminder: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `⏰🚨 <b>1 Hour Reminder · 开赛前一小时</b> 🚨⏰\n⭐ {firstPickLeague}\n\n🏟️ {firstPickName}\n🕐 Kickoff · 开赛: {firstPickKickoff}\n\n⚡ Pro Pick · 智能推荐: <b>{firstPickLabel}</b> 🎯 ({firstPickConfidence})\n\n💹 Odds + AI pick · 赔率分析:\n🔗 {websiteUrl}\n\n{signupCta}\n\n⚠️ 18+ · Bet responsibly · 理性投注\n#PreKickoff #ScoreOcs8 #足球预测 ⚽`,
  },
  result: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `🏆🎉 <b>Full Time · 全场比赛结束</b> 🎉🏆\n⭐ {resultLeague}\n\n⚽ {resultScore} ⚽\n\n🎬 Highlights · 比赛集锦:\n🔗 {youtubeUrl}\n\n📊 Full result · 比赛详情:\n🔗 {websiteUrl}\n\n{signupCta}\n\n#FullTime #ScoreOcs8 #足球预测 ⚽🏆`,
  },
  proof: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `💬🔥 <b>What Our Users Say · 用户口碑</b> 🔥💬\n\n{proofTestimonials}\n\n📊 Tracked weekly · 每周追踪\n🏆 Major leagues only · 仅覆盖主要联赛\n✅ Public results · 公开战绩\n\n📲 See more on ScoreOcs8:\n🔗 {websiteUrl}\n\n{signupCta}\n\n#Testimonials #CustomerProof #ScoreOcs8 #足球预测 ⚽`,
  },
  blog: {
    button: '🆕 Sign Up · OCS8 Sports',
    url: SIGNUP_URL,
    text: `📰✍️ <b>ScoreOcs8 Blog · 最新博客</b> ✍️📰\n\nLatest match analysis and football insights:\n最新比赛分析与足球见解：\n\n{latestPostTitles}\n\n📖 Read more · 阅读全文:\n🔗 {websiteUrl}\n\n{signupCta}\n\n#Blog #FootballAnalysis #ScoreOcs8 #足球预测 ⚽`,
  },
};

const SPORTSBOOK_PAGE_BY_KEY = {
  prediction: '/predictions/',
  upcoming: '/predictions/',
  reminder: '/predictions/',
  result: '/',
  proof: '/',
  blog: '/blog/',
};

// Smart per-key image default — used when the user leaves the panel "Image"
// field blank. Two images per batch (prediction + result), everything else
// text-only or og:image. Each image uses Codex's existing /og/* card endpoints
// (rendered as SVG, rasterized to PNG via Browser Rendering for Telegram):
//   prediction → /og/match card with team names, league, kickoff, AI pick tag
//   result     → /og/highlight card with score, teams, league
//   upcoming   → text-only (multi-match list doesn't fit one image)
//   reminder   → text-only (kickoff alert, image not essential)
//   blog       → og:image from /blog/
//   proof      → og:image from /  (user will typically disable this template)
// A pick is "ready" only when it carries a real label/value AND that value
// isn't the placeholder the AI pipeline writes before analysis completes.
// This is the single source of truth for "do we have content worth posting?"
function isPickReady(pick) {
  const label = String(pick?.pickLabel || pick?.pick || '').trim();
  if (!label) return false;
  return !/^(pending|pro\s+analysis\s+pending|analysing|coming\s+soon)$/i.test(label);
}

function defaultImageStrategy(key, topFx, topPick, hasHighlight, batchToken) {
  if (key === 'prediction' && topFx?.fixture?.id) {
    const realTag = isPickReady(topPick) ? (topPick.pickLabel || topPick.pick) : '';
    const params = new URLSearchParams({
      home:    topFx.teams?.home?.name || 'Home',
      away:    topFx.teams?.away?.name || 'Away',
      league:  topFx.league?.name || 'Football',
      date:    topFx.fixture?.date || '',
      v:       String(batchToken),
    });
    if (realTag) params.set('tag', realTag);
    if (topPick?.confidence != null) params.set('confidence', String(topPick.confidence));
    if (topFx.teams?.home?.logo) params.set('home_logo', topFx.teams.home.logo);
    if (topFx.teams?.away?.logo) params.set('away_logo', topFx.teams.away.logo);
    return `screenshot:${PUBLIC_SITE_URL}/og/tg-prediction?${params.toString()}`;
  }
  if (key === 'result' && hasHighlight) return 'highlight';
  if (key === 'upcoming' || key === 'reminder') return 'off';
  return ''; // blog, proof, and fallbacks → og:image
}

async function readSportsbookConfigFromKV(env) {
  try {
    const raw = await env.CACHE.get('sportsbook:config');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function fillSportsbookPlaceholders(text, ctx) {
  // Leaves unknown placeholders intact so authors can spot typos in the preview.
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in ctx ? String(ctx[k] ?? '') : m));
}

async function postSportsbookTemplateTest(env) {
  const report = { status: 'init', source: 'defaults', results: [] };
  const config = await readSportsbookConfigFromKV(env);
  if (config && config.templates) report.source = 'kv';

  // One token shared by all screenshot URLs in this batch — busts CF/page cache
  // while keeping concurrent renders coherent.
  const batchToken = Date.now();

  // Pull live data once; reuse across templates.
  const { date, picks } = await loadFeaturedWithPicks(env);
  const top = picks[0] || null;
  const topFx = top?.fx;
  const topPick = top?.pick;

  // Per-fixture preview line used by upcoming list.
  const pickRows = picks.length
    ? picks.slice(0, 3).map(p => `• ${escHtml(firstPickLine(p)).replace(/\n/g, ' · ')}`).join('\n')
    : 'Latest match predictions are ready on ScoreOCS8.';

  // Upcoming list. For now this mirrors today's featured picks (3 max). When
  // tomorrow/day+2 content keys exist in KV (content:YYYY-MM-DD), extend this
  // to read those and concatenate. The same {upcomingList} placeholder is used.
  const upcomingList = pickRows;

  // Latest finished match (for result + highlight templates). FRESHNESS GATE:
  // only use it if it kicked off within the last 36h — otherwise the daily
  // batch would replay an old result (e.g. re-posting a days-old match every
  // morning at 9 AM) instead of skipping to the fallback text.
  let highlights = [];
  try { highlights = JSON.parse(await env.CACHE.get('highlights:latest') || '[]'); } catch {}
  const hRaw = highlights[0];
  const hFresh = hRaw && Number.isFinite(Date.parse(hRaw.kickoff_iso)) &&
    (Date.now() - Date.parse(hRaw.kickoff_iso)) < 36 * 3600 * 1000;
  const h = hFresh ? hRaw : null;

  // Cache fetched pages — multiple templates often share a source.
  const pageCache = new Map();
  const fetchPageCached = async (path) => {
    if (pageCache.has(path)) return pageCache.get(path);
    const p = fetchWebsitePage(path);
    pageCache.set(path, p);
    return p;
  };

  // Latest blog post titles for the {latestPostTitles} placeholder — fetched
  // once and reused. Falls back to a friendly line if /api/posts is empty.
  const latestPostTitles = await (async () => {
    try {
      const res = await fetch(`${PUBLIC_SITE_URL}/api/posts`);
      if (!res.ok) return '📝 New analysis coming soon · 新分析即将上线';
      const posts = await res.json();
      const top = (posts || []).slice(0, 3);
      if (!top.length) return '📝 New analysis coming soon · 新分析即将上线';
      return top.map(p => {
        const e = p.emoji || '📝';
        const t = escHtml(p.title || 'Untitled');
        const slug = p.slug || '';
        return `${e} <a href="${PUBLIC_SITE_URL}/blog/${slug}/">${t}</a>`;
      }).join('\n');
    } catch {
      return '📝 New analysis coming soon · 新分析即将上线';
    }
  })();

  // Inline customer testimonials for the {proofTestimonials} placeholder.
  // The proof post BECOMES the proof — no teaser-and-link only.
  const proofTestimonials = [
    '💬 "Won RM20K+ following the AI prediction." — MJ',
    '💬 "Copied the UCL pick and made RM8,700 profit." — AL',
    '💬 "La Liga call landed, RM3,250 return." — TAN',
  ].join('\n');

  // Templates that depend on a concrete pro pick. Refuse to post these
  // when the AI pipeline hasn't produced a real pick yet — otherwise the
  // channel ships a "Pro analysis pending" / "PRO PICK: PRO PICK" card.
  const PICK_DEPENDENT_KEYS = new Set(['prediction', 'reminder']);
  const pickReady = isPickReady(topPick);

  // Lean default — only the headline `prediction` template fires unless
  // the user has explicitly enabled others in the panel (enabled === true).
  // Previously the channel could ship up to 6 messages in one 09:00 batch
  // (prediction + upcoming + reminder + result + proof + blog), which felt
  // spammy. Now: 1 strong morning post. Re-enable individual templates from
  // the panel anytime by toggling them on.
  const CORE_KEYS = new Set(['prediction']);

  for (const key of SPORTSBOOK_TEMPLATE_KEYS) {
    const userTpl = config?.templates?.[key];
    if (userTpl && userTpl.enabled === false) {
      report.results.push({ key, status: 'skipped', reason: 'template disabled' });
      continue;
    }
    if (!CORE_KEYS.has(key) && !(userTpl && userTpl.enabled === true)) {
      report.results.push({ key, status: 'skipped', reason: 'non-core template, not explicitly enabled in panel' });
      continue;
    }
    if (PICK_DEPENDENT_KEYS.has(key) && !pickReady) {
      report.results.push({ key, status: 'skipped', reason: 'pick not ready (no pickLabel from AI pipeline yet)' });
      continue;
    }

    const fallback = SPORTSBOOK_DEFAULTS[key];
    const rawText = userTpl?.text || fallback.text;
    const buttonText = userTpl?.button || fallback.button;
    const buttonUrl = userTpl?.url || fallback.url;

    const page = await fetchPageCached(SPORTSBOOK_PAGE_BY_KEY[key] || '/');

    const placeholders = {
      // Website metadata (used by blog, proof, generic templates)
      websiteTitle: escHtml(page.title || ''),
      websiteDescription: escHtml(page.description || ''),
      websiteUrl: page.url || `${PUBLIC_SITE_URL}/`,

      // Top featured pick — used by prediction / reminder
      firstPick: top ? escHtml(firstPickLine(top)) : 'Latest AI pick is ready on ScoreOCS8.',
      firstPickName: topFx
        ? `${escHtml(topFx.teams?.home?.name || 'Home')} vs ${escHtml(topFx.teams?.away?.name || 'Away')}`
        : '',
      firstPickLeague: escHtml(topFx?.league?.name || ''),
      firstPickKickoff: topFx?.fixture?.date ? `${fmtMYT(topFx.fixture.date)} MYT` : '',
      firstPickConfidence: topPick?.confidence != null ? `${topPick.confidence}%` : '',
      firstPickLabel: escHtml(topPick?.pickLabel || topPick?.pick || 'Pending'),

      // Fixture lists
      pickRows,
      upcomingList,

      // Blog + proof template helpers
      latestPostTitles,
      proofTestimonials,

      // Affiliate signup CTA — reusable across every template body
      signupCta: SIGNUP_CTA,
      signupUrl: SIGNUP_URL,

      // Result / highlight (latest finished match)
      resultLine: h
        ? `${escHtml(h.home)} ${escHtml(h.score_home)}-${escHtml(h.score_away)} ${escHtml(h.away)}\n${escHtml(h.league || 'Football')}`
        : escHtml(page.description || 'Latest results are live on ScoreOCS8.'),
      resultScore: h
        ? `${escHtml(h.home)} ${escHtml(h.score_home)}-${escHtml(h.score_away)} ${escHtml(h.away)}`
        : '',
      resultLeague: h ? escHtml(h.league || 'Football') : '',
      youtubeUrl: h?.youtube_url || '',
    };

    const text = fillSportsbookPlaceholders(rawText, placeholders);

    // Image resolution per template. `image` field controls strategy:
    //   ''  / unset             → smart default per template key (see defaultImageStrategy)
    //   'og' / 'auto'           → force og:image from associated page
    //   'off' / 'none' / 'no'   → text-only
    //   'highlight'             → highlights:latest[0].image_url (Codex's pre-rendered card)
    //   'screenshot:<url>'      → live screenshot via Cloudflare Browser Rendering
    //                             (returns PNG bytes; sent via multipart)
    //   any explicit https URL  → use that URL directly
    const userImage = String(userTpl?.image ?? '').trim();
    const rawImage = userImage || defaultImageStrategy(key, topFx, topPick, !!h, batchToken);

    let imageUrl = '';
    let imageBytes = null;
    let imageError = null;

    if (!rawImage || /^(og|auto)$/i.test(rawImage)) {
      imageUrl = page.ogImage || '';
    } else if (/^(off|none|no)$/i.test(rawImage)) {
      // text-only — leave both image vars empty
    } else if (/^highlight$/i.test(rawImage)) {
      // Build a Telegram-optimized result card URL (/og/tg-result returns SVG;
      // we rasterize to PNG via Browser Rendering). Falls back to the older
      // /og/highlight URL stored in KV if we can't construct fresh params.
      let cardUrl = h?.image_url || '';
      if (h) {
        const params = new URLSearchParams({
          home:   h.home || 'Home',
          away:   h.away || 'Away',
          league: h.league || 'Football',
          score:  `${h.score_home ?? 0}-${h.score_away ?? 0}`,
          date:   h.kickoff_iso || '',
        });
        if (h.home_logo) params.set('home_logo', h.home_logo);
        if (h.away_logo) params.set('away_logo', h.away_logo);
        if (h.correct === true)  params.set('pick_was', 'correct');
        if (h.correct === false) params.set('pick_was', 'wrong');
        cardUrl = `${PUBLIC_SITE_URL}/og/tg-result?${params.toString()}`;
      }
      if (cardUrl) {
        try {
          imageBytes = await screenshot(env, {
            url: cardUrl,
            viewport: { width: 1280, height: 720 },
            waitUntil: 'networkidle0',
            timeoutMs: 25000,
          });
        } catch (e) {
          imageError = 'highlight rasterize failed: ' + (e.message || String(e));
          imageUrl = page.ogImage || '';
        }
      } else {
        imageUrl = page.ogImage || '';
      }
    } else if (/^screenshot:/i.test(rawImage)) {
      const targetUrl = rawImage.replace(/^screenshot:/i, '').trim() || `${PUBLIC_SITE_URL}/`;
      try {
        imageBytes = await screenshot(env, {
          url: targetUrl,
          viewport: { width: 1280, height: 720 },
          waitUntil: 'networkidle0',
          timeoutMs: 25000,
        });
      } catch (e) {
        imageError = 'screenshot failed: ' + (e.message || String(e));
        // Fall back to og:image so the post still ships with an image
        imageUrl = page.ogImage || '';
      }
    } else {
      imageUrl = rawImage;
    }

    await new Promise(resolve => setTimeout(resolve, 700));
    const result = await sendTemplateMessage(env, { text, buttonText, buttonUrl, imageUrl, imageBytes });
    if (imageError) result.imageError = imageError;
    report.results.push({ key, ...result });
  }

  report.status = 'ok';
  report.date = date;
  report.sent = report.results.filter(r => r.status === 'ok').length;
  report.failed = report.results.filter(r => r.status === 'error').length;
  report.skipped = report.results.filter(r => r.status === 'skipped').length;
  await env.CACHE.put(`post:telegram:sportsbook-test:${Date.now()}`, JSON.stringify(report), {
    expirationTtl: 14 * 24 * 3600,
  });
  return report;
}

// Daily cron handler. Only fires the Telegram batch when the panel's Automation
// toggle is ON (config.enabled === true). Idempotent within a day: a per-day
// flag in KV prevents double-firing if the cron retries.
async function runSportsbookDaily(env) {
  const config = await readSportsbookConfigFromKV(env);
  if (!config || !config.enabled) {
    return { status: 'skipped', reason: 'autopost disabled — toggle Automation ON in panel' };
  }

  // Content freshness gate: between seasons/tournaments there are no upcoming
  // fixtures, and the batch would post empty shells ("Upcoming Matches" with
  // nothing behind it — exactly what happened after the WC final). Skip
  // WITHOUT burning the daily slot until a fixture is coming up within 72h;
  // when the new season's fixtures land, posting resumes by itself.
  try {
    const fx = await fetch(`${PUBLIC_SITE_URL}/api/fixtures`).then(r => r.ok ? r.json() : null);
    const now = Date.now();
    const hasUpcoming = (fx?.leagues || []).some(lg =>
      ['today', 'next'].some(k => (lg[k] || []).some(m => {
        const t = new Date(m.fixture?.date || 0).getTime();
        return Number.isFinite(t) && t > now && t - now < 72 * 3600 * 1000;
      })));
    if (!hasUpcoming) {
      return { status: 'skipped', reason: 'no upcoming fixtures within 72h — paused until fresh matches land' };
    }
  } catch { /* if the check itself fails, fall through and post as before */ }

  const todayMyt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const dedupKey = `sportsbook:daily-fired:${todayMyt}`;
  const alreadyFired = await env.CACHE.get(dedupKey);
  if (alreadyFired) {
    return { status: 'skipped', reason: `already fired today (${todayMyt})`, ts: alreadyFired };
  }

  // Reserve the slot BEFORE the send so a retry loop can't double-fire while
  // we're mid-batch. TTL 36h covers any timezone weirdness.
  await env.CACHE.put(dedupKey, String(Date.now()), { expirationTtl: 36 * 3600 });

  const result = await postSportsbookTemplateTest(env);
  result.trigger = 'daily-cron';
  result.fired_on = todayMyt;

  // If the pick-dependent templates were skipped because the AI pipeline
  // hadn't produced a real pick yet, release the dedup slot so a manual
  // retry (or the next cron tick, if added) can re-fire once picks land.
  // Otherwise today's prediction post is silently lost for 36h.
  const skippedForPickGap = (result.results || []).some(r =>
    r.status === 'skipped' && /pick not ready/i.test(r.reason || '')
  );
  if (skippedForPickGap) {
    await env.CACHE.delete(dedupKey);
    result.dedup = 'released — pick not ready, retry allowed';
  }

  // Fan out to PWA push subscribers when the headline `prediction` template
  // actually fired. The daily dedup above means this only ever fires once
  // per match day, matching the single Telegram morning post.
  const predictionFired = (result.results || []).some(r =>
    r.key === 'prediction' && r.status === 'ok'
  );
  if (predictionFired) {
    const { picks } = await loadFeaturedWithPicks(env).catch(() => ({ picks: [] }));
    const top = picks[0];
    const home = top?.fx?.teams?.home?.name || '';
    const away = top?.fx?.teams?.away?.name || '';
    const pickLabel = top?.pick?.pickLabel || top?.pick?.pick || '';
    const headline = home && away
      ? `Today's pro pick: ${home} vs ${away}`
      : `Today's pro picks are ready`;
    const body = pickLabel
      ? `Pick: ${pickLabel} · ${picks.length} match${picks.length === 1 ? '' : 'es'} on the slate`
      : `Tap to see the day's slate at ScoreOcs8.`;
    result.push = await broadcastPush(env, {
      title: headline,
      body,
      url: '/',
      tag: `daily-${todayMyt}`,
    });
  }

  return result;
}

async function postToX(env, photoBytes, text, date) {
  if (!env.X_API_KEY) return { status: 'skipped', reason: 'not configured' };
  try {
    const res = await X.postPhoto(env, { photoBytes, text });
    await env.CACHE.put(
      `post:x:daily:${date}`,
      JSON.stringify({ date, tweetId: res.tweetId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: 'ok', tweetId: res.tweetId };
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
  }
}

async function postToIG(env, imageUrl, caption, date) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) return { status: 'skipped', reason: 'not configured' };
  try {
    const res = await IG.postPhoto(env, { imageUrl, caption });
    await env.CACHE.put(
      `post:ig:daily:${date}`,
      JSON.stringify({ date, mediaId: res.mediaId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: 'ok', mediaId: res.mediaId, retried: !!res.retried };
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
  }
}

async function postToThreads(env, imageUrl, text, date) {
  if (!env.THREADS_USER_ID || !env.THREADS_ACCESS_TOKEN) return { status: 'skipped', reason: 'not configured' };
  try {
    const res = await Threads.postPhoto(env, { imageUrl, text });
    await env.CACHE.put(
      `post:threads:daily:${date}`,
      JSON.stringify({ date, threadId: res.threadId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: 'ok', threadId: res.threadId, retried: !!res.retried };
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
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

// Current hour/minute in MYT, for time-gating heartbeat-driven posts.
function nowMytHM() {
  const s = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const [h, m] = s.split(':').map(n => parseInt(n, 10));
  return { h, m };
}

// MYT date string offset by N days from now (negative = past, positive = future).
function mytDateOffset(days = 0) {
  return new Date(Date.now() + days * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// Load ft-queue entries across yesterday/today/tomorrow MYT buckets.
//
// Matches are filed under their KICKOFF MYT date, but the readers fire on a
// clock that can land on an ADJACENT calendar day: the KO-30 alert and KO-12h
// poll run the *evening before* a 00:00 MYT kickoff, and a KO+100 FT check can
// spill past midnight. Reading only ft-queue:<today> therefore silently misses
// any match sitting in a neighbouring bucket — most visibly the 12:00am MYT
// fixtures. Scanning a 3-day window fixes that. Each entry is tagged with
// _qdate so it can be written back to the exact bucket it came from.
async function loadFtQueueWindow(env) {
  const dates = [mytDateOffset(-1), mytDateOffset(0), mytDateOffset(1)];
  const entries = [];
  const seen = new Set();
  for (const d of dates) {
    let raw;
    try { raw = await env.CACHE.get(`ft-queue:${d}`); } catch { continue; }
    if (!raw) continue;
    let arr;
    try { arr = JSON.parse(raw); } catch { continue; }
    for (const e of arr) {
      if (e?.fixture_id == null || seen.has(e.fixture_id)) continue;
      seen.add(e.fixture_id);
      entries.push({ ...e, _qdate: d });
    }
  }
  return { dates, entries };
}

// Persist window entries back to their origin bucket (_qdate), preserving the
// one-bucket-per-match invariant. Loaded buckets that end up empty are written
// as [] so removed fixtures don't linger.
async function saveFtQueueWindow(env, loadedDates, entries, ttlSec) {
  const byDate = {};
  for (const d of loadedDates) byDate[d] = [];
  for (const e of entries) {
    const { _qdate, ...clean } = e;
    const d = _qdate || mytDateOffset(0);
    (byDate[d] = byDate[d] || []).push(clean);
  }
  for (const [d, list] of Object.entries(byDate)) {
    await env.CACHE.put(`ft-queue:${d}`, JSON.stringify(list), { expirationTtl: ttlSec });
  }
}

function isoWeekKey(d = new Date()) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tgt.getUTCDay() || 7;
  tgt.setUTCDate(tgt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((tgt - yearStart) / 86400000) + 1) / 7);
  return `${tgt.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Decide if a pro pick was correct given the final score.
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

// Append a reconciled match to history:matches. Keeps newest-first, capped
// at 60 entries (enough to power the homepage table + weekly/monthly stats
// without bloating KV values). 90-day TTL.
async function appendHistory(env, entry) {
  const raw = await env.CACHE.get('history:matches');
  let list = [];
  if (raw) { try { list = JSON.parse(raw); } catch {} }
  // De-dupe: if same fixture was already logged, replace it (e.g. retry).
  list = list.filter(m => m.fixture_id !== entry.fixture_id);
  list.unshift(entry);
  list = list.slice(0, 60);
  await env.CACHE.put('history:matches', JSON.stringify(list), {
    expirationTtl: 90 * 24 * 3600,
  });
}

async function appendHighlight(env, entry) {
  const raw = await env.CACHE.get('highlights:latest');
  let list = [];
  if (raw) { try { list = JSON.parse(raw); } catch {} }
  list = list.filter(m => m.fixture_id !== entry.fixture_id);
  list.unshift(entry);
  list = list.slice(0, 24);
  await env.CACHE.put('highlights:latest', JSON.stringify(list), {
    expirationTtl: 90 * 24 * 3600,
  });
}

function highlightImageUrl(fx) {
  const home = fx?.teams?.home?.name || 'Home';
  const away = fx?.teams?.away?.name || 'Away';
  const league = fx?.league?.name || 'Football';
  const score = `${fx?.goals?.home ?? 0}-${fx?.goals?.away ?? 0}`;
  const params = new URLSearchParams({
    home,
    away,
    league,
    score,
    date: fx?.fixture?.date || '',
  });
  if (fx?.teams?.home?.logo) params.set('home_logo', fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set('away_logo', fx.teams.away.logo);
  return `${SITE_URL}/og/highlight?${params.toString()}`;
}

// Telegram-optimized full-time result card (1280x720 SVG, rasterized to PNG
// by Browser Rendering). Built straight from an API-Football fixture object.
function tgResultCardUrl(fx, correct) {
  const params = new URLSearchParams({
    home:   fx?.teams?.home?.name || 'Home',
    away:   fx?.teams?.away?.name || 'Away',
    league: fx?.league?.name || 'Football',
    score:  `${fx?.goals?.home ?? 0}-${fx?.goals?.away ?? 0}`,
    date:   fx?.fixture?.date || '',
  });
  if (fx?.teams?.home?.logo) params.set('home_logo', fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set('away_logo', fx.teams.away.logo);
  if (correct === true) params.set('pick_was', 'correct');
  if (correct === false) params.set('pick_was', 'wrong');
  return `${PUBLIC_SITE_URL}/og/tg-result?${params.toString()}`;
}

// Stage title from the round string — names the big knockout matches.
function wcStageTitle(round) {
  const r = String(round || '').toLowerCase();
  if (r.includes('semi')) return 'SEMI-FINAL';
  if (r.includes('quarter')) return 'QUARTER-FINAL';
  if (r.includes('3rd') || r.includes('third')) return '3RD PLACE MATCH';
  if (r.includes('final')) return 'FINAL';
  if (r.includes('16')) return 'ROUND OF 16';
  if (r.includes('32')) return 'ROUND OF 32';
  return '';
}

// Branded pre-match PREDICTION card image (pick, confidence, predicted score,
// risk) — screenshotted and posted with the pre-match alert.
function tgPredictionCardUrl(fx, pick) {
  const stage = fx?.league?.id === 1 ? wcStageTitle(fx?.league?.round) : '';
  const params = new URLSearchParams({
    home:   fx?.teams?.home?.name || 'Home',
    away:   fx?.teams?.away?.name || 'Away',
    league: stage ? `FIFA World Cup · ${stage}` : (fx?.league?.name || 'FIFA World Cup'),
    date:   fx?.fixture?.date || '',
  });
  if (fx?.teams?.home?.logo) params.set('home_logo', fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set('away_logo', fx.teams.away.logo);
  const tag = pick?.pickLabel || pick?.pick;
  if (tag) params.set('tag', String(tag));
  if (pick?.pick) params.set('pick', String(pick.pick));
  if (pick?.confidence != null) params.set('confidence', String(pick.confidence));
  if (pick?.correctScore) params.set('score', String(pick.correctScore));
  if (pick?.risk) params.set('risk', String(pick.risk));
  return `${PUBLIC_SITE_URL}/og/tg-prediction?${params.toString()}`;
}

function youtubeSearchUrl(fx) {
  const home = fx?.teams?.home?.name || '';
  const away = fx?.teams?.away?.name || '';
  const score = `${fx?.goals?.home ?? ''}-${fx?.goals?.away ?? ''}`;
  const query = `${home} ${score} ${away} highlights`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function youtubeChannelTokens(env) {
  const raw = String(env.YOUTUBE_CHANNELS || env.YOUTUBE_CHANNEL_IDS || DEFAULT_YOUTUBE_CHANNELS);
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function youtubeHandleFromToken(token) {
  const s = String(token || '').trim();
  const handleUrl = s.match(/youtube\.com\/@([^/?#]+)/i);
  if (handleUrl) return handleUrl[1];
  if (s.startsWith('@')) return s.slice(1);
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(s)) return null;
  return s.replace(/^@/, '');
}

function youtubeChannelIdFromToken(token) {
  const s = String(token || '').trim();
  const channelUrl = s.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (channelUrl) return channelUrl[1];
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

async function resolveYoutubeChannelId(env, token) {
  const direct = youtubeChannelIdFromToken(token);
  if (direct) return direct;
  const handle = youtubeHandleFromToken(token);
  if (!handle || !env.YOUTUBE_API_KEY) return null;
  const cacheKey = `youtube:channel:${handle.toLowerCase()}`;
  const cached = await env.CACHE?.get(cacheKey).catch(() => null);
  if (cached) return cached;
  const params = new URLSearchParams({
    part: 'id',
    forHandle: handle,
    key: env.YOUTUBE_API_KEY,
  });
  const res = await fetch(`${YOUTUBE_CHANNELS_API}?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  const id = data.items?.[0]?.id || null;
  if (id) await env.CACHE?.put(cacheKey, id, { expirationTtl: 60 * 60 * 24 * 30 }).catch(() => {});
  return id;
}

async function youtubeChannelIds(env) {
  const ids = [];
  for (const token of youtubeChannelTokens(env)) {
    const id = await resolveYoutubeChannelId(env, token);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function youtubeVideoScore(item, fx) {
  const title = String(item?.snippet?.title || '').toLowerCase();
  const home = String(fx?.teams?.home?.name || '').toLowerCase();
  const away = String(fx?.teams?.away?.name || '').toLowerCase();
  const score = `${fx?.goals?.home ?? ''}-${fx?.goals?.away ?? ''}`;
  let points = 0;
  if (home && title.includes(home)) points += 3;
  if (away && title.includes(away)) points += 3;
  if (score && title.includes(score)) points += 2;
  if (/highlight|highlights|ringkasan|extended|full time|ft/.test(title)) points += 2;
  return points;
}

async function findYoutubeHighlight(env, fx) {
  if (!env.YOUTUBE_API_KEY) return null;
  const home = fx?.teams?.home?.name || '';
  const away = fx?.teams?.away?.name || '';
  const score = `${fx?.goals?.home ?? ''}-${fx?.goals?.away ?? ''}`;
  const q = `${home} ${score} ${away} highlights`;
  try {
    let items = [];
    const channelIds = await youtubeChannelIds(env);
    const searches = [...channelIds, null];
    for (const channelId of searches) {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        maxResults: '5',
        order: 'date',
        q,
        key: env.YOUTUBE_API_KEY,
      });
      if (channelId) params.set('channelId', channelId);
      const res = await fetch(`${YOUTUBE_SEARCH_API}?${params.toString()}`);
      if (!res.ok) continue;
      const data = await res.json();
      items = items.concat(data.items || []);
    }
    const video = items
      .filter(item => item?.id?.videoId)
      .sort((a, b) => {
        const scoreDiff = youtubeVideoScore(b, fx) - youtubeVideoScore(a, fx);
        if (scoreDiff) return scoreDiff;
        return new Date(b.snippet?.publishedAt || 0) - new Date(a.snippet?.publishedAt || 0);
      })[0];
    if (!video) return null;
    return {
      url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
      video_id: video.id.videoId,
      title: video.snippet?.title || null,
      channel: video.snippet?.channelTitle || null,
      thumbnail: video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || null,
      matched_at: Date.now(),
    };
  } catch {
    return null;
  }
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

// 12h pre-match Telegram poll. Fires off the */15 heartbeat — scans the last
// few days of generateDaily content for fixtures whose kickoff lies in the
// 11h45m..12h15m window (covers any single */15 firing), posts a 'Who wins?'
// poll once per fixture (KV flag `poll:posted:<id>` prevents duplicates).
async function postPrematchPolls(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'telegram not configured' };
  }
  if (!env?.CACHE) {
    return { status: 'skipped', reason: 'no KV binding' };
  }
  const now = Date.now();
  const WINDOW = 15 * 60 * 1000; // ±15 min around the 12h mark
  const targetMs = 12 * 3600 * 1000;

  // Walk the next 2 days of stored daily content (today + tomorrow MYT)
  // since 12h-before-kickoff can sit either side of the date boundary.
  // MOTD-only: previously polled every featured fixture (up to 3 polls
  // per day on a busy slate), which felt spammy. Now we only poll the
  // top.fixture — one curated fan poll per day, matched to the same
  // fixture the pre-match alert + FT slip + recap headline. Previews
  // skipped intentionally.
  const seenFixtures = new Map();
  for (let i = 0; i < 2; i++) {
    const d = new Date(now + i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
    let bundle;
    try {
      bundle = await env.CACHE.get(`content:${d}`, 'json');
    } catch { continue; }
    if (!bundle) continue;
    const items = [];
    if (bundle.top?.fixture) items.push(bundle.top.fixture);
    // bundle.previews intentionally NOT included — MOTD only.
    for (const fx of items) {
      const id = fx?.fixture?.id;
      if (!id || seenFixtures.has(id)) continue;
      seenFixtures.set(id, fx);
    }
  }

  const results = [];
  for (const [id, fx] of seenFixtures) {
    const kickoffMs = new Date(fx.fixture?.date || 0).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const msUntil = kickoffMs - now;
    if (Math.abs(msUntil - targetMs) > WINDOW) continue;

    const flagKey = `poll:posted:${id}`;
    const already = await env.CACHE.get(flagKey).catch(() => null);
    if (already) {
      results.push({ id, status: 'skipped', reason: 'already posted' });
      continue;
    }

    const home = fx.teams?.home?.name || 'Home';
    const away = fx.teams?.away?.name || 'Away';
    const league = fx.league?.name || 'Football';
    try {
      const poll = await sendPoll(env, {
        question: `⚽ Who wins? · 谁会获胜?\n${league}\n${home} vs ${away}`,
        options: [home, 'Draw · 平局', away],
        isAnonymous: true,
      });
      // 13h TTL — past kickoff the flag self-expires so KV doesn't grow.
      await env.CACHE.put(flagKey, '1', { expirationTtl: 13 * 3600 });
      results.push({ id, status: 'ok', messageId: poll.message_id, kickoff: fx.fixture?.date });
    } catch (e) {
      results.push({ id, status: 'error', error: String(e.message || e) });
    }
  }

  return { status: 'ok', checked: seenFixtures.size, results };
}

// --- KO-30 pre-match alert --------------------------------------------------
//
// Fires once per Match-of-the-Day fixture when kickoff is ~15-35 min away.
// The window is wider than 30 ± a few to guarantee that at least one of the
// */15 cron ticks lands inside it; the per-fixture KV dedup
// (posted:premat30:<id>) ensures we never double-send.
//
// Cost: 0-1 sendMessage calls per cron tick. Skipped entirely when pick
// isn't ready, so a stalled AI pipeline never produces a broken alert.
async function postPreMatchAlerts(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'telegram not configured' };
  }
  const date = todayMYT();
  // Scan yesterday/today/tomorrow so 12:00am MYT kickoffs (whose KO-30 window
  // falls the previous evening) are never missed.
  const { entries: queue } = await loadFtQueueWindow(env);
  if (!queue.length) return { status: 'skipped', reason: 'no queued fixtures', date };

  const now = Date.now();
  // Window: 15-35 min before kickoff. Wide enough for the */15 heartbeat
  // to overlap regardless of which minute it fires, narrow enough that
  // the alert text "Match of the Day" stays accurate.
  const WINDOW_MIN_MS = 15 * 60 * 1000;
  const WINDOW_MAX_MS = 35 * 60 * 1000;

  const report = { date, eligible: 0, posted: 0, skipped: 0, errors: [] };

  for (const item of queue) {
    // Pre-match alert fires for the MOTD fixture AND every World Cup fixture
    // (is_wc). Other non-WC featured fixtures track silently — same
    // channel-flood-prevention as the FT result post in checkFinishedMatches().
    if (!item.is_motd && !item.is_wc) continue;
    const kickoffMs = new Date(item.kickoff_iso).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const tilKO = kickoffMs - now;
    if (tilKO < WINDOW_MIN_MS || tilKO > WINDOW_MAX_MS) continue;
    report.eligible += 1;

    const dedupKey = `posted:premat30:${item.fixture_id}`;
    if (await env.CACHE.get(dedupKey).catch(() => null)) {
      report.skipped += 1;
      continue;
    }

    try {
      const pick = await env.CACHE.get(`prediction:${item.fixture_id}`, 'json').catch(() => null);
      const pickReady = isPickReady(pick);

      // For a non-WC MOTD we still refuse to ship a "Pro analysis pending"
      // alert — the slip-style caption needs a real pick. World Cup matches
      // always post: the lightweight match-update caption is fine pick-less.
      if (!item.is_wc && !pickReady) {
        report.skipped += 1;
        report.errors.push({ fixture_id: item.fixture_id, error: 'pick not ready at KO-30' });
        continue;
      }

      const fxData = await afGet(env, '/fixtures', { id: item.fixture_id });
      const fx = fxData.response?.[0];
      if (!fx) {
        report.errors.push({ fixture_id: item.fixture_id, error: 'fixture not found' });
        continue;
      }

      // World Cup match update now carries a compact prediction (pick +
      // confidence + one line). Use the warmed KV pick if present, else fetch
      // /api/predictions so even un-warmed WC fixtures get a form preview.
      let wcPick = (pick && (pick.pickLabel || pick.pick)) ? pick : null;
      if (item.is_wc && !wcPick) {
        wcPick = await fetch(`${SITE_URL}/api/predictions?fixture_id=${item.fixture_id}`)
          .then(r => r.ok ? r.json() : null).catch(() => null);
      }
      const caption = item.is_wc
        ? buildMatchUpdateCaption({ fixture: fx, pick: wcPick, siteUrl: SITE_URL })
        : buildPreMatchMotdCaption({ fixture: fx, pick, siteUrl: SITE_URL });

      // World Cup: post a branded prediction CARD IMAGE (screenshot of
      // /og/tg-prediction) with the caption; fall back to text if the render
      // fails. Non-WC MOTD stays a plain text alert.
      let msg;
      if (item.is_wc) {
        try {
          const png = await screenshot(env, {
            url: tgPredictionCardUrl(fx, wcPick),
            viewport: { width: 1280, height: 720 },
            waitUntil: 'networkidle0',
            timeoutMs: 25000,
          });
          msg = await sendPhoto(env, { photoBytes: png, caption });
        } catch (e) {
          msg = await sendMessage(env, { text: caption });
          report.errors.push({ fixture_id: item.fixture_id, error: 'tg-prediction render failed, sent text: ' + (e.message || String(e)) });
        }
      } else {
        msg = await sendMessage(env, { text: caption });
      }
      if (msg?.disabled) { report.skipped += 1; continue; }
      // 6h TTL — past kickoff the flag self-expires so KV stays clean.
      await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: now }), {
        expirationTtl: 6 * 3600,
      });
      report.posted += 1;

      // Fan out to PWA push subscribers — only for the MOTD, so a busy WC day
      // with 3-4 matches doesn't fire 3-4 OS notifications. Telegram still
      // gets the per-match update above.
      if (item.is_motd) {
        const home = fx?.teams?.home?.name || 'Home';
        const away = fx?.teams?.away?.name || 'Away';
        const slug = `${home}-vs-${away}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
        const pickText = pick?.pickLabel || pick?.pick;
        const pushResult = await broadcastPush(env, {
          title: `⚡ Starts in 30 min · ${home} vs ${away}`,
          body: pickText ? `Pro pick: ${pickText}` : `Kicks off in ~30 min — tap for live tracking`,
          url: `/match/${item.fixture_id}-${slug}/`,
          tag: `premat30-${item.fixture_id}`,
        });
        report.push = report.push || [];
        report.push.push({ fixture_id: item.fixture_id, ...pushResult });
      }
    } catch (e) {
      report.errors.push({ fixture_id: item.fixture_id, error: String(e.message || e) });
    }
  }

  return { status: 'ok', ...report };
}

async function checkFinishedMatches(env) {
  const date = todayMYT();
  // Scan yesterday/today/tomorrow so a finished match sitting in an adjacent
  // bucket (e.g. a 12:00am MYT kickoff, or an FT check that spills past
  // midnight) is still picked up and posted.
  const { dates: loadedDates, entries: queue } = await loadFtQueueWindow(env);
  if (!queue.length) return { status: 'skipped', reason: 'no queued fixtures', date };

  const now = Date.now();
  const due = queue.filter(q => !q.posted && q.check_at_ms <= now);
  if (!due.length) return { status: 'ok', due: 0, date, total: queue.length };

  // Max retries per fixture. Initial check fires at KO+100min; with a
  // 10-min retry on still-live this covers up to KO+150min — past any
  // realistic football match length including ET+PEN. Beyond this we
  // assume the match is stuck or API-Football is misreporting and stop.
  const MAX_ATTEMPTS = 6;

  const report = { date, checked: due.length, posted: 0, still_live: 0, gave_up: 0, errors: [] };

  // Batch the status lookups: one API-Football call per 20 due fixtures
  // instead of one call per fixture. This keeps quota flat even on a busy
  // 6-match World Cup day — a heartbeat tick now costs a single /fixtures
  // read regardless of how many matches are being checked.
  const fxById = new Map();
  let batchError = null;
  try {
    for (let i = 0; i < due.length; i += 20) {
      const ids = due.slice(i, i + 20).map(d => d.fixture_id).join('-');
      const data = await afGet(env, '/fixtures', { ids });
      for (const fx of (data.response || [])) {
        if (fx?.fixture?.id != null) fxById.set(fx.fixture.id, fx);
      }
    }
  } catch (e) {
    batchError = String(e.message || e);
  }

  for (const item of due) {
    try {
      if (batchError) throw new Error(batchError);
      const fx = fxById.get(item.fixture_id);
      const short = fx?.fixture?.status?.short;
      item.attempts = (item.attempts || 0) + 1;

      if (!short || LIVE_UNFINISHED.has(short)) {
        if (item.attempts >= MAX_ATTEMPTS) {
          // Give up — match has been "live" for >150min past KO.
          item.posted = true;
          item.note = `gave up after ${item.attempts} attempts, last status ${short || 'unknown'}`;
          report.gave_up += 1;
          continue;
        }
        // Match still ongoing — retry in 10 min (tighter than the old 15)
        item.check_at_ms = now + 10 * 60 * 1000;
        report.still_live += 1;
        continue;
      }
      if (!FINISHED.has(short)) {
        // Postponed / cancelled / unknown — mark posted to stop retries
        item.posted = true;
        item.note = `non-terminal status ${short}`;
        continue;
      }

      // FT reached — reconcile pick accuracy + history regardless of MOTD.
      const pick = await env.CACHE.get(`prediction:${item.fixture_id}`, 'json').catch(() => null);
      const goalsHome = fx.goals?.home;
      const goalsAway = fx.goals?.away;
      const correct = pickWasCorrect(pick, goalsHome, goalsAway);
      const accAfter = correct === null ? null : await bumpAccuracy(env, correct);

      // Result posting:
      //   • World Cup match → clean branded /og/tg-result card (score only,
      //     no AI-pick verdict / accuracy / badge). Text fallback if the
      //     screenshot fails so a finished match is never dropped.
      //   • Non-WC MOTD → rich virtual-bet-slip screenshot (needs a pick).
      //   • Everything else → tracked silently.
      if (item.is_wc) {
        const caption = buildResultCaption({
          fixture: fx,
          pickCorrect: null,
          weekAcc: null,
          siteUrl: SITE_URL,
        });
        let msg;
        try {
          const png = await screenshot(env, {
            url: tgResultCardUrl(fx, null),
            viewport: { width: 1280, height: 720 },
            waitUntil: 'networkidle0',
            timeoutMs: 25000,
          });
          msg = await sendPhoto(env, { photoBytes: png, caption });
        } catch (e) {
          msg = await sendMessage(env, { text: caption });
          report.errors.push({ fixture_id: item.fixture_id, error: 'tg-result render failed, sent text: ' + (e.message || String(e)) });
        }
        item.message_id = msg.message_id;
        report.posted += 1;
      } else if (item.is_motd) {
        const slipStatus = correct === true ? 'won' : (correct === false ? 'lost' : 'running');
        const slipUrl = `${SITE_URL}${slipPath(item.fixture_id, item.home, item.away)}?status=${slipStatus}&stake=100&v=${Date.now()}`;
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
        item.message_id = msg.message_id;
        report.posted += 1;
      } else {
        report.silent = (report.silent || 0) + 1;
      }
      item.posted = true;
      item.posted_at = Date.now();
      item.correct = correct;

      // Always append to rolling history list so the homepage
      // track-record section can render live stats even for non-MOTD picks.
      await appendHistory(env, {
        fixture_id: item.fixture_id,
        kickoff_iso: fx.fixture.date,
        sport: 'football',
        league_id: item.league_id,
        home: fx.teams?.home?.name || item.home,
        away: fx.teams?.away?.name || item.away,
        score_home: goalsHome,
        score_away: goalsAway,
        pick: pick?.pickLabel || pick?.pick || null,
        confidence: pick?.confidence ?? null,
        correct,
        ts: Date.now(),
      });

      // YouTube highlight lookup is the priciest per-match external call
      // (a few search units each). Limit it to the Match of the Day; other
      // World Cup matches still get a highlights-feed entry below, just with
      // the zero-cost search URL instead of a resolved video.
      const youtube = item.is_motd ? await findYoutubeHighlight(env, fx) : null;
      await appendHighlight(env, {
        fixture_id: item.fixture_id,
        kickoff_iso: fx.fixture.date,
        league_id: item.league_id,
        league: fx.league?.name || null,
        home: fx.teams?.home?.name || item.home,
        away: fx.teams?.away?.name || item.away,
        home_logo: fx.teams?.home?.logo || null,
        away_logo: fx.teams?.away?.logo || null,
        score_home: goalsHome,
        score_away: goalsAway,
        image_url: highlightImageUrl(fx),
        youtube_url: youtube?.url || null,
        youtube_video_id: youtube?.video_id || null,
        youtube_title: youtube?.title || null,
        youtube_channel: youtube?.channel || null,
        youtube_thumbnail: youtube?.thumbnail || null,
        youtube_search_url: youtubeSearchUrl(fx),
        source: 'ft-cron',
        ts: Date.now(),
      });
    } catch (e) {
      report.errors.push({ fixture_id: item.fixture_id, error: String(e.message || e) });
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts >= MAX_ATTEMPTS) {
        item.posted = true;
        item.note = `gave up after ${item.attempts} errored attempts`;
        report.gave_up += 1;
      } else {
        // Exponential backoff capped at 30 min so transient API-Football
        // outages don't peg us to the same 30-min retry indefinitely.
        const backoff = Math.min(30, 5 * item.attempts) * 60 * 1000;
        item.check_at_ms = Date.now() + backoff;
      }
    }
  }

  // Persist queue with updated states — each entry back to its origin bucket.
  await saveFtQueueWindow(env, loadedDates, queue, 48 * 3600);

  // Event-driven daily recap: when EVERY queued fixture is posted (either
  // FT'd, postponed, or gave-up) AND at least one had a real W/L verdict,
  // fire the recap. Means the recap always lands right after the last
  // match of the day, regardless of whether that's 22:00 or 06:00 MYT.
  // postDailyRecap has its own KV dedup so calling it on every tick after
  // completion is safe. Scoped to TODAY's bucket so a 3-day window load
  // doesn't hold the recap hostage to yesterday's/tomorrow's matches.
  let recap = null;
  let upcoming = null;
  const todayQueue = queue.filter(q => q._qdate === date);
  const allDone = todayQueue.length > 0 && todayQueue.every(q => q.posted === true);
  const anyReconciled = todayQueue.some(q => q.correct === true || q.correct === false);
  if (allDone) {
    // Post the next day's upcoming-matches card right after the day's last
    // final whistle. Independent of pick reconciliation (WC matches carry no
    // pick), KV-deduped so it fires once per day.
    upcoming = await postWcUpcomingCard(env);
    // Updated group standings after the day's slate completes (KV-deduped).
    await postGroupStandings(env).catch(() => null);
  }
  if (allDone && anyReconciled) {
    recap = await postDailyRecap(env);
  }

  return { status: 'ok', ...report, total: queue.length, recap, upcoming };
}

// --- Daily recap (event-driven, fires after last FT reconciled) -------------
//
// Per-day W/L summary + running week record + tomorrow MOTD teaser. Fires
// after the last match of the day has had time to reach FT (~23:30 MYT = the
// tail of the European evening slate, ~3h after KO of a 20:00 MYT game).
//
// Dedup: posted:recap:<date> with 36h TTL. Skips silently when there's
// nothing reconciled to report (off-days produce no spam).
async function postDailyRecap(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'telegram not configured' };
  }
  const date = todayMYT();
  const dedupKey = `posted:recap:${date}`;
  if (await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: 'skipped', reason: 'already posted', date };
  }

  // 1. Today's reconciled results from the ft-queue.
  const raw = await env.CACHE.get(`ft-queue:${date}`);
  let queue = [];
  if (raw) { try { queue = JSON.parse(raw); } catch {} }
  const reconciled = queue.filter(q =>
    q.posted === true && (q.correct === true || q.correct === false)
  );
  if (reconciled.length === 0) {
    return { status: 'skipped', reason: 'no reconciled results today', date };
  }
  const wins = reconciled.filter(q => q.correct === true).length;
  const losses = reconciled.length - wins;

  // 2. Running week record (already maintained by bumpAccuracy()).
  let weekAcc = null;
  try {
    const wraw = await env.CACHE.get('accuracy:week:current');
    if (wraw) {
      const w = JSON.parse(wraw);
      if (w.total) {
        weekAcc = { hits: w.hits, total: w.total, pct: Math.round((w.hits / w.total) * 100) };
      }
    }
  } catch {}

  // 3. Tomorrow's MOTD teaser — first featured fixture from the next-day bundle.
  const tomorrowDate = new Date(Date.now() + 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  let tomorrowFx = null;
  try {
    const bundle = await env.CACHE.get(`content:${tomorrowDate}`, 'json');
    tomorrowFx = bundle?.top?.fixture || null;
  } catch {}

  // 4. Build the caption.
  const lines = [];
  lines.push('<b>📊 Daily Recap · 今日回顾</b>');
  lines.push('');
  for (const r of reconciled) {
    const emoji = r.correct === true ? '✅' : '❌';
    const verdict = r.correct === true ? 'WIN' : 'LOSS';
    lines.push(`${emoji} ${r.home || 'Home'} vs ${r.away || 'Away'} — ${verdict}`);
  }
  lines.push('');
  lines.push(`<b>Today:</b> ${wins}W · ${losses}L`);
  if (weekAcc) {
    lines.push(`<b>This week:</b> ${weekAcc.hits}/${weekAcc.total} (${weekAcc.pct}%)`);
  }

  if (tomorrowFx) {
    const home = tomorrowFx.teams?.home?.name || 'TBD';
    const away = tomorrowFx.teams?.away?.name || 'TBD';
    const league = tomorrowFx.league?.name || 'Football';
    const ko = tomorrowFx.fixture?.date;
    let koStr = '';
    if (ko) {
      const koDate = new Date(ko);
      if (!isNaN(koDate.getTime())) {
        koStr = koDate.toLocaleString('en-GB', {
          timeZone: 'Asia/Kuala_Lumpur',
          day: '2-digit', month: 'short',
          hour: '2-digit', minute: '2-digit',
          hour12: false,
        }) + ' MYT';
      }
    }
    lines.push('');
    lines.push('<b>⚽ Tomorrow · 明日焦点</b>');
    lines.push(`${league} · ${home} vs ${away}`);
    if (koStr) lines.push(`Kickoff: ${koStr}`);
  }

  lines.push('');
  lines.push(`<a href="${SITE_URL}">Open ScoreOCS8 for full AI analysis →</a>`);

  try {
    const msg = await sendMessage(env, { text: lines.join('\n') });
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600,
    });

    // Fan out to PWA push subscribers. Compact summary suited to the OS
    // notification line (most platforms truncate body around 100 chars).
    const tomorrowLine = tomorrowFx
      ? `Tomorrow: ${tomorrowFx.teams?.home?.name || 'TBD'} vs ${tomorrowFx.teams?.away?.name || 'TBD'}`
      : '';
    const weekLine = weekAcc ? ` · Week ${weekAcc.hits}/${weekAcc.total}` : '';
    const pushResult = await broadcastPush(env, {
      title: `📊 Today: ${wins}W · ${losses}L${weekLine}`,
      body: tomorrowLine || 'Open ScoreOcs8 for today\'s recap.',
      url: '/',
      tag: `recap-${date}`,
    });

    return {
      status: 'ok',
      date,
      day: { played: reconciled.length, wins, losses },
      weekAcc,
      tomorrow: tomorrowFx ? {
        home: tomorrowFx.teams?.home?.name,
        away: tomorrowFx.teams?.away?.name,
      } : null,
      message_id: msg.message_id,
      push: pushResult,
    };
  } catch (e) {
    return { status: 'error', error: String(e.message || e) };
  }
}

// --- Daily World Cup group card -------------------------------------------
//
// Screenshots /wc-card/ (the group fixtures + standings digest) once per day
// and posts it to Telegram. The page auto-features the group with the next
// kickoff, so the card is always relevant. Dedup: posted:wc-card:<date>.
//
// Cost: one Browser Rendering screenshot + one sendPhoto per day.
// slot: 'preview' (00:30 MYT, fixtures before kickoff) | 'recap' (15:00 MYT,
// final scores after the day's matches finish). Same card URL — the page
// auto-shows kickoff times or FT scores per match — only the dedup key and
// caption differ, so both can post on the same day.
// Count World Cup matches whose kickoff falls on the given MYT day. Used to
// guard the daily digest card from posting "0 MATCHES". Reads wc-schedule,
// falling back to /api/fixtures (the source the predictions page uses).
async function countWcMatchesForDay(env, dayKey) {
  const mytKey = iso => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); } catch { return ''; } };
  try {
    const sched = await fetch(`${SITE_URL}/api/wc-schedule`).then(r => r.ok ? r.json() : null).catch(() => null);
    let dates = (sched?.matches || []).map(m => m.date);
    if (!dates.length) {
      const fx = await fetch(`${SITE_URL}/api/fixtures?league=1&season=2026`).then(r => r.ok ? r.json() : null).catch(() => null);
      const lg = fx?.leagues?.[0];
      const buckets = lg ? [...(lg.today || []), ...(lg.next || []), ...(lg.last || [])] : [];
      dates = buckets.map(f => f.fixture?.date);
    }
    return dates.filter(d => mytKey(d) === dayKey).length;
  } catch {
    return 0;
  }
}

async function postWorldCupCard(env, slot = 'preview', opts = {}) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'telegram not configured' };
  }
  const date = todayMYT();
  const dedupKey = (slot === 'recap' ? 'posted:wc-recap:' : 'posted:wc-card:') + date;
  if (!opts.force && await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: 'skipped', reason: 'already posted today', slot, date };
  }
  // Never post a blank "0 MATCHES" card. Skip (without burning the dedup slot)
  // when nothing is scheduled for today so a later tick retries once data lands.
  const todayCount = await countWcMatchesForDay(env, date);
  if (todayCount === 0) {
    return { status: 'skipped', reason: 'no WC matches today', slot, date };
  }
  try {
    const png = await screenshot(env, {
      url: `${SITE_URL}/wc-card/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1350 },
      waitUntil: 'networkidle0',
      timeoutMs: 30000,
    });
    const caption = buildWcCardCaption({ date, siteUrl: SITE_URL, recap: slot === 'recap' });
    const msg = await sendPhoto(env, { photoBytes: png, caption });
    // sendPhoto returns { disabled: true } when the kill-switch is on — don't
    // burn the dedup slot in that case so it posts once posting is re-enabled.
    if (msg?.disabled) return { status: 'skipped', reason: 'posting disabled (tg:posting=off)', slot, date };
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600,
    });
    return { status: 'ok', slot, date, message_id: msg.message_id };
  } catch (e) {
    return { status: 'error', error: String(e.message || e), slot, date };
  }
}

// --- Upcoming-matches card --------------------------------------------------
//
// Screenshots /wc-upcoming/ (next day's fixtures, MatchDay style) and posts it
// to Telegram. Fired event-driven from checkFinishedMatches once every match
// in the day's queue is done, so it lands right after the last final whistle.
// Dedup: posted:wc-upcoming:<date>.
// Count upcoming World Cup matches from the same sources the card uses, so we
// never screenshot+post a blank "Upcoming Matches" card. Falls back to
// /api/fixtures (the source the predictions page uses) if wc-schedule is empty.
async function countUpcomingWcMatches(env) {
  const now = Date.now();
  const FIN = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);
  const upcoming = (date, status) =>
    !FIN.has(status) && new Date(date).getTime() > now - 15 * 60 * 1000;
  try {
    const sched = await fetch(`${SITE_URL}/api/wc-schedule`).then(r => r.ok ? r.json() : null).catch(() => null);
    let matches = (sched?.matches || []).map(m => ({ date: m.date, status: m.status }));
    if (!matches.length) {
      const fx = await fetch(`${SITE_URL}/api/fixtures?league=1&season=2026`).then(r => r.ok ? r.json() : null).catch(() => null);
      const lg = fx?.leagues?.[0];
      const buckets = lg ? [...(lg.today || []), ...(lg.next || [])] : [];
      matches = buckets.map(f => ({ date: f.fixture?.date, status: f.fixture?.status?.short || 'NS' }));
    }
    return matches.filter(m => upcoming(m.date, m.status)).length;
  } catch {
    return 0; // on error, treat as "no data" and skip — better blank than wrong
  }
}

async function postWcUpcomingCard(env, opts = {}) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: 'skipped', reason: 'telegram not configured' };
  }
  const date = todayMYT();
  // opts.date pins the card to a specific MYT day (e.g. force-post 2026-06-22);
  // otherwise the card auto-selects the next upcoming match day.
  const dedupKey = `posted:wc-upcoming:${opts.date || date}`;
  if (!opts.force && await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: 'skipped', reason: 'already posted', date: opts.date || date };
  }
  // Never post a blank card. If there are no matches for the target window,
  // skip WITHOUT setting the dedup flag so a later heartbeat retries.
  const matchCount = opts.date
    ? await countWcMatchesForDay(env, opts.date)
    : await countUpcomingWcMatches(env);
  if (matchCount === 0) {
    return { status: 'skipped', reason: 'no matches for that day', date: opts.date || date };
  }
  try {
    const png = await screenshot(env, {
      url: `${SITE_URL}/wc-upcoming/?v=${Date.now()}${opts.date ? `&date=${encodeURIComponent(opts.date)}` : ''}`,
      viewport: { width: 1080, height: 1350 },
      waitUntil: 'networkidle0',
      timeoutMs: 30000,
    });
    const caption = buildWcUpcomingCaption({ siteUrl: SITE_URL });
    const msg = await sendPhoto(env, { photoBytes: png, caption });
    if (msg?.disabled) return { status: 'skipped', reason: 'posting disabled (tg:posting=off)', date };
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600,
    });
    return { status: 'ok', date: opts.date || date, message_id: msg.message_id };
  } catch (e) {
    return { status: 'error', error: String(e.message || e), date: opts.date || date };
  }
}

// --- Golden Boot race post ---------------------------------------------------
// Top-5 WC scorers, posted roughly every 2 days (13:00 MYT window, 44h dedup).
async function postScorersRace(env, opts = {}) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) return { status: 'skipped', reason: 'telegram not configured' };
  if (!opts.force) {
    const { h } = nowMytHM();
    if (h !== 13) return { status: 'skipped', reason: 'outside 13:00 MYT window' };
    if (await env.CACHE.get('posted:scorers').catch(() => null)) return { status: 'skipped', reason: 'posted within 44h' };
  }
  // Tournament-active gate: the Golden Boot race is stale once the WC is
  // over — only post while a WC match kicked off in the last 72h or is
  // still upcoming.
  const sched = await fetch(`${SITE_URL}/api/wc-schedule`).then(r => r.ok ? r.json() : null).catch(() => null);
  const nowMs = Date.now();
  const wcActive = (sched?.matches || []).some(m => {
    const t = Date.parse(m.date);
    return Number.isFinite(t) && (t > nowMs || nowMs - t < 72 * 3600 * 1000);
  });
  if (!wcActive && !opts.force) return { status: 'skipped', reason: 'World Cup finished — scorers race paused' };
  const data = await fetch(`${SITE_URL}/api/topscorers?league=1&season=2026`).then(r => r.ok ? r.json() : null).catch(() => null);
  const list = (data?.response || []).slice(0, 5);
  if (!list.length) return { status: 'skipped', reason: 'no scorer data' };
  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  const lines = [`👑 <b>Golden Boot Race · 金靴榜</b>`, `🏆 2026 FIFA World Cup`, ''];
  list.forEach((p, i) => {
    const s = p.statistics?.[0] || {};
    lines.push(`${medals[i]} <b>${p.player?.name || '?'}</b> (${s.team?.name || ''}) — ${s.goals?.total ?? 0} ⚽`);
  });
  lines.push('', `Who takes the Golden Boot? 谁能穿金靴?`, '', `🔗 Live table: ${SITE_URL}/predictions/fifa-world-cup/`, '', `#GoldenBoot #WorldCup2026 #ScoreOcs8 #足球预测`);
  const msg = await sendMessage(env, { text: lines.join('\n') });
  if (msg?.disabled) return { status: 'skipped', reason: 'posting disabled' };
  await env.CACHE.put('posted:scorers', '1', { expirationTtl: 44 * 3600 });
  return { status: 'ok', message_id: msg.message_id };
}

// --- Group standings digest ---------------------------------------------------
// Compact per-group points table, fired after the day's last match (allDone)
// or manually. One per day.
async function postGroupStandings(env, opts = {}) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) return { status: 'skipped', reason: 'telegram not configured' };
  const date = todayMYT();
  const dedupKey = `posted:grouptable:${date}`;
  if (!opts.force && await env.CACHE.get(dedupKey).catch(() => null)) return { status: 'skipped', reason: 'already posted today' };
  const data = await fetch(`${SITE_URL}/api/standings?league=1&season=2026`).then(r => r.ok ? r.json() : null).catch(() => null);
  const groups = data?.response?.[0]?.league?.standings || [];
  if (!groups.length) return { status: 'skipped', reason: 'no standings data' };
  const lines = [`📊 <b>Group Standings · 小组积分榜</b>`, `🏆 2026 FIFA World Cup`, ''];
  for (const g of groups) {
    const label = (g?.[0]?.group || '').replace(/^Group\s*/i, '');
    const row = g.map(t => `${t.team?.name} ${t.points}`).join(' · ');
    lines.push(`<b>${label ? 'Group ' + label : 'Group'}</b>: ${row}`);
  }
  lines.push('', `🔗 Full tables: ${SITE_URL}/predictions/fifa-world-cup/`, '', `#WorldCup2026 #ScoreOcs8 #足球预测`);
  const text = lines.join('\n');
  const msg = await sendMessage(env, { text: text.length > 4000 ? text.slice(0, 3997) + '...' : text });
  if (msg?.disabled) return { status: 'skipped', reason: 'posting disabled' };
  await env.CACHE.put(dedupKey, '1', { expirationTtl: 36 * 3600 });
  return { status: 'ok', message_id: msg.message_id };
}

// --- Fan market of the day ------------------------------------------------
// One open fan-prediction market daily (11:00 MYT window), soonest-closing
// first, never the same market twice.
async function postFanMarket(env, opts = {}) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) return { status: 'skipped', reason: 'telegram not configured' };
  if (!opts.force) {
    const { h } = nowMytHM();
    if (h !== 11) return { status: 'skipped', reason: 'outside 11:00 MYT window' };
  }
  const date = todayMYT();
  const dedupKey = `posted:market:${date}`;
  if (!opts.force && await env.CACHE.get(dedupKey).catch(() => null)) return { status: 'skipped', reason: 'already posted today' };
  const data = await fetch(`${SITE_URL}/api/markets`).then(r => r.ok ? r.json() : null).catch(() => null);
  const open = (data?.markets || []).filter(m => m.status === 'open').sort((a, b) => Date.parse(a.closes) - Date.parse(b.closes));
  let pickMkt = null;
  for (const m of open) {
    if (!(await env.CACHE.get(`posted:mkt:${m.id}`).catch(() => null))) { pickMkt = m; break; }
  }
  if (!pickMkt) return { status: 'skipped', reason: 'no unposted open market' };
  const lines = [
    `🔮 <b>Fan Prediction · 球迷预测</b>`, '',
    `❓ ${pickMkt.q}`, '',
    `✅ YES ${pickMkt.yesPct}%  ·  ❌ NO ${pickMkt.noPct}%`,
    `🗳 ${pickMkt.votes} fan votes so far`, '',
    `Cast your vote 👉 ${SITE_URL}/worldcup-markets/`, '',
    `#FanVote #WorldCup2026 #ScoreOcs8 #足球预测`,
  ];
  const msg = await sendMessage(env, { text: lines.join('\n') });
  if (msg?.disabled) return { status: 'skipped', reason: 'posting disabled' };
  await env.CACHE.put(dedupKey, '1', { expirationTtl: 36 * 3600 });
  await env.CACHE.put(`posted:mkt:${pickMkt.id}`, '1', { expirationTtl: 21 * 86400 });
  return { status: 'ok', market: pickMkt.id, message_id: msg.message_id };
}

// --- Live goal alerts -------------------------------------------------------
// Each heartbeat: compare live WC scores to the last posted score (KV) and
// announce changes. First sighting of a match records the score silently so
// we never replay goals that happened before the worker started watching.
async function postGoalAlerts(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) return { status: 'skipped', reason: 'telegram not configured' };
  const live = await fetch(`${SITE_URL}/api/live`).then(r => r.ok ? r.json() : null).catch(() => null);
  const wcLive = (live?.response || []).filter(fx => fx.league?.id === 1);
  if (!wcLive.length) return { status: 'ok', live: 0 };
  const report = { status: 'ok', live: wcLive.length, posted: 0 };
  for (const fx of wcLive) {
    const id = fx.fixture?.id;
    const gh = fx.goals?.home, ga = fx.goals?.away;
    if (id == null || gh == null || ga == null) continue;
    const cur = `${gh}-${ga}`;
    const key = `goal:${id}`;
    const last = await env.CACHE.get(key).catch(() => null);
    if (last === null) { await env.CACHE.put(key, cur, { expirationTtl: 6 * 3600 }); continue; }
    if (last === cur) continue;
    const [lh, la] = last.split('-').map(Number);
    const scorerSide = gh > lh ? fx.teams?.home?.name : ga > la ? fx.teams?.away?.name : null;
    const min = fx.fixture?.status?.elapsed;
    // Deep-link to the live match page (peak click intent) + signup promo.
    const matchPath = `/match/${id}-${slugify(`${fx.teams?.home?.name}-vs-${fx.teams?.away?.name}`)}/`;
    const lines = [
      `⚽ <b>GOAL · 进球!</b>${scorerSide ? ` — <b>${scorerSide}</b>` : ''}`, '',
      `<b>${fx.teams?.home?.name} ${gh} — ${ga} ${fx.teams?.away?.name}</b>${min != null ? ` (${min}')` : ''}`, '',
      `📊 Live stats &amp; timeline · 实时追踪:`,
      `👉 ${SITE_URL}${matchPath}`, '',
      `🆕 <b>Bet live · OCS8 Sports</b> | 立即投注:`,
      `👉 https://ocs8my.com/signup?ref=OCSFMZ6HVI`, '',
      `#WorldCup2026 #ScoreOcs8`,
    ];
    const msg = await sendMessage(env, { text: lines.join('\n') });
    if (msg?.disabled) return { ...report, reason: 'posting disabled' };
    await env.CACHE.put(key, cur, { expirationTtl: 6 * 3600 });
    report.posted += 1;
  }
  return report;
}

export default {
  async scheduled(event, env, ctx) {
    // Dispatch by cron pattern:
    //   23:00 UTC = 07:00 MYT → generate tomorrow's content
    //   01:00 UTC = 09:00 MYT → sportsbook daily batch (gated by panel toggle)
    //   02:00 UTC = 10:00 MYT → post today's AI picks to Telegram
    //   */15 * UTC → heartbeat (KO-30 alert, 12h poll, FT result slips,
    //                  and event-driven recap triggered from inside
    //                  checkFinishedMatches when the day's queue is done).
    const cron = event.cron || '';
    if (cron.startsWith('0 1 ')) {
      ctx.waitUntil(runSportsbookDaily(env));
    } else if (cron.startsWith('0 2 ')) {
      ctx.waitUntil(postDailyToAll(env));
    } else if (cron.startsWith('*/15 ')) {
      // Heartbeat does three things:
      //   1. KO-30 pre-match alert for the MOTD fixture
      //   2. 12h pre-match poll for upcoming featured fixtures
      //   3. FT result slips for finished matches
      // All three are KV-flagged so they fire at most once per fixture.
      ctx.waitUntil(postPreMatchAlerts(env));
      ctx.waitUntil(postPrematchPolls(env));
      ctx.waitUntil(checkFinishedMatches(env));
      // Engagement posts, all KV-deduped: goal alerts every tick while WC
      // matches are live; Golden Boot race ~every 2 days (13:00 MYT); fan
      // market daily (11:00 MYT). Group standings fire from checkFinished-
      // Matches when the day's slate completes.
      ctx.waitUntil(postGoalAlerts(env));
      ctx.waitUntil(postScorersRace(env));
      ctx.waitUntil(postFanMarket(env));
      // 'Today at the World Cup' digest. This used to depend on dedicated
      // 30-16 / 0-7 UTC cron triggers that were never registered in
      // wrangler.toml, so it silently stopped posting. Drive it from the
      // heartbeat instead, time-gated to a window (so a transient failure
      // retries on the next tick) and protected by the same per-day dedup so
      // each card still posts exactly once.
      const { h, m } = nowMytHM();
      if ((h === 0 && m >= 30) || (h >= 1 && h < 3)) {
        ctx.waitUntil(postWorldCupCard(env, 'preview')); // ~00:30 MYT, before kickoffs
      } else if (h >= 15 && h < 17) {
        ctx.waitUntil(postWorldCupCard(env, 'recap'));    // ~15:00 MYT, after the slate
      }
    } else {
      ctx.waitUntil(generateDaily(env));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    // Manual triggers: generate | wc-queue | wc-card | wc-recap | wc-upcoming | post | check | poll | premat | recap | push-test | sportsbook-test
    const task = url.searchParams.get('task') || 'generate';
    // ?force=1 re-posts a card even if today's dedup flag is already set
    // (e.g. an earlier blank card burned the slot).
    const force = url.searchParams.get('force') === '1';
    // ?date=YYYY-MM-DD pins the upcoming card to a specific MYT day.
    const wantDate = url.searchParams.get('date') || '';
    let result;
    if (task === 'sportsbook-test') result = await postSportsbookTemplateTest(env);
    else if (task === 'gindex') {
      // Test Google Indexing: ?task=gindex&url=https://scoreocs8.com/...
      // (defaults to the homepage). Returns token + per-URL status.
      const u = url.searchParams.get('url');
      result = await googleIndexUrls(env, u ? [u] : [`https://${SITE_HOST}/`]);
    }
    else if (task === 'wc-queue') result = await queueWorldCupFixtures(env);
    else if (task === 'wc-card') result = await postWorldCupCard(env, 'preview', { force });
    else if (task === 'wc-recap') result = await postWorldCupCard(env, 'recap', { force });
    else if (task === 'wc-upcoming') result = await postWcUpcomingCard(env, { force, date: wantDate || undefined });
    else if (task === 'post') result = await postDailyToAll(env);
    else if (task === 'check') result = await checkFinishedMatches(env);
    else if (task === 'poll') result = await postPrematchPolls(env);
    else if (task === 'premat') result = await postPreMatchAlerts(env);
    else if (task === 'recap') result = await postDailyRecap(env);
    else if (task === 'scorers') result = await postScorersRace(env, { force });
    else if (task === 'group-table') result = await postGroupStandings(env, { force });
    else if (task === 'market') result = await postFanMarket(env, { force });
    else if (task === 'goals') result = await postGoalAlerts(env);
    else if (task === 'set-json') {
      // Curated-data loader: POST a JSON body to store it in KV. Whitelisted
      // keys only. The Dota/badminton keys were retired in Aug 2026 when the
      // site went football-only; add new football keys here as needed.
      //   curl -X POST '.../?key=SECRET&task=set-json&kv=football:curated' \
      //        -H 'content-type: application/json' --data @data.json
      const ALLOWED_KV = new Set(['football:curated']);
      const kvKey = url.searchParams.get('kv') || '';
      if (!ALLOWED_KV.has(kvKey)) {
        result = { status: 'error', error: `kv must be one of: ${[...ALLOWED_KV].join(', ')}` };
      } else if (request.method !== 'POST') {
        result = { status: 'error', error: 'POST a JSON body to this endpoint' };
      } else {
        try {
          const body = await request.json();
          body.updated = Date.now();
          await env.CACHE.put(kvKey, JSON.stringify(body));
          result = { status: 'ok', kv: kvKey, matches: Array.isArray(body.matches) ? body.matches.length : 0 };
        } catch (e) {
          result = { status: 'error', error: 'invalid JSON body: ' + (e.message || e) };
        }
      }
    }
    else if (task === 'posting') {
      // Read or flip the global Telegram kill-switch (KV tg:posting).
      //   ?task=posting              → report current state
      //   ?task=posting&set=on|off   → enable / silence channel posting
      const set = url.searchParams.get('set');
      if (set === 'on') {
        await env.CACHE.put('tg:posting', 'on');
        result = { posting: 'on', changed: true, note: 'channel posting ENABLED' };
      } else if (set === 'off') {
        await env.CACHE.put('tg:posting', 'off');
        result = { posting: 'off', changed: true, note: 'channel posting SILENCED' };
      } else {
        const v = await env.CACHE.get('tg:posting');
        result = { posting: v === 'off' ? 'off' : 'on', raw: v ?? null, silenced: v === 'off' };
      }
    }
    else if (task === 'ft-dump') {
      // Read-only diagnostic: dump the 3-day ft-queue window so we can see
      // each entry's real state (posted flag, status note, attempts).
      const now = Date.now();
      const { dates, entries } = await loadFtQueueWindow(env);
      result = {
        now_iso: new Date(now).toISOString(),
        dates,
        count: entries.length,
        entries: entries.map(e => ({
          fixture_id: e.fixture_id,
          match: `${e.home} vs ${e.away}`,
          kickoff_iso: e.kickoff_iso,
          due_in_min: Math.round((e.check_at_ms - now) / 60000),
          posted: e.posted,
          attempts: e.attempts,
          is_wc: e.is_wc,
          is_motd: e.is_motd,
          correct: e.correct,
          note: e.note || null,
          message_id: e.message_id || null,
          _qdate: e._qdate,
        })),
      };
    }
    else if (task === 'push-test') {
      // Fire a one-shot test push to every subscriber. Useful for verifying
      // VAPID setup before a real event lands.
      result = await broadcastPush(env, {
        title: 'ScoreOcs8 test push',
        body: 'If you see this, web push is working end-to-end. ✅',
        url: '/',
        tag: 'test',
      });
    }
    else result = await generateDaily(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
