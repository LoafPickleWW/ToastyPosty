// Product link previews: paste an affiliate link (LTK, ShopMy, rstyle.me, a store page…) and get back
// the product's name, brand, price and photo. Follows the link's redirects to the store page and reads the
// structured data stores publish for search engines (JSON-LD Product), falling back to Open Graph tags.
// The caller keeps the ORIGINAL link for posting, so the referral/commission tracking is never lost.
import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'Mozilla/5.0 (compatible; ToastyPosty/1.0; +https://github.com/LoafPickleWW) link preview';
const MAX_HTML = 2 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_HOPS = 8;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// ---------- Only public internet addresses (no localhost, no private network) ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}
async function checkPublic(u) {
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('Only http and https links work.');
  if (u.port && !['80', '443'].includes(u.port)) throw bad('That link uses an unusual port.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw bad('That isn’t a public web address.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw bad(`Couldn’t find ${host}. Check the link.`); });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw bad('That isn’t a public web address.');
}

// Follow redirects ourselves so every hop gets the same check.
async function fetchPublic(raw, { accept, timeout = 9000 } = {}) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw bad('That doesn’t look like a link.'); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      await checkPublic(u);
      const res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        res.body?.cancel().catch(() => {});
        u = new URL(res.headers.get('location'), u);
        continue;
      }
      return { res, url: u.toString(), timer };
    }
    throw bad('That link redirects too many times.');
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw bad('The store took too long to answer.', 502);
    throw e;
  }
}

async function readCapped(res, max) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// ---------- Parsing ----------
const decode = (s = '') => s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
}).replace(/\s+/g, ' ').trim();

function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && val != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decode(val);
  }
  return out;
}

function jsonLdProducts(html) {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = [].concat(n['@type'] || []).map(String);
    if (t.some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(x))) found.push(n);
    if (n['@graph']) walk(n['@graph']);
    if (n.mainEntity) walk(n.mainEntity);
    if (n.itemListElement) walk([].concat(n.itemListElement).map((x) => x.item || x));
  };
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''))); } catch {}
  }
  return found;
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const imgOf = (v) => { const x = first(v); return typeof x === 'string' ? x : x?.url || x?.contentUrl || ''; };
const brandOf = (v) => { const x = first(v); return typeof x === 'string' ? x : x?.name || ''; };
function offerOf(p) {
  const offers = [].concat(p.offers || [], ...(p.hasVariant ? [].concat(p.hasVariant).map((v) => v.offers || []) : []));
  for (const o of offers.flatMap((x) => (x?.offers ? [].concat(x.offers) : [x]))) {
    const price = o?.price ?? o?.lowPrice ?? o?.priceSpecification?.price;
    if (price != null && price !== '') return { price: String(price), currency: o.priceCurrency || o.priceSpecification?.priceCurrency || '' };
  }
  return {};
}

const SITE_SUFFIX = /\s*[|\-–—:]\s*[^|\-–—:]{2,40}$/; // "Linen Shirt | Abercrombie" -> "Linen Shirt"
function parse(html, finalUrl) {
  const meta = metaTags(html);
  const p = jsonLdProducts(html)[0];
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const site = meta['og:site_name'] || host;
  let name = decode(p?.name || '') || meta['og:title'] || meta['twitter:title'] || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
  if (!p?.name && site && name.toLowerCase().endsWith(site.toLowerCase())) name = name.replace(SITE_SUFFIX, '');
  const offer = p ? offerOf(p) : {};
  const price = offer.price || meta['product:price:amount'] || meta['og:price:amount'] || '';
  const currency = offer.currency || meta['product:price:currency'] || meta['og:price:currency'] || '';
  // og:image is usually the big hero shot; JSON-LD images are often thumbnails (Shopify sends width=100).
  let image = meta['og:image:secure_url'] || meta['og:image'] || imgOf(p?.image) || meta['twitter:image'] || meta['twitter:image:src'] || '';
  if (image) {
    try {
      const iu = new URL(image, finalUrl);
      for (const k of ['width', 'height', 'w', 'h']) if (Number(iu.searchParams.get(k)) && Number(iu.searchParams.get(k)) < 800) iu.searchParams.delete(k);
      if (iu.protocol === 'http:') iu.protocol = 'https:';
      image = iu.toString();
    } catch { image = ''; }
  }
  return {
    name: name.slice(0, 140),
    brand: decode(brandOf(p?.brand) || meta['product:brand'] || meta['og:brand'] || '').slice(0, 60),
    price: price ? String(price).replace(/[^\d.,]/g, '') : '',
    currency,
    image,
    site,
    finalUrl,
    found: !!p,
  };
}

export async function unfurl(url) {
  const { res, url: finalUrl, timer } = await fetchPublic(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' });
  try {
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw bad(res.status === 403 || res.status === 429 || res.status === 503
        ? `${new URL(finalUrl).hostname} blocks automatic previews. Fill in the product details yourself.`
        : `The store answered ${res.status}. Check the link.`, 502);
    }
    if (!/html|xml/i.test(res.headers.get('content-type') || '')) throw bad('That link isn’t a web page.');
    const html = (await readCapped(res, MAX_HTML)).toString('utf8');
    const out = parse(html, finalUrl);
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    if (/captcha|robot check|are you a robot|client challenge|just a moment|access denied|attention required|pardon our interruption/i.test(out.name) || (!out.name && !out.image)) {
      throw bad(`${host} blocks automatic previews. Fill in the product details yourself.`, 502);
    }
    if (!out.found && /^\/?$/.test(new URL(finalUrl).pathname)) {
      throw bad(`That link went to ${host}’s home page, so the product may be sold out or gone.`, 502);
    }
    out.name = out.name.replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*[A-Z][\w &,']{2,40}$/, '');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// Product photos for the Video Studio: browsers can't read pixels from other sites, so it comes through here.
export async function image(url) {
  const { res, timer } = await fetchPublic(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
  try {
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) { res.body?.cancel().catch(() => {}); throw bad('Couldn’t load that product photo.', 502); }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE) { res.body?.cancel().catch(() => {}); throw bad('That product photo is too big.'); }
    const buf = await readCapped(res, MAX_IMAGE + 1);
    if (buf.length > MAX_IMAGE) throw bad('That product photo is too big.');
    return { type: type.split(';')[0], data: buf };
  } finally {
    clearTimeout(timer);
  }
}

export const _test = { parse, privateIp };
