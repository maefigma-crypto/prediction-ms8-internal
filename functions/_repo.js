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
  const posts = await listPosts(env);
  return posts.find(p => p.slug === slug || p.filename.replace(/\.md$/, '') === slug) || null;
}

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function escXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
