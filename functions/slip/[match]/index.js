// Pretty-URL slip handler: /slip/<fixture-id>-<home>-vs-<away>/
// Examples:
//   /slip/1540844-arsenal-vs-chelsea/?status=running&stake=100
//   /slip/1540844/?status=won&stake=100
// Delegates to the existing /slip/?fixture_id=N renderer.

import { onRequest as legacySlipHandler } from '../index.js';

export async function onRequest(context) {
  const slug = String(context.params.match || '');
  const m = slug.match(/^(\d+)/);
  if (!m) return new Response('not found', { status: 404 });

  // Build a synthetic legacy-style request that the existing handler understands.
  const url = new URL(context.request.url);
  const newUrl = new URL('/slip/', url);
  newUrl.searchParams.set('fixture_id', m[1]);
  for (const [k, v] of url.searchParams) {
    if (k === 'fixture_id') continue;
    newUrl.searchParams.set(k, v);
  }
  const newReq = new Request(newUrl.toString(), context.request);
  return legacySlipHandler({ ...context, request: newReq });
}
