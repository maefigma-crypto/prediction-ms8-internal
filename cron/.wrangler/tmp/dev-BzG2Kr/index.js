var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/lib/screenshot.js
var CF_API = "https://api.cloudflare.com/client/v4";
async function screenshot(env, {
  url,
  viewport = { width: 1080, height: 1920 },
  waitUntil = "networkidle0",
  timeoutMs = 3e4
}) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
    throw new Error("CF_ACCOUNT_ID and CF_API_TOKEN must be set");
  }
  const res = await fetch(
    `${CF_API}/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/screenshot`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        viewport,
        gotoOptions: { waitUntil, timeout: timeoutMs },
        screenshotOptions: { type: "png", fullPage: false, omitBackground: false }
      })
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Browser Rendering ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.arrayBuffer();
}
__name(screenshot, "screenshot");

// src/lib/telegram.js
var TG_API = "https://api.telegram.org";
async function postingOff(env) {
  try {
    return await env.CACHE?.get("tg:posting") === "off";
  } catch {
    return false;
  }
}
__name(postingOff, "postingOff");
async function sendPhoto(env, { photoBytes, caption, parseMode = "HTML" }) {
  if (await postingOff(env)) return { disabled: true };
  assertCreds(env);
  const form = new FormData();
  form.append("chat_id", env.TG_CHANNEL_ID);
  form.append("parse_mode", parseMode);
  if (caption) form.append("caption", caption);
  form.append(
    "photo",
    new Blob([photoBytes], { type: "image/png" }),
    "daily.png"
  );
  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
    method: "POST",
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram sendPhoto failed ${data.error_code || res.status}: ${data.description || "unknown"}`
    );
  }
  return data.result;
}
__name(sendPhoto, "sendPhoto");
async function sendMessage(env, { text, parseMode = "HTML", disablePreview = false }) {
  if (await postingOff(env)) return { disabled: true };
  assertCreds(env);
  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHANNEL_ID,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: disablePreview
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram sendMessage failed ${data.error_code || res.status}: ${data.description || "unknown"}`
    );
  }
  return data.result;
}
__name(sendMessage, "sendMessage");
async function sendPoll(env, { question, options, isAnonymous = true }) {
  if (await postingOff(env)) return { disabled: true };
  assertCreds(env);
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
    throw new Error(`sendPoll needs 2-10 options, got ${options?.length}`);
  }
  const res = await fetch(`${TG_API}/bot${env.TG_BOT_TOKEN}/sendPoll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHANNEL_ID,
      question: String(question || "").slice(0, 300),
      options: options.map((o) => String(o || "").slice(0, 100)),
      is_anonymous: !!isAnonymous,
      type: "regular",
      allows_multiple_answers: false
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `Telegram sendPoll failed ${data.error_code || res.status}: ${data.description || "unknown"}`
    );
  }
  return data.result;
}
__name(sendPoll, "sendPoll");
function assertCreds(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    throw new Error("TG_BOT_TOKEN and TG_CHANNEL_ID must be set");
  }
}
__name(assertCreds, "assertCreds");

// src/lib/webpush.js
var ENC = new TextEncoder();
var FALLBACK_PUB = "BB4VbycFeH5MKGIrIuEX7AzzFih61rEdvEN7x3Mvo8Sn4GvwZrXk24nsGyGUy3MiEDKSBFMvZhnbpAwmqUNy-b4";
function b64uEncode(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
__name(b64uEncode, "b64uEncode");
function b64uDecode(str) {
  const pad = "=".repeat((4 - str.length % 4) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
__name(b64uDecode, "b64uDecode");
function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
__name(concat, "concat");
async function importVapidEcdsa(privB64u, pubB64u) {
  const pub = b64uDecode(pubB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("vapid-public-key-bad");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: privB64u
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}
__name(importVapidEcdsa, "importVapidEcdsa");
async function signVapidJwt(privateKey, audience, subject) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1e3) + 12 * 3600,
    // 12h validity
    sub: subject
  };
  const headerB64 = b64uEncode(ENC.encode(JSON.stringify(header)));
  const payloadB64 = b64uEncode(ENC.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    ENC.encode(signingInput)
  );
  return `${signingInput}.${b64uEncode(sig)}`;
}
__name(signVapidJwt, "signVapidJwt");
async function importClientEcdhPub(p256dhB64u) {
  const pub = b64uDecode(p256dhB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("client-pub-bad");
  return crypto.subtle.importKey(
    "raw",
    pub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}
__name(importClientEcdhPub, "importClientEcdhPub");
async function generateEcdhKeypair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
}
__name(generateEcdhKeypair, "generateEcdhKeypair");
async function exportEcdhPub(publicKey) {
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  return new Uint8Array(raw);
}
__name(exportEcdhPub, "exportEcdhPub");
async function deriveSharedSecret(serverPriv, clientPub) {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPub },
    serverPriv,
    256
  );
  return new Uint8Array(bits);
}
__name(deriveSharedSecret, "deriveSharedSecret");
async function hkdf(salt, ikm, info, lengthBytes) {
  const base = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "HKDF" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    base,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}
__name(hkdf, "hkdf");
async function encryptAes128gcm(payload, clientP256dhB64u, clientAuthB64u) {
  const clientPub = await importClientEcdhPub(clientP256dhB64u);
  const auth = b64uDecode(clientAuthB64u);
  const server = await generateEcdhKeypair();
  const serverPubRaw = await exportEcdhPub(server.publicKey);
  const sharedSecret = await deriveSharedSecret(server.privateKey, clientPub);
  const clientPubRaw = b64uDecode(clientP256dhB64u);
  const keyInfo = concat(
    ENC.encode("WebPush: info\0"),
    clientPubRaw,
    serverPubRaw
  );
  const prkKey = await hkdf(auth, sharedSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prkKey, ENC.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prkKey, ENC.encode("Content-Encoding: nonce\0"), 12);
  const plaintext = concat(
    payload instanceof Uint8Array ? payload : ENC.encode(payload),
    new Uint8Array([2])
  );
  const cekKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cekKey,
    plaintext
  ));
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + serverPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = serverPubRaw.length;
  header.set(serverPubRaw, 21);
  return concat(header, ciphertext);
}
__name(encryptAes128gcm, "encryptAes128gcm");
async function sendPush(env, sub, payloadObj) {
  if (!env.VAPID_PRIVATE_KEY) {
    return { status: "error", error: "no-vapid-private-key" };
  }
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { status: "error", error: "invalid-subscription" };
  }
  const pub = env.VAPID_PUBLIC_KEY || FALLBACK_PUB;
  const subject = env.VAPID_SUBJECT || "mailto:admin@scoreocs8.com";
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const vapidKey = await importVapidEcdsa(env.VAPID_PRIVATE_KEY, pub);
    const jwt = await signVapidJwt(vapidKey, audience, subject);
    const body = await encryptAes128gcm(
      ENC.encode(JSON.stringify(payloadObj)),
      sub.keys.p256dh,
      sub.keys.auth
    );
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        // 24h — push services drop messages older than this
        "Authorization": `vapid t=${jwt}, k=${pub}`
      },
      body
    });
    if (res.status === 201 || res.status === 200) {
      return { status: "ok", code: res.status };
    }
    if (res.status === 404 || res.status === 410) {
      return { status: "gone", code: res.status };
    }
    let errText = "";
    try {
      errText = (await res.text()).slice(0, 200);
    } catch {
    }
    return { status: "error", code: res.status, error: errText || `http-${res.status}` };
  } catch (e) {
    return { status: "error", error: String(e?.message || e) };
  }
}
__name(sendPush, "sendPush");
async function broadcastPush(env, payloadObj) {
  const report = { total: 0, sent: 0, removed: 0, errors: 0 };
  if (!env.CACHE) {
    return { ...report, status: "skipped", reason: "no kv" };
  }
  if (!env.VAPID_PRIVATE_KEY) {
    return { ...report, status: "skipped", reason: "no vapid private key" };
  }
  const subs = [];
  let cursor;
  for (; ; ) {
    const page = await env.CACHE.list({ prefix: "push:scoreocs8:", cursor });
    for (const k of page.keys) subs.push(k.name);
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  report.total = subs.length;
  if (!subs.length) return { ...report, status: "ok", reason: "no subscribers" };
  const work = subs.map(async (key) => {
    let sub;
    try {
      sub = JSON.parse(await env.CACHE.get(key) || "null");
    } catch {
      sub = null;
    }
    if (!sub) return { key, result: { status: "error", error: "bad-record" } };
    const result = await sendPush(env, sub, payloadObj);
    if (result.status === "gone") {
      await env.CACHE.delete(key);
    }
    return { key, result };
  });
  const settled = await Promise.allSettled(work);
  for (const s of settled) {
    if (s.status !== "fulfilled") {
      report.errors += 1;
      continue;
    }
    const r = s.value.result;
    if (r.status === "ok") report.sent += 1;
    else if (r.status === "gone") report.removed += 1;
    else report.errors += 1;
  }
  return { ...report, status: "ok" };
}
__name(broadcastPush, "broadcastPush");

// src/lib/caption.js
var LEAGUE_EMOJI = {
  39: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  2: "\u2B50",
  1: "\u{1F3C6}",
  140: "\u{1F1EA}\u{1F1F8}",
  78: "\u{1F1E9}\u{1F1EA}",
  135: "\u{1F1EE}\u{1F1F9}",
  61: "\u{1F1EB}\u{1F1F7}"
};
var LEAGUE_SHORT = {
  39: "EPL",
  2: "UCL",
  1: "WC",
  140: "LaLiga",
  78: "BL",
  135: "Serie A",
  61: "Ligue 1"
};
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(esc, "esc");
function fmtDate(ymd) {
  const d = /* @__PURE__ */ new Date(ymd + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}
__name(fmtDate, "fmtDate");
function buildDailyCaption({
  date,
  picks = [],
  accuracy = null,
  siteUrl = "https://scoreocs8.com",
  affiliates = []
}) {
  const lines = [];
  lines.push(`\u{1F4E2} <b>ScoreOcs8 Today's Predictions</b> | \u4ECA\u65E5\u8DB3\u7403\u7CBE\u9009\u9884\u6D4B`);
  lines.push(`\u{1F4C5} ${esc(fmtDate(date))}`);
  lines.push("");
  if (picks.length) {
    lines.push(`<b>Today's top pro picks</b> | \u4ECA\u65E5\u63A8\u4ECB:`);
    for (const p of picks.slice(0, 3)) {
      const leagueId = p.fx?.league?.id;
      const flag = LEAGUE_EMOJI[leagueId] || "\u26BD";
      const league = LEAGUE_SHORT[leagueId] || (p.fx?.league?.name || "");
      const home = p.fx?.teams?.home?.name || "Home";
      const away = p.fx?.teams?.away?.name || "Away";
      const pickLabel = p.pick?.pickLabel || p.pick?.pick || "Pro analysis pending";
      const conf = p.pick?.confidence != null ? ` (${p.pick.confidence}%)` : "";
      lines.push(`\u{1F449} ${flag} <b>${esc(league)}</b> \xB7 ${esc(home)} vs ${esc(away)} \u2014 <b>${esc(pickLabel)}</b>${conf}`);
    }
    lines.push("");
  }
  if (accuracy && accuracy.total > 0) {
    lines.push(
      `\u{1F4CA} <b>Accuracy this week</b> | \u672C\u5468\u51C6\u786E\u7387: ${accuracy.hits}/${accuracy.total} (${accuracy.pct}%)`
    );
    lines.push("");
  }
  lines.push(`\u{1F517} <b>View all predictions</b> | \u6D4F\u89C8\u66F4\u591A\u63A8\u4ECB:`);
  lines.push(`\u{1F449} ${siteUrl}/`);
  lines.push("");
  lines.push(`\u{1F195} <b>Sign up \xB7 OCS8 Sports</b> | \u7ACB\u5373\u6CE8\u518C:`);
  lines.push(`\u{1F449} https://ocs8my.com/signup?ref=OCSFMZ6HVI`);
  lines.push("");
  if (affiliates.length) {
    lines.push(`\u{1F381} <b>Welcome bonus</b> | \u9886\u53D6\u65B0\u624B\u793C\u91D1:`);
    for (const a of affiliates) {
      lines.push(`\u{1F449} ${a.flag || ""} ${a.url}`);
    }
    lines.push("");
  }
  lines.push(
    `#ScoreOcs8 #footballpredictions #ProPicks #malaysianfootball #\u8DB3\u7403\u9884\u6D4B #\u4ECA\u65E5\u63A8\u4ECB`
  );
  const out = lines.join("\n");
  return out.length > 1020 ? out.slice(0, 1017) + "..." : out;
}
__name(buildDailyCaption, "buildDailyCaption");
function buildDailyCaptionX({
  date,
  picks = [],
  accuracy = null,
  siteUrl = "https://scoreocs8.com"
}) {
  const d = (/* @__PURE__ */ new Date(date + "T12:00:00Z")).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short"
  });
  const lines = [];
  lines.push(`\u{1F4E2} ScoreOcs8 Top Pro Picks \xB7 ${d}`);
  lines.push("");
  for (const p of picks.slice(0, 3)) {
    const leagueId = p.fx?.league?.id;
    const flag = LEAGUE_EMOJI[leagueId] || "\u26BD";
    const short = LEAGUE_SHORT[leagueId] || "";
    const home = p.fx?.teams?.home?.name || "Home";
    const away = p.fx?.teams?.away?.name || "Away";
    const pickLabel = p.pick?.pickLabel || p.pick?.pick || "\u2014";
    const conf = p.pick?.confidence != null ? ` (${p.pick.confidence}%)` : "";
    lines.push(`${flag} ${short} \xB7 ${home} vs ${away} \u2192 ${pickLabel}${conf}`);
  }
  if (accuracy && accuracy.total > 0) {
    lines.push("");
    lines.push(`\u{1F4CA} Weekly: ${accuracy.hits}/${accuracy.total} (${accuracy.pct}%)`);
  }
  lines.push("");
  lines.push(`\u{1F517} ${siteUrl}/`);
  lines.push("#football #ProPicks");
  let out = lines.join("\n");
  const urlCount = (out.match(/https?:\/\/[^\s]+/g) || []).length;
  const effective = out.length + (urlCount > 0 ? 23 - 22 : 0);
  if (effective > 275) {
    const trimmed = out.split("\n").filter((l, i, arr) => {
      if (i === arr.findIndex((x) => x.startsWith("#"))) return false;
      return true;
    }).join("\n");
    out = trimmed.length > 275 ? trimmed.slice(0, 275) : trimmed;
  }
  return out;
}
__name(buildDailyCaptionX, "buildDailyCaptionX");
function buildDailyCaptionThreads(opts) {
  const full = buildDailyCaption(opts);
  return full.length > 495 ? full.slice(0, 492) + "..." : full;
}
__name(buildDailyCaptionThreads, "buildDailyCaptionThreads");
var buildDailyCaptionIG = buildDailyCaption;
function buildPreMatchMotdCaption({
  fixture,
  pick,
  stake = 100,
  siteUrl = "https://scoreocs8.com"
}) {
  const home = fixture?.teams?.home?.name || "Home";
  const away = fixture?.teams?.away?.name || "Away";
  const leagueId = fixture?.league?.id;
  const flag = LEAGUE_EMOJI[leagueId] || "\u26BD";
  const league = LEAGUE_SHORT[leagueId] || fixture?.league?.name || "";
  const conf = pick?.confidence ?? 50;
  const odds = +(1 + (1 - conf / 100) * 2.5).toFixed(2);
  const payout = +(stake * odds).toFixed(2);
  const selection = pick?.pickLabel || pick?.pick || "Pro analysis pending";
  let kickoff = "\u2014";
  try {
    kickoff = new Date(fixture.fixture.date).toLocaleTimeString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
  }
  const lines = [];
  lines.push(`\u{1F3AB} <b>Match of the Day</b> \xB7 \u4ECA\u65E5\u91CD\u70B9\u63A8\u4ECB`);
  lines.push(`${flag} <b>${esc(league)}</b>`);
  lines.push("");
  lines.push(`\u26BD <b>${esc(home)} vs ${esc(away)}</b>`);
  lines.push(`\u23F0 Kickoff: ${esc(kickoff)} MYT`);
  lines.push("");
  lines.push(`\u26A1 <b>Pro Pick</b>: ${esc(selection)} (${conf}%)`);
  lines.push(`\u{1F4B0} Virtual stake \xB7 \u865A\u62DF\u6CE8\u7801: <b>RM${esc(stake)}</b>`);
  lines.push(`\u{1F4B5} Potential payout \xB7 \u6F5C\u5728\u56DE\u62A5: <b>RM${esc(payout.toFixed(2))}</b> @${esc(odds)}`);
  lines.push("");
  lines.push(`\u{1F517} Live tracking: ${siteUrl}/`);
  lines.push("");
  lines.push(`\u26A0 18+`);
  lines.push(`#MatchOfTheDay #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B`);
  return lines.join("\n");
}
__name(buildPreMatchMotdCaption, "buildPreMatchMotdCaption");
function buildMatchUpdateCaption({ fixture, siteUrl = "https://scoreocs8.com" }) {
  const home = fixture?.teams?.home?.name || "Home";
  const away = fixture?.teams?.away?.name || "Away";
  const leagueId = fixture?.league?.id;
  const flag = LEAGUE_EMOJI[leagueId] || "\u26BD";
  const league = LEAGUE_SHORT[leagueId] || fixture?.league?.name || "";
  const venue = fixture?.fixture?.venue?.name || "";
  const city = fixture?.fixture?.venue?.city || "";
  let kickoff = "\u2014";
  try {
    kickoff = new Date(fixture.fixture.date).toLocaleTimeString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
  }
  const lines = [];
  lines.push(`\u23F0 <b>Kicking off soon \xB7 \u5373\u5C06\u5F00\u8D5B</b>`);
  lines.push(`${flag} <b>${esc(league)}</b>`);
  lines.push("");
  lines.push(`\u26BD <b>${esc(home)} vs ${esc(away)}</b>`);
  lines.push(`\u{1F550} Kickoff \xB7 \u5F00\u8D5B: ${esc(kickoff)} MYT`);
  if (venue) lines.push(`\u{1F3DF}\uFE0F ${esc(venue)}${city ? ", " + esc(city) : ""}`);
  lines.push("");
  lines.push(`\u{1F517} Live tracking \xB7 \u5B9E\u65F6\u8FFD\u8E2A: ${siteUrl}/`);
  lines.push("");
  lines.push(`\u{1F195} <b>Sign up \xB7 OCS8 Sports</b> | \u7ACB\u5373\u6CE8\u518C:`);
  lines.push(`\u{1F449} https://ocs8my.com/signup?ref=OCSFMZ6HVI`);
  lines.push("");
  lines.push(`\u26A0 18+`);
  lines.push(`#WorldCup2026 #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B`);
  return lines.join("\n");
}
__name(buildMatchUpdateCaption, "buildMatchUpdateCaption");
function buildResultCaption({ fixture, pickCorrect = null, weekAcc = null, siteUrl = "https://scoreocs8.com" }) {
  const home = fixture?.teams?.home?.name || "Home";
  const away = fixture?.teams?.away?.name || "Away";
  const hs = fixture?.goals?.home ?? "-";
  const as = fixture?.goals?.away ?? "-";
  const leagueId = fixture?.league?.id;
  const flag = LEAGUE_EMOJI[leagueId] || "\u26BD";
  const league = LEAGUE_SHORT[leagueId] || fixture?.league?.name || "";
  const lines = [];
  lines.push(`\u26BD <b>FULL-TIME</b> | \u6BD4\u8D5B\u7ED3\u675F`);
  lines.push(`${flag} <b>${esc(league)}</b>`);
  lines.push("");
  lines.push(`<b>${esc(home)} ${hs} \u2014 ${as} ${esc(away)}</b>`);
  lines.push("");
  if (pickCorrect === true) lines.push(`\u2705 Our pro pick was <b>correct</b> \xB7 \u9884\u6D4B\u6B63\u786E`);
  else if (pickCorrect === false) lines.push(`\u274C Our pro pick missed \xB7 \u9884\u6D4B\u672A\u4E2D`);
  if (weekAcc && weekAcc.total > 0) {
    lines.push(`\u{1F4CA} This week: ${weekAcc.hits}/${weekAcc.total} (${weekAcc.pct}%)`);
  }
  lines.push("");
  lines.push(`\u{1F517} Full analysis | \u5B8C\u6574\u5206\u6790: ${siteUrl}/`);
  lines.push("");
  lines.push(`\u{1F195} <b>Sign up \xB7 OCS8 Sports</b> | \u7ACB\u5373\u6CE8\u518C:`);
  lines.push(`\u{1F449} https://ocs8my.com/signup?ref=OCSFMZ6HVI`);
  lines.push("");
  lines.push(`#ScoreOcs8 #${esc(league).replace(/\s+/g, "")} #\u8DB3\u7403\u9884\u6D4B`);
  return lines.join("\n");
}
__name(buildResultCaption, "buildResultCaption");
function buildWcCardCaption({ date, siteUrl = "https://scoreocs8.com" }) {
  const lines = [];
  lines.push(`\u{1F3C6} <b>Today at the World Cup \xB7 \u4ECA\u65E5\u4E16\u754C\u676F</b>`);
  if (date) lines.push(`\u{1F4C5} ${esc(fmtDate(date))}`);
  lines.push("");
  lines.push(`Every match today \u2014 scores &amp; kickoffs in Malaysia Time \u{1F1F2}\u{1F1FE}`);
  lines.push(`\u4ECA\u65E5\u5168\u90E8\u8D5B\u4E8B\uFF0C\u6BD4\u5206\u4E0E\u5F00\u8D5B\u65F6\u95F4\uFF08\u9A6C\u6765\u897F\u4E9A\u65F6\u95F4\uFF09\u3002`);
  lines.push("");
  lines.push(`\u{1F517} <b>Full schedule &amp; standings</b> | \u5B8C\u6574\u8D5B\u7A0B\u4E0E\u79EF\u5206\u699C:`);
  lines.push(`\u{1F449} ${siteUrl}/predictions/fifa-world-cup/`);
  lines.push("");
  lines.push(`\u{1F195} <b>Sign up \xB7 OCS8 Sports</b> | \u7ACB\u5373\u6CE8\u518C:`);
  lines.push(`\u{1F449} https://ocs8my.com/signup?ref=OCSFMZ6HVI`);
  lines.push("");
  lines.push(`#WorldCup2026 #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B`);
  const out = lines.join("\n");
  return out.length > 1020 ? out.slice(0, 1017) + "..." : out;
}
__name(buildWcCardCaption, "buildWcCardCaption");
function buildWcUpcomingCaption({ siteUrl = "https://scoreocs8.com" }) {
  const lines = [];
  lines.push(`\u{1F4C5} <b>Upcoming Matches \xB7 \u5373\u5C06\u5F00\u8D5B</b>`);
  lines.push(`\u{1F3C6} 2026 FIFA World Cup`);
  lines.push("");
  lines.push(`Next up \u2014 all kickoff times in Malaysia Time \u{1F1F2}\u{1F1FE} (MYT).`);
  lines.push(`\u4E0B\u4E00\u8F6E\u8D5B\u4E8B\uFF0C\u5168\u90E8\u4E3A\u9A6C\u6765\u897F\u4E9A\u65F6\u95F4\u3002`);
  lines.push("");
  lines.push(`\u{1F517} <b>Full schedule &amp; standings</b> | \u5B8C\u6574\u8D5B\u7A0B\u4E0E\u79EF\u5206\u699C:`);
  lines.push(`\u{1F449} ${siteUrl}/predictions/fifa-world-cup/`);
  lines.push("");
  lines.push(`\u{1F195} <b>Sign up \xB7 OCS8 Sports</b> | \u7ACB\u5373\u6CE8\u518C:`);
  lines.push(`\u{1F449} https://ocs8my.com/signup?ref=OCSFMZ6HVI`);
  lines.push("");
  lines.push(`#WorldCup2026 #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B`);
  const out = lines.join("\n");
  return out.length > 1020 ? out.slice(0, 1017) + "..." : out;
}
__name(buildWcUpcomingCaption, "buildWcUpcomingCaption");

