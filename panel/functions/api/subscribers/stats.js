// GET /api/subscribers/stats?site=scoreocs8
// Returns total / 24h growth / 7d growth / country breakdown.

import { json } from '../../_lib/auth.js';

const SITES = ['scoreocs8'];                          // add 'megartp' here when onboarding

export async function onRequestGet({ request, env }) {
  if (!env.CACHE) return json({ error: 'kv-not-bound' }, { status: 500 });

  const url = new URL(request.url);
  const requestedSite = url.searchParams.get('site') || 'scoreocs8';
  if (!SITES.includes(requestedSite)) return json({ error: 'unknown-site' }, { status: 400 });

  const prefix = `push:${requestedSite}:`;
  let cursor;
  let total = 0;
  let last24h = 0;
  let last7d = 0;
  const byCountry = {};
  const byLang = {};
  const now = Date.now();
  const day = 24 * 3600 * 1000;

  // KV list pages return up to 1000 keys at a time; loop until done.
  do {
    const { keys, list_complete, cursor: next } = await env.CACHE.list({ prefix, cursor, limit: 1000 });
    for (const k of keys) {
      const raw = await env.CACHE.get(k.name);
      if (!raw) continue;
      let s; try { s = JSON.parse(raw); } catch { continue; }
      total++;
      if (s.createdAt && (now - s.createdAt) <= day)     last24h++;
      if (s.createdAt && (now - s.createdAt) <= 7 * day) last7d++;
      const c = s.country || '??';
      byCountry[c] = (byCountry[c] || 0) + 1;
      const l = s.lang || 'en';
      byLang[l] = (byLang[l] || 0) + 1;
    }
    cursor = list_complete ? null : next;
  } while (cursor);

  return json({
    site: requestedSite,
    total,
    last_24h: last24h,
    last_7d: last7d,
    by_country: byCountry,
    by_lang: byLang,
    fetched_at: now,
  });
}
