// GET /api/audit/log?limit=50&cursor=...
// Returns recent audit events newest-first.

import { json } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  if (!env.CACHE) return json({ error: 'kv-not-bound' }, { status: 500 });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const cursor = url.searchParams.get('cursor') || undefined;

  const page = await env.CACHE.list({ prefix: 'audit:', limit, cursor });
  const rows = [];
  for (const k of page.keys) {
    const raw = await env.CACHE.get(k.name);
    if (!raw) continue;
    try { rows.push(JSON.parse(raw)); } catch { /* skip */ }
  }
  return json({
    rows,
    next_cursor: page.list_complete ? null : page.cursor,
  });
}
