// Shared helpers: fetch and parse repo content from GitHub (public repo, no auth).
// Results are cached in KV with short TTLs so we don't hammer GitHub's 60/hr
// unauthenticated rate limit per Cloudflare colo.

export const REPO = 'maefigma-crypto/prediction-ms8-internal';
export const BRANCH = 'main';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const API = `https://api.github.com/repos/${REPO}/contents`;

export const SITE_URL = 'https://scoreocs8.pages.dev';

export async function getSettings(env) {
  const cacheKey = 'repo:settings';
  if (env?.CACHE) {
    const hit = await env.CACHE.get(cacheKey, 'json');
    if (hit) return hit;
  }
  try {
    const res = await fetch(`${RAW}/_data/settings.json`);
    if (!res.ok) return defaultSettings();
    const data = await res.json();
    if (env?.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
    return data;
  } catch {
    return defaultSettings();
  }
}

export async function getRedirects(env) {
  const cacheKey = 'repo:redirects';
  if (env?.CACHE) {
    const hit = await env.CACHE.get(cacheKey, 'json');
    if (hit) return hit;
  }
  try {
    const res = await fetch(`${RAW}/_data/redirects.json`);
    if (!res.ok) return { redirects: [] };
    const data = await res.json();
    if (env?.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 300 });
    return data;
  } catch {
    return { redirects: [] };
  }
}

export function defaultSettings() {
  return {
    site_name: 'ScoreOcs8',
    default_seo_title: 'ScoreOcs8 — AI Sports Predictions',
    default_meta_description: 'AI-powered football and badminton predictions.',
    default_og_image: '',
    robots_txt: 'User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: https://scoreocs8.pages.dev/sitemap.xml',
    google_analytics_id: '',
    search_console_verify: '',
    organisation_schema: '',
  };
}

export function parseFrontmatter(md) {
  const m = md.match(/^---\s*\n([\s\S]+?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  let currentList = null;
  let currentKey = null;
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\r$/, '');
    const nested = line.match(/^\s+-\s+(.+)$/);
    if (nested && currentList) {
      currentList.push(parseScalar(nested[1]));
      continue;
    }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, vRaw] = kv;
    const v = vRaw.trim();
    currentKey = k;
    if (v === '') {
      currentList = [];
      meta[k] = currentList;
    } else {
      meta[k] = parseScalar(v);
      currentList = null;
    }
  }
  return { meta, body: m[2] };
}

function parseScalar(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export async function listPosts(env) {
  const cacheKey = 'repo:posts:list';
  if (env?.CACHE) {
    const hit = await env.CACHE.get(cacheKey, 'json');
    if (hit) return hit;
  }
  try {
    const res = await fetch(`${API}/_posts?ref=${BRANCH}`);
    if (res.status === 404) {
      const v = [];
      if (env?.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(v), { expirationTtl: 300 });
      return v;
    }
    if (!res.ok) throw new Error(`github ${res.status}`);
    const files = (await res.json()).filter(f => f.type === 'file' && f.name.endsWith('.md'));
    const posts = await Promise.all(files.map(async f => {
      const raw = await fetch(f.download_url).then(r => r.text());
      const { meta, body } = parseFrontmatter(raw);
      const slug = meta.slug || f.name.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      return { filename: f.name, slug, meta, body };
    }));
    posts.sort((a, b) => new Date(b.meta.date || 0) - new Date(a.meta.date || 0));
    if (env?.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(posts), { expirationTtl: 300 });
    return posts;
  } catch {
    return [];
  }
}

export async function getPostBySlug(env, slug) {
  if (slug?.startsWith('daily-')) {
    const kv = await listKvContent(env, 60);
    const hit = kv.find(p => p.slug === slug);
    if (hit) return hit;
  }
  const posts = await listPosts(env);
  return posts.find(p => p.slug === slug || p.filename.replace(/\.md$/, '') === slug) || null;
}

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function escXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

// Pull cron-generated content from KV for the last N days. Each daily bundle
// stored at "content:YYYY-MM-DD" contains { top, previews[] }. Flatten into
// virtual "posts" with stable slugs so the blog listing + SSR post pages can
// render cron content without requiring /_posts/ markdown files.
export async function listKvContent(env, days = 30) {
  if (!env?.CACHE) return [];
  const now = new Date();
  const items = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    try {
      const bundle = await env.CACHE.get(`content:${dateKey}`, 'json');
      if (!bundle) continue;
      if (bundle.top) items.push(toKvPost(dateKey, 'top', bundle.top, bundle.generatedAt));
      for (let p = 0; p < (bundle.previews || []).length; p++) {
        items.push(toKvPost(dateKey, `p${p + 1}`, bundle.previews[p], bundle.generatedAt));
      }
    } catch { /* skip day */ }
  }
  return items;
}

