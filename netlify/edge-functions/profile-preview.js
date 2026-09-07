/* SotTracker — sottracker.fr
   Creator: Vyros__
   https://github.com/Elock-exe/SeaOfThieves-Trackers */
/* ============================================================
   Link previews for a profile, filled in before the page is sent.

   A shared profile looked identical whoever it belonged to: "Pirate
   profile — SotTracker", the same sentence about playtime and gold, and
   an address with no pirate in it. The page is drawn by JavaScript and
   Discord does not run JavaScript — it reads the HTML as served, so it
   read the placeholders.

   That matters more than it sounds. A tracker is shared by pasting a
   link, and a link that says nothing about whose profile it is gives
   nobody a reason to open it.

   So for crawlers only, this fetches the pirate's stats and rewrites the
   four tags that matter. Crawlers only, because the API sleeps on free
   hosting and waking it can take the better part of a minute: a reader
   would wait for it, and they already have the page.
   ============================================================ */

const API = 'https://sot-tracker-api-8vqc.onrender.com';

/* The ones that actually unfurl a link somewhere people talk. Matched
   loosely: a crawler that slips through gets the old generic card, which
   is what it would have had anyway. */
const CRAWLER = /discordbot|twitterbot|facebookexternalhit|slackbot|whatsapp|telegrambot|linkedinbot|googlebot|bingbot|redditbot|embedly|pinterest|vkshare|skypeuripreview/i;

const esc = (v) => String(v == null ? '' : v)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/* Thousands separated with a narrow no-break space: a card is read at a
   glance, and 2384878 is not. */
const num = (n) => Number(n).toLocaleString('en-GB').replaceAll(',', ' ');

/** One line of stats, in the order someone would say them out loud. */
function summarise(snap) {
  const bits = [];
  const c = snap.currencies || {};
  if (c.gold) bits.push(num(c.gold) + ' gold');
  if (snap.hourglass && snap.hourglass.level) {
    bits.push('Hourglass ' + num(snap.hourglass.level));
  }
  const r = snap.hourglassRecord;
  if (r && r.battles && r.winRate != null) {
    bits.push(r.winRate + '% over ' + num(r.battles) + ' battles');
  }
  if (snap.ships && snap.ships.length) {
    bits.push(snap.ships.length + (snap.ships.length === 1 ? ' ship' : ' ships'));
  }
  if (snap.chest && snap.chest.total) bits.push(num(snap.chest.total) + ' cosmetics');
  return bits.join(' · ');
}

export default async function (request, context) {
  const url = new URL(request.url);
  const player = (url.searchParams.get('player') || '').trim();
  const agent = request.headers.get('user-agent') || '';

  if (!player || !CRAWLER.test(agent)) return;   // untouched, straight through

  const res = await context.next();
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;

  let snap = null;
  try {
    /* Short leash. A preview is worth a second, not a cold start — and an
       unfurl that times out shows nothing at all, which is worse than the
       generic card this falls back to. */
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(API + '/api/synced?handle=' + encodeURIComponent(player),
      { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) snap = await r.json();
  } catch (e) {
    /* Nothing to do about it here: fall through with what the page had. */
  }

  const title = player + ' — SotTracker';
  const line = snap ? summarise(snap) : '';
  const description = line ||
    'Sea of Thieves stats: gold, Hourglass rank, reputation and cosmetics.';
  const canonical = 'https://sottracker.fr/profile?player=' + encodeURIComponent(player);

  const html = (await res.text())
    .replace(/<title>[^<]*<\/title>/i, '<title>' + esc(title) + '</title>')
    .replace(/(<meta property="og:title" content=")[^"]*(")/i, '$1' + esc(title) + '$2')
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/i, '$1' + esc(title) + '$2')
    .replace(/(<meta property="og:description" content=")[^"]*(")/i, '$1' + esc(description) + '$2')
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/i, '$1' + esc(description) + '$2')
    .replace(/(<meta property="og:url" content=")[^"]*(")/i, '$1' + esc(canonical) + '$2');

  return new Response(html, { status: res.status, headers: res.headers });
}
