const SITE = 'https://scoreocs8.com';

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
}[c]));
const slugify = s => String(s || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

function videoIdFromUrl(url) {
  const text = String(url || '');
  return text.match(/[?&]v=([A-Za-z0-9_-]{6,})/)?.[1]
    || text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)?.[1]
    || null;
}

async function getHighlights(origin) {
  try {
    const res = await fetch(`${origin}/api/highlights?limit=12`);
    return res.ok ? (await res.json()).highlights || [] : [];
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const slug = String(context.params.match || '');
  const id = slug.match(/^(\d+)/)?.[1];
  if (!id) return new Response('Highlight not found', { status: 404 });

  const origin = new URL(context.request.url).origin;
  const items = await getHighlights(origin);
  const item = items.find(h => String(h.fixture_id) === String(id));
  if (!item) return new Response('Highlight not found', { status: 404 });

  const home = item.home || 'Home';
  const away = item.away || 'Away';
  const score = `${item.score_home ?? '-'}-${item.score_away ?? '-'}`;
  const expectedSlug = slugify(`${home}-vs-${away}`);
  const canonicalSlug = expectedSlug ? `${id}-${expectedSlug}` : id;
  const canonical = `${SITE}/highlights/${canonicalSlug}/`;
  if (slug !== canonicalSlug) {
    return new Response('', { status: 301, headers: { location: `/highlights/${canonicalSlug}/` } });
  }

  const title = `${home} ${score} ${away} Highlights | ${item.league || 'Football'} | ScoreOcs8`;
  const description = `Watch ${home} ${score} ${away} highlights, full-time result card, match detail and ScoreOcs8 prediction context. Updated in MYT.`;
  const image = item.image_url?.startsWith('http') ? item.image_url : `${SITE}${item.image_url || '/og/default?v=2'}`;
  const videoId = item.youtube_video_id || videoIdFromUrl(item.youtube_url);
  const searchUrl = item.youtube_search_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${home} ${score} ${away} highlights`)}`;
  const matchUrl = `/match/${id}-${slugify(`${home}-vs-${away}`)}/`;
  const date = fmtDate(item.kickoff_iso);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoObject',
        name: title,
        description,
        thumbnailUrl: [item.youtube_thumbnail || image],
        uploadDate: item.kickoff_iso || new Date().toISOString(),
        ...(videoId && { embedUrl: `https://www.youtube.com/embed/${videoId}` }),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Highlights', item: `${SITE}/#match-highlights` },
          { '@type': 'ListItem', position: 3, name: `${home} ${score} ${away}`, item: canonical },
        ],
      },
    ],
  };

  const embed = videoId
    ? `<iframe src="https://www.youtube.com/embed/${esc(videoId)}" title="${esc(title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
    : `<div class="pending"><strong>Official video match pending</strong><span>The result page is ready. Open YouTube search while trusted-channel matching runs.</span><a href="${esc(searchUrl)}" target="_blank" rel="noopener">Find Official Highlights</a></div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">
