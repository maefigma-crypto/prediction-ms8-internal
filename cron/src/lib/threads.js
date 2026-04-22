// Threads API adapter (Meta).
//
// Same 2-step create/publish pattern as Instagram. Different base URL,
// different id. Shares an access-token model with Meta's other products
// but Threads uses its OWN user_id and token (not the IG one).
//
// Required secrets:
//   THREADS_USER_ID        Threads user id (17-digit numeric)
//   THREADS_ACCESS_TOKEN   long-lived token with threads_basic,
//                          threads_content_publish scopes
//
// Setup:
// 1. developers.facebook.com → app → add "Threads API" product
// 2. Graph API Explorer → select Threads → generate user token
// 3. Use /me to get THREADS_USER_ID
// 4. Exchange short-lived token for long-lived via:
//    GET /access_token?grant_type=th_exchange_token&client_secret=&access_token=

const THREADS = 'https://graph.threads.net/v1.0';

async function createContainer(env, { imageUrl, text }) {
  const params = new URLSearchParams({
    media_type: 'IMAGE',
    image_url: imageUrl,
    text: text || '',
    access_token: env.THREADS_ACCESS_TOKEN,
  });
  const res = await fetch(`${THREADS}/${env.THREADS_USER_ID}/threads?${params}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads create container ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

async function publishContainer(env, creationId) {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: env.THREADS_ACCESS_TOKEN,
  });
  const res = await fetch(`${THREADS}/${env.THREADS_USER_ID}/threads_publish?${params}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads publish ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}

function assertCreds(env) {
  if (!env.THREADS_USER_ID || !env.THREADS_ACCESS_TOKEN) {
    throw new Error('THREADS_USER_ID and THREADS_ACCESS_TOKEN must be set');
  }
}

export async function postPhoto(env, { imageUrl, text }) {
  assertCreds(env);
  const creationId = await createContainer(env, { imageUrl, text });
  // Same fetch-delay behaviour as IG — sometimes Meta needs a moment.
  try {
    const threadId = await publishContainer(env, creationId);
    return { threadId, creationId };
  } catch (e) {
    await new Promise(r => setTimeout(r, 3000));
    const threadId = await publishContainer(env, creationId);
    return { threadId, creationId, retried: true };
  }
}
