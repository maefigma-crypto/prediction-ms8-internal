const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const LEAGUES = { MSL: 278, EPL: 39, UCL: 2, WC: 1 };
const DEFAULT_SEASON = '2025';
const ODDS_SPORT = 'soccer_malaysia_super_league';

const TTL = {
  live: 60,
  fixtures: 6 * 3600,
  standings: 24 * 3600,
  odds: 5 * 60,
  predictions: 12 * 3600,
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

async function cached(env, key, ttl, fetcher, opts = {}) {
  if (!opts.refresh) {
    const hit = await env.CACHE.get(key, 'json');
    if (hit) return { data: hit, source: 'kv' };
  }
  const data = await fetcher();
  await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  return { data, source: opts.refresh ? 'refreshed' : 'origin' };
}

async function afGet(env, path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_FOOTBALL_BASE}${path}?${qs}`, {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY },
  });
  if (!res.ok) throw new Error(`API-Football ${path} ${res.status}`);
  return res.json();
}

async function handleLive(env, url) {
  const refresh = url.searchParams.get('refresh') === '1';
  return cached(env, 'live:all', TTL.live, async () => {
    const leagueIds = Object.values(LEAGUES).join('-');
    const data = await afGet(env, '/fixtures', { live: leagueIds });
    return { updated: Date.now(), response: data.response || [] };
  }, { refresh });
}

async function handleFixtures(env, url) {
  const season = url.searchParams.get('season') || DEFAULT_SEASON;
  const refresh = url.searchParams.get('refresh') === '1';
  const leagueParam = url.searchParams.get('league');

  // Scoped single-league fetch (used by /predictions/<slug>/ landing pages).
  if (leagueParam) {
    const id = parseInt(leagueParam, 10);
    if (!id) return { data: { error: 'invalid league id' }, source: 'error' };
    return cached(env, `fixtures:league:${id}:${season}`, TTL.fixtures, async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [next, last, todayMatches] = await Promise.all([
        afGet(env, '/fixtures', { league: id, season, next: 10 }),
        afGet(env, '/fixtures', { league: id, season, last: 10 }),
        afGet(env, '/fixtures', { league: id, season, date: today }),
      ]);
      return {
        updated: Date.now(),
        leagues: [{
          leagueId: id,
          next: next.response || [],
          last: last.response || [],
          today: todayMatches.response || [],
        }],
      };
    }, { refresh });
  }

  // Default: fetch all 4 primary leagues at once (homepage behaviour).
  return cached(env, `fixtures:${season}`, TTL.fixtures, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      Object.entries(LEAGUES).map(async ([name, id]) => {
        const [next, last, todayMatches] = await Promise.all([
          afGet(env, '/fixtures', { league: id, season, next: 10 }),
          afGet(env, '/fixtures', { league: id, season, last: 10 }),
          afGet(env, '/fixtures', { league: id, season, date: today }),
        ]);
        return {
          league: name,
          leagueId: id,
          next: next.response || [],
          last: last.response || [],
          today: todayMatches.response || [],
        };
      })
    );
    return { updated: Date.now(), leagues: results };
  }, { refresh });
}

async function handleStandings(env, url) {
  const season = url.searchParams.get('season') || DEFAULT_SEASON;
  const refresh = url.searchParams.get('refresh') === '1';
  // Default to MSL for backwards compat, but accept any league id.
  const leagueId = parseInt(url.searchParams.get('league') || String(LEAGUES.MSL), 10);
  return cached(env, `standings:${leagueId}:${season}`, TTL.standings, async () => {
    try {
      const data = await afGet(env, '/standings', { league: leagueId, season });
      return { updated: Date.now(), leagueId, season, response: data.response || [] };
    } catch (err) {
      // Knockout comps (UCL, FIFA WC) don't have a league table — return empty.
      return { updated: Date.now(), leagueId, season, response: [], error: String(err.message || err) };
    }
  }, { refresh });
}

async function handleOdds(env, url) {
  const sport = url.searchParams.get('sport') || ODDS_SPORT;
  const refresh = url.searchParams.get('refresh') === '1';
  return cached(env, `odds:${sport}`, TTL.odds, async () => {
    const params = new URLSearchParams({
      apiKey: env.ODDS_API_KEY,
      regions: 'eu',
      markets: 'h2h',
      oddsFormat: 'decimal',
    });
    const res = await fetch(`${ODDS_API_BASE}/sports/${sport}/odds/?${params}`);
    if (res.status === 404 || res.status === 422) {
      return { updated: Date.now(), sport, outOfSeason: true, response: [] };
    }
    if (!res.ok) throw new Error(`Odds API ${res.status}`);
    const data = await res.json();
    return { updated: Date.now(), sport, response: data };
  }, { refresh });
}

async function handlePredictions(env, url) {
  const fixtureId = url.searchParams.get('fixture_id');
  if (!fixtureId) return { error: 'fixture_id required', status: 400 };

  return cached(env, `prediction:${fixtureId}`, TTL.predictions, async () => {
    const fixtureData = await afGet(env, '/fixtures', { id: fixtureId });
    const fx = fixtureData.response?.[0];
    if (!fx) throw new Error('fixture not found');

    const home = fx.teams.home.id;
    const away = fx.teams.away.id;
    const h2hData = await afGet(env, '/fixtures/headtohead', { h2h: `${home}-${away}`, last: 5 });

    const prompt = buildPredictionPrompt(fx, h2hData.response || []);
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

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const route = Array.isArray(params.route) ? params.route.join('/') : (params.route || '');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  try {
    let result;
    switch (route) {
      case 'live':
        result = await handleLive(env, url); break;
      case 'fixtures':
        result = await handleFixtures(env, url); break;
      case 'standings':
        result = await handleStandings(env, url); break;
      case 'odds':
        result = await handleOdds(env, url); break;
      case 'predictions':
        result = await handlePredictions(env, url);
        if (result.status) return json({ error: result.error }, result.status);
        break;
      case 'health':
        return json({ ok: true, time: Date.now() });
      case 'leagues': {
        const search = url.searchParams.get('search') || '';
        const country = url.searchParams.get('country') || '';
        const params = {};
        if (search) params.search = search;
        if (country) params.country = country;
        const data = await afGet(env, '/leagues', params);
        return json({
          count: data.response?.length || 0,
          results: (data.response || []).map(x => ({
            id: x.league.id,
            name: x.league.name,
            type: x.league.type,
            country: x.country.name,
            seasons: (x.seasons || []).map(s => s.year),
          })),
        });
      }
      case 'content/today': {
        const date = new Date().toISOString().slice(0, 10);
        const cached = await env.CACHE.get(`content:${date}`, 'json');
        if (!cached) return json({ status: 'empty', date, message: 'no content generated yet today' }, 200);
        return json(cached);
      }
      case 'content/usage': {
        const date = new Date().toISOString().slice(0, 10);
        const used = parseInt(await env.CACHE.get(`usage:tokens:${date}`) || '0', 10);
        return json({ date, used, budget: 8000, remaining: 8000 - used });
      }
      default:
        return json({
          error: 'not found',
          route,
          routes: ['/api/live', '/api/fixtures', '/api/standings', '/api/odds', '/api/predictions?fixture_id=', '/api/health'],
        }, 404);
    }
    return json(result.data, 200, { 'X-Cache': result.source });
  } catch (err) {
    return json({ error: 'upstream failed', detail: String(err.message || err) }, 502);
  }
}