// src/lib/snap.js
var SITE_URL = "https://scoreocs8.com";
function randId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(randId, "randId");
async function saveSnap(env, pngBytes, ttlSeconds = 24 * 3600) {
  const id = randId();
  await env.CACHE.put(`snap:${id}`, pngBytes, { expirationTtl: ttlSeconds });
  return {
    id,
    url: `${SITE_URL}/snap?id=${id}`
  };
}
__name(saveSnap, "saveSnap");

// src/lib/x.js
var MEDIA_UPLOAD = "https://upload.twitter.com/1.1/media/upload.json";
var TWEETS_V2 = "https://api.twitter.com/2/tweets";
function pctEncode(s) {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
__name(pctEncode, "pctEncode");
async function hmacSha1Base64(keyStr, msgStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(keyStr),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msgStr));
  let bin = "";
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(hmacSha1Base64, "hmacSha1Base64");
async function buildAuthHeader(env, method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1e3).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0"
  };
  const u = new URL(url);
  const queryParams = {};
  for (const [k, v] of u.searchParams.entries()) queryParams[k] = v;
  const allParams = { ...oauthParams, ...queryParams, ...extraParams };
  const paramStr = Object.keys(allParams).sort().map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`).join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const sigBase = `${method.toUpperCase()}&${pctEncode(baseUrl)}&${pctEncode(paramStr)}`;
  const sigKey = `${pctEncode(env.X_API_KEY_SECRET)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1Base64(sigKey, sigBase);
  const authParams = { ...oauthParams, oauth_signature: signature };
  return "OAuth " + Object.keys(authParams).sort().map((k) => `${pctEncode(k)}="${pctEncode(authParams[k])}"`).join(", ");
}
__name(buildAuthHeader, "buildAuthHeader");
async function uploadMedia(env, pngBytes) {
  const auth = await buildAuthHeader(env, "POST", MEDIA_UPLOAD, {});
  const form = new FormData();
  form.append("media", new Blob([pngBytes], { type: "image/png" }), "snap.png");
  const res = await fetch(MEDIA_UPLOAD, {
    method: "POST",
    headers: { Authorization: auth },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.media_id_string) {
    throw new Error(`X media upload ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.media_id_string;
}
__name(uploadMedia, "uploadMedia");
async function createTweet(env, { text, mediaId }) {
  const auth = await buildAuthHeader(env, "POST", TWEETS_V2, {});
  const body = { text };
  if (mediaId) body.media = { media_ids: [mediaId] };
  const res = await fetch(TWEETS_V2, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X create tweet ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.data;
}
__name(createTweet, "createTweet");
function assertCreds2(env) {
  const need = ["X_API_KEY", "X_API_KEY_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) throw new Error(`X secrets missing: ${missing.join(", ")}`);
}
__name(assertCreds2, "assertCreds");
async function postPhoto(env, { photoBytes, text }) {
  assertCreds2(env);
  const mediaId = await uploadMedia(env, photoBytes);
  const tweet = await createTweet(env, { text, mediaId });
  return { tweetId: tweet.id, text: tweet.text, mediaId };
}
__name(postPhoto, "postPhoto");

// src/lib/instagram.js
var GRAPH = "https://graph.facebook.com/v21.0";
async function createContainer(env, { imageUrl, caption }) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    caption: caption || "",
    access_token: env.IG_ACCESS_TOKEN
  });
  const res = await fetch(`${GRAPH}/${env.IG_USER_ID}/media?${params}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`IG create container ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}
__name(createContainer, "createContainer");
async function publishContainer(env, creationId) {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: env.IG_ACCESS_TOKEN
  });
  const res = await fetch(`${GRAPH}/${env.IG_USER_ID}/media_publish?${params}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`IG publish ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}
__name(publishContainer, "publishContainer");
function assertCreds3(env) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) {
    throw new Error("IG_USER_ID and IG_ACCESS_TOKEN must be set");
  }
}
__name(assertCreds3, "assertCreds");
async function postPhoto2(env, { imageUrl, caption }) {
  assertCreds3(env);
  const creationId = await createContainer(env, { imageUrl, caption });
  try {
    const mediaId = await publishContainer(env, creationId);
    return { mediaId, creationId };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 3e3));
    const mediaId = await publishContainer(env, creationId);
    return { mediaId, creationId, retried: true };
  }
}
__name(postPhoto2, "postPhoto");

// src/lib/threads.js
var THREADS = "https://graph.threads.net/v1.0";
async function createContainer2(env, { imageUrl, text }) {
  const params = new URLSearchParams({
    media_type: "IMAGE",
    image_url: imageUrl,
    text: text || "",
    access_token: env.THREADS_ACCESS_TOKEN
  });
  const res = await fetch(`${THREADS}/${env.THREADS_USER_ID}/threads?${params}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads create container ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}
__name(createContainer2, "createContainer");
async function publishContainer2(env, creationId) {
  const params = new URLSearchParams({
    creation_id: creationId,
    access_token: env.THREADS_ACCESS_TOKEN
  });
  const res = await fetch(`${THREADS}/${env.THREADS_USER_ID}/threads_publish?${params}`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`Threads publish ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.id;
}
__name(publishContainer2, "publishContainer");
function assertCreds4(env) {
  if (!env.THREADS_USER_ID || !env.THREADS_ACCESS_TOKEN) {
    throw new Error("THREADS_USER_ID and THREADS_ACCESS_TOKEN must be set");
  }
}
__name(assertCreds4, "assertCreds");
async function postPhoto3(env, { imageUrl, text }) {
  assertCreds4(env);
  const creationId = await createContainer2(env, { imageUrl, text });
  try {
    const threadId = await publishContainer2(env, creationId);
    return { threadId, creationId };
  } catch (e) {
    await new Promise((r) => setTimeout(r, 3e3));
    const threadId = await publishContainer2(env, creationId);
    return { threadId, creationId, retried: true };
  }
}
__name(postPhoto3, "postPhoto");

// src/index.js
var API_FOOTBALL_BASE = "https://v3.football.api-sports.io";
var ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
var YOUTUBE_SEARCH_API = "https://www.googleapis.com/youtube/v3/search";
var YOUTUBE_CHANNELS_API = "https://www.googleapis.com/youtube/v3/channels";
var DEFAULT_YOUTUBE_CHANNELS = "@stadiumastro,@beINSPORTSAsia";
var CLAUDE_MODEL = "claude-haiku-4-5-20251001";
var MAX_TOKENS_PER_REQ = 2e3;
var DAILY_TOKEN_BUDGET = 8e3;
var SITE_URL2 = "https://scoreocs8.com";
var PUBLIC_SITE_URL = "https://scoreocs8.com";
var LEAGUE_PRIORITY = [
  { key: "UCL", id: 2 },
  { key: "EPL", id: 39 },
  { key: "WC", id: 1 }
];
function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}
__name(slugify, "slugify");
function slipPath(fixtureId, home, away) {
  const slug = slugify(`${home}-vs-${away}`);
  return slug ? `/slip/${fixtureId}-${slug}/` : `/slip/${fixtureId}/`;
}
__name(slipPath, "slipPath");
var DEFAULT_SEASON = "2025";
var LEAGUE_SEASONS = { 1: "2026" };
var seasonFor = /* @__PURE__ */ __name((id) => LEAGUE_SEASONS[String(id)] || DEFAULT_SEASON, "seasonFor");
function today() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
__name(today, "today");
async function afGet(env, path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_FOOTBALL_BASE}${path}?${qs}`, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY }
  });
  if (!res.ok) throw new Error(`API-Football ${path} ${res.status}`);
  return res.json();
}
__name(afGet, "afGet");
async function claudeCall(env, prompt) {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS_PER_REQ,
      system: "You are a ScoreOcs8 AI football writer. Respond ONLY with a single valid JSON object. No prose, no markdown code fences, no commentary before or after. Every requested field must be present.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const u = data.usage || {};
  return { text, tokens: (u.input_tokens || 0) + (u.output_tokens || 0), stopReason: data.stop_reason };
}
__name(claudeCall, "claudeCall");
async function readBudget(env) {
  const used = parseInt(await env.CACHE.get(`usage:tokens:${today()}`) || "0", 10);
  return { used, remaining: DAILY_TOKEN_BUDGET - used };
}
__name(readBudget, "readBudget");
async function spendBudget(env, amount) {
  const key = `usage:tokens:${today()}`;
  const used = parseInt(await env.CACHE.get(key) || "0", 10);
  await env.CACHE.put(key, String(used + amount), { expirationTtl: 2 * 24 * 3600 });
}
__name(spendBudget, "spendBudget");
async function pickTopFixtures(env) {
  const all = [];
  for (let i = 0; i < LEAGUE_PRIORITY.length; i++) {
    const lg = LEAGUE_PRIORITY[i];
    try {
      const data = await afGet(env, "/fixtures", { league: lg.id, season: seasonFor(lg.id), next: 5 });
      for (const fx of data.response || []) {
        all.push({ ...fx, _priority: i, _leagueKey: lg.key });
      }
    } catch (_) {
    }
  }
  all.sort((a, b) => a._priority - b._priority || new Date(a.fixture.date) - new Date(b.fixture.date));
  return all.slice(0, 3);
}
__name(pickTopFixtures, "pickTopFixtures");
function longPrompt(fx) {
  return `Write an SEO-optimised football match preview as JSON only (no prose outside the JSON).

Match: ${fx.teams.home.name} vs ${fx.teams.away.name}
League: ${fx.league.name}
Kickoff: ${fx.fixture.date}
Venue: ${fx.fixture.venue?.name || "TBD"}

Shape (ALL fields required, double quotes, valid JSON):
{
  "title_en": "SEO headline, 50-70 chars, primary keyword at start, compelling, sentence-case",
  "title_bm": "Localised Bahasa Malaysia headline (for BM readers on listing pages)",
  "title_zh": "\u4E2D\u6587\u672C\u5730\u5316\u6807\u9898 (for Chinese-Malaysian readers on listing pages)",
  "meta_description": "140-155 chars, natural English, includes match + league + key angle, action verb",
  "body_en": "500-600 words in markdown. Use H2/H3 subheadings, short paragraphs, scannable structure. Sections: intro with hook, recent form both teams, key player matchups, tactical analysis, injury/lineup notes, clear prediction with reasoning and confidence %. Include relevant keywords naturally."
}`;
}
__name(longPrompt, "longPrompt");
function shortPrompt(fx) {
  return `Write a short SEO-optimised football match preview as JSON only.

Match: ${fx.teams.home.name} vs ${fx.teams.away.name}
League: ${fx.league.name}
Kickoff: ${fx.fixture.date}

Shape (ALL fields required, valid JSON):
{
  "title_en": "SEO headline, 50-70 chars, keyword-forward",
  "title_bm": "Bahasa Malaysia headline",
  "title_zh": "\u4E2D\u6587\u6807\u9898",
  "meta_description": "140-155 chars, compelling English snippet",
  "body_en": "300-400 words in markdown. One or two H2 subheadings, form snapshot, key angle, prediction with reasoning."
}`;
}
__name(shortPrompt, "shortPrompt");
function parseJsonLoose(text, context = {}) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    const preview = (text || "").slice(0, 300).replace(/\n/g, " ");
    throw new Error(`no JSON in response (stop=${context.stopReason || "?"}, preview="${preview}")`);
  }
  try {
    return JSON.parse(m[0]);
  } catch (err) {
    const preview = m[0].slice(0, 200).replace(/\n/g, " ");
    throw new Error(`invalid JSON (${err.message}, preview="${preview}")`);
  }
}
__name(parseJsonLoose, "parseJsonLoose");
async function generateDaily(env) {
  const date = today();
  const wcQueue = await queueWorldCupFixtures(env).catch((e) => ({ status: "error", error: String(e.message || e) }));
  const existing = await env.CACHE.get(`content:${date}`);
  if (existing) return { status: "skipped", reason: "already generated", date, wcQueue };
  const fixtures = await pickTopFixtures(env);
  if (!fixtures.length) return { status: "skipped", reason: "no upcoming fixtures", date };
  const estimate = 4e3;
  const { remaining } = await readBudget(env);
  if (remaining < estimate) {
    return { status: "skipped", reason: `budget exhausted: ${remaining} tokens left`, date };
  }
  const output = { date, generatedAt: Date.now(), top: null, previews: [], tokensUsed: 0 };
  try {
    const topCall = await claudeCall(env, longPrompt(fixtures[0]));
    output.top = { fixture: fixtures[0], content: parseJsonLoose(topCall.text, { stopReason: topCall.stopReason }) };
    output.tokensUsed += topCall.tokens;
    await spendBudget(env, topCall.tokens);
  } catch (e) {
    return { status: "error", stage: "top", detail: String(e.message || e), date };
  }
  for (const fx of fixtures.slice(1, 3)) {
    try {
      const { remaining: rem } = await readBudget(env);
      if (rem < 1e3) break;
      const call = await claudeCall(env, shortPrompt(fx));
      output.previews.push({ fixture: fx, content: parseJsonLoose(call.text, { stopReason: call.stopReason }) });
      output.tokensUsed += call.tokens;
      await spendBudget(env, call.tokens);
    } catch (_) {
    }
  }
  await env.CACHE.put(`content:${date}`, JSON.stringify(output), { expirationTtl: 48 * 3600 });
  const warmerReport = await warmPredictions(output).catch((e) => ({ error: String(e.message || e) }));
  const queueReport = await queueFtChecks(env, output, date).catch((e) => ({ error: String(e.message || e) }));
  const indexNowResult = await pingIndexNow(output, date).catch((e) => ({ error: String(e.message || e) }));
  return {
    status: "ok",
    date,
    tokensUsed: output.tokensUsed,
    items: 1 + output.previews.length,
    warmed: warmerReport,
    ftQueue: queueReport,
    wcQueue,
    indexnow: indexNowResult
  };
}
__name(generateDaily, "generateDaily");
var SITE_HOST = "scoreocs8.com";
var INDEXNOW_KEY = "8c4e6d9f2b7a1e3f5c8d0a9b2e4f7c1d";
async function pingIndexNow(bundle, date) {
  const urls = [];
  if (bundle.top) urls.push(`https://${SITE_HOST}/blog/daily-${date}-top/`);
  for (let i = 0; i < (bundle.previews || []).length; i++) {
    urls.push(`https://${SITE_HOST}/blog/daily-${date}-p${i + 1}/`);
  }
  urls.push(`https://${SITE_HOST}/blog/`, `https://${SITE_HOST}/sitemap.xml`);
  if (!urls.length) return { submitted: 0 };
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: SITE_HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${SITE_HOST}/${INDEXNOW_KEY}.txt`,
      urlList: urls
    })
  });
  return { submitted: urls.length, status: res.status };
}
__name(pingIndexNow, "pingIndexNow");
async function warmPredictions(output) {
  const ids = [];
  if (output.top?.fixture?.fixture?.id) ids.push(output.top.fixture.fixture.id);
  if (Array.isArray(output.previews)) {
    for (const p of output.previews) {
      if (p.fixture?.fixture?.id) ids.push(p.fixture.fixture.id);
    }
  }
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`${SITE_URL2}/api/predictions?fixture_id=${id}`);
        return { id, ok: res.ok, status: res.status };
      } catch (e) {
        return { id, ok: false, error: String(e.message || e) };
      }
    })
  );
  return { count: results.length, results };
}
__name(warmPredictions, "warmPredictions");
async function queueFtChecks(env, output, date) {
  const fixtures = [];
  if (output.top?.fixture) fixtures.push(output.top.fixture);
  if (Array.isArray(output.previews)) {
    for (const p of output.previews) if (p.fixture) fixtures.push(p.fixture);
  }
  const byDate = {};
  fixtures.forEach((fx, i) => {
    const kickoffMs = new Date(fx.fixture.date).getTime();
    let kickoffDate = date;
    try {
      kickoffDate = new Date(fx.fixture.date).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    } catch {
    }
    (byDate[kickoffDate] = byDate[kickoffDate] || []).push({
      fixture_id: fx.fixture.id,
      home: fx.teams?.home?.name,
      away: fx.teams?.away?.name,
      league_id: fx.league?.id,
      kickoff_iso: fx.fixture.date,
      check_at_ms: kickoffMs + 100 * 60 * 1e3,
      // FT typically ~100 min after KO
      attempts: 0,
      posted: false,
      is_motd: i === 0
    });
  });
  let count = 0;
  for (const [kd, entries] of Object.entries(byDate)) {
    const existing = await env.CACHE.get(`ft-queue:${kd}`, "json").catch(() => null) || [];
    const seen = new Set(existing.map((e) => e.fixture_id));
    const fresh = entries.filter((e) => !seen.has(e.fixture_id));
    if (!fresh.length) continue;
    await env.CACHE.put(`ft-queue:${kd}`, JSON.stringify(existing.concat(fresh)), { expirationTtl: 72 * 3600 });
    count += fresh.length;
  }
  return { count };
}
__name(queueFtChecks, "queueFtChecks");
var WC_LEAGUE_ID = 1;
async function queueWorldCupFixtures(env, daysAhead = 2) {
  let data;
  try {
    data = await afGet(env, "/fixtures", { league: WC_LEAGUE_ID, season: seasonFor(WC_LEAGUE_ID), next: 30 });
  } catch (e) {
    return { status: "error", error: String(e.message || e) };
  }
  const fixtures = data.response || [];
  const now = Date.now();
  const horizon = now + daysAhead * 864e5;
  const byDate = {};
  for (const fx of fixtures) {
    const kickoffMs = new Date(fx.fixture?.date).getTime();
    if (!Number.isFinite(kickoffMs) || kickoffMs > horizon) continue;
    let kd = todayMYT();
    try {
      kd = new Date(fx.fixture.date).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    } catch {
    }
    (byDate[kd] = byDate[kd] || []).push({
      fixture_id: fx.fixture.id,
      home: fx.teams?.home?.name,
      away: fx.teams?.away?.name,
      league_id: fx.league?.id,
      kickoff_iso: fx.fixture.date,
      check_at_ms: kickoffMs + 100 * 60 * 1e3,
      attempts: 0,
      posted: false,
      is_motd: false,
      is_wc: true
    });
  }
  let added = 0, tagged = 0;
  for (const [kd, entries] of Object.entries(byDate)) {
    const existing = await env.CACHE.get(`ft-queue:${kd}`, "json").catch(() => null) || [];
    const byId = new Map(existing.map((e) => [e.fixture_id, e]));
    for (const e of entries) {
      const cur = byId.get(e.fixture_id);
      if (cur) {
        if (!cur.is_wc) {
          cur.is_wc = true;
          tagged += 1;
        }
      } else {
        existing.push(e);
        byId.set(e.fixture_id, e);
        added += 1;
      }
    }
    await env.CACHE.put(`ft-queue:${kd}`, JSON.stringify(existing), { expirationTtl: 72 * 3600 });
  }
  return { status: "ok", added, tagged, dates: Object.keys(byDate) };
}
__name(queueWorldCupFixtures, "queueWorldCupFixtures");
async function loadFeaturedWithPicks(env) {
  const mytDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const utcDate = today();
  const keys = [`content:${mytDate}`, `content:${utcDate}`];
  let content = null;
  let usedKey = null;
  for (const k of keys) {
    content = await env.CACHE.get(k, "json");
    if (content) {
      usedKey = k;
      break;
    }
  }
  if (!content) return { date: mytDate, picks: [], sourceKey: null };
  const fixtures = [];
  if (content.top?.fixture) fixtures.push(content.top.fixture);
  if (Array.isArray(content.previews)) {
    for (const p of content.previews) if (p.fixture) fixtures.push(p.fixture);
  }
  const picks = await Promise.all(
    fixtures.slice(0, 3).map(async (fx) => ({
      fx,
      pick: await env.CACHE.get(`prediction:${fx.fixture?.id}`, "json").catch(() => null)
    }))
  );
  return { date: mytDate, picks, sourceKey: usedKey };
}
__name(loadFeaturedWithPicks, "loadFeaturedWithPicks");
async function loadWeeklyAccuracy(env) {
  try {
    const raw = await env.CACHE.get("accuracy:week:current");
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.total) return null;
    return {
      hits: data.hits,
      total: data.total,
      pct: Math.round(data.hits / data.total * 100)
    };
  } catch {
    return null;
  }
}
__name(loadWeeklyAccuracy, "loadWeeklyAccuracy");
async function postDailyToAll(env) {
  const started = Date.now();
  const report = { stage: "init", startedAt: started, platforms: {} };
  try {
    report.stage = "load-featured";
    const { date, picks, sourceKey } = await loadFeaturedWithPicks(env);
    report.date = date;
    report.sourceKey = sourceKey;
    report.pickCount = picks.length;
    if (!picks.length) {
      report.status = "skipped";
      report.reason = "no featured picks in KV yet";
      return report;
    }
    const accuracy = await loadWeeklyAccuracy(env);
    report.accuracy = accuracy;
    report.stage = "screenshot";
    const pngBytes = await screenshot(env, {
      url: `${SITE_URL2}/daily/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1920 },
      waitUntil: "networkidle0",
      timeoutMs: 3e4
    });
    report.screenshotBytes = pngBytes.byteLength;
    report.stage = "snap";
    const snap = await saveSnap(env, pngBytes);
    report.snapUrl = snap.url;
    const affiliates = [];
    if (env.AFFILIATE_URL_MY) affiliates.push({ flag: "\u{1F1F2}\u{1F1FE}", url: env.AFFILIATE_URL_MY });
    if (env.AFFILIATE_URL_SG) affiliates.push({ flag: "\u{1F1F8}\u{1F1EC}", url: env.AFFILIATE_URL_SG });
    const captions = {
      telegram: buildDailyCaption({ date, picks, accuracy, siteUrl: SITE_URL2, affiliates }),
      x: buildDailyCaptionX({ date, picks, accuracy, siteUrl: SITE_URL2 }),
      ig: buildDailyCaptionIG({ date, picks, accuracy, siteUrl: SITE_URL2, affiliates }),
      threads: buildDailyCaptionThreads({ date, picks, accuracy, siteUrl: SITE_URL2, affiliates })
    };
    report.stage = "fanout";
    const results = await Promise.allSettled([
      Promise.resolve({ status: "skipped", reason: "telegram daily handled by 09:00 sportsbook batch" }),
      postToX(env, pngBytes, captions.x, date),
      postToIG(env, snap.url, captions.ig, date),
      postToThreads(env, snap.url, captions.threads, date)
    ]);
    report.platforms.telegram = unwrap(results[0]);
    report.platforms.x = unwrap(results[1]);
    report.platforms.instagram = unwrap(results[2]);
    report.platforms.threads = unwrap(results[3]);
    report.motd = { status: "skipped", reason: "motd-prematch single-pick post removed" };
    report.stage = "done";
    report.status = "ok";
    report.durationMs = Date.now() - started;
    return report;
  } catch (err) {
    report.status = "error";
    report.error = String(err.message || err);
    report.durationMs = Date.now() - started;
    return report;
  }
}
__name(postDailyToAll, "postDailyToAll");
function unwrap(settled) {
  if (settled.status === "fulfilled") return settled.value;
  return { status: "error", error: String(settled.reason?.message || settled.reason) };
}
__name(unwrap, "unwrap");
function escHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escHtml, "escHtml");
function fmtMYT(iso) {
  try {
    return new Date(iso).toLocaleString("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return "MYT";
  }
}
__name(fmtMYT, "fmtMYT");
async function sendTemplateMessage(env, { text, buttonText, buttonUrl, imageUrl, imageBytes }) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "TG_BOT_TOKEN/TG_CHANNEL_ID not configured" };
  }
  const useUrlImage = imageUrl && /^https?:\/\//i.test(imageUrl);
  const useBytesImage = imageBytes && imageBytes.byteLength > 0;
  const replyMarkup = buttonText && buttonUrl ? { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] } : void 0;
  const captionMax = 1024;
  const captionText = (useUrlImage || useBytesImage) && text.length > captionMax ? text.slice(0, captionMax - 3) + "..." : text;
  if (useBytesImage) {
    const form = new FormData();
    form.append("chat_id", env.TG_CHANNEL_ID);
    form.append("parse_mode", "HTML");
    if (captionText) form.append("caption", captionText);
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append("photo", new Blob([imageBytes], { type: "image/png" }), "snap.png");
    const res2 = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form
    });
    const data2 = await res2.json().catch(() => ({}));
    if (data2.ok) return { status: "ok", messageId: data2.result?.message_id };
    var bytesFailReason = data2.description || `Telegram ${res2.status}`;
  }
  if (useUrlImage) {
    const body2 = {
      chat_id: env.TG_CHANNEL_ID,
      photo: imageUrl,
      caption: captionText,
      parse_mode: "HTML"
    };
    if (replyMarkup) body2.reply_markup = replyMarkup;
    const res2 = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body2)
    });
    const data2 = await res2.json().catch(() => ({}));
    if (data2.ok) return { status: "ok", messageId: data2.result?.message_id };
    var urlFailReason = data2.description || `Telegram ${res2.status}`;
  }
  const body = {
    chat_id: env.TG_CHANNEL_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) return { status: "error", error: data.description || `Telegram ${res.status}` };
  const fallback = typeof bytesFailReason !== "undefined" || typeof urlFailReason !== "undefined" ? `photo\u2192text: ${bytesFailReason || urlFailReason}` : void 0;
  return { status: "ok", messageId: data.result?.message_id, ...fallback ? { fallback } : {} };
}
__name(sendTemplateMessage, "sendTemplateMessage");
function absolutizeImageUrl(raw, baseUrl) {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return "https:" + raw;
  if (raw.startsWith("/")) return PUBLIC_SITE_URL + raw;
  return baseUrl.replace(/\/[^\/]*$/, "/") + raw;
}
__name(absolutizeImageUrl, "absolutizeImageUrl");
async function fetchWebsitePage(path = "/") {
  const url = `${PUBLIC_SITE_URL}${path}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "ScoreOCS8-Cron/1.0" } });
    const html = await res.text();
    const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "ScoreOCS8";
    const description = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || "";
    const rawImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] || "";
    return {
      url,
      title: title.replace(/&amp;/g, "&").trim(),
      description: description.replace(/&amp;/g, "&").trim(),
      ogImage: absolutizeImageUrl(rawImage, url)
    };
  } catch {
    return { url, title: "ScoreOCS8", description: "Latest football predictions, highlights, proof, and blog updates are live.", ogImage: "" };
  }
}
__name(fetchWebsitePage, "fetchWebsitePage");
function firstPickLine(item) {
  const fx = item?.fx;
  if (!fx) return "Latest AI pick is ready on ScoreOCS8.";
  const home = fx.teams?.home?.name || "Home";
  const away = fx.teams?.away?.name || "Away";
  const league = fx.league?.name || "Football";
  const pick = item.pick?.pickLabel || item.pick?.pick || "Pro analysis pending";
  const conf = item.pick?.confidence != null ? ` (${item.pick.confidence}%)` : "";
  return `${league} \xB7 ${home} vs ${away}
Kickoff: ${fmtMYT(fx.fixture?.date)} MYT
Pick: ${pick}${conf}`;
}
__name(firstPickLine, "firstPickLine");
var SPORTSBOOK_TEMPLATE_KEYS = ["prediction", "upcoming", "reminder", "result", "blog"];
var SIGNUP_URL = "https://ocs8my.com/signup?ref=OCSFMZ6HVI";
var SIGNUP_CTA = `\u{1F195} Sign up \xB7 OCS8 Sports \xB7 \u7ACB\u5373\u6CE8\u518C:
\u{1F517} ${SIGNUP_URL}`;
var SPORTSBOOK_DEFAULTS = {
  prediction: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u26BD\u{1F525} <b>AI Match Prediction \xB7 AI \u667A\u80FD\u9884\u6D4B</b> \u{1F525}\u26BD
\u2B50 {firstPickLeague}

\u{1F3DF}\uFE0F {firstPickName}
\u{1F550} Kickoff \xB7 \u5F00\u8D5B: {firstPickKickoff}

\u26A1 Pro Pick \xB7 \u667A\u80FD\u63A8\u8350: <b>{firstPickLabel}</b> \u{1F3AF} ({firstPickConfidence})

\u{1F4CA} Full breakdown \xB7 \u5B8C\u6574\u5206\u6790:
\u{1F517} {websiteUrl}

{signupCta}

\u26A0\uFE0F 18+ \xB7 AI analysis
#AIPrediction #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD`
  },
  upcoming: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u{1F4C5}\u26A1 <b>Upcoming Matches \xB7 \u8FD1\u671F\u8D5B\u4E8B\u9884\u544A</b> \u26A1\u{1F4C5}

