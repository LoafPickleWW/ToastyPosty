// Web feeds: any RSS/Atom feed, plus presets and keyword "topics". No accounts or API keys needed.
import { XMLParser } from 'fast-xml-parser';

const UA = 'ToastyPosty/1.0 (self-hosted feed reader; +https://github.com/LoafPickleWW)';
const CACHE_MS = 5 * 60_000;
const MAX_BYTES = 5 * 1024 * 1024;
const cache = new Map(); // url -> { at, feed }
const failures = new Map(); // url -> { at, error }: don't hammer a source that just failed
const FAIL_MS = 3 * 60_000;

const enc = encodeURIComponent;
const splitKeywords = (s = '') => s.split(/[,\n]/).map((k) => k.trim()).filter(Boolean).slice(0, 6);
const clean = (s) => (s || '').trim().replace(/^@/, '').replace(/\/+$/, '');

// Presets shown in the "Add a web feed" form. build() turns what the user typed into feed URLs.
export const SOURCES = [
  { id: 'topic', label: 'Topic / keywords', hint: 'e.g. algorand, indie games', help: 'Searches Google News, Hacker News and Reddit for any of these words.',
    build: (q) => {
      const kws = splitKeywords(q);
      if (!kws.length) throw new Error('Add at least one keyword.');
      const quoted = kws.map((k) => (k.includes(' ') ? `"${k}"` : k));
      return [
        `https://news.google.com/rss/search?q=${enc(quoted.join(' OR '))}&hl=en-US&gl=US&ceid=US:en`,
        `https://www.reddit.com/search.rss?q=${enc(quoted.join(' OR '))}&sort=new`,
        ...kws.slice(0, 3).map((k) => `https://hnrss.org/newest?q=${enc(k)}`),
      ];
    } },
  { id: 'rss', label: 'Any RSS / Atom link', hint: 'https://example.com/feed', help: 'Most blogs and news sites have one at /feed or /rss.',
    build: (q) => { const u = q.trim(); if (!/^https?:\/\//i.test(u)) throw new Error('Paste a full link starting with https://'); return [u]; } },
  { id: 'googlenews', label: 'Google News search', hint: 'e.g. web3 gaming', build: (q) => [`https://news.google.com/rss/search?q=${enc(q.trim())}&hl=en-US&gl=US&ceid=US:en`] },
  { id: 'hn', label: 'Hacker News', hint: 'keywords, or leave blank for the front page', optional: true,
    build: (q) => (q.trim() ? [`https://hnrss.org/newest?q=${enc(q.trim())}`] : ['https://hnrss.org/frontpage']) },
  { id: 'reddit', label: 'Subreddit (public RSS)', hint: 'e.g. indiegames', help: 'Reddit sometimes rate-limits anonymous readers. A connected Reddit account is more reliable.', build: (q) => [`https://www.reddit.com/r/${clean(q).replace(/^r\//, '')}/.rss`] },
  { id: 'medium', label: 'Medium writer', hint: 'e.g. @loafpickle', build: (q) => [`https://medium.com/feed/@${clean(q).replace(/^https?:\/\/medium\.com\/@?/, '')}`] },
  { id: 'substack', label: 'Substack', hint: 'e.g. platformer', build: (q) => [/^https?:/.test(q) ? `${clean(q)}/feed` : `https://${clean(q)}.substack.com/feed`] },
  { id: 'youtube', label: 'YouTube channel', hint: '@handle or channel link', build: (q) => [`youtube:${q.trim()}`] },
  { id: 'bluesky', label: 'Bluesky profile (public)', hint: 'e.g. pfrazee.com', build: (q) => [`https://bsky.app/profile/${clean(q)}/rss`] },
  { id: 'mastodon', label: 'Mastodon profile', hint: '@user@mastodon.social', build: (q) => {
    const m = clean(q).match(/^([^@]+)@(.+)$/);
    if (!m) throw new Error('Use the format @user@instance.social');
    return [`https://${m[2]}/@${m[1]}.rss`];
  } },
  { id: 'github', label: 'GitHub releases', hint: 'owner/repo', build: (q) => {
    const r = clean(q).replace(/^https?:\/\/github\.com\//, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error('Use owner/repo, e.g. nodejs/node');
    return [`https://github.com/${r}/releases.atom`];
  } },
];

export const publicSources = () => SOURCES.map(({ id, label, hint, help, optional }) => ({ id, label, hint, help, optional: !!optional }));

// ---------- fetching ----------
async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5' }, redirect: 'follow', signal: ctrl.signal });
    if (res.status === 429 && /reddit\.com$/.test(new URL(url).hostname)) {
      throw new Error('Reddit is limiting anonymous feed readers right now. Try again in a while, or connect a Reddit account and add this subreddit from it.');
    }
    if (res.status === 429) throw new Error(`${new URL(url).host} says we're asking too often. Try again in a few minutes.`);
    if (res.status === 404) throw new Error(`Nothing found at ${new URL(url).host}. Check the name or link.`);
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new Error('That feed is too large.');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('That feed is too large.');
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} took too long to answer.`);
    if (e.message?.includes('fetch failed')) throw new Error(`Couldn't reach ${new URL(url).host}.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function resolveYouTube(input) {
  const v = input.trim();
  let m = v.match(/(UC[\w-]{22})/);
  if (m) return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
  const handle = (v.match(/@([\w.-]+)/) || [])[1] || v.replace(/^https?:\/\/(www\.)?youtube\.com\//, '');
  const html = await getText(`https://www.youtube.com/@${handle}`);
  m = html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel_id=(UC[\w-]{22})/) || html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error(`Couldn't find the YouTube channel @${handle}.`);
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
}

// ---------- parsing ----------
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail'].includes(name),
});