<meta property="og:site_name" content="ScoreOcs8">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="video.other">
<meta property="og:image" content="${esc(image)}">
${videoId ? `<meta property="og:video" content="https://www.youtube.com/embed/${esc(videoId)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#080b10;--card:#11161d;--border:rgba(255,255,255,.10);--accent:#f97316;--accent2:#f6a04a;--text:#f1f5f9;--text2:#9aa5b5;--text3:#5b6678;--ff:'Rajdhani',sans-serif;--fb:'Outfit',sans-serif;--fm:'DM Mono',monospace}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:radial-gradient(circle at top,#1b130f 0,#080b10 42%,#050608 100%);color:var(--text);font-family:var(--fb)}
nav{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(18px,5vw,84px);border-bottom:1px solid var(--border);background:rgba(8,11,16,.92);backdrop-filter:blur(18px)}
nav img{height:48px}nav a{font-family:var(--ff);font-size:18px;font-weight:700;text-decoration:none;color:var(--text2)}nav a:hover{color:var(--accent)}
.wrap{width:min(1180px,calc(100% - 38px));margin:0 auto;padding:54px 0 70px}.crumb{font-family:var(--fm);font-size:11px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px}.crumb a{color:var(--text3);text-decoration:none}.crumb span{color:var(--accent)}
.hero{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr);gap:26px;align-items:start}.panel{border:1px solid rgba(249,115,22,.22);background:rgba(255,255,255,.035);border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.34)}
.result-card{padding:28px;background:linear-gradient(135deg,#081014,#111923 58%,#2b130b)}.scorebox{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;background:#fff5ee;color:#111;border-radius:12px;padding:26px 18px;box-shadow:0 18px 44px rgba(0,0,0,.28)}
.team{text-align:center;min-width:0}.team img{width:76px;height:76px;object-fit:contain;border-radius:50%;background:#f0f0f0;padding:8px;margin-bottom:8px}.team strong{display:block;font-family:var(--ff);font-size:24px;line-height:1.05;overflow:hidden;text-overflow:ellipsis}.score{font-family:var(--ff);font-size:66px;font-weight:800;color:#ac2924;white-space:nowrap}.ft{text-align:center;font-family:var(--fm);font-size:10px;color:#a67364;letter-spacing:.48em;margin-top:10px;text-transform:uppercase}
.copy{padding:28px}h1{font-family:var(--ff);font-size:clamp(38px,5vw,64px);line-height:.95;color:var(--accent2);letter-spacing:0;margin-bottom:14px}.meta{font-family:var(--fm);font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px}.copy p{font-size:17px;line-height:1.7;color:var(--text2);margin-bottom:18px}
.actions{display:flex;gap:12px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;border-radius:10px;padding:0 18px;font-family:var(--ff);font-size:16px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;text-decoration:none}.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#111}.btn.ghost{border:1px solid rgba(249,115,22,.32);color:var(--accent)}
.video{aspect-ratio:16/9;background:#06080c}.video iframe{width:100%;height:100%;border:0;display:block}.pending{height:100%;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px;color:var(--text2)}.pending strong{font-family:var(--ff);font-size:30px;color:var(--text);margin-bottom:8px}.pending span{max-width:420px;line-height:1.6}.pending a{margin-top:18px;color:var(--accent);font-family:var(--ff);font-weight:800;text-transform:uppercase;text-decoration:none}
@media(max-width:860px){.hero{grid-template-columns:1fr}.scorebox{grid-template-columns:1fr}.score{font-size:50px;text-align:center}.team img{width:62px;height:62px}}
</style>
</head>
<body>
<nav><a href="/"><img src="/logo.png" alt="ScoreOcs8"></a><a href="/predictions/">Match Prediction</a></nav>
<main class="wrap">
  <div class="crumb"><a href="/">Home</a> / <a href="/#match-highlights">Highlights</a> / <span>${esc(home)} vs ${esc(away)}</span></div>
  <section class="hero">
    <article class="panel">
      <div class="result-card">
        <div class="scorebox">
          <div class="team">${item.home_logo ? `<img src="${esc(item.home_logo)}" alt="${esc(home)} logo">` : ''}<strong>${esc(home)}</strong></div>
          <div><div class="score">${esc(score)}</div><div class="ft">Full Time</div></div>
          <div class="team">${item.away_logo ? `<img src="${esc(item.away_logo)}" alt="${esc(away)} logo">` : ''}<strong>${esc(away)}</strong></div>
        </div>
      </div>
      <div class="copy">
        <div class="meta">FT · ${esc(date)} · ${esc(item.league || 'Football')}</div>
        <h1>${esc(home)} ${esc(score)} ${esc(away)}</h1>
        <p>${esc(description)}</p>
        <div class="actions">
          <a class="btn primary" href="${esc(matchUrl)}">Match Detail</a>
          <a class="btn ghost" href="${esc(searchUrl)}" target="_blank" rel="noopener">YouTube Search</a>
        </div>
      </div>
    </article>
    <aside class="panel video">${embed}</aside>
  </section>
</main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300, must-revalidate',
    },
  });
}