{upcomingList}

\u{1F550} All times in Malaysia Time \u{1F1F2}\u{1F1FE} (MYT) \xB7 \u9A6C\u6765\u897F\u4E9A\u65F6\u95F4
\u{1F4CA} Full list \xB7 \u5B8C\u6574\u8D5B\u7A0B:
\u{1F517} {websiteUrl}

{signupCta}

#UpcomingMatches #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD`
  },
  reminder: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u23F0\u{1F6A8} <b>1 Hour Reminder \xB7 \u5F00\u8D5B\u524D\u4E00\u5C0F\u65F6</b> \u{1F6A8}\u23F0
\u2B50 {firstPickLeague}

\u{1F3DF}\uFE0F {firstPickName}
\u{1F550} Kickoff \xB7 \u5F00\u8D5B: {firstPickKickoff}

\u26A1 Pro Pick \xB7 \u667A\u80FD\u63A8\u8350: <b>{firstPickLabel}</b> \u{1F3AF} ({firstPickConfidence})

\u{1F4B9} Odds + AI pick \xB7 \u8D54\u7387\u5206\u6790:
\u{1F517} {websiteUrl}

{signupCta}

\u26A0\uFE0F 18+ \xB7 Bet responsibly \xB7 \u7406\u6027\u6295\u6CE8
#PreKickoff #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD`
  },
  result: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u{1F3C6}\u{1F389} <b>Full Time \xB7 \u5168\u573A\u6BD4\u8D5B\u7ED3\u675F</b> \u{1F389}\u{1F3C6}
