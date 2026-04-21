const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_PER_REQ = 2000;
const DAILY_TOKEN_BUDGET = 8000;

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

  // Ping IndexNow (Bing/Yandex) so fresh posts get crawled fast. Google
  // removed their sitemap ping in 2023; IndexNow is the modern equivalent.
  const indexNowResult = await pingIndexNow(output, date).catch(e => ({ error: String(e.message || e) }));

  return {
    status: 'ok',
    date,
    tokensUsed: output.tokensUsed,
    items: 1 + output.previews.length,
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateDaily(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('unauthorized', { status: 401 });
    }
    const result = await generateDaily(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
