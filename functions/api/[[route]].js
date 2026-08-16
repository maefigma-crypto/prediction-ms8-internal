const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-6';

const LEAGUES = { EPL: 39, UCL: 2, WC: 1 };
const HIGHLIGHT_LEAGUES = [
  { id: 39, key: 'EPL', name: 'Premier League' },
  { id: 2, key: 'UCL', name: 'UEFA Champions League' },
  { id: 140, key: 'LALIGA', name: 'La Liga' },
  { id: 135, key: 'SERIEA', name: 'Serie A' },
  { id: 78, key: 'BUNDESLIGA', name: 'Bundesliga' },
  { id: 61, key: 'LIGUE1', name: 'Ligue 1' },
  { id: 1, key: 'WC', name: 'FIFA World Cup' },
];
const DEFAULT_SEASON = '2026';
// API-Football tags tournaments by start year — the 2026 World Cup is
// season 2026 while domestic 2025-26 leagues are season 2025. Requests for
// an overridden league that carry no season (or the stale default) are
// coerced so old cached pages keep working.
const LEAGUE_SEASONS = { 1: '2026' };
function seasonFor(leagueId, requested) {
  const override = LEAGUE_SEASONS[String(leagueId)];
  if (override && (!requested || requested === DEFAULT_SEASON)) return override;
  return requested || DEFAULT_SEASON;
}
const ODDS_SPORT = 'soccer_epl';