\u2B50 {resultLeague}

\u26BD {resultScore} \u26BD

\u{1F3AC} Highlights \xB7 \u6BD4\u8D5B\u96C6\u9526:
\u{1F517} {youtubeUrl}

\u{1F4CA} Full result \xB7 \u6BD4\u8D5B\u8BE6\u60C5:
\u{1F517} {websiteUrl}

{signupCta}

#FullTime #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD\u{1F3C6}`
  },
  proof: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u{1F4AC}\u{1F525} <b>What Our Users Say \xB7 \u7528\u6237\u53E3\u7891</b> \u{1F525}\u{1F4AC}

{proofTestimonials}

\u{1F4CA} Tracked weekly \xB7 \u6BCF\u5468\u8FFD\u8E2A
\u{1F3C6} Major leagues only \xB7 \u4EC5\u8986\u76D6\u4E3B\u8981\u8054\u8D5B
\u2705 Public results \xB7 \u516C\u5F00\u6218\u7EE9

\u{1F4F2} See more on ScoreOcs8:
\u{1F517} {websiteUrl}

{signupCta}

#Testimonials #CustomerProof #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD`
  },
  blog: {
    button: "\u{1F195} Sign Up \xB7 OCS8 Sports",
    url: SIGNUP_URL,
    text: `\u{1F4F0}\u270D\uFE0F <b>ScoreOcs8 Blog \xB7 \u6700\u65B0\u535A\u5BA2</b> \u270D\uFE0F\u{1F4F0}

Latest match analysis and football insights:
\u6700\u65B0\u6BD4\u8D5B\u5206\u6790\u4E0E\u8DB3\u7403\u89C1\u89E3\uFF1A

{latestPostTitles}

\u{1F4D6} Read more \xB7 \u9605\u8BFB\u5168\u6587:
\u{1F517} {websiteUrl}

{signupCta}

#Blog #FootballAnalysis #ScoreOcs8 #\u8DB3\u7403\u9884\u6D4B \u26BD`
  }
};
var SPORTSBOOK_PAGE_BY_KEY = {
  prediction: "/predictions/",
  upcoming: "/predictions/",
  reminder: "/predictions/",
  result: "/",
  proof: "/",
  blog: "/blog/"
};
function isPickReady(pick) {
  const label = String(pick?.pickLabel || pick?.pick || "").trim();
  if (!label) return false;
  return !/^(pending|pro\s+analysis\s+pending|analysing|coming\s+soon)$/i.test(label);
}
__name(isPickReady, "isPickReady");
function defaultImageStrategy(key, topFx, topPick, hasHighlight, batchToken) {
  if (key === "prediction" && topFx?.fixture?.id) {
    const realTag = isPickReady(topPick) ? topPick.pickLabel || topPick.pick : "";
    const params = new URLSearchParams({
      home: topFx.teams?.home?.name || "Home",
      away: topFx.teams?.away?.name || "Away",
      league: topFx.league?.name || "Football",
      date: topFx.fixture?.date || "",
      v: String(batchToken)
    });
    if (realTag) params.set("tag", realTag);
    if (topPick?.confidence != null) params.set("confidence", String(topPick.confidence));
    if (topFx.teams?.home?.logo) params.set("home_logo", topFx.teams.home.logo);
    if (topFx.teams?.away?.logo) params.set("away_logo", topFx.teams.away.logo);
    return `screenshot:${PUBLIC_SITE_URL}/og/tg-prediction?${params.toString()}`;
  }
  if (key === "result" && hasHighlight) return "highlight";
  if (key === "upcoming" || key === "reminder") return "off";
  return "";
}
__name(defaultImageStrategy, "defaultImageStrategy");
async function readSportsbookConfigFromKV(env) {
  try {
    const raw = await env.CACHE.get("sportsbook:config");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
__name(readSportsbookConfigFromKV, "readSportsbookConfigFromKV");
function fillSportsbookPlaceholders(text, ctx) {
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => k in ctx ? String(ctx[k] ?? "") : m);
}
__name(fillSportsbookPlaceholders, "fillSportsbookPlaceholders");
async function postSportsbookTemplateTest(env) {
  const report = { status: "init", source: "defaults", results: [] };
  const config = await readSportsbookConfigFromKV(env);
  if (config && config.templates) report.source = "kv";
  const batchToken = Date.now();
  const { date, picks } = await loadFeaturedWithPicks(env);
  const top = picks[0] || null;
  const topFx = top?.fx;
  const topPick = top?.pick;
  const pickRows = picks.length ? picks.slice(0, 3).map((p) => `\u2022 ${escHtml(firstPickLine(p)).replace(/\n/g, " \xB7 ")}`).join("\n") : "Latest match predictions are ready on ScoreOCS8.";
  const upcomingList = pickRows;
  let highlights = [];
  try {
    highlights = JSON.parse(await env.CACHE.get("highlights:latest") || "[]");
  } catch {
  }
  const h = highlights[0];
  const pageCache = /* @__PURE__ */ new Map();
  const fetchPageCached = /* @__PURE__ */ __name(async (path) => {
    if (pageCache.has(path)) return pageCache.get(path);
    const p = fetchWebsitePage(path);
    pageCache.set(path, p);
    return p;
  }, "fetchPageCached");
  const latestPostTitles = await (async () => {
    try {
      const res = await fetch(`${PUBLIC_SITE_URL}/api/posts`);
      if (!res.ok) return "\u{1F4DD} New analysis coming soon \xB7 \u65B0\u5206\u6790\u5373\u5C06\u4E0A\u7EBF";
      const posts = await res.json();
      const top2 = (posts || []).slice(0, 3);
      if (!top2.length) return "\u{1F4DD} New analysis coming soon \xB7 \u65B0\u5206\u6790\u5373\u5C06\u4E0A\u7EBF";
      return top2.map((p) => {
        const e = p.emoji || "\u{1F4DD}";
        const t = escHtml(p.title || "Untitled");
        const slug = p.slug || "";
        return `${e} <a href="${PUBLIC_SITE_URL}/blog/${slug}/">${t}</a>`;
      }).join("\n");
    } catch {
      return "\u{1F4DD} New analysis coming soon \xB7 \u65B0\u5206\u6790\u5373\u5C06\u4E0A\u7EBF";
    }
  })();
  const proofTestimonials = [
    '\u{1F4AC} "Won RM20K+ following the AI prediction." \u2014 MJ',
    '\u{1F4AC} "Copied the UCL pick and made RM8,700 profit." \u2014 AL',
    '\u{1F4AC} "La Liga call landed, RM3,250 return." \u2014 TAN'
  ].join("\n");
  const PICK_DEPENDENT_KEYS = /* @__PURE__ */ new Set(["prediction", "reminder"]);
  const pickReady = isPickReady(topPick);
  const CORE_KEYS = /* @__PURE__ */ new Set(["prediction"]);
  for (const key of SPORTSBOOK_TEMPLATE_KEYS) {
    const userTpl = config?.templates?.[key];
    if (userTpl && userTpl.enabled === false) {
      report.results.push({ key, status: "skipped", reason: "template disabled" });
      continue;
    }
    if (!CORE_KEYS.has(key) && !(userTpl && userTpl.enabled === true)) {
      report.results.push({ key, status: "skipped", reason: "non-core template, not explicitly enabled in panel" });
      continue;
    }
    if (PICK_DEPENDENT_KEYS.has(key) && !pickReady) {
      report.results.push({ key, status: "skipped", reason: "pick not ready (no pickLabel from AI pipeline yet)" });
      continue;
    }
    const fallback = SPORTSBOOK_DEFAULTS[key];
    const rawText = userTpl?.text || fallback.text;
    const buttonText = userTpl?.button || fallback.button;
    const buttonUrl = userTpl?.url || fallback.url;
    const page = await fetchPageCached(SPORTSBOOK_PAGE_BY_KEY[key] || "/");
    const placeholders = {
      // Website metadata (used by blog, proof, generic templates)
      websiteTitle: escHtml(page.title || ""),
      websiteDescription: escHtml(page.description || ""),
      websiteUrl: page.url || `${PUBLIC_SITE_URL}/`,
      // Top featured pick — used by prediction / reminder
      firstPick: top ? escHtml(firstPickLine(top)) : "Latest AI pick is ready on ScoreOCS8.",
      firstPickName: topFx ? `${escHtml(topFx.teams?.home?.name || "Home")} vs ${escHtml(topFx.teams?.away?.name || "Away")}` : "",
      firstPickLeague: escHtml(topFx?.league?.name || ""),
      firstPickKickoff: topFx?.fixture?.date ? `${fmtMYT(topFx.fixture.date)} MYT` : "",
      firstPickConfidence: topPick?.confidence != null ? `${topPick.confidence}%` : "",
      firstPickLabel: escHtml(topPick?.pickLabel || topPick?.pick || "Pending"),
      // Fixture lists
      pickRows,
      upcomingList,
      // Blog + proof template helpers
      latestPostTitles,
      proofTestimonials,
      // Affiliate signup CTA — reusable across every template body
      signupCta: SIGNUP_CTA,
      signupUrl: SIGNUP_URL,
      // Result / highlight (latest finished match)
      resultLine: h ? `${escHtml(h.home)} ${escHtml(h.score_home)}-${escHtml(h.score_away)} ${escHtml(h.away)}
${escHtml(h.league || "Football")}` : escHtml(page.description || "Latest results are live on ScoreOCS8."),
      resultScore: h ? `${escHtml(h.home)} ${escHtml(h.score_home)}-${escHtml(h.score_away)} ${escHtml(h.away)}` : "",
      resultLeague: h ? escHtml(h.league || "Football") : "",
      youtubeUrl: h?.youtube_url || ""
    };
    const text = fillSportsbookPlaceholders(rawText, placeholders);
    const userImage = String(userTpl?.image ?? "").trim();
    const rawImage = userImage || defaultImageStrategy(key, topFx, topPick, !!h, batchToken);
    let imageUrl = "";
    let imageBytes = null;
    let imageError = null;
    if (!rawImage || /^(og|auto)$/i.test(rawImage)) {
      imageUrl = page.ogImage || "";
    } else if (/^(off|none|no)$/i.test(rawImage)) {
    } else if (/^highlight$/i.test(rawImage)) {
      let cardUrl = h?.image_url || "";
      if (h) {
        const params = new URLSearchParams({
          home: h.home || "Home",
          away: h.away || "Away",
          league: h.league || "Football",
          score: `${h.score_home ?? 0}-${h.score_away ?? 0}`,
          date: h.kickoff_iso || ""
        });
        if (h.home_logo) params.set("home_logo", h.home_logo);
        if (h.away_logo) params.set("away_logo", h.away_logo);
        if (h.correct === true) params.set("pick_was", "correct");
        if (h.correct === false) params.set("pick_was", "wrong");
        cardUrl = `${PUBLIC_SITE_URL}/og/tg-result?${params.toString()}`;
      }
      if (cardUrl) {
        try {
          imageBytes = await screenshot(env, {
            url: cardUrl,
            viewport: { width: 1280, height: 720 },
            waitUntil: "networkidle0",
            timeoutMs: 25e3
          });
        } catch (e) {
          imageError = "highlight rasterize failed: " + (e.message || String(e));
          imageUrl = page.ogImage || "";
        }
      } else {
        imageUrl = page.ogImage || "";
      }
    } else if (/^screenshot:/i.test(rawImage)) {
      const targetUrl = rawImage.replace(/^screenshot:/i, "").trim() || `${PUBLIC_SITE_URL}/`;
      try {
        imageBytes = await screenshot(env, {
          url: targetUrl,
          viewport: { width: 1280, height: 720 },
          waitUntil: "networkidle0",
          timeoutMs: 25e3
        });
      } catch (e) {
        imageError = "screenshot failed: " + (e.message || String(e));
        imageUrl = page.ogImage || "";
      }
    } else {
      imageUrl = rawImage;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    const result = await sendTemplateMessage(env, { text, buttonText, buttonUrl, imageUrl, imageBytes });
    if (imageError) result.imageError = imageError;
    report.results.push({ key, ...result });
  }
  report.status = "ok";
  report.date = date;
  report.sent = report.results.filter((r) => r.status === "ok").length;
  report.failed = report.results.filter((r) => r.status === "error").length;
  report.skipped = report.results.filter((r) => r.status === "skipped").length;
  await env.CACHE.put(`post:telegram:sportsbook-test:${Date.now()}`, JSON.stringify(report), {
    expirationTtl: 14 * 24 * 3600
  });
  return report;
}
__name(postSportsbookTemplateTest, "postSportsbookTemplateTest");
async function runSportsbookDaily(env) {
  const config = await readSportsbookConfigFromKV(env);
  if (!config || !config.enabled) {
    return { status: "skipped", reason: "autopost disabled \u2014 toggle Automation ON in panel" };
  }
  const todayMyt = (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const dedupKey = `sportsbook:daily-fired:${todayMyt}`;
  const alreadyFired = await env.CACHE.get(dedupKey);
  if (alreadyFired) {
    return { status: "skipped", reason: `already fired today (${todayMyt})`, ts: alreadyFired };
  }
  await env.CACHE.put(dedupKey, String(Date.now()), { expirationTtl: 36 * 3600 });
  const result = await postSportsbookTemplateTest(env);
  result.trigger = "daily-cron";
  result.fired_on = todayMyt;
  const skippedForPickGap = (result.results || []).some(
    (r) => r.status === "skipped" && /pick not ready/i.test(r.reason || "")
  );
  if (skippedForPickGap) {
    await env.CACHE.delete(dedupKey);
    result.dedup = "released \u2014 pick not ready, retry allowed";
  }
  const predictionFired = (result.results || []).some(
    (r) => r.key === "prediction" && r.status === "ok"
  );
  if (predictionFired) {
    const { picks } = await loadFeaturedWithPicks(env).catch(() => ({ picks: [] }));
    const top = picks[0];
    const home = top?.fx?.teams?.home?.name || "";
    const away = top?.fx?.teams?.away?.name || "";
    const pickLabel = top?.pick?.pickLabel || top?.pick?.pick || "";
    const headline = home && away ? `Today's pro pick: ${home} vs ${away}` : `Today's pro picks are ready`;
    const body = pickLabel ? `Pick: ${pickLabel} \xB7 ${picks.length} match${picks.length === 1 ? "" : "es"} on the slate` : `Tap to see the day's slate at ScoreOcs8.`;
    result.push = await broadcastPush(env, {
      title: headline,
      body,
      url: "/",
      tag: `daily-${todayMyt}`
    });
  }
  return result;
}
__name(runSportsbookDaily, "runSportsbookDaily");
async function postToX(env, photoBytes, text, date) {
  if (!env.X_API_KEY) return { status: "skipped", reason: "not configured" };
  try {
    const res = await postPhoto(env, { photoBytes, text });
    await env.CACHE.put(
      `post:x:daily:${date}`,
      JSON.stringify({ date, tweetId: res.tweetId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: "ok", tweetId: res.tweetId };
  } catch (e) {
    return { status: "error", error: String(e.message || e) };
  }
}
__name(postToX, "postToX");
async function postToIG(env, imageUrl, caption, date) {
  if (!env.IG_USER_ID || !env.IG_ACCESS_TOKEN) return { status: "skipped", reason: "not configured" };
  try {
    const res = await postPhoto2(env, { imageUrl, caption });
    await env.CACHE.put(
      `post:ig:daily:${date}`,
      JSON.stringify({ date, mediaId: res.mediaId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: "ok", mediaId: res.mediaId, retried: !!res.retried };
  } catch (e) {
    return { status: "error", error: String(e.message || e) };
  }
}
__name(postToIG, "postToIG");
async function postToThreads(env, imageUrl, text, date) {
  if (!env.THREADS_USER_ID || !env.THREADS_ACCESS_TOKEN) return { status: "skipped", reason: "not configured" };
  try {
    const res = await postPhoto3(env, { imageUrl, text });
    await env.CACHE.put(
      `post:threads:daily:${date}`,
      JSON.stringify({ date, threadId: res.threadId, postedAt: Date.now() }),
      { expirationTtl: 14 * 24 * 3600 }
    );
    return { status: "ok", threadId: res.threadId, retried: !!res.retried };
  } catch (e) {
    return { status: "error", error: String(e.message || e) };
  }
}
__name(postToThreads, "postToThreads");
var LIVE_UNFINISHED = /* @__PURE__ */ new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE"]);
var FINISHED = /* @__PURE__ */ new Set(["FT", "AET", "PEN", "AWD", "WO"]);
function todayMYT() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}
__name(todayMYT, "todayMYT");
function isoWeekKey(d = /* @__PURE__ */ new Date()) {
  const tgt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tgt.getUTCDay() || 7;
  tgt.setUTCDate(tgt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tgt.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tgt - yearStart) / 864e5 + 1) / 7);
  return `${tgt.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}
__name(isoWeekKey, "isoWeekKey");
function pickWasCorrect(pick, goalsHome, goalsAway) {
  if (!pick || !pick.pick) return null;
  if (goalsHome == null || goalsAway == null) return null;
  const p = String(pick.pick).toUpperCase();
  if (p === "HOME") return goalsHome > goalsAway;
  if (p === "AWAY") return goalsAway > goalsHome;
  if (p === "DRAW") return goalsHome === goalsAway;
  return null;
}
__name(pickWasCorrect, "pickWasCorrect");
async function appendHistory(env, entry) {
  const raw = await env.CACHE.get("history:matches");
  let list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
    } catch {
    }
  }
  list = list.filter((m) => m.fixture_id !== entry.fixture_id);
  list.unshift(entry);
  list = list.slice(0, 60);
  await env.CACHE.put("history:matches", JSON.stringify(list), {
    expirationTtl: 90 * 24 * 3600
  });
}
__name(appendHistory, "appendHistory");
async function appendHighlight(env, entry) {
  const raw = await env.CACHE.get("highlights:latest");
  let list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
    } catch {
    }
  }
  list = list.filter((m) => m.fixture_id !== entry.fixture_id);
  list.unshift(entry);
  list = list.slice(0, 24);
  await env.CACHE.put("highlights:latest", JSON.stringify(list), {
    expirationTtl: 90 * 24 * 3600
  });
}
__name(appendHighlight, "appendHighlight");
function highlightImageUrl(fx) {
  const home = fx?.teams?.home?.name || "Home";
  const away = fx?.teams?.away?.name || "Away";
  const league = fx?.league?.name || "Football";
  const score = `${fx?.goals?.home ?? 0}-${fx?.goals?.away ?? 0}`;
  const params = new URLSearchParams({
    home,
    away,
    league,
    score,
    date: fx?.fixture?.date || ""
  });
  if (fx?.teams?.home?.logo) params.set("home_logo", fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set("away_logo", fx.teams.away.logo);
  return `${SITE_URL2}/og/highlight?${params.toString()}`;
}
__name(highlightImageUrl, "highlightImageUrl");
function tgResultCardUrl(fx, correct) {
  const params = new URLSearchParams({
    home: fx?.teams?.home?.name || "Home",
    away: fx?.teams?.away?.name || "Away",
    league: fx?.league?.name || "Football",
    score: `${fx?.goals?.home ?? 0}-${fx?.goals?.away ?? 0}`,
    date: fx?.fixture?.date || ""
  });
  if (fx?.teams?.home?.logo) params.set("home_logo", fx.teams.home.logo);
  if (fx?.teams?.away?.logo) params.set("away_logo", fx.teams.away.logo);
  if (correct === true) params.set("pick_was", "correct");
  if (correct === false) params.set("pick_was", "wrong");
  return `${PUBLIC_SITE_URL}/og/tg-result?${params.toString()}`;
}
__name(tgResultCardUrl, "tgResultCardUrl");
function youtubeSearchUrl(fx) {
  const home = fx?.teams?.home?.name || "";
  const away = fx?.teams?.away?.name || "";
  const score = `${fx?.goals?.home ?? ""}-${fx?.goals?.away ?? ""}`;
  const query = `${home} ${score} ${away} highlights`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}
__name(youtubeSearchUrl, "youtubeSearchUrl");
function youtubeChannelTokens(env) {
  const raw = String(env.YOUTUBE_CHANNELS || env.YOUTUBE_CHANNEL_IDS || DEFAULT_YOUTUBE_CHANNELS);
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
__name(youtubeChannelTokens, "youtubeChannelTokens");
function youtubeHandleFromToken(token) {
  const s = String(token || "").trim();
  const handleUrl = s.match(/youtube\.com\/@([^/?#]+)/i);
  if (handleUrl) return handleUrl[1];
  if (s.startsWith("@")) return s.slice(1);
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(s)) return null;
  return s.replace(/^@/, "");
}
__name(youtubeHandleFromToken, "youtubeHandleFromToken");
function youtubeChannelIdFromToken(token) {
  const s = String(token || "").trim();
  const channelUrl = s.match(/youtube\.com\/channel\/([^/?#]+)/i);
  if (channelUrl) return channelUrl[1];
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}
__name(youtubeChannelIdFromToken, "youtubeChannelIdFromToken");
async function resolveYoutubeChannelId(env, token) {
  const direct = youtubeChannelIdFromToken(token);
  if (direct) return direct;
  const handle = youtubeHandleFromToken(token);
  if (!handle || !env.YOUTUBE_API_KEY) return null;
  const cacheKey = `youtube:channel:${handle.toLowerCase()}`;
  const cached = await env.CACHE?.get(cacheKey).catch(() => null);
  if (cached) return cached;
  const params = new URLSearchParams({
    part: "id",
    forHandle: handle,
    key: env.YOUTUBE_API_KEY
  });
  const res = await fetch(`${YOUTUBE_CHANNELS_API}?${params.toString()}`);
  if (!res.ok) return null;
  const data = await res.json();
  const id = data.items?.[0]?.id || null;
  if (id) await env.CACHE?.put(cacheKey, id, { expirationTtl: 60 * 60 * 24 * 30 }).catch(() => {
  });
  return id;
}
__name(resolveYoutubeChannelId, "resolveYoutubeChannelId");
async function youtubeChannelIds(env) {
  const ids = [];
  for (const token of youtubeChannelTokens(env)) {
    const id = await resolveYoutubeChannelId(env, token);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
__name(youtubeChannelIds, "youtubeChannelIds");
function youtubeVideoScore(item, fx) {
  const title = String(item?.snippet?.title || "").toLowerCase();
  const home = String(fx?.teams?.home?.name || "").toLowerCase();
  const away = String(fx?.teams?.away?.name || "").toLowerCase();
  const score = `${fx?.goals?.home ?? ""}-${fx?.goals?.away ?? ""}`;
  let points = 0;
  if (home && title.includes(home)) points += 3;
  if (away && title.includes(away)) points += 3;
  if (score && title.includes(score)) points += 2;
  if (/highlight|highlights|ringkasan|extended|full time|ft/.test(title)) points += 2;
  return points;
}
__name(youtubeVideoScore, "youtubeVideoScore");
async function findYoutubeHighlight(env, fx) {
  if (!env.YOUTUBE_API_KEY) return null;
  const home = fx?.teams?.home?.name || "";
  const away = fx?.teams?.away?.name || "";
  const score = `${fx?.goals?.home ?? ""}-${fx?.goals?.away ?? ""}`;
  const q = `${home} ${score} ${away} highlights`;
  try {
    let items = [];
    const channelIds = await youtubeChannelIds(env);
    const searches = [...channelIds, null];
    for (const channelId of searches) {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        maxResults: "5",
        order: "date",
        q,
        key: env.YOUTUBE_API_KEY
      });
      if (channelId) params.set("channelId", channelId);
      const res = await fetch(`${YOUTUBE_SEARCH_API}?${params.toString()}`);
      if (!res.ok) continue;
      const data = await res.json();
      items = items.concat(data.items || []);
    }
    const video = items.filter((item) => item?.id?.videoId).sort((a, b) => {
      const scoreDiff = youtubeVideoScore(b, fx) - youtubeVideoScore(a, fx);
      if (scoreDiff) return scoreDiff;
      return new Date(b.snippet?.publishedAt || 0) - new Date(a.snippet?.publishedAt || 0);
    })[0];
    if (!video) return null;
    return {
      url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
      video_id: video.id.videoId,
      title: video.snippet?.title || null,
      channel: video.snippet?.channelTitle || null,
      thumbnail: video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || null,
      matched_at: Date.now()
    };
  } catch {
    return null;
  }
}
__name(findYoutubeHighlight, "findYoutubeHighlight");
async function bumpAccuracy(env, correct) {
  const weekKey = `accuracy:week:${isoWeekKey()}`;
  const curKey = `accuracy:week:current`;
  const raw = await env.CACHE.get(weekKey);
  let data = { hits: 0, total: 0 };
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
    }
  }
  data.total += 1;
  if (correct === true) data.hits += 1;
  const payload = JSON.stringify(data);
  await env.CACHE.put(weekKey, payload, { expirationTtl: 45 * 24 * 3600 });
  await env.CACHE.put(curKey, payload, { expirationTtl: 10 * 24 * 3600 });
  return data;
}
__name(bumpAccuracy, "bumpAccuracy");
async function postPrematchPolls(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "telegram not configured" };
  }
  if (!env?.CACHE) {
    return { status: "skipped", reason: "no KV binding" };
  }
  const now = Date.now();
  const WINDOW = 15 * 60 * 1e3;
  const targetMs = 12 * 3600 * 1e3;
  const seenFixtures = /* @__PURE__ */ new Map();
  for (let i = 0; i < 2; i++) {
    const d = new Date(now + i * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    let bundle;
    try {
      bundle = await env.CACHE.get(`content:${d}`, "json");
    } catch {
      continue;
    }
    if (!bundle) continue;
    const items = [];
    if (bundle.top?.fixture) items.push(bundle.top.fixture);
    for (const fx of items) {
      const id = fx?.fixture?.id;
      if (!id || seenFixtures.has(id)) continue;
      seenFixtures.set(id, fx);
    }
  }
  const results = [];
  for (const [id, fx] of seenFixtures) {
    const kickoffMs = new Date(fx.fixture?.date || 0).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const msUntil = kickoffMs - now;
    if (Math.abs(msUntil - targetMs) > WINDOW) continue;
    const flagKey = `poll:posted:${id}`;
    const already = await env.CACHE.get(flagKey).catch(() => null);
    if (already) {
      results.push({ id, status: "skipped", reason: "already posted" });
      continue;
    }
    const home = fx.teams?.home?.name || "Home";
    const away = fx.teams?.away?.name || "Away";
    const league = fx.league?.name || "Football";
    try {
      const poll = await sendPoll(env, {
        question: `\u26BD Who wins? \xB7 \u8C01\u4F1A\u83B7\u80DC?
${league}
${home} vs ${away}`,
        options: [home, "Draw \xB7 \u5E73\u5C40", away],
        isAnonymous: true
      });
      await env.CACHE.put(flagKey, "1", { expirationTtl: 13 * 3600 });
      results.push({ id, status: "ok", messageId: poll.message_id, kickoff: fx.fixture?.date });
    } catch (e) {
      results.push({ id, status: "error", error: String(e.message || e) });
    }
  }
  return { status: "ok", checked: seenFixtures.size, results };
}
__name(postPrematchPolls, "postPrematchPolls");
async function postPreMatchAlerts(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "telegram not configured" };
  }
  const date = todayMYT();
  const raw = await env.CACHE.get(`ft-queue:${date}`);
  if (!raw) return { status: "skipped", reason: "no queue for today", date };
  let queue;
  try {
    queue = JSON.parse(raw);
  } catch {
    return { status: "error", reason: "bad queue json", date };
  }
  const now = Date.now();
  const WINDOW_MIN_MS = 15 * 60 * 1e3;
  const WINDOW_MAX_MS = 35 * 60 * 1e3;
  const report = { date, eligible: 0, posted: 0, skipped: 0, errors: [] };
  for (const item of queue) {
    if (!item.is_motd && !item.is_wc) continue;
    const kickoffMs = new Date(item.kickoff_iso).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const tilKO = kickoffMs - now;
    if (tilKO < WINDOW_MIN_MS || tilKO > WINDOW_MAX_MS) continue;
    report.eligible += 1;
    const dedupKey = `posted:premat30:${item.fixture_id}`;
    if (await env.CACHE.get(dedupKey).catch(() => null)) {
      report.skipped += 1;
      continue;
    }
    try {
      const pick = await env.CACHE.get(`prediction:${item.fixture_id}`, "json").catch(() => null);
      const pickReady = isPickReady(pick);
      if (!item.is_wc && !pickReady) {
        report.skipped += 1;
        report.errors.push({ fixture_id: item.fixture_id, error: "pick not ready at KO-30" });
        continue;
      }
      const fxData = await afGet(env, "/fixtures", { id: item.fixture_id });
      const fx = fxData.response?.[0];
      if (!fx) {
        report.errors.push({ fixture_id: item.fixture_id, error: "fixture not found" });
        continue;
      }
      const caption = item.is_wc ? buildMatchUpdateCaption({ fixture: fx, siteUrl: SITE_URL2 }) : buildPreMatchMotdCaption({ fixture: fx, pick, siteUrl: SITE_URL2 });
      const msg = await sendMessage(env, { text: caption });
      await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: now }), {
        expirationTtl: 6 * 3600
      });
      report.posted += 1;
      if (item.is_motd) {
        const home = fx?.teams?.home?.name || "Home";
        const away = fx?.teams?.away?.name || "Away";
        const slug = `${home}-vs-${away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
        const pickText = pick?.pickLabel || pick?.pick;
        const pushResult = await broadcastPush(env, {
          title: `\u26A1 Starts in 30 min \xB7 ${home} vs ${away}`,
          body: pickText ? `Pro pick: ${pickText}` : `Kicks off in ~30 min \u2014 tap for live tracking`,
          url: `/match/${item.fixture_id}-${slug}/`,
          tag: `premat30-${item.fixture_id}`
        });
        report.push = report.push || [];
        report.push.push({ fixture_id: item.fixture_id, ...pushResult });
      }
    } catch (e) {
      report.errors.push({ fixture_id: item.fixture_id, error: String(e.message || e) });
    }
  }
  return { status: "ok", ...report };
}
__name(postPreMatchAlerts, "postPreMatchAlerts");
async function checkFinishedMatches(env) {
  const date = todayMYT();
  const raw = await env.CACHE.get(`ft-queue:${date}`);
  if (!raw) return { status: "skipped", reason: "no queue for today", date };
  let queue;
  try {
    queue = JSON.parse(raw);
  } catch {
    return { status: "error", reason: "bad queue json", date };
  }
  const now = Date.now();
  const due = queue.filter((q) => !q.posted && q.check_at_ms <= now);
  if (!due.length) return { status: "ok", due: 0, date, total: queue.length };
  const MAX_ATTEMPTS = 6;
  const report = { date, checked: due.length, posted: 0, still_live: 0, gave_up: 0, errors: [] };
  const fxById = /* @__PURE__ */ new Map();
  let batchError = null;
  try {
    for (let i = 0; i < due.length; i += 20) {
      const ids = due.slice(i, i + 20).map((d) => d.fixture_id).join("-");
      const data = await afGet(env, "/fixtures", { ids });
      for (const fx of data.response || []) {
        if (fx?.fixture?.id != null) fxById.set(fx.fixture.id, fx);
      }
    }
  } catch (e) {
    batchError = String(e.message || e);
  }
  for (const item of due) {
    try {
      if (batchError) throw new Error(batchError);
      const fx = fxById.get(item.fixture_id);
      const short = fx?.fixture?.status?.short;
      item.attempts = (item.attempts || 0) + 1;
      if (!short || LIVE_UNFINISHED.has(short)) {
        if (item.attempts >= MAX_ATTEMPTS) {
          item.posted = true;
          item.note = `gave up after ${item.attempts} attempts, last status ${short || "unknown"}`;
          report.gave_up += 1;
          continue;
        }
        item.check_at_ms = now + 10 * 60 * 1e3;
        report.still_live += 1;
        continue;
      }
      if (!FINISHED.has(short)) {
        item.posted = true;
        item.note = `non-terminal status ${short}`;
        continue;
      }
      const pick = await env.CACHE.get(`prediction:${item.fixture_id}`, "json").catch(() => null);
      const goalsHome = fx.goals?.home;
      const goalsAway = fx.goals?.away;
      const correct = pickWasCorrect(pick, goalsHome, goalsAway);
      const accAfter = correct === null ? null : await bumpAccuracy(env, correct);
      if (item.is_wc) {
        const caption = buildResultCaption({
          fixture: fx,
          pickCorrect: null,
          weekAcc: null,
          siteUrl: SITE_URL2
        });
        let msg;
        try {
          const png = await screenshot(env, {
            url: tgResultCardUrl(fx, null),
            viewport: { width: 1280, height: 720 },
            waitUntil: "networkidle0",
            timeoutMs: 25e3
          });
          msg = await sendPhoto(env, { photoBytes: png, caption });
        } catch (e) {
          msg = await sendMessage(env, { text: caption });
          report.errors.push({ fixture_id: item.fixture_id, error: "tg-result render failed, sent text: " + (e.message || String(e)) });
        }
        item.message_id = msg.message_id;
        report.posted += 1;
      } else if (item.is_motd) {
        const slipStatus = correct === true ? "won" : correct === false ? "lost" : "running";
        const slipUrl = `${SITE_URL2}${slipPath(item.fixture_id, item.home, item.away)}?status=${slipStatus}&stake=100&v=${Date.now()}`;
        const png = await screenshot(env, {
          url: slipUrl,
          viewport: { width: 1080, height: 1350 },
          waitUntil: "networkidle0"
        });
        const weekAcc = accAfter ? { hits: accAfter.hits, total: accAfter.total, pct: Math.round(accAfter.hits / accAfter.total * 100) } : null;
        const caption = buildResultCaption({
          fixture: fx,
          pickCorrect: correct,
          weekAcc,
          siteUrl: SITE_URL2
        });
        const msg = await sendPhoto(env, { photoBytes: png, caption });
        item.message_id = msg.message_id;
        report.posted += 1;
      } else {
        report.silent = (report.silent || 0) + 1;
      }
      item.posted = true;
      item.posted_at = Date.now();
      item.correct = correct;
      await appendHistory(env, {
        fixture_id: item.fixture_id,
        kickoff_iso: fx.fixture.date,
        sport: "football",
        league_id: item.league_id,
        home: item.home,
        away: item.away,
        score_home: goalsHome,
        score_away: goalsAway,
        pick: pick?.pickLabel || pick?.pick || null,
        confidence: pick?.confidence ?? null,
        correct,
        ts: Date.now()
      });
      const youtube = item.is_motd ? await findYoutubeHighlight(env, fx) : null;
      await appendHighlight(env, {
        fixture_id: item.fixture_id,
        kickoff_iso: fx.fixture.date,
        league_id: item.league_id,
        league: fx.league?.name || null,
        home: item.home,
        away: item.away,
        home_logo: fx.teams?.home?.logo || null,
        away_logo: fx.teams?.away?.logo || null,
        score_home: goalsHome,
        score_away: goalsAway,
        image_url: highlightImageUrl(fx),
        youtube_url: youtube?.url || null,
        youtube_video_id: youtube?.video_id || null,
        youtube_title: youtube?.title || null,
        youtube_channel: youtube?.channel || null,
        youtube_thumbnail: youtube?.thumbnail || null,
        youtube_search_url: youtubeSearchUrl(fx),
        source: "ft-cron",
        ts: Date.now()
      });
    } catch (e) {
      report.errors.push({ fixture_id: item.fixture_id, error: String(e.message || e) });
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts >= MAX_ATTEMPTS) {
        item.posted = true;
        item.note = `gave up after ${item.attempts} errored attempts`;
        report.gave_up += 1;
      } else {
        const backoff = Math.min(30, 5 * item.attempts) * 60 * 1e3;
        item.check_at_ms = Date.now() + backoff;
      }
    }
  }
  await env.CACHE.put(`ft-queue:${date}`, JSON.stringify(queue), { expirationTtl: 48 * 3600 });
  let recap = null;
  let upcoming = null;
  const allDone = queue.length > 0 && queue.every((q) => q.posted === true);
  const anyReconciled = queue.some((q) => q.correct === true || q.correct === false);
  if (allDone) {
    upcoming = await postWcUpcomingCard(env);
  }
  if (allDone && anyReconciled) {
    recap = await postDailyRecap(env);
  }
  return { status: "ok", ...report, total: queue.length, recap, upcoming };
}
__name(checkFinishedMatches, "checkFinishedMatches");
async function postDailyRecap(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "telegram not configured" };
  }
  const date = todayMYT();
  const dedupKey = `posted:recap:${date}`;
  if (await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: "skipped", reason: "already posted", date };
  }
  const raw = await env.CACHE.get(`ft-queue:${date}`);
  let queue = [];
  if (raw) {
    try {
      queue = JSON.parse(raw);
    } catch {
    }
  }
  const reconciled = queue.filter(
    (q) => q.posted === true && (q.correct === true || q.correct === false)
  );
  if (reconciled.length === 0) {
    return { status: "skipped", reason: "no reconciled results today", date };
  }
  const wins = reconciled.filter((q) => q.correct === true).length;
  const losses = reconciled.length - wins;
  let weekAcc = null;
  try {
    const wraw = await env.CACHE.get("accuracy:week:current");
    if (wraw) {
      const w = JSON.parse(wraw);
      if (w.total) {
        weekAcc = { hits: w.hits, total: w.total, pct: Math.round(w.hits / w.total * 100) };
      }
    }
  } catch {
  }
  const tomorrowDate = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  let tomorrowFx = null;
  try {
    const bundle = await env.CACHE.get(`content:${tomorrowDate}`, "json");
    tomorrowFx = bundle?.top?.fixture || null;
  } catch {
  }
  const lines = [];
  lines.push("<b>\u{1F4CA} Daily Recap \xB7 \u4ECA\u65E5\u56DE\u987E</b>");
  lines.push("");
  for (const r of reconciled) {
    const emoji = r.correct === true ? "\u2705" : "\u274C";
    const verdict = r.correct === true ? "WIN" : "LOSS";
    lines.push(`${emoji} ${r.home || "Home"} vs ${r.away || "Away"} \u2014 ${verdict}`);
  }
  lines.push("");
  lines.push(`<b>Today:</b> ${wins}W \xB7 ${losses}L`);
  if (weekAcc) {
    lines.push(`<b>This week:</b> ${weekAcc.hits}/${weekAcc.total} (${weekAcc.pct}%)`);
  }
  if (tomorrowFx) {
    const home = tomorrowFx.teams?.home?.name || "TBD";
    const away = tomorrowFx.teams?.away?.name || "TBD";
    const league = tomorrowFx.league?.name || "Football";
    const ko = tomorrowFx.fixture?.date;
    let koStr = "";
    if (ko) {
      const koDate = new Date(ko);
      if (!isNaN(koDate.getTime())) {
        koStr = koDate.toLocaleString("en-GB", {
          timeZone: "Asia/Kuala_Lumpur",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }) + " MYT";
      }
    }
    lines.push("");
    lines.push("<b>\u26BD Tomorrow \xB7 \u660E\u65E5\u7126\u70B9</b>");
    lines.push(`${league} \xB7 ${home} vs ${away}`);
    if (koStr) lines.push(`Kickoff: ${koStr}`);
  }
  lines.push("");
  lines.push(`<a href="${SITE_URL2}">Open ScoreOCS8 for full AI analysis \u2192</a>`);
  try {
    const msg = await sendMessage(env, { text: lines.join("\n") });
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600
    });
    const tomorrowLine = tomorrowFx ? `Tomorrow: ${tomorrowFx.teams?.home?.name || "TBD"} vs ${tomorrowFx.teams?.away?.name || "TBD"}` : "";
    const weekLine = weekAcc ? ` \xB7 Week ${weekAcc.hits}/${weekAcc.total}` : "";
    const pushResult = await broadcastPush(env, {
      title: `\u{1F4CA} Today: ${wins}W \xB7 ${losses}L${weekLine}`,
      body: tomorrowLine || "Open ScoreOcs8 for today's recap.",
      url: "/",
      tag: `recap-${date}`
    });
    return {
      status: "ok",
      date,
      day: { played: reconciled.length, wins, losses },
      weekAcc,
      tomorrow: tomorrowFx ? {
        home: tomorrowFx.teams?.home?.name,
        away: tomorrowFx.teams?.away?.name
      } : null,
      message_id: msg.message_id,
      push: pushResult
    };
  } catch (e) {
    return { status: "error", error: String(e.message || e) };
  }
}
__name(postDailyRecap, "postDailyRecap");
async function postWorldCupCard(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "telegram not configured" };
  }
  const date = todayMYT();
  const dedupKey = `posted:wc-card:${date}`;
  if (await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: "skipped", reason: "already posted today", date };
  }
  try {
    const png = await screenshot(env, {
      url: `${SITE_URL2}/wc-card/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1350 },
      waitUntil: "networkidle0",
      timeoutMs: 3e4
    });
    const caption = buildWcCardCaption({ date, siteUrl: SITE_URL2 });
    const msg = await sendPhoto(env, { photoBytes: png, caption });
    if (msg?.disabled) return { status: "skipped", reason: "posting disabled (tg:posting=off)", date };
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600
    });
    return { status: "ok", date, message_id: msg.message_id };
  } catch (e) {
    return { status: "error", error: String(e.message || e), date };
  }
}
__name(postWorldCupCard, "postWorldCupCard");
async function postWcUpcomingCard(env) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHANNEL_ID) {
    return { status: "skipped", reason: "telegram not configured" };
  }
  const date = todayMYT();
  const dedupKey = `posted:wc-upcoming:${date}`;
  if (await env.CACHE.get(dedupKey).catch(() => null)) {
    return { status: "skipped", reason: "already posted today", date };
  }
  try {
    const png = await screenshot(env, {
      url: `${SITE_URL2}/wc-upcoming/?v=${Date.now()}`,
      viewport: { width: 1080, height: 1350 },
      waitUntil: "networkidle0",
      timeoutMs: 3e4
    });
    const caption = buildWcUpcomingCaption({ siteUrl: SITE_URL2 });
    const msg = await sendPhoto(env, { photoBytes: png, caption });
    if (msg?.disabled) return { status: "skipped", reason: "posting disabled (tg:posting=off)", date };
    await env.CACHE.put(dedupKey, JSON.stringify({ message_id: msg.message_id, ts: Date.now() }), {
      expirationTtl: 36 * 3600
    });
    return { status: "ok", date, message_id: msg.message_id };
  } catch (e) {
    return { status: "error", error: String(e.message || e), date };
  }
}
__name(postWcUpcomingCard, "postWcUpcomingCard");
var src_default = {
  async scheduled(event, env, ctx) {
    const cron = event.cron || "";
    if (cron.startsWith("0 1 ")) {
      ctx.waitUntil(runSportsbookDaily(env));
    } else if (cron.startsWith("0 2 ")) {
      ctx.waitUntil(postDailyToAll(env));
      ctx.waitUntil(postWorldCupCard(env));
    } else if (cron.startsWith("*/15 ")) {
      ctx.waitUntil(postPreMatchAlerts(env));
      ctx.waitUntil(postPrematchPolls(env));
      ctx.waitUntil(checkFinishedMatches(env));
    } else {
      ctx.waitUntil(generateDaily(env));
    }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.CRON_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const task = url.searchParams.get("task") || "generate";
    let result;
    if (task === "sportsbook-test") result = await postSportsbookTemplateTest(env);
    else if (task === "wc-queue") result = await queueWorldCupFixtures(env);
    else if (task === "wc-card") result = await postWorldCupCard(env);
    else if (task === "wc-upcoming") result = await postWcUpcomingCard(env);
    else if (task === "post") result = await postDailyToAll(env);
    else if (task === "check") result = await checkFinishedMatches(env);
    else if (task === "poll") result = await postPrematchPolls(env);
    else if (task === "premat") result = await postPreMatchAlerts(env);
    else if (task === "recap") result = await postDailyRecap(env);
    else if (task === "push-test") {
      result = await broadcastPush(env, {
        title: "ScoreOcs8 test push",
        body: "If you see this, web push is working end-to-end. \u2705",
        url: "/",
        tag: "test"
      });
    } else result = await generateDaily(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
};

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// .wrangler/tmp/bundle-WUOUXE/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default
];
var middleware_insertion_facade_default = src_default;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-WUOUXE/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
