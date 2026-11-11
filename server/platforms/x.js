// X (Twitter) API v2 with OAuth 1.0a user context (the four keys from the developer portal).
import crypto from 'node:crypto';
import { request } from '../http.js';

const API = 'https://api.x.com';

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Signs a request. Only query params (and form-urlencoded bodies) go into the signature;
// JSON and multipart bodies do not, per the OAuth 1.0a spec.
export function oauth1Header(method, url, c, formParams = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: c.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: c.accessToken,
    oauth_version: '1.0',
  };
  const all = { ...Object.fromEntries(u.searchParams), ...formParams, ...oauth };
  const paramStr = Object.keys(all).sort().map((k) => `${enc(k)}=${enc(all[k])}`).join('&');
  const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(paramStr)].join('&');
  const key = `${enc(c.apiSecret)}&${enc(c.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => `${enc(k)}="${enc(oauth[k])}"`).join(', ');
}

async function call(account, method, path, { json, formData, query } = {}) {
  const url = API + path + (query ? '?' + new URLSearchParams(query) : '');
  const headers = { Authorization: oauth1Header(method, url, account.credentials) };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (formData) body = formData;
  return request(url, { method, headers, body }, 'X');
}

async function me(account) {
  if (account.credentials._userId) return account.credentials._userId;
  const r = await call(account, 'GET', '/2/users/me');
  account.credentials._userId = r.data.id;
  return r.data.id;
}

function normalize(t, users) {
  const u = users?.find((x) => x.id === t.author_id) || {};
  return {
    id: t.id,
    author: u.name || 'X user',
    handle: u.username ? '@' + u.username : '',
    avatar: u.profile_image_url,
    text: t.text,
    media: [],
    url: `https://x.com/${u.username || 'i'}/status/${t.id}`,
    time: t.created_at,
    stats: { likes: t.public_metrics?.like_count, reposts: t.public_metrics?.retweet_count, replies: t.public_metrics?.reply_count },
  };
}

export default {
  id: 'x',
  name: 'X / Twitter',
  limits: { text: 280, images: 4, video: false },
  fields: [
    { key: 'apiKey', label: 'API Key (Consumer Key)', secret: true },
    { key: 'apiSecret', label: 'API Key Secret', secret: true },
    { key: 'accessToken', label: 'Access Token', secret: true },
    { key: 'accessSecret', label: 'Access Token Secret', secret: true },
  ],
  feedTypes: [
    { id: 'mine', label: 'My posts' },
    { id: 'home', label: 'Home timeline (paid tiers)' },
    { id: 'search', label: 'Recent search (paid tiers)', query: 'search query' },
  ],

  async verify(account) {
    delete account.credentials._userId;
    const r = await call(account, 'GET', '/2/users/me', { query: { 'user.fields': 'profile_image_url,name,username' } });
    account.credentials._userId = r.data.id;
    return { profile: { handle: '@' + r.data.username, name: r.data.name, avatar: r.data.profile_image_url, url: `https://x.com/${r.data.username}` } };
  },

  async publish({ account, text, media }) {
    if (media.some((m) => m.mime.startsWith('video/'))) throw new Error('X video upload is not supported yet in Toasty Posty. Images only (up to 4).');
    const mediaIds = [];
    for (const m of media.slice(0, 4)) {
      const fd = new FormData();
      fd.append('media', new Blob([m.data], { type: m.mime }), m.name);
      fd.append('media_category', 'tweet_image');
      const up = await call(account, 'POST', '/2/media/upload', { formData: fd });
      const mid = up.data?.id || up.media_id_string;
      mediaIds.push(mid);
      if (m.alt) {
        await call(account, 'POST', '/2/media/metadata', { json: { id: mid, metadata: { alt_text: { text: m.alt.slice(0, 1000) } } } }).catch(() => {});
      }
    }
    const r = await call(account, 'POST', '/2/tweets', { json: { text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) } });
    return { remoteId: r.data.id, url: `https://x.com/i/status/${r.data.id}` };
  },

  async feed({ account, feed }) {
    const query = { max_results: '20', 'tweet.fields': 'created_at,public_metrics,author_id', expansions: 'author_id', 'user.fields': 'profile_image_url,username,name' };
    let r;
    if (feed.type === 'search') r = await call(account, 'GET', '/2/tweets/search/recent', { query: { ...query, query: feed.query } });
    else {
      const uid = await me(account);
      r = await call(account, 'GET', feed.type === 'home' ? `/2/users/${uid}/timelines/reverse_chronological` : `/2/users/${uid}/tweets`, { query });
    }
    return (r.data || []).map((t) => normalize(t, r.includes?.users));
  },
};
