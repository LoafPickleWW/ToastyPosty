// Shoppable posts: affiliate product links, the per-platform "shop" block, and the #ad disclosure.
// Used by the Compose previews and at publish time, so what you see is exactly what goes out.

export const NETWORKS = [
  { id: 'amazon', name: 'Amazon', test: (h) => /(^|\.)amazon\.[a-z.]{2,6}$/.test(h) || ['amzn.to', 'amzn.eu', 'a.co'].includes(h) },
  { id: 'ltk', name: 'LTK', test: (h) => /(^|\.)(liketk\.it|shopltk\.com|liketoknow\.it|rstyle\.me)$/.test(h) },
  { id: 'shopmy', name: 'ShopMy', test: (h) => /(^|\.)shopmy\.us$/.test(h) },
  { id: 'tiktokshop', name: 'TikTok Shop', test: (h) => /(^|\.)(shop\.tiktok\.com|vt\.tiktok\.com)$/.test(h) },
];

const host = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
export const networkOf = (url) => NETWORKS.find((n) => n.test(host(url)))?.id || (host(url) ? 'other' : null);
export const networkName = (id) => NETWORKS.find((n) => n.id === id)?.name || 'Link';
export const isAmazon = (url) => networkOf(url) === 'amazon';

export function cleanUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { return new URL(s).toString(); } catch { return ''; }
}

// Amazon long links get your Associates tag. Short amzn.to links already carry the tag they were made with.
export function withAmazonTag(url, tag) {
  if (!tag || !url) return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)amazon\.[a-z.]{2,6}$/.test(u.hostname.toLowerCase().replace(/^www\./, ''))) return url;
    u.searchParams.set('tag', tag.trim());
    return u.toString();
  } catch { return url; }
}

// Links are clickable in captions on these; Instagram and TikTok captions show URLs as plain text.
export const CLICKABLE = { x: true, bluesky: true, reddit: true, instagram: false, tiktok: false };

export const CTAS = [
  ['bio', 'Link in bio'],
  ['comment', 'Comment a keyword'],
  ['list', 'Just list them'],
  ['none', 'Nothing'],
];

export const blankShop = () => ({ products: [], cta: 'bio', keyword: 'SHOP', disclose: true, list: true });

// Amazon's program doesn't allow prices you typed yourself (they go stale), so we leave those out.
export const showPrice = (p) => !!p.price && !isAmazon(p.url);
const fmtPrice = (p) => {
  const v = String(p.price).trim();
  return /^[\d.,]+$/.test(v) ? '$' + v : v;
};
const label = (p) => [p.name?.trim(), p.brand?.trim() && `(${p.brand.trim()})`, showPrice(p) && fmtPrice(p)].filter(Boolean).join(' ');

export function disclosureFor(shop, settings = {}) {
  if (!shop?.disclose || !shop.products?.length) return '';
  const base = (settings.disclosure || '').trim() || '#ad I earn a commission from links in this post.';
  const amazon = shop.products.some((p) => isAmazon(p.url));
  const amz = (settings.amazonDisclosure || '').trim() || '#CommissionsEarned';
  return amazon && !base.toLowerCase().includes(amz.toLowerCase()) ? `${base} ${amz}` : base;
}

export function productUrl(p, settings = {}) {
  return withAmazonTag(p.url, settings.amazonTag);
}

// The block that goes under the caption on one platform.
export function shopBlock(shop, pid, settings = {}) {
  const items = (shop?.products || []).filter((p) => p.name?.trim() || p.url);
  if (!items.length) return '';
  const clickable = CLICKABLE[pid] ?? true;
  const shopUrl = (settings.shopUrl || '').trim();
  const lines = [];
  if (shop.list !== false) {
    items.forEach((p, i) => {
      const name = label(p) || `Item ${i + 1}`;
      lines.push(clickable && p.url ? `${i + 1}. ${name} ${productUrl(p, settings)}` : `${i + 1}. ${name}`);
    });
  }
  const kw = (shop.keyword || 'SHOP').trim().toUpperCase();
  if (shop.cta === 'bio') lines.push(clickable && shopUrl ? `Shop everything: ${shopUrl}` : '🔗 Shop it: link in bio');
  if (shop.cta === 'comment') lines.push(`💬 Comment "${kw}" and I’ll send you the links`);
  return lines.join('\n');
}

// Final text for one platform: disclosure first (so it shows before "...more"), then the post, then the shop block.
export function finalText(text, pid, shop, settings = {}) {
  const parts = [];
  const d = disclosureFor(shop, settings);
  if (d && !text.includes(d)) parts.push(d);
  parts.push(text.trim());
  const block = shopBlock(shop, pid, settings);
  if (block) parts.push(block);
  return parts.filter(Boolean).join('\n\n');
}

// Pasted affiliate links in the text itself also need a disclosure.
export function affiliateLinksIn(text) {
  return (String(text).match(/https?:\/\/\S+/g) || []).filter((u) => ['amazon', 'ltk', 'shopmy', 'tiktokshop'].includes(networkOf(u)) || /[?&](tag|aff|affiliate|ref|irclickid|clickid)=/i.test(u));
}
