// GET /api/subscribers/list?site=scoreocs8&limit=50&cursor=...
// Paginated list of subscribers for one site.

import { json } from '../../_lib/auth.js';

const SITES = ['scoreocs8'];
const MAX_LIMIT = 200;

export async function onRequestGet({ request, env }) {
  if (!env.CACHE) return json({ error: 'kv-not-bound' }, { status: 500 });

  const url = new URL(request.url);
  const site = url.searchParams.get('site') || 'scoreocs8';
  if (!SITES.includes(site)) return json({ error: 'unknown-site' }, { status: 400 });

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), MAX_LIMIT);
  const cursor = url.searchParams.get('cursor') || undefined;

  const page = await env.CACHE.list({ prefix: `push:${site}:`, limit, cursor });
  const rows = [];
  for (const k of page.keys) {
    const raw = await env.CACHE.get(k.name);
    if (!raw) continue;
    let s; try { s = JSON.parse(raw); } catch { continue; }
    rows.push({
      id: k.name.replace(`push:${site}:`, ''),
      lang: s.lang || 'en',
      country: s.country || '',
      source: s.source || '',
      ua: s.userAgent || '',
      createdAt: s.createdAt || null,
      active: !!s.active,
    });
  }
  return json({
    site,
    rows,
    next_cursor: page.list_complete ? null : page.cursor,
  });
}
