// Reddit via a personal "script" app (password grant). Supports text, link, and single-image posts.
import { request, form } from '../http.js';

const tokens = new Map(); // accountId -> { token, exp }

const ua = (c) => `web:toasty-posty:v1.0 (by /u/${c.username || 'unknown'})`;

async function token(account) {
  const t = tokens.get(account.id);
  if (t && t.exp > Date.now() + 60_000) return t.token;
  const c = account.credentials;
  const r = await request('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua(c),
    },
    body: form({ grant_type: 'password', username: c.username, password: c.password }),
  }, 'Reddit login');
  if (!r.access_token) throw new Error('Reddit login: ' + (r.error || 'no token returned (check username/password; 2FA accounts need the password as password:123456).'));
  tokens.set(account.id, { token: r.access_token, exp: Date.now() + r.expires_in * 1000 });
  return r.access_token;
}

async function api(account, method, path, body) {
  const t = await token(account);
  return request('https://oauth.reddit.com' + path, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'User-Agent': ua(account.credentials), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: body ? form(body) : undefined,
  }, 'Reddit');
}

// Native image upload: lease an upload slot, push the file to Reddit's media bucket, submit kind=image.
async function uploadImage(account, m) {
  const lease = await api(account, 'POST', '/api/media/asset.json', { filepath: m.name, mimetype: m.mime });
  const action = 'https:' + lease.args.action.replace(/^https?:/, '');
  const fd = new FormData();
  let key = '';
  for (const f of lease.args.fields) {
    fd.append(f.name, f.value);
    if (f.name === 'key') key = f.value;
  }
  fd.append('file', new Blob([m.data], { type: m.mime }), m.name);
  const up = await fetch(action, { method: 'POST', body: fd });
  if (!up.ok) throw new Error(`Reddit media upload failed (${up.status}).`);
  return `${action}/${key}`;
}

function normalize({ data: d }) {
  const img = d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&');
  return {
    id: d.name,
    author: 'u/' + d.author,
    handle: 'r/' + d.subreddit,
    title: d.title,
    text: d.selftext?.slice(0, 600) || '',
    media: img ? [img] : [],
    url: 'https://www.reddit.com' + d.permalink,
    time: new Date(d.created_utc * 1000).toISOString(),
    stats: { score: d.score, comments: d.num_comments },
  };
}

export default {
  id: 'reddit',
  name: 'Reddit',
  limits: { text: 40000, title: 300, images: 1, video: false },
  fields: [
    { key: 'clientId', label: 'Client ID', placeholder: 'the string under "personal use script"' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
    { key: 'username', label: 'Reddit Username', placeholder: 'without u/' },
    { key: 'password', label: 'Reddit Password', secret: true },
    { key: 'defaultSubreddit', label: 'Default Subreddit', placeholder: 'u_yourname or a sub you mod', optional: true },
  ],
  feedTypes: [
    { id: 'subreddit', label: 'Subreddit (hot)', query: 'subreddit name, no r/' },
    { id: 'new', label: 'Subreddit (new)', query: 'subreddit name, no r/' },
    { id: 'mine', label: 'My submissions' },
    { id: 'home', label: 'My front page' },
  ],

  async verify(account) {
    tokens.delete(account.id);
    const me = await api(account, 'GET', '/api/v1/me');
    return { profile: { handle: 'u/' + me.name, name: me.name, avatar: me.icon_img?.split('?')[0], url: `https://www.reddit.com/user/${me.name}` } };
  },

  async publish({ account, text, options = {}, media }) {
    const sr = (options.subreddit || account.credentials.defaultSubreddit || `u_${account.credentials.username}`).replace(/^\/?r\//, '');
    let title = (options.title || '').trim();
    let body = text;
    if (!title) {
      const [first, ...rest] = text.split('\n');
      title = first.slice(0, 300);
      body = rest.join('\n').trim();
    }
    if (!title) throw new Error('Reddit posts need a title.');
    const sub = { sr, title, api_type: 'json', resubmit: 'true', sendreplies: 'true' };
    if (options.flairId) sub.flair_id = options.flairId;
    const img = media.find((m) => m.mime.startsWith('image/'));
    const link = !img && body.match(/^https?:\/\/\S+$/) ? body : null;
    if (img) Object.assign(sub, { kind: 'image', url: await uploadImage(account, img) });
    else if (link) Object.assign(sub, { kind: 'link', url: link });
    else Object.assign(sub, { kind: 'self', text: body });
    const r = await api(account, 'POST', '/api/submit', sub);
    if (r.json?.errors?.length) throw new Error('Reddit: ' + r.json.errors.map((e) => e.slice(1).join(' ')).join('; '));
    const url = r.json?.data?.url || `https://www.reddit.com/r/${sr}/new`;
    return { remoteId: r.json?.data?.name || null, url };
  },

  async feed({ account, feed }) {
    const q = (feed.query || '').replace(/^\/?r\//, '');
    const path =
      feed.type === 'mine' ? `/user/${account.credentials.username}/submitted?limit=25`
      : feed.type === 'home' ? '/best?limit=25'
      : feed.type === 'new' ? `/r/${q}/new?limit=25`
      : `/r/${q}/hot?limit=25`;
    const r = await api(account, 'GET', path);
    return r.data.children.filter((c) => c.kind === 't3').map(normalize);
  },
};
