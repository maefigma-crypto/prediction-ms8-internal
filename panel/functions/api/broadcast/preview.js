// POST /api/broadcast/preview
// Same payload shape as /send but returns the parsed/sanitised payload
// without actually fanning out — used by the compose UI's preview panel.

import { json } from '../../_lib/auth.js';

const MAX_TITLE_LEN = 80;
const MAX_BODY_LEN  = 240;

export async function onRequestPost({ request }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid-json' }, { status: 400 }); }

  const title = String(body?.title || '').slice(0, MAX_TITLE_LEN).trim();
  const text  = String(body?.body  || '').slice(0, MAX_BODY_LEN).trim();
  const url   = String(body?.url   || '/');

  return json({
    title,
    body: text,
    url,
    title_length: title.length,
    body_length: text.length,
    title_max: MAX_TITLE_LEN,
    body_max: MAX_BODY_LEN,
  });
}