function toKvPost(dateKey, kind, entry, generatedAt) {
  const c = entry?.content || {};
  const fx = entry?.fixture || {};
  const leagueKey = fx._leagueKey || (fx.league?.id === 39 ? 'EPL' : fx.league?.id === 2 ? 'UCL' : fx.league?.id === 1 ? 'FIFA' : 'General');
  const categoryMap = {
    EPL: 'English Premier League',
    UCL: 'UEFA Champions League',
    FIFA: 'FIFA World Cup',
    BWF: 'BWF Badminton',
    General: 'Football Prediction',
  };
  const slug = `daily-${dateKey}-${kind}`;
  const dateIso = new Date(generatedAt || (dateKey + 'T07:00:00+08:00')).toISOString();

  // Branded composite OG image — a ScoreOcs8-themed match card served by
  // /og/match (pure-SVG, no deps, cached 1y immutable). We pass home/away/
  // league/date via query so every match gets a unique URL that crawlers
  // cache by URL.
  const homeName = fx.teams?.home?.name || '';
  const awayName = fx.teams?.away?.name || '';
  const leagueLabel = fx.league?.name || categoryMap[leagueKey] || 'Match Preview';
  const kickoff = fx.fixture?.date || dateIso;
  const ogParams = new URLSearchParams();
  if (homeName) ogParams.set('home', homeName);
  if (awayName) ogParams.set('away', awayName);
  ogParams.set('league', leagueLabel);
  ogParams.set('date', kickoff);
  ogParams.set('tag', kind === 'top' ? 'MATCH OF THE DAY' : 'AI PICK');
  const ogImage = `${SITE_URL}/og/match?${ogParams.toString()}`;

  return {
    filename: `${slug}.kv`,
    slug,
    source: 'kv',
    meta: {
      title: c.title_en || 'Daily AI Preview',
      date: dateIso,
      category: categoryMap[leagueKey] || 'Football Prediction',
      league: leagueKey,
      excerpt: c.meta_description || (c.body_en || '').replace(/[#*_`>\-]/g, '').slice(0, 155) || 'AI-generated match preview.',
      featured_image: ogImage,
      seo_title: c.title_en || 'Daily AI Preview',
      meta_description: c.meta_description || (c.body_en || '').replace(/\s+/g, ' ').slice(0, 155),
      // Keep title localisation; body is EN-only (SEO focus).
      title_bm: c.title_bm || '',
      title_zh: c.title_zh || '',
      include_in_sitemap: true,
      sitemap_priority: kind === 'top' ? '0.8' : '0.6',
      meta_robots: 'index, follow',
      og_title: c.title_en || '',
      og_description: c.meta_description || '',
      og_image: ogImage,
      og_type: 'article',
      twitter_card: 'summary_large_image',
      schema_type: 'Article',
      // SportsEvent schema surfaces — populated from fixture for cron posts.
      sports_sport: leagueKey === 'BWF' ? 'Badminton' : 'Football',
      sports_home_name: homeName,
      sports_away_name: awayName,
      sports_start_date: fx.fixture?.date || '',
      sports_venue: fx.fixture?.venue?.name || '',
      sports_league: leagueLabel,
    },
    body: c.body_en || '',
  };
}
