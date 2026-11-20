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
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    const blocked = `${host} blocks automatic previews`;
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      if (res.status === 403 || res.status === 429 || res.status === 503) return fromUrlOnly(finalUrl, blocked);
      throw bad(`The store answered ${res.status}. Check the link.`, 502);
    }
    if (!/html|xml/i.test(res.headers.get('content-type') || '')) throw bad('That link isn’t a web page.');
    const html = (await readCapped(res, MAX_HTML)).toString('utf8');
    const out = parse(html, finalUrl);
    if (/captcha|robot check|are you a robot|client challenge|just a moment|access denied|attention required|pardon our interruption/i.test(out.name) || (!out.name && !out.image)) {
      return fromUrlOnly(finalUrl, blocked);
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

// When a store blocks previews (Nordstrom, Abercrombie…), the product name is often still in its address:
// nordstrom.com/s/andrew-marc-bubble-leather-moto-jacket/5434113 -> "Andrew Marc Bubble Leather Moto Jacket".
const GENERIC = new Set(['products', 'product', 'shop', 'p', 's', 'dp', 'item', 'items', 'us', 'en', 'en-us', 'womens', 'mens', 'women', 'men', 'clothing', 'html']);
export function nameFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const segs = u.pathname.split('/').map((x) => { try { return decodeURIComponent(x); } catch { return x; } })
    .map((x) => x.replace(/\.(html?|aspx?|php)$/i, ''))
    .filter((x) => /[a-z]{3,}[-_+][a-z]/i.test(x) && !GENERIC.has(x.toLowerCase()));
  const best = segs.sort((a, b) => b.length - a.length)[0];
  if (!best) return '';
  const words = best.split(/[-_+\s]+/).filter((w) => w && !/^\d+$/.test(w) && !/^(?=.*\d)[a-z\d]{6,}$/i.test(w)); // drop ids like 5434113, ab12cd34
  const small = new Set(['and', 'or', 'of', 'the', 'in', 'with', 'for', 'a', 'to']);
  return words.map((w, i) => (i && small.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ').slice(0, 140);
}
function fromUrlOnly(finalUrl, reason) {
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const name = nameFromUrl(finalUrl);
  if (!name) throw bad(`${reason}. Fill in the product details yourself.`, 502);
  return { name, brand: '', price: '', currency: '', image: '', site: host, finalUrl, found: false, partial: true, note: `${reason}, so only the name came through (from the link). Add the price and a photo yourself.` };
}

function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('latin1', 4, 8) === 'ftyp' && /avif|avis/.test(b.toString('latin1', 8, 12))) return 'image/avif';
  return null;
}

// Product photos for the Video Studio: browsers can't read pixels from other sites, so it comes through here.
export async function image(url) {
  const { res, timer } = await fetchPublic(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
  try {
    const declared = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok || /^(text|application\/(json|xml|javascript))/i.test(declared)) { res.body?.cancel().catch(() => {}); throw bad('Couldn’t load that product photo.', 502); }
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE) { res.body?.cancel().catch(() => {}); throw bad('That product photo is too big.'); }
    const buf = await readCapped(res, MAX_IMAGE + 1);
    if (buf.length > MAX_IMAGE) throw bad('That product photo is too big.');
    // Some hosts label photos loosely ("jpeg", "binary/octet-stream"), so trust the file's own bytes.
    const type = sniffImage(buf);
    if (!type) throw bad('That link isn’t a photo.', 502);
    return { type, data: buf };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- ShopMy collections (opt-in) ----------
// A shopmy.us/collections/<id> page is an empty app shell; its products come from ShopMy's own app data
// endpoint, which isn't an official API. Only used when the person turns it on in Settings, and only the
// product details are passed back: nothing about the collection's owner.
const SHOPMY_COLLECTION = /^https?:\/\/(?:www\.)?shopmy\.us\/(?:shop\/)?collections\/(?:public\/|quick\/|embed\/)?(\d+)/i;
export const isShopMyCollection = (url) => SHOPMY_COLLECTION.test(String(url || '').trim());

// ShopMy stores photos in a locked bucket and serves them from its image CDN.
function shopmyImage(u) {
  const m = String(u).match(/^https:\/\/production-shopmyshelf-(uploads|pins)\.s3[.-][a-z0-9-]*\.?amazonaws\.com\/(.+)$/i);
  if (!m) return u;
  return m[1].toLowerCase() === 'pins' ? `https://static.shopmy.us/pins/${m[2]}` : `https://img.shopmy.us/${m[2]}`;
}

export async function collection(url) {
  const m = String(url || '').trim().match(SHOPMY_COLLECTION);
  if (!m) throw bad('That isn’t a ShopMy collection link (shopmy.us/collections/…).');
  const { res, timer } = await fetchPublic(`https://apiv3.shopmy.us/api/Collections/${m[1]}`, { accept: 'application/json' });
  let d;
  try {
    if (res.status === 404) throw bad('ShopMy couldn’t find that collection. It may be private or deleted.', 502);
    if (!res.ok) throw bad(`ShopMy answered ${res.status}. Try again in a bit, or paste the product links instead.`, 502);
    d = JSON.parse((await readCapped(res, MAX_HTML * 2)).toString('utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) throw bad('ShopMy sent something we couldn’t read. It may have changed how collections load; paste the product links instead.', 502);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (d.private) throw bad('That collection is private.');
  const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const items = (Array.isArray(d.pins) ? d.pins : [])
    .filter((p) => p && !p.isHidden && p.id)
    .slice(0, 150)
    .map((p) => {
      const pr = p.product || {};
      const t = lines(p.title);
      const brand = pr.AllBrand_name || (t.length > 1 ? t[0] : '');
      const store = p.merchant_data?.name || p.domain || '';
      const amazon = /(^|\.)amazon\./i.test(p.domain || '') || /amazon/i.test(store);
      const price = pr.fallbackPrice != null && !amazon ? String(pr.fallbackPrice) : '';
      return {
        name: (pr.title || (t.length > 1 ? t.slice(1).join(' ') : t[0]) || '').slice(0, 140),
        brand: String(brand).slice(0, 60),
        price: price && (pr.fallbackPriceCurrency || 'USD') !== 'USD' ? `${price} ${pr.fallbackPriceCurrency}` : price,
        image: amazon ? '' : shopmyImage(pr.image || p.image || ''),
        url: `https://go.shopmy.us/p-${p.id}`, // the creator's own tracking link for this product
        store,
        category: pr.Category_name || '',
      };
    })
    .filter((x) => x.name);
  if (!items.length) throw bad('That collection has no products we could read.', 502);
  return { title: String(d.name || 'ShopMy collection').slice(0, 120), description: String(d.description || '').slice(0, 300), source: 'ShopMy', items };
}

export const _test = { parse, privateIp };
