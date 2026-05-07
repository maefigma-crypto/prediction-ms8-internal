// POST /api/broadcast/send
// Body: { site, title, body, url?, tag?, dry_run? }
//
// Iterates all subscribers under push:<site>:* in KV, encrypts the payload
// per-subscriber, sends via Web Push. Auto-deletes 410 Gone endpoints.
// Records the broadcast in audit log + a dedicated history entry.

import { json, audit } from '../../_lib/auth.js';
import { sendPush } from '../../_lib/webpush.js';

const SITES = ['scoreocs8'];                      // keep in sync with subscribers/stats
const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN  = 240;
const CONCURRENCY   = 50;

export async function onRequestPost({ request, env, data }) {
  if (!env.CACHE) return json({ error: 'kv-not-bound' }, { status: 500 });

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid-json' }, { status: 400 }); }

  const site = String(body?.site || 'scoreocs8');
  if (!SITES.includes(site)) return json({ error: 'unknown-site' }, { status: 400 });

  const title = String(body?.title || '').slice(0, MAX_TITLE_LEN).trim();
  const text  = String(body?.body  || '').slice(0, MAX_BODY_LEN).trim();
  const url   = String(body?.url   || '/');
  const tag   = String(body?.tag   || `bcast-${Date.now()}`);
  const dryRun = !!body?.dry_run;

  if (!title || !text) return json({ error: 'title-and-body-required' }, { status: 400 });

  const payload = { title, body: text, url, tag };
  const broadcastId = `bcast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Phase 1: enumerate subscribers.
  const subs = [];
  const prefix = `push:${site}:`;
  let cursor;
  do {
    const page = await env.CACHE.list({ prefix, cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.CACHE.get(k.name);
      if (!raw) continue;
      let s; try { s = JSON.parse(raw); } catch { continue; }
      if (!s.endpoint || !s.keys?.p256dh || !s.keys?.auth) continue;
      subs.push({ id: k.name, sub: s });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      site,
      payload,
      target_count: subs.length,
    });
  }

  // Phase 2: send with bounded concurrency.
  let sent = 0, failed = 0, gone = 0;
  const failures = [];

  async function worker(slice) {
    for (const { id, sub } of slice) {
      try {
        const r = await sendPush(env, sub, payload);
        if (r.ok) {
          sent++;
        } else if (r.gone) {
          gone++;
          await env.CACHE.delete(id);                       // auto-cleanup dead endpoint
        } else {
          failed++;
          if (failures.length < 20) failures.push({ id, status: r.status });
        }
      } catch (e) {
        failed++;
        if (failures.length < 20) failures.push({ id, error: String(e?.message || e) });
      }
    }
  }

  const slices = Array.from({ length: CONCURRENCY }, () => []);
  subs.forEach((s, i) => slices[i % CONCURRENCY].push(s));
  await Promise.all(slices.map(worker));

  // Phase 3: persist broadcast record + audit.
  const record = {
    id: broadcastId,
    site,
    payload,
    target: subs.length,
    sent,
    failed,
    gone,
    sent_by: data?.session?.username || 'unknown',
    sent_at: Date.now(),
    failures,
  };
  // Inverse-timestamp keying so newest comes first in list().
  const inv = String(9_999_999_999_999 - Date.now()).padStart(13, '0');
  await env.CACHE.put(`broadcast:${inv}:${broadcastId}`, JSON.stringify(record), {
    expirationTtl: 365 * 24 * 3600,
  });

  await audit(env, request, data?.session, 'broadcast.sent', {
    site, target: subs.length, sent, failed, gone, broadcast_id: broadcastId,
  });

  return json({ ok: true, ...record });
}