const txt = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? all);
const strip = (html) => decode(decode(String(html || '')).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
const firstImg = (html) => (String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1];
// Drop tracking junk (utm_*, Medium's ?source=rss-…) so shared links stay clean.
function cleanUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid|ref_src)$/i.test(k) || (k === 'source' && /^rss/i.test(url.searchParams.get(k)))) url.searchParams.delete(k);
    }
    return url.toString();
  } catch { return u; }
}
const date = (v) => { const d = new Date(txt(v)); return isNaN(d) ? null : d.toISOString(); };

function parse(xml, url) {
  const doc = parser.parse(xml);
  const host = new URL(url).host.replace(/^www\./, '');
  if (doc.rss || doc['rdf:RDF']) {
    const ch = doc.rss?.channel || doc['rdf:RDF']?.channel || {};
    const items = doc.rss?.channel?.item || doc['rdf:RDF']?.item || [];
    // Google News search feeds are titled after the query; show the publisher instead.
    const rawTitle = strip(txt(ch.title));
    const source = /google news/i.test(rawTitle) ? 'Google News' : rawTitle || host;
    return { title: source, items: items.map((it) => {
      const html = txt(it['content:encoded']) || txt(it.description);
      const link = txt(it.link?.[0]) || it.link?.[0]?.['@href'] || txt(it.guid);
      const img = it['media:content']?.find((m) => /image/.test(m['@type'] || 'image') || m['@medium'] === 'image')?.['@url']
        || it['media:thumbnail']?.[0]?.['@url'] || it.enclosure?.find((e) => /^image\//.test(e['@type'] || ''))?.['@url'] || firstImg(html);
      const publisher = strip(txt(it.source));
      let title = strip(txt(it.title));
      if (publisher && title.endsWith(' - ' + publisher)) title = title.slice(0, -(publisher.length + 3));
      let text = strip(html);
      // Google News repeats "Headline - Publisher" as the body; drop the echo.
      if (title && text.startsWith(title)) {
        text = text.slice(title.length).trim();
        if (publisher && text.startsWith(publisher)) text = text.slice(publisher.length).trim();
      }
      return {
        id: txt(it.guid) || link,
        title,
        text: text.slice(0, 500),
        url: cleanUrl(link),
        time: date(it.pubDate || it['dc:date'] || it.published),
        author: publisher || strip(txt(it['dc:creator']) || txt(it.author)) || source,
        handle: source,
        media: img ? [img] : [],
      };
    }) };
  }
  if (doc.feed) {
    const f = doc.feed;
    const source = strip(txt(f.title)) || host;
    return { title: source, items: (f.entry || []).map((e) => {
      const links = e.link || [];
      const link = (links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') || links[0] || {})['@href'] || '';
      const html = txt(e.content) || txt(e.summary) || txt(e['media:group']?.['media:description']);
      const img = e['media:group']?.['media:thumbnail']?.[0]?.['@url'] || e['media:thumbnail']?.[0]?.['@url'] || firstImg(html);
      return {
        id: txt(e.id) || link,
        title: strip(txt(e.title)),
        text: strip(html).slice(0, 500),
        url: cleanUrl(link),
        time: date(e.published || e.updated),
        author: strip(txt(e.author?.name)) || source,
        handle: source,
        media: img ? [img] : [],
      };
    }) };
  }
  throw new Error(`${host} didn't return an RSS or Atom feed.`);
}

async function load(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.feed;
  const bad = failures.get(url);
  if (bad && Date.now() - bad.at < FAIL_MS) throw bad.error;
  try {
    const real = url.startsWith('youtube:') ? await resolveYouTube(url.slice(8)) : url;
    const feed = parse(await getText(real), real);
    cache.set(url, { at: Date.now(), feed });
    failures.delete(url);
    return feed;
  } catch (error) {
    failures.set(url, { at: Date.now(), error });
    if (hit) return hit.feed; // serve the last good copy if we have one
    throw error;
  }
}

// ---------- public API ----------
export function matchesKeywords(item, keywords) {
  const kws = splitKeywords(keywords).map((k) => k.toLowerCase());
  if (!kws.length) return true;
  const hay = `${item.title || ''} ${item.text || ''}`.toLowerCase();
  return kws.some((k) => hay.includes(k));
}

export function urlsFor(feed) {
  const src = SOURCES.find((s) => s.id === feed.source);
  if (!src) throw new Error('Unknown feed type.');
  if (!feed.query?.trim() && !src.optional) throw new Error(`Fill in: ${src.hint}`);
  return src.build(feed.query || '');
}

export async function webItems(feed) {
  const urls = urlsFor(feed);
  const results = await Promise.allSettled(urls.map(load));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw new Error(results[0].reason?.message || 'Feed failed to load.');
  const seen = new Set();
  const items = ok.flatMap((f) => f.items)
    .filter((it) => it.url && !seen.has(it.url) && seen.add(it.url))
    .filter((it) => feed.source === 'topic' || matchesKeywords(it, feed.keywords))
    .sort((a, b) => (Date.parse(b.time || 0) || 0) - (Date.parse(a.time || 0) || 0))
    .slice(0, 60);
  return { items, title: ok.length === 1 ? ok[0].title : null };
}

// Used when a feed is added, so a typo fails right away instead of later.
export async function probe(feed) {
  const r = await webItems(feed);
  return r.title;
}