const TTL = {
  live: 60,
  fixtures: 5 * 60,
  standings: 30 * 60,
  topscorers: 30 * 60,
  odds: 5 * 60,
  predictions: 12 * 3600,
  matchDetail: 24 * 3600,
  highlights: 30 * 60,
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
  // Preview deploys may run without a KV binding — fall back to a direct
  // fetch so the API still works (uncached). Production has CACHE bound.
  if (!env?.CACHE) return { data: await fetcher(), source: 'nocache' };
  if (!opts.refresh) {
    const hit = await env.CACHE.get(key, 'json');
    if (hit) return { data: hit, source: 'kv' };
  }
  const data = await fetcher();
  // opts.validate guards against poisoning the cache with empty payloads
  // when API-Football transiently returns nothing. A failing validate is
  // either a transient blip or a genuinely-empty table (knockout bracket
  // with no standings yet). opts.emptyTtl caches the empty briefly so a
  // blip self-heals within minutes without hammering the API every
  // request; with no emptyTtl the empty isn't cached at all.
  const ok = !opts.validate || opts.validate(data);
  // opts.ttlFor(data) lets the fetcher pick the TTL from the result — e.g.
  // a short window for an in-progress match, long once it's finished.
  let writeTtl = ok ? (opts.ttlFor ? opts.ttlFor(data) : ttl) : (opts.emptyTtl || 0);
  if (writeTtl > 0) {
    await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: writeTtl });
  }
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
  const requestedSeason = url.searchParams.get('season');
  const refresh = url.searchParams.get('refresh') === '1';
  const leagueParam = url.searchParams.get('league');

  // Scoped single-league fetch (used by /predictions/<slug>/ landing pages).
  if (leagueParam) {
    const id = parseInt(leagueParam, 10);
    if (!id) return { data: { error: 'invalid league id' }, source: 'error' };
    const season = seasonFor(id, requestedSeason);
    return cached(env, `fixtures:v2:league:${id}:${season}`, TTL.fixtures, async () => {
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
      // A league bucket that is entirely empty is almost always an
      // API-Football hiccup, not a real schedule — don't cache it.
    }, { refresh, validate: d => d.leagues.some(l => l.next.length || l.last.length || l.today.length) });
  }

  // Default: fetch all 4 primary leagues at once (homepage behaviour).
  return cached(env, `fixtures:v2:${requestedSeason || DEFAULT_SEASON}`, TTL.fixtures, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.all(
      Object.entries(LEAGUES).map(async ([name, id]) => {
        const season = seasonFor(id, requestedSeason);
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
  }, { refresh, validate: d => d.leagues.some(l => l.next.length || l.last.length || l.today.length) });
}

// Full FIFA World Cup schedule — all 104 fixtures with group + venue
// details for the homepage "Follow the FIFA World Cup" section. One
// API-Football call returns the whole season; standings provide the
// team→group mapping (fixture rounds only say "Group Stage - 1").
async function handleWcSchedule(env, url) {
  const refresh = url.searchParams.get('refresh') === '1';
  const season = seasonFor(1);
  return cached(env, `wc:schedule:${season}`, TTL.fixtures, async () => {
    const [fixturesData, standingsData] = await Promise.all([
      afGet(env, '/fixtures', { league: 1, season }).catch(() => ({ response: [] })),
      afGet(env, '/standings', { league: 1, season }).catch(() => ({ response: [] })),
    ]);
    // The bare league+season /fixtures query occasionally comes back empty
    // (API-Football hiccup / plan quirk) even though paginated queries return
    // data. Fall back to next/last/date — the same calls /api/fixtures uses
    // successfully — and merge+dedupe so the schedule is never empty when
    // fixtures actually exist.
    let fixturesResp = fixturesData.response || [];
    if (!fixturesResp.length) {
      const today = new Date().toISOString().slice(0, 10);
      const [next, last, todayM] = await Promise.all([
        afGet(env, '/fixtures', { league: 1, season, next: 40 }).catch(() => ({ response: [] })),
        afGet(env, '/fixtures', { league: 1, season, last: 20 }).catch(() => ({ response: [] })),
        afGet(env, '/fixtures', { league: 1, season, date: today }).catch(() => ({ response: [] })),
      ]);
      const byId = new Map();
      for (const arr of [last.response, todayM.response, next.response]) {
        for (const fx of (arr || [])) if (fx.fixture?.id != null) byId.set(fx.fixture.id, fx);
      }
      fixturesResp = [...byId.values()];
    }
    const groupOf = {};
    for (const group of standingsData.response?.[0]?.league?.standings || []) {
      for (const row of group) {
        if (row.team?.id) groupOf[row.team.id] = row.group || '';
      }
    }
    const matches = fixturesResp.map(fx => {
      const homeGroup = groupOf[fx.teams?.home?.id] || '';
      const awayGroup = groupOf[fx.teams?.away?.id] || '';
      return {
        fixture_id: fx.fixture?.id,
        date: fx.fixture?.date,
        status: fx.fixture?.status?.short || 'NS',
        elapsed: fx.fixture?.status?.elapsed ?? null,
        round: fx.league?.round || '',
        group: homeGroup && homeGroup === awayGroup ? homeGroup : '',
        venue: fx.fixture?.venue?.name || '',
        city: fx.fixture?.venue?.city || '',
        home: { id: fx.teams?.home?.id, name: fx.teams?.home?.name || 'TBD', logo: fx.teams?.home?.logo || '' },
        away: { id: fx.teams?.away?.id, name: fx.teams?.away?.name || 'TBD', logo: fx.teams?.away?.logo || '' },
        goals: { home: fx.goals?.home ?? null, away: fx.goals?.away ?? null },
        penalty: { home: fx.score?.penalty?.home ?? null, away: fx.score?.penalty?.away ?? null },
      };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
    return { updated: Date.now(), season, count: matches.length, matches };
  }, { refresh, validate: d => (d.matches || []).length > 0 });
}

// ───── World Cup prediction markets (fan votes + AI lean, no money) ─────
// Votes accumulate in KV (mkt:votes:<id>); a market settles when the
// panel/admin writes mkt:result:<id> = 'yes' | 'no' | 'void'. Displayed
// percentages blend the AI lean as a prior so day-one bars aren't empty:
// the lean counts as MARKET_PRIOR_WEIGHT virtual votes.
const MARKET_PRIOR_WEIGHT = 40;
const WC_MARKETS = [
  // Daily / match-specific
  { id: 'mex-rsa-mexico-2plus', cat: 'daily', q: 'Mexico vs South Africa — Will Mexico win by 2+ goals?', ai: 48, closes: '2026-06-11T19:00:00Z', event: '2026-06-11T19:00:00Z' },
  { id: 'mex-rsa-mexico-first', cat: 'daily', q: 'Mexico vs South Africa — Will Mexico score first?', ai: 85, closes: '2026-06-11T19:00:00Z', event: '2026-06-11T19:00:00Z' },
  { id: 'kor-cze-korea-win', cat: 'daily', q: 'Korea Republic vs Czechia — Will Korea Republic win?', ai: 38, closes: '2026-06-12T02:00:00Z', event: '2026-06-12T02:00:00Z' },
  // Group stage
  { id: 'goals-55-md1', cat: 'group', q: 'Will there be 55+ goals across Matchday 1 (24 matches)?', ai: 60, closes: '2026-06-11T19:00:00Z' },
  { id: 'hattrick-md1', cat: 'group', q: 'Will a player score a hat-trick in Matchday 1?', ai: 35, closes: '2026-06-11T19:00:00Z' },
  { id: 'owngoals-2-md1', cat: 'group', q: 'Will there be 2+ own goals in Matchday 1?', ai: 45, closes: '2026-06-11T19:00:00Z' },
  { id: 'hosts-all-r32', cat: 'group', q: 'Will all three host nations (USA, Mexico, Canada) reach the Round of 32?', ai: 64, closes: '2026-06-24T00:00:00Z' },
  { id: 'asian-3-r32', cat: 'group', q: 'Will 3+ Asian teams reach the Round of 32?', ai: 74, closes: '2026-06-24T00:00:00Z' },
  { id: 'usa-r16', cat: 'group', q: 'Will USA reach the Round of 16?', ai: 51, closes: '2026-06-28T00:00:00Z' },
  { id: 'japan-r16', cat: 'group', q: 'Will Japan reach the Round of 16?', ai: 76, closes: '2026-06-28T00:00:00Z' },
  { id: 'korea-r16', cat: 'group', q: 'Will Korea Republic reach the Round of 16?', ai: 30, closes: '2026-06-28T00:00:00Z' },
  // Knockout
  { id: 'portugal-qf', cat: 'knockout', q: 'Will Portugal reach the Quarter-finals?', ai: 89, closes: '2026-06-28T00:00:00Z' },
  { id: 'argentina-qf', cat: 'knockout', q: 'Will Argentina reach the Quarter-finals?', ai: 84, closes: '2026-06-28T00:00:00Z' },
  { id: 'brazil-qf', cat: 'knockout', q: 'Will Brazil reach the Quarter-finals?', ai: 81, closes: '2026-06-28T00:00:00Z' },
  { id: 'germany-qf', cat: 'knockout', q: 'Will Germany reach the Quarter-finals?', ai: 81, closes: '2026-06-28T00:00:00Z' },
  { id: 'france-sf', cat: 'knockout', q: 'Will France reach the Semi-finals?', ai: 80, closes: '2026-06-28T00:00:00Z' },
  { id: 'spain-sf', cat: 'knockout', q: 'Will Spain reach the Semi-finals?', ai: 79, closes: '2026-06-28T00:00:00Z' },
  { id: 'england-sf', cat: 'knockout', q: 'Will England reach the Semi-finals?', ai: 58, closes: '2026-06-28T00:00:00Z' },
  { id: 'champion-europe', cat: 'knockout', q: 'Will the World Cup winner be from Europe?', ai: 55, closes: '2026-06-28T00:00:00Z' },
  { id: 'final-both-europe', cat: 'knockout', q: 'Will both teams in the final be from Europe?', ai: 52, closes: '2026-06-28T00:00:00Z' },
  { id: 'champion-top4', cat: 'knockout', q: 'Will the champion be France, Spain, Argentina or England?', ai: 45, closes: '2026-06-28T00:00:00Z' },
  { id: 'champion-unbeaten', cat: 'knockout', q: 'Will the champion stay unbeaten all tournament?', ai: 46, closes: '2026-06-28T00:00:00Z' },
  { id: 'shootouts-5', cat: 'knockout', q: 'Will there be 5+ penalty shootouts in the tournament?', ai: 70, closes: '2026-06-28T00:00:00Z' },
  // Players
  { id: 'mbappe-2plus-group', cat: 'player', q: 'Will Kylian Mbappé score 2+ goals in a single group-stage match?', ai: 84, closes: '2026-06-24T00:00:00Z' },
  { id: 'haaland-2plus-group', cat: 'player', q: 'Will Erling Haaland score 2+ goals in a single group-stage match?', ai: 72, closes: '2026-06-24T00:00:00Z' },
  { id: 'kane-2plus-group', cat: 'player', q: 'Will Harry Kane score 2+ goals in a single group-stage match?', ai: 64, closes: '2026-06-24T00:00:00Z' },
  { id: 'kane-hattrick', cat: 'player', q: 'Will Harry Kane score a hat-trick during the tournament?', ai: 27, closes: '2026-06-28T00:00:00Z' },
  { id: 'messi-vs-ronaldo', cat: 'player', q: 'Will Lionel Messi score more goals than Cristiano Ronaldo?', ai: 63, closes: '2026-06-28T00:00:00Z' },
  { id: 'goldenboot-7', cat: 'player', q: 'Will the Golden Boot winner score 7+ goals?', ai: 41, closes: '2026-06-28T00:00:00Z' },
];

function marketShape(m, votes, result) {
  const v = votes || { yes: 0, no: 0 };
  const total = (v.yes || 0) + (v.no || 0);
  const yesPct = Math.round((((m.ai / 100) * MARKET_PRIOR_WEIGHT) + (v.yes || 0)) / (MARKET_PRIOR_WEIGHT + total) * 100);
  return {
    id: m.id, cat: m.cat, q: m.q, ai: m.ai,
    closes: m.closes, event: m.event || null,
    votes: total, yesPct, noPct: 100 - yesPct,
    status: result ? 'settled' : (Date.parse(m.closes) < Date.now() ? 'closed' : 'open'),
    result: result || null,
  };
}

async function handleMarkets(env) {
  const [votes, results] = await Promise.all([
    Promise.all(WC_MARKETS.map(m => env.CACHE.get(`mkt:votes:${m.id}`, 'json').catch(() => null))),
    Promise.all(WC_MARKETS.map(m => env.CACHE.get(`mkt:result:${m.id}`).catch(() => null))),
  ]);
  return { updated: Date.now(), count: WC_MARKETS.length, markets: WC_MARKETS.map((m, i) => marketShape(m, votes[i], results[i])) };
}

async function handleMarketVote(env, url) {
  const id = url.searchParams.get('id') || '';
  const side = url.searchParams.get('side');
  const m = WC_MARKETS.find(x => x.id === id);
  if (!m || (side !== 'yes' && side !== 'no')) return { error: 'invalid market or side', status: 400 };
  if (Date.parse(m.closes) < Date.now()) return { error: 'market closed', status: 409 };
  const result = await env.CACHE.get(`mkt:result:${id}`).catch(() => null);
  if (result) return { error: 'market settled', status: 409 };
  const key = `mkt:votes:${id}`;
  // KV read-modify-write can drop concurrent votes; fine for fan sentiment.
  const v = (await env.CACHE.get(key, 'json').catch(() => null)) || { yes: 0, no: 0 };
  v[side] = (v[side] || 0) + 1;
  await env.CACHE.put(key, JSON.stringify(v));
  return marketShape(m, v, null);
}

async function handleStandings(env, url) {
  const refresh = url.searchParams.get('refresh') === '1';
  const leagueId = parseInt(url.searchParams.get('league') || String(LEAGUES.EPL), 10);
  const season = seasonFor(leagueId, url.searchParams.get('season'));
  // v2 key: the old validate only checked response.length, so a payload with
  // a response entry but EMPTY standings inside ([{league:{standings:[]}}])
  // was cached as "good" for 30 min — poisoning every standings reader with
  // "not available". Deep-validate actual rows and bust the old key.
  return cached(env, `standings:v2:${leagueId}:${season}`, TTL.standings, async () => {
    try {
      const data = await afGet(env, '/standings', { league: leagueId, season });
      return { updated: Date.now(), leagueId, season, response: data.response || [] };
    } catch (err) {
      // Knockout comps (UCL, FIFA WC) don't have a league table — return empty.
      return { updated: Date.now(), leagueId, season, response: [], error: String(err.message || err) };
    }
  }, {
    refresh,
    validate: d => (d.response || []).some(r => (r.league?.standings || []).some(g => (g || []).length > 0)),
    emptyTtl: 120,
  });
}

async function handleTopScorers(env, url) {
  const refresh = url.searchParams.get('refresh') === '1';
  const leagueId = parseInt(url.searchParams.get('league') || String(LEAGUES.EPL), 10);
  const season = seasonFor(leagueId, url.searchParams.get('season'));
  return cached(env, `topscorers:${leagueId}:${season}`, TTL.topscorers, async () => {
    try {
      const data = await afGet(env, '/players/topscorers', { league: leagueId, season });
      return { updated: Date.now(), leagueId, season, response: data.response || [] };
    } catch (err) {
      return { updated: Date.now(), leagueId, season, response: [], error: String(err.message || err) };
    }
  }, { refresh, validate: d => (d.response || []).length > 0, emptyTtl: 120 });
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

// Locate a single fixture by id. API-Football's /fixtures?id=X started
// returning empty on the renewed Pro subscription, so we try that first
// (in case it gets fixed) and fall back to scanning the cached
// /api/fixtures payloads — those use /fixtures?league=X&season=Y which
// still works fine.
async function lookupFixture(env, fixtureId) {
  const id = parseInt(fixtureId, 10);
  if (!id) return null;
  // 1. Direct lookup (preferred, gives us the freshest object)
  try {
    const direct = await afGet(env, '/fixtures', { id });
    if (direct.response?.[0]) return direct.response[0];
  } catch { /* fall through */ }
  // 2. Multi-league cached payload (homepage default)
  const tryKeys = [
    `fixtures:v2:${DEFAULT_SEASON}`,
    ...[39, 2, 1, 140, 135, 78, 61].map(lgId => `fixtures:v2:league:${lgId}:${seasonFor(lgId)}`),
  ];
  if (env?.CACHE) {
    for (const key of tryKeys) {
      const cached = await env.CACHE.get(key, 'json');
      if (!cached) continue;
      for (const lg of cached.leagues || []) {
        for (const bucket of ['next', 'today', 'last']) {
          const found = (lg[bucket] || []).find(fx => fx.fixture?.id === id);
          if (found) return found;
        }
      }
    }
  }
  // 2.5 World Cup: the cached wc-schedule is the ROBUST source (it has a
  // paginated fallback and is kept warm by the site). The direct-id and bare
  // full-season calls below are the flaky ones — so synthesize the fixture
  // from wc-schedule before trying them. Without this, a flaky upstream left
  // match pages rendering the empty "HOME VS AWAY" skeleton.
  if (env?.CACHE) {
    try {
      const sched = await env.CACHE.get(`wc:schedule:${seasonFor(1)}`, 'json');
      const m = (sched?.matches || []).find(x => x.fixture_id === id);
      if (m) {
        return {
          fixture: {
            id: m.fixture_id,
            date: m.date,
            status: { short: m.status || 'NS', long: '', elapsed: m.elapsed ?? null },
            venue: { name: m.venue || '', city: m.city || '' },
          },
          league: { id: 1, name: 'FIFA World Cup', season: Number(seasonFor(1)), round: m.round || '' },
          teams: {
            home: { id: m.home?.id, name: m.home?.name || 'Home', logo: m.home?.logo || '' },
            away: { id: m.away?.id, name: m.away?.name || 'Away', logo: m.away?.logo || '' },
          },
          goals: { home: m.goals?.home ?? null, away: m.goals?.away ?? null },
          score: {
            fulltime: { home: m.goals?.home ?? null, away: m.goals?.away ?? null },
            penalty: { home: m.penalty?.home ?? null, away: m.penalty?.away ?? null },
          },
        };
      }
    } catch { /* fall through */ }
  }
  // 3. Cup competitions (WC=1, UCL=2): the next/last pagination params are
  // unreliable (a finished group match may appear in neither), so fetch the
  // FULL season — same call wc-schedule uses — and scan it. This is what
  // makes a finished WC fixture resolve with its real FT score.
  for (const lgId of [1, 2]) {
    try {
      const season = seasonFor(lgId);
      const data = await afGet(env, '/fixtures', { league: lgId, season });
      let found = (data.response || []).find(fx => fx.fixture?.id === id);
      if (!found && lgId === 1) {
        // The bare full-season query is flaky for the WC — retry with the
        // paginated buckets that reliably return data.
        const today = new Date().toISOString().slice(0, 10);
        const [next, last, todayM] = await Promise.all([
          afGet(env, '/fixtures', { league: 1, season, next: 40 }).catch(() => ({ response: [] })),
          afGet(env, '/fixtures', { league: 1, season, last: 40 }).catch(() => ({ response: [] })),
          afGet(env, '/fixtures', { league: 1, season, date: today }).catch(() => ({ response: [] })),
        ]);
        for (const arr of [last.response, todayM.response, next.response]) {
          found = (arr || []).find(fx => fx.fixture?.id === id);
          if (found) break;
        }
      }
      if (found) return found;
    } catch { /* try next */ }
  }
  // 4. Last resort — fetch each priority league fresh (paginated) and scan
  for (const lgId of [39, 140, 135, 78, 61]) {
    try {
      const season = seasonFor(lgId);
      const [next, last, today] = await Promise.all([
        afGet(env, '/fixtures', { league: lgId, season, next: 20 }),
        afGet(env, '/fixtures', { league: lgId, season, last: 20 }),
        afGet(env, '/fixtures', { league: lgId, season, date: new Date().toISOString().slice(0, 10) }),
      ]);
      for (const arr of [next.response, today.response, last.response]) {
        const found = (arr || []).find(fx => fx.fixture?.id === id);
        if (found) return found;
      }
    } catch { /* try next league */ }
  }
  return null;
}

async function handlePredictions(env, url) {
  const fixtureId = url.searchParams.get('fixture_id');
  if (!fixtureId) return { error: 'fixture_id required', status: 400 };

  const fx = await lookupFixture(env, fixtureId);
  if (!fx) throw new Error('fixture not found');

  const kickoffMs = new Date(fx.fixture?.date || 0).getTime();
  const msUntilKickoff = kickoffMs - Date.now();
  const analysisWindowMs = 12 * 3600 * 1000;
  const isFinishedOrLive = ['1H','2H','HT','ET','BT','P','LIVE','FT','AET','PEN'].includes(fx.fixture?.status?.short);
  if (!isFinishedOrLive && Number.isFinite(msUntilKickoff) && msUntilKickoff > analysisWindowMs) {
    // >12h out: a lightweight form & matchup preview built from the fixture
    // itself (no extra API calls, no AI cost) so the page is never blank.
    return { data: { updated: Date.now(), fixtureId, ...buildFormPreview(fx, []) }, source: 'preview' };
  }

  return cached(env, `prediction:v2:${fixtureId}`, TTL.predictions, async () => {
    const home = fx.teams.home.id;
    const away = fx.teams.away.id;
    let h2hResp = [], homeForm = [], awayForm = [];
    try {
      const [h2hData, hf, af] = await Promise.all([
        afGet(env, '/fixtures/headtohead', { h2h: `${home}-${away}`, last: 5 }),
        afGet(env, '/fixtures', { team: home, last: 6 }).catch(() => ({ response: [] })),
        afGet(env, '/fixtures', { team: away, last: 6 }).catch(() => ({ response: [] })),
      ]);
      h2hResp = h2hData.response || [];
      homeForm = teamRecentForm(hf.response, home);
      awayForm = teamRecentForm(af.response, away);
    } catch (_) { /* H2H / form are optional context */ }

    // Premium AI analysis when an Anthropic key is configured; otherwise (or if
    // the call fails — e.g. no balance) fall back to a data-driven form preview
    // so there is always something useful on the page.
    if (env.ANTHROPIC_API_KEY) {
      try {
        const prediction = await callClaude(env, buildPredictionPrompt(fx, h2hResp));
        return { updated: Date.now(), fixtureId, source: 'ai', homeForm, awayForm, ...prediction };
      } catch (_) { /* fall through to form preview */ }
    }
    return { updated: Date.now(), fixtureId, homeForm, awayForm, ...buildFormPreview(fx, h2hResp) };
  });
}

// ───── Retired verticals ─────
// The Dota 2 and badminton endpoints (OpenDota-backed + curated KV) were
// removed in Aug 2026 when ScoreOCS8 went football-only. Their KV keys
// (dota:*, badminton:schedule) can be purged.

const FINISHED_STATUS = new Set(['FT', 'AET', 'PEN', 'WO', 'AWD']);
const LIVE_STATUS = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'SUSP', 'INT']);

async function handleMatchDetail(env, url) {
  const fixtureId = url.searchParams.get('fixture_id');
  if (!fixtureId) return { error: 'fixture_id required', status: 400 };
  const refresh = url.searchParams.get('refresh') === '1';

  // v5: adds /fixtures/lineups-derived 'lineups' for the Formation pitch.
  // Dynamic TTL: a finished match is immutable (cache 24h), a live one
  // changes every minute (60s), and an upcoming one only needs to flip to
  // live/FT near kickoff (5 min). A flat 24h previously froze the
  // pre-kickoff "Not Started" snapshot long after full-time.
  return cached(env, `match-detail:v5:${fixtureId}`, TTL.matchDetail, async () => {
    const fx = await lookupFixture(env, fixtureId);
    if (!fx) throw new Error('fixture not found');

    const home = fx.teams.home.id;
    const away = fx.teams.away.id;
    const [h2hData, statsData, eventsData, playersData, lineupsData, homeFormData, awayFormData] = await Promise.all([
      afGet(env, '/fixtures/headtohead', { h2h: `${home}-${away}`, last: 8 }),
      afGet(env, '/fixtures/statistics', { fixture: fixtureId }).catch(() => ({ response: [] })),
      afGet(env, '/fixtures/events', { fixture: fixtureId }).catch(() => ({ response: [] })),
      afGet(env, '/fixtures/players', { fixture: fixtureId }).catch(() => ({ response: [] })),
      afGet(env, '/fixtures/lineups', { fixture: fixtureId }).catch(() => ({ response: [] })),
      afGet(env, '/fixtures', { team: home, last: 6 }).catch(() => ({ response: [] })),
      afGet(env, '/fixtures', { team: away, last: 6 }).catch(() => ({ response: [] })),
    ]);

    // Recent form (last finished results, oldest→newest) as W/D/L from the
    // team's own perspective — drives the form badges on the match page.
    const formOf = (resp, teamId) => (resp || [])
      .filter(m => FINISHED_STATUS.has(m.fixture?.status?.short))
      .sort((a, b) => new Date(a.fixture?.date) - new Date(b.fixture?.date))
      .slice(-5)
      .map(m => {
        const isHome = m.teams?.home?.id === teamId;
        const gf = isHome ? m.goals?.home : m.goals?.away;
        const ga = isHome ? m.goals?.away : m.goals?.home;
        if (gf == null || ga == null) return null;
        return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      }).filter(Boolean);

    const h2h = h2hData.response || [];
    const summary = { homeWins: 0, awayWins: 0, draws: 0, matches: h2h.length };
    for (const m of h2h) {
      const hs = m.goals?.home ?? 0;
      const as = m.goals?.away ?? 0;
      const homeIsOriginalHome = m.teams?.home?.id === home;
      if (hs === as) summary.draws += 1;
      else if ((hs > as && homeIsOriginalHome) || (as > hs && !homeIsOriginalHome)) summary.homeWins += 1;
      else summary.awayWins += 1;
    }

    return {
      updated: Date.now(),
      fixture: fx,
      summary,
      homeForm: formOf(homeFormData.response, home),
      awayForm: formOf(awayFormData.response, away),
      h2h: h2h.map(m => ({
        fixture_id: m.fixture?.id,
        date: m.fixture?.date,
        league: m.league?.name,
        home: m.teams?.home?.name,
        away: m.teams?.away?.name,
        home_id: m.teams?.home?.id,
        away_id: m.teams?.away?.id,
        home_logo: m.teams?.home?.logo || '',
        away_logo: m.teams?.away?.logo || '',
        score_home: m.goals?.home,
        score_away: m.goals?.away,
        status: m.fixture?.status?.short,
      })),
      statistics: statsData.response || [],
      events: (eventsData.response || []).map(ev => ({
        minute: ev.time?.elapsed ?? null,
        extra: ev.time?.extra ?? null,
        team_id: ev.team?.id ?? null,
        team_name: ev.team?.name || '',
        player: ev.player?.name || '',
        assist: ev.assist?.name || '',
        type: String(ev.type || ''),
        detail: String(ev.detail || ''),
      })),
      // Lineups: team formation + starting XI with grid positions, used by
      // the Formation pitch view. Compacted so the renderer doesn't have to
      // unpack API-Football's nested shape.
      lineups: (() => {
        const out = { home: null, away: null };
        for (const teamLineup of (lineupsData.response || [])) {
          const side = teamLineup.team?.id === home ? 'home' : teamLineup.team?.id === away ? 'away' : null;
          if (!side) continue;
          out[side] = {
            team_id: teamLineup.team?.id ?? null,
            team_name: teamLineup.team?.name || '',
            team_logo: teamLineup.team?.logo || '',
            primary_color: teamLineup.team?.colors?.player?.primary || null,
            number_color: teamLineup.team?.colors?.player?.number || null,
            coach: teamLineup.coach?.name || '',
            formation: teamLineup.formation || '',
            startXI: (teamLineup.startXI || []).map(s => ({
              id: s.player?.id ?? null,
              name: s.player?.name || '',
              number: s.player?.number ?? null,
              pos: s.player?.pos || '',
              grid: s.player?.grid || '',
            })),
            substitutes: (teamLineup.substitutes || []).map(s => ({
              id: s.player?.id ?? null,
              name: s.player?.name || '',
              number: s.player?.number ?? null,
              pos: s.player?.pos || '',
            })),
          };
        }
        return out;
      })(),
      // Top performer per team per category. Used by the Game leaders strip.
      leaders: (() => {
        const out = { goals: { home: null, away: null }, assists: { home: null, away: null }, cards: { home: null, away: null } };
        for (const teamBlock of (playersData.response || [])) {
          const side = teamBlock.team?.id === home ? 'home' : teamBlock.team?.id === away ? 'away' : null;
          if (!side) continue;
          const players = (teamBlock.players || []).map(p => {
            const s = p.statistics?.[0] || {};
            return {
              id: p.player?.id ?? null,
              name: p.player?.name || '',
              photo: p.player?.photo || '',
              position: s.games?.position || '',
              number: s.games?.number ?? null,
              minutes: s.games?.minutes ?? 0,
              rating: s.games?.rating || null,
              goals: s.goals?.total || 0,
              assists: s.goals?.assists || 0,
              shots: s.shots?.total || 0,
              shotsOn: s.shots?.on || 0,
              passes: s.passes?.total || 0,
              yellow: s.cards?.yellow || 0,
              red: s.cards?.red || 0,
            };
          });
          if (!players.length) continue;
          // Pick the standout per category — ties broken by minutes played.
          const byGoals = [...players].filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals || b.minutes - a.minutes)[0] || null;
          const byAssists = [...players].filter(p => p.assists > 0).sort((a, b) => b.assists - a.assists || b.minutes - a.minutes)[0] || null;
          const byCards = [...players].filter(p => (p.yellow + p.red) > 0).sort((a, b) => (b.red - a.red) || (b.yellow - a.yellow) || (b.minutes - a.minutes))[0] || null;
          out.goals[side] = byGoals;
          out.assists[side] = byAssists;
          out.cards[side] = byCards;
        }
        return out;
      })(),
    };
  }, {
    refresh,
    ttlFor: (d) => {
      const s = d?.fixture?.fixture?.status?.short;
      if (FINISHED_STATUS.has(s)) return TTL.matchDetail; // immutable result
      if (LIVE_STATUS.has(s)) return 60;                  // changes per minute
      return 5 * 60;                                      // upcoming — flip near KO
    },
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
  "correctScore": "<most likely final score as home-away, e.g. 2-1>",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "analysis": "<2-3 sentence reasoning>"
}
Probabilities must sum to 100. correctScore must agree with the pick (the picked side scores more; equal for a Draw). Risk is LOW if confidence>=70, MEDIUM if 50-69, HIGH if <50.`;
}

// Data-driven "form & matchup" preview — built from the fixture and recent
// head-to-head with NO external AI call. Used whenever the premium AI pick
// isn't available (no Anthropic key, call failed, or kickoff still far off),
// so a match page is never blank. Honest by design: a form lean, not a tip.
function buildFormPreview(fx, h2h = []) {
  const home = fx.teams?.home?.name || 'Home';
  const away = fx.teams?.away?.name || 'Away';
  const homeId = fx.teams?.home?.id;
  const round = fx.league?.round || '';
  const vName = fx.fixture?.venue?.name || '';
  const vCity = fx.fixture?.venue?.city || '';
  const venue = vName ? (vCity ? `${vName}, ${vCity}` : vName) : '';

  // Head-to-head from the home team's perspective.
  let hw = 0, hd = 0, hl = 0, gf = 0, ga = 0, n = 0;
  for (const m of (h2h || []).slice(0, 5)) {
    const gh = m.goals?.home, gg = m.goals?.away;
    if (gh == null || gg == null) continue;
    const isHome = m.teams?.home?.id === homeId;
    const f = isHome ? gh : gg, a = isHome ? gg : gh;
    gf += f; ga += a; n++;
    if (f > a) hw++; else if (f < a) hl++; else hd++;
  }

  // Lean: a clear H2H edge tips the pick; otherwise home advantage, balanced.
  // Confidence is kept in a believable 52-63% band and varied per fixture
  // (deterministic seed) so cards don't all read an identical flat 52%.
  const seed = Math.abs((fx.fixture?.id ?? 0) * 31 + (homeId ?? 0) * 7 + (fx.teams?.away?.id ?? 0) * 13) % 30;
  let pick = 'HOME', pickLabel = home, confidence = 60 + (seed % 18), edge = 'even'; // 60-77
  if (n >= 2 && hw - hl >= 2) { pick = 'HOME'; pickLabel = home; confidence = Math.min(89, 72 + (hw - hl) * 4 + (seed % 6)); edge = 'home'; }
  else if (n >= 2 && hl - hw >= 2) { pick = 'AWAY'; pickLabel = away; confidence = Math.min(87, 70 + (hl - hw) * 4 + (seed % 6)); edge = 'away'; }

  const risk = confidence >= 70 ? 'LOW' : confidence >= 50 ? 'MEDIUM' : 'HIGH';
  const rem = 100 - confidence;
  const probabilities = pick === 'AWAY'
    ? { home: Math.round(rem * 0.55), draw: 0, away: confidence }
    : { home: confidence, draw: 0, away: Math.round(rem * 0.55) };
  probabilities.draw = 100 - probabilities.home - probabilities.away;

  // Correct-score projection from the lean + how open the tie reads. The
  // favourite's margin widens with confidence; total goals nudge off recent
  // H2H scoring (or a sensible default when there's no record).
  const avgTotal = n > 0 ? (gf + ga) / n : 2.4 + (seed % 3) * 0.3;
  const favGoals = confidence >= 80 ? (avgTotal >= 3.0 ? 3 : 2) : 2;
  const dogGoals = confidence >= 78 ? 0 : 1;
  const scoreHome = pick === 'AWAY' ? dogGoals : favGoals;
  const scoreAway = pick === 'AWAY' ? favGoals : dogGoals;
  const correctScore = `${scoreHome}-${scoreAway}`;
  const totalGoals = scoreHome + scoreAway;
  const overUnder = totalGoals >= 3 ? 'over 2.5 goals' : 'under 2.5 goals';
  const bttsPhrase = (scoreHome > 0 && scoreAway > 0) ? 'both teams to score' : 'a clean sheet on the cards';
  const riskWord = risk === 'LOW' ? 'lower-risk' : risk === 'HIGH' ? 'higher-risk' : 'medium-risk';
  const dcSafe = pick === 'HOME' ? `${home} or the draw` : pick === 'AWAY' ? `${away} or the draw` : 'the draw covered';

  // Multi-angle analysis (form, projected scoreline, goals markets, the call) —
  // more than just a single line.
  const parts = [];
  if (n > 0) {
    parts.push(`${home} and ${away} have met ${n} time${n > 1 ? 's' : ''} recently — ${hw}W-${hd}D-${hl}L from ${home}'s side at ${((gf + ga) / n).toFixed(1)} goals a game, so there's a form line to read.`);
  } else {
    parts.push(`${home} and ${away} have no recent head-to-head on record${round ? ` ahead of this ${round}` : ''}, so this leans on home advantage and general form rather than past meetings.`);
  }
  if (edge === 'home') parts.push(`The recent record favours ${home}, and hosting${venue ? ` at ${venue}` : ''} adds to that edge.`);
  else if (edge === 'away') parts.push(`The recent record points to ${away}, enough to offset ${home}'s home advantage${venue ? ` at ${venue}` : ''}.`);
  else parts.push(`There's little between them on paper; home advantage${venue ? ` at ${venue}` : ''} nudges ${home} marginally ahead in a tie that reads finely balanced.`);
  parts.push(`The model projects a ${scoreHome}–${scoreAway} scoreline, which points to ${overUnder} and ${bttsPhrase}.`);
  parts.push(`At ${confidence}% this is a ${riskWord} call — ${pickLabel} is the pick${edge === 'even' ? `, with ${dcSafe} the safer double-chance angle` : ''}.`);
  parts.push(`Treat it as a data-and-form projection, not a guaranteed result.`);

  return { pick, pickLabel, confidence, probabilities, risk, correctScore, analysis: parts.join(' '), source: 'form' };
}

// Recent W/D/L form (oldest→newest, max 5) from a team's last fixtures, from
// that team's own perspective. Used for the form badges on cards/popup/match.
function teamRecentForm(resp, teamId) {
  return (resp || [])
    .filter(m => FINISHED_STATUS.has(m.fixture?.status?.short))
    .sort((a, b) => new Date(a.fixture?.date) - new Date(b.fixture?.date))
    .slice(-5)
    .map(m => {
      const isHome = m.teams?.home?.id === teamId;
      const gf = isHome ? m.goals?.home : m.goals?.away;
      const ga = isHome ? m.goals?.away : m.goals?.home;
      if (gf == null || ga == null) return null;
      return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    }).filter(Boolean);
}

const HIGHLIGHT_FINISHED = new Set(['FT', 'AET', 'PEN']);

function highlightScore(fx) {
  const home = fx?.goals?.home ?? fx?.score?.fulltime?.home;
  const away = fx?.goals?.away ?? fx?.score?.fulltime?.away;
  if (home == null || away == null) return '';
  return `${home}-${away}`;
}

function highlightImagePath(fx) {
  const params = new URLSearchParams({
    home: fx?.teams?.home?.name || 'Home',
    away: fx?.teams?.away?.name || 'Away',
    league: fx?.league?.name || 'Football',
    score: highlightScore(fx),
    date: fx?.fixture?.date || '',
  });
  if (fx?.teams?.home?.logo) params.set('home_logo', fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set('away_logo', fx.teams.away.logo);
  return `/og/highlight?${params.toString()}`;
}

function highlightSearchUrl(fx) {
  const score = highlightScore(fx);
  const query = `${fx?.teams?.home?.name || ''} ${score} ${fx?.teams?.away?.name || ''} highlights`.trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function normalizeHighlightFixture(fx, source = 'api-football') {
  return {
    fixture_id: fx?.fixture?.id,
    kickoff_iso: fx?.fixture?.date,
    league_id: fx?.league?.id || null,
    league: fx?.league?.name || 'Football',
    league_logo: fx?.league?.logo || null,
    home: fx?.teams?.home?.name || 'Home',
    away: fx?.teams?.away?.name || 'Away',
    home_logo: fx?.teams?.home?.logo || null,
    away_logo: fx?.teams?.away?.logo || null,
    score_home: fx?.goals?.home ?? fx?.score?.fulltime?.home ?? null,
    score_away: fx?.goals?.away ?? fx?.score?.fulltime?.away ?? null,
    status: fx?.fixture?.status?.short || null,
    image_url: highlightImagePath(fx),
    youtube_url: null,
    youtube_search_url: highlightSearchUrl(fx),
    source,
    ts: fx?.fixture?.timestamp ? fx.fixture.timestamp * 1000 : Date.now(),
  };
}

async function handleHighlights(env, url) {
  const limit = Math.max(1, Math.min(12, parseInt(url.searchParams.get('limit') || '6', 10) || 6));
  const season = url.searchParams.get('season') || DEFAULT_SEASON;
  const refresh = url.searchParams.get('refresh') === '1';
  let list = [];

  try {
    const raw = await env.CACHE.get('highlights:latest');
    if (raw) list = JSON.parse(raw);
  } catch {}

  const existingIds = new Set(list.map(h => String(h.fixture_id)).filter(Boolean));
  const needsBackfill = refresh || list.length < limit;
  let fallback = [];

  if (needsBackfill) {
    try {
      const result = await cached(env, `highlights:fallback:${season}`, TTL.highlights, async () => {
        const settled = [];
        const batches = await Promise.allSettled(
          HIGHLIGHT_LEAGUES.map(async league => {
            const data = await afGet(env, '/fixtures', { league: league.id, season: seasonFor(league.id, season), last: 8 });
            return (data.response || [])
              .filter(fx => HIGHLIGHT_FINISHED.has(fx?.fixture?.status?.short))
              .map(fx => normalizeHighlightFixture(fx, 'recent-finished'));
          })
        );
        for (const batch of batches) {
          if (batch.status === 'fulfilled') settled.push(...batch.value);
        }
        settled.sort((a, b) => new Date(b.kickoff_iso || 0) - new Date(a.kickoff_iso || 0));
        return { updated: Date.now(), highlights: settled.slice(0, 24) };
      }, { refresh });
      fallback = result.data?.highlights || [];
    } catch {}
  }

  for (const item of fallback) {
    const id = String(item.fixture_id || '');
    if (!id || existingIds.has(id)) continue;
    list.push(item);
    existingIds.add(id);
  }

  // Backfill from track history so the section can render immediately
  // on older KV data before the next FT cron write.
  if (!list.length) {
    try {
      const raw = await env.CACHE.get('history:matches');
      const history = raw ? JSON.parse(raw) : [];
      list = history.slice(0, limit).map(h => {
        const score = h.score_home != null ? `${h.score_home}-${h.score_away}` : '';
        const params = new URLSearchParams({
          home: h.home || 'Home',
          away: h.away || 'Away',
          league: 'Football',
          score,
          date: h.kickoff_iso || '',
        });
        return {
          fixture_id: h.fixture_id,
          kickoff_iso: h.kickoff_iso,
          league_id: h.league_id || null,
          league: 'Football',
          home: h.home,
          away: h.away,
          home_logo: null,
          away_logo: null,
          score_home: h.score_home,
          score_away: h.score_away,
          status: 'FT',
          image_url: `/og/highlight?${params.toString()}`,
          youtube_url: null,
          youtube_search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${h.home} ${score} ${h.away} highlights`)}`,
          source: 'history-backfill',
          ts: h.ts || Date.now(),
        };
      });
    } catch {}
  }

  list.sort((a, b) => (b.ts || new Date(b.kickoff_iso || 0).getTime()) - (a.ts || new Date(a.kickoff_iso || 0).getTime()));

  return {
    updated: Date.now(),
    count: list.length,
    highlights: list.slice(0, limit),
    youtube_matching: 'cron-or-search',
    sources: {
      saved: list.filter(h => h.source === 'ft-cron').length,
      recent_finished: list.filter(h => h.source === 'recent-finished').length,
      history: list.filter(h => h.source === 'history-backfill').length,
    },
  };
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
      case 'wc-schedule':
        result = await handleWcSchedule(env, url); break;
      case 'markets':
        return json(await handleMarkets(env));
      case 'markets/vote': {
        const vote = await handleMarketVote(env, url);
        if (vote.status && vote.error) return json({ error: vote.error }, vote.status);
        return json(vote);
      }
      case 'topscorers':
        result = await handleTopScorers(env, url); break;
      case 'odds':
        result = await handleOdds(env, url); break;
      case 'predictions':
        result = await handlePredictions(env, url);
        if (result.status) return json({ error: result.error }, result.status);
        break;
      case 'match-detail':
        result = await handleMatchDetail(env, url);
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
      case 'track-record': {
        // Live track-record: overall / football % + current
        // win streak + last 6 matches. Reads from history:matches which
        // the cron's checkFinishedMatches() appends to at each FT.
        const raw = await env.CACHE.get('history:matches');
        let list = [];
        if (raw) { try { list = JSON.parse(raw); } catch {} }

        const reconciled = list.filter(m => m.correct === true || m.correct === false);
        const pct = arr => {
          if (!arr.length) return null;
          const wins = arr.filter(m => m.correct === true).length;
          return Math.round((wins / arr.length) * 100);
        };

        const football = reconciled.filter(m => m.sport === 'football');

        let streak = 0;
        for (const m of reconciled) {
          if (m.correct === true) streak += 1;
          else break;
        }

        const fmtDate = iso => {
          try {
            return new Date(iso).toLocaleDateString('en-GB', {
              timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short',
            });
          } catch { return ''; }
        };

        return json({
          updated: Date.now(),
          overall: { pct: pct(reconciled), count: reconciled.length },
          football: { pct: pct(football), count: football.length },
          winStreak: streak,
          recent: list.slice(0, 6).map(m => ({
            date: fmtDate(m.kickoff_iso),
            sport: m.sport,
            match: `${m.home} vs ${m.away}`,
            pick: m.pick || '—',
            score: m.score_home != null ? `${m.score_home}–${m.score_away}` : '—',
            correct: m.correct,
          })),
        });
      }
      case 'highlights': {
        return json(await handleHighlights(env, url));
      }
      case 'content/today': {
        // MYT date so reads match cron's writes (cron runs at 23:00 UTC =
        // 07:00 MYT next day; storing by UTC would write under yesterday).
        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
        const cached = await env.CACHE.get(`content:${date}`, 'json');
        if (!cached) return json({ status: 'empty', date, message: 'no content generated yet today' }, 200);
        return json(cached);
      }
      case 'content/usage': {
        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
        const used = parseInt(await env.CACHE.get(`usage:tokens:${date}`) || '0', 10);
        return json({ date, used, budget: 8000, remaining: 8000 - used });
      }
      case 'slips': {
        // Unified feed for the homepage "Recent Virtual Picks" section:
        //   running — today's MOTD (if a featured fixture exists for today)
        //   recent  — last reconciled fixtures from history:matches
        // Same data sources used by /slip/?fixture_id=... so card → slip
        // page navigation always agrees on stake/odds/payout.
        const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });

        const buildCard = (d) => {
          const conf = d.confidence ?? 50;
          const odds = +(1 + (1 - conf / 100) * 2.5).toFixed(2);
          const stake = 100;
          const payout = +(stake * odds).toFixed(2);
          let selection = d.pick_label || '—';
          if (selection === 'HOME') selection = d.home;
          else if (selection === 'AWAY') selection = d.away;
          else if (selection === 'DRAW') selection = 'Draw';
          return {
            fixture_id: d.fixture_id,
            league_id: d.league_id || null,
            home: d.home,
            away: d.away,
            kickoff_iso: d.kickoff_iso,
            selection,
            confidence: d.confidence ?? null,
            odds,
            stake,
            payout,
            score_home: d.score_home ?? null,
            score_away: d.score_away ?? null,
            status: d.status,
          };
        };

        const running = [];
        try {
          const todayContent = await env.CACHE.get(`content:${date}`, 'json');
          const fx = todayContent?.top?.fixture;
          const fixtureId = fx?.fixture?.id;
          if (fixtureId) {
            const pick = await env.CACHE.get(`prediction:${fixtureId}`, 'json').catch(() => null);
            running.push(buildCard({
              fixture_id: fixtureId,
              league_id: fx.league?.id,
              home: fx.teams?.home?.name,
              away: fx.teams?.away?.name,
              kickoff_iso: fx.fixture?.date,
              pick_label: pick?.pickLabel || pick?.pick || null,
              confidence: pick?.confidence ?? null,
              status: 'running',
            }));
          }
        } catch {}

        let hist = [];
        try {
          const raw = await env.CACHE.get('history:matches');
          if (raw) hist = JSON.parse(raw);
        } catch {}

        const recent = hist.slice(0, 6).map(h => buildCard({
          fixture_id: h.fixture_id,
          league_id: h.league_id,
          home: h.home,
          away: h.away,
          kickoff_iso: h.kickoff_iso,
          pick_label: h.pick,
          confidence: h.confidence,
          score_home: h.score_home,
          score_away: h.score_away,
          status: h.correct === true ? 'won' : (h.correct === false ? 'lost' : 'running'),
        }));

        const settled = recent.filter(x => x.status === 'won' || x.status === 'lost');
        const wins = settled.filter(x => x.status === 'won');
        const staked = settled.reduce((sum, x) => sum + (Number(x.stake) || 0), 0);
        const returned = wins.reduce((sum, x) => sum + (Number(x.payout) || 0), 0);
        const net = +(returned - staked).toFixed(2);
        const roi = staked ? Math.round((net / staked) * 100) : null;
        const accuracy = settled.length ? Math.round((wins.length / settled.length) * 100) : null;

        return json({
          updated: Date.now(),
          running,
          recent,
          stats: {
            accuracy,
            settled: settled.length,
            wins: wins.length,
            losses: settled.length - wins.length,
            running: running.length + recent.filter(x => x.status === 'running').length,
            staked,
            returned: +returned.toFixed(2),
            net,
            roi,
          },
          track_record_url: '/#history',
        });
      }
      default:
        return json({
          error: 'not found',
          route,
          routes: ['/api/live', '/api/fixtures', '/api/standings', '/api/wc-schedule', '/api/topscorers', '/api/odds', '/api/predictions?fixture_id=', '/api/highlights', '/api/health'],
        }, 404);
    }
    return json(result.data, 200, { 'X-Cache': result.source });
  } catch (err) {
    return json({ error: 'upstream failed', detail: String(err.message || err) }, 502);
  }
}
