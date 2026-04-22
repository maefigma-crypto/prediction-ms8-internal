// Minimal Telegram Bot API wrapper for sending photos + text to channels.
//
// Required env vars:
//   env.TG_BOT_TOKEN    - bot token from BotFather (bot MUST be admin of
//                         target channel with "Post Messages" permission)
//   env.TG_CHANNEL_ID   - either @public_username or numeric -100... id

const TG_API = 'https://api.telegram.org';

// sendPhoto with PNG bytes as multipart form data.
// Returns Telegram's message object on success.
export async function sendPhoto(env, { photoBytes, caption, parseMode = 'HTML' }) {
  assertCreds(env);

  const form = new FormData();
  form.append('chat_id', env.TG_CHANNEL_ID);
  form.append('parse_mode', parseMode);
  if (caption) form.append('caption', caption);
  form.append(
    'photo',
    new Blob([photoBytes], { type: 'image/png' }),
    'daily.png'
  );

  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram sendPhoto failed ${data.error_code || res.status}: ${data.description || 'unknown'}`
    );
  }
  return data.result;
}

// sendMessage for text-only posts (polls, accuracy tracker, etc.).
export async function sendMessage(env, { text, parseMode = 'HTML', disablePreview = false }) {
  assertCreds(env);

  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TG_CHANNEL_ID,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: disablePreview,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram sendMessage failed ${data.error_code || res.status}: ${data.description || 'unknown'}`
    );
  }
  return data.result;
}

function assertCreds(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    throw new Error('TG_BOT_TOKEN and TG_CHANNEL_ID must be set');
  }
}
