const ALLOWED_ORIGIN = 'https://scoreocs8.pages.dev';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const LEAGUES = { MSL: 166, EPL: 39, UCL: 2, WC: 1 };
const DEFAULT_SEASON = '2025';
const ODDS_SPORT = 'soccer_malaysia_super_league';

const TTL = {
  live: 60,
  fixtures: 6 * 3600,
  standings: 24 * 3600,
  odds: 5 * 60,
  predictions: 12 * 3600,
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

async function cached(env, key, ttl, fetcher) {
  const hit = await env.CACHE.get(key, 'json');
  if (hit) return { data: hit, source: 'kv' };
  const data = await fetcher();
  await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return { data, source: 'origin' };
}

async function afGet(env, path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_FOOTBALL_BASE}${path}?${qs}`, {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY },
  });
  if (!res.ok) throw new Error(`API-Football ${path} ${res.status}`);
  return res.json();
}

async function handleLive(env) {
  const key = 'live:all';
  return cached(env, key, TTL.live, async () => {
    const leagueIds = Object.values(LEAGUES).join('-');
    const data = await afGet(env, '/fixtures', { live: leagueIds });
    return { updated: Date.now(), response: data.response || [] };
  });
}

async function handleFixtures(env, url) {
  const season = url.searchParams.get('season') || DEFAULT_SEASON;
  const key = `fixtures:${season}`;
  return cached(env, key, TTL.fixtures, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      Object.entries(LEAGUES).map(async ([name, id]) => {
        const [next, todayMatches] = await Promise.all([
          afGet(env, '/fixtures', { league: id, season, next: 10 }),
          afGet(env, '/fixtures', { league: id, season, date: today }),
        ]);
        return {
          league: name,
          leagueId: id,
          next: next.response || [],
          today: todayMatches.response || [],
        };
      })
    );
    return { updated: Date.now(), leagues: results };
  });
}

async function handleStandings(env, url) {
  const season = url.searchParams.get('season') || DEFAULT_SEASON;
  const key = `standings:msl:${season}`;
  return cached(env, key, TTL.standings, async () => {
    const data = await afGet(env, '/standings', { league: LEAGUES.MSL, season });
    return { updated: Date.now(), response: data.response || [] };
  });
}

async function handleOdds(env) {
  const key = `odds:${ODDS_SPORT}`;
  return cached(env, key, TTL.odds, async () => {
    const params = new URLSearchParams({
      apiKey: env.ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',
      oddsFormat: 'decimal',
    });
    const res = await fetch(`${ODDS_API_BASE}/sports/${ODDS_SPORT}/odds/?${params}`);
    if (!res.ok) throw new Error(`Odds API ${res.status}`);
    const data = await res.json();
    return { updated: Date.now(), response: data };
  });
}

async function handlePredictions(env, url) {
  const fixtureId = url.searchParams.get('fixture_id');
  if (!fixtureId) {
    return { error: 'fixture_id required', status: 400 };
  }
  const key = `prediction:${fixtureId}`;
  return cached(env, key, TTL.predictions, async () => {
    const [fixtureData, h2hData] = await Promise.all([
      afGet(env, '/fixtures', { id: fixtureId }),
      (async () => {
        const fx = await afGet(env, '/fixtures', { id: fixtureId });
        const home = fx.response?.[0]?.teams?.home?.id;
        const away = fx.response?.[0]?.teams?.away?.id;
        if (!home || !away) return null;
        return afGet(env, '/fixtures/headtohead', { h2h: `${home}-${away}`, last: 5 });
      })(),
    ]);
    const fx = fixtureData.response?.[0];
    if (!fx) throw new Error('fixture not found');

    const prompt = buildPredictionPrompt(fx, h2hData?.response || []);
    const prediction = await callClaude(env, prompt);
    return { updated: Date.now(), fixtureId, ...prediction };
  });
}

function buildPredictionPrompt(fx, h2h) {
  const home = fx.teams.home.name;
  const away = fx.teams.away.name;
  const league = fx.league.name;
  const date = fx.fixture.date;
  const venue = fx.fixture.venue?.name || 'unknown';
  const h2hLines = h2h.slice(0, 5).map(m => {
    const hs = m.goals.home, as = m.goals.away;
    return `- ${m.teams.home.name} ${hs}-${as} ${m.teams.away.name} (${m.fixture.date.slice(0, 10)})`;
  }).join('\n') || 'No recent H2H data';

  return `You are a football prediction analyst. Analyze this fixture and respond with ONLY a JSON object, no prose.

Fixture: ${home} vs ${away}
League: ${league}
Date: ${date}
Venue: ${venue}

Recent H2H:
${h2hLines}

Respond with exactly this JSON shape:
{
  "pick": "HOME" | "DRAW" | "AWAY",
  "pickLabel": "<team name or 'Draw'>",
  "confidence": <integer 0-100>,
  "probabilities": { "home": <int>, "draw": <int>, "away": <int> },
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "analysis": "<2-3 sentence reasoning>"
}
Probabilities must sum to 100. Risk is LOW if confidence>=70, MEDIUM if 50-69, HIGH if <50.`;
}

async function callClaude(env, prompt) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON');
  return JSON.parse(match[0]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405);
    }

    try {
      let result;
      switch (url.pathname) {
        case '/live':
          result = await handleLive(env); break;
        case '/fixtures':
          result = await handleFixtures(env, url); break;
        case '/standings':
          result = await handleStandings(env, url); break;
        case '/odds':
          result = await handleOdds(env); break;
        case '/predictions':
          result = await handlePredictions(env, url);
          if (result.status) return json({ error: result.error }, result.status);
          break;
        case '/health':
          return json({ ok: true, time: Date.now() });
        default:
          return json({
            error: 'not found',
            routes: ['/live', '/fixtures', '/standings', '/odds', '/predictions?fixture_id=', '/health'],
          }, 404);
      }
      return json(result.data, 200, { 'X-Cache': result.source });
    } catch (err) {
      return json({ error: 'upstream failed', detail: String(err.message || err) }, 502);
    }
  },
};
