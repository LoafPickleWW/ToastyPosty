// Bluesky via the AT Protocol. Auth = handle + App Password (never your main password).
import { request } from '../http.js';

const sessions = new Map(); // accountId -> { accessJwt, refreshJwt, did, at }

const svc = (c) => (c.service || 'https://bsky.social').replace(/\/$/, '');

// Accept what people actually paste: "@you", "you", a bsky.app profile link, stray spaces.
function cleanIdentifier(raw = '') {
  let id = String(raw).trim().replace(/^https?:\/\/(www\.)?bsky\.app\/profile\//i, '').replace(/\/.*$/, '').replace(/^@/, '').trim();
  if (id && !id.includes('@') && !id.includes('.') && !id.startsWith('did:')) id += '.bsky.social';
  return id.toLowerCase();
}

async function createSession(c) {
  const identifier = cleanIdentifier(c.identifier);
  const password = String(c.appPassword || '').trim();
  if (!identifier || !password) throw Object.assign(new Error('Bluesky login: enter both your handle and an App Password.'), { status: 400 });
  try {
    return await request(`${svc(c)}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    }, 'Bluesky login');
  } catch (e) {
    const code = e.body?.error;
    if (code === 'AuthenticationRequired') {
      e.message = `Bluesky login failed for "${identifier}": handle or App Password is wrong. Use your full handle (e.g. you.bsky.social) and an App Password from bsky.app → Settings → Privacy and security → App passwords — not your normal password.`;
    } else if (code === 'AuthFactorTokenRequired') {
      e.message = 'Bluesky asked for an email sign-in code, which means your normal password was used. Create an App Password (xxxx-xxxx-xxxx-xxxx) and paste that instead.';
    } else if (code === 'AccountTakedown' || code === 'AccountDeactivated') {
      e.message = `Bluesky login: this account is ${code === 'AccountTakedown' ? 'suspended' : 'deactivated'}.`;
    }
    throw e;
  }
}

async function session(account) {
  const s = sessions.get(account.id);
  if (s && Date.now() - s.at < 60 * 60 * 1000) return s;
  const fresh = await createSession(account.credentials);
  const v = { ...fresh, at: Date.now() };
  sessions.set(account.id, v);
  return v;
}

async function xrpc(account, method, nsid, { params, body, headers } = {}) {
  const s = await session(account);
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const opts = { method, headers: { Authorization: `Bearer ${s.accessJwt}`, ...(headers || {}) } };
  if (body !== undefined) {
    opts.body = body instanceof Buffer ? body : JSON.stringify(body);
    if (!(body instanceof Buffer)) opts.headers['Content-Type'] = 'application/json';
  }
  return request(`${svc(account.credentials)}/xrpc/${nsid}${qs}`, opts, 'Bluesky');
}

// Links + hashtags become clickable "facets" (byte offsets, not char offsets).
function facets(text) {
  const enc = new TextEncoder();
  const out = [];
  const re = /(https?:\/\/[^\s)\]]+)|(^|\s)(#[^\s#.,!?;:)\]]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) {
      const start = enc.encode(text.slice(0, m.index)).length;
      out.push({ index: { byteStart: start, byteEnd: start + enc.encode(m[1]).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[1] }] });
    } else if (m[3]) {
      const idx = m.index + m[2].length;
      const start = enc.encode(text.slice(0, idx)).length;
      out.push({ index: { byteStart: start, byteEnd: start + enc.encode(m[3]).length }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[3].slice(1) }] });
    }
  }
  return out;
}

const postUrl = (uri) => {
  const [did, , rkey] = uri.replace('at://', '').split('/');
  return did && rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : null;
};

function normalize(item) {
  const p = item.post;
  const imgs = p.embed?.images || p.embed?.media?.images || [];
  return {
    id: p.uri,
    author: p.author.displayName || p.author.handle,
    handle: '@' + p.author.handle,
    avatar: p.author.avatar,
    text: p.record?.text || '',
    media: imgs.map((i) => i.thumb),
    url: postUrl(p.uri),
    time: p.indexedAt,
    stats: { likes: p.likeCount, reposts: p.repostCount, replies: p.replyCount },
    repostBy: item.reason?.by ? item.reason.by.handle : null,
  };
}

export default {
  id: 'bluesky',
  name: 'Bluesky',
  limits: { text: 300, images: 4, video: false },
  fields: [
    { key: 'identifier', label: 'Handle', placeholder: 'you.bsky.social' },
    { key: 'appPassword', label: 'App Password', secret: true, placeholder: 'xxxx-xxxx-xxxx-xxxx' },
    { key: 'service', label: 'PDS URL', placeholder: 'https://bsky.social', optional: true },
  ],
  feedTypes: [
    { id: 'timeline', label: 'My following timeline' },
    { id: 'author', label: 'A user’s posts', query: 'handle (e.g. pfrazee.com)' },
    { id: 'search', label: 'Search posts', query: 'search terms or #tag' },
  ],

  async verify(account) {
    sessions.delete(account.id);
    const s = await session(account);
    const prof = await xrpc(account, 'GET', 'app.bsky.actor.getProfile', { params: { actor: s.did } });
    return { profile: { handle: '@' + prof.handle, name: prof.displayName || prof.handle, avatar: prof.avatar, url: `https://bsky.app/profile/${prof.handle}` } };
  },

  async publish({ account, text, media }) {
    if (media.some((m) => m.mime.startsWith('video/'))) throw new Error('Bluesky video uploads are not supported yet. Use images (up to 4).');
    const s = await session(account);
    const images = [];
    for (const m of media.slice(0, 4)) {
      if (m.size > 1_000_000) throw new Error(`"${m.name}" is ${(m.size / 1e6).toFixed(2)}MB; Bluesky images must be under 1MB.`);
      const blob = await xrpc(account, 'POST', 'com.atproto.repo.uploadBlob', { body: m.data, headers: { 'Content-Type': m.mime } });
      images.push({ alt: m.alt || '', image: blob.blob, ...(m.width ? { aspectRatio: { width: m.width, height: m.height } } : {}) });
    }
    const record = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      langs: ['en'],
      facets: facets(text),
      ...(images.length ? { embed: { $type: 'app.bsky.embed.images', images } } : {}),
    };
    const res = await xrpc(account, 'POST', 'com.atproto.repo.createRecord', { body: { repo: s.did, collection: 'app.bsky.feed.post', record } });
    return { remoteId: res.uri, url: postUrl(res.uri) };
  },

  async feed({ account, feed }) {
    let res;
    if (feed.type === 'author') res = await xrpc(account, 'GET', 'app.bsky.feed.getAuthorFeed', { params: { actor: feed.query.replace(/^@/, ''), limit: 30 } });
    else if (feed.type === 'search') {
      res = await xrpc(account, 'GET', 'app.bsky.feed.searchPosts', { params: { q: feed.query, limit: 30, sort: 'latest' } });
      return res.posts.map((post) => normalize({ post }));
    } else res = await xrpc(account, 'GET', 'app.bsky.feed.getTimeline', { params: { limit: 30 } });
    return res.feed.map(normalize);
  },
};
