// Instagram Graph API with Instagram Login (professional accounts: Business or Creator).
// Instagram pulls media from a PUBLIC URL; the browser hosts each file first (Vercel Blob or your tunnel) and sends us m.publicUrl.
import { request, sleep } from '../http.js';

const base = (c) => `https://graph.instagram.com${c.apiVersion ? '/' + c.apiVersion.replace(/^\/?/, '') : ''}`;

async function ig(account, method, path, params = {}) {
  const c = account.credentials;
  const qs = new URLSearchParams({ ...params, access_token: c.accessToken });
  const url = `${base(c)}${path}${method === 'GET' ? '?' + qs : ''}`;
  return request(url, method === 'GET' ? {} : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs }, 'Instagram');
}

async function waitReady(account, containerId, video) {
  const tries = video ? 60 : 15;
  for (let i = 0; i < tries; i++) {
    const s = await ig(account, 'GET', `/${containerId}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram could not process the media (${s.status || s.status_code}).`);
    await sleep(video ? 5000 : 2000);
  }
  throw new Error('Instagram took too long to process the media.');
}

export default {
  id: 'instagram',
  name: 'Instagram',
  limits: { text: 2200, images: 10, video: true, requiresMedia: true, needsPublicUrl: true },
  fields: [
    { key: 'accessToken', label: 'Instagram User Access Token', secret: true, placeholder: 'IGAA…' },
    { key: 'apiVersion', label: 'Graph API version', placeholder: 'leave blank for default', optional: true },
  ],
  feedTypes: [{ id: 'mine', label: 'My recent posts' }],

  async verify(account) {
    const me = await ig(account, 'GET', '/me', { fields: 'user_id,username,name,profile_picture_url' });
    account.credentials._igUserId = me.user_id || me.id;
    return { profile: { handle: '@' + me.username, name: me.name || me.username, avatar: me.profile_picture_url, url: `https://instagram.com/${me.username}` } };
  },

  // Long-lived tokens last ~60 days; refresh pushes that out again.
  async refresh(account) {
    const r = await request(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(account.credentials.accessToken)}`, {}, 'Instagram refresh');
    account.credentials.accessToken = r.access_token;
    account.credentials._expiresAt = Date.now() + r.expires_in * 1000;
  },

  async publish({ account, text, media }) {
    if (!media.length) throw new Error('Instagram posts need at least one image or video.');
    if (media.some((m) => !m.publicUrl)) throw new Error('Instagram needs your media at a public address. See Settings → Public media.');
    if (!account.credentials._igUserId) await this.verify(account);
    const uid = account.credentials._igUserId;
    const urlFor = (m) => m.publicUrl;
    let creation;
    if (media.length === 1) {
      const m = media[0];
      const isVideo = m.mime.startsWith('video/');
      const c = await ig(account, 'POST', `/${uid}/media`, isVideo ? { media_type: 'REELS', video_url: urlFor(m), caption: text } : { image_url: urlFor(m), caption: text, ...(m.alt ? { alt_text: m.alt } : {}) });
      await waitReady(account, c.id, isVideo);
      creation = c.id;
    } else {
      const children = [];
      for (const m of media.slice(0, 10)) {
        const isVideo = m.mime.startsWith('video/');
        const c = await ig(account, 'POST', `/${uid}/media`, { is_carousel_item: 'true', ...(isVideo ? { media_type: 'VIDEO', video_url: urlFor(m) } : { image_url: urlFor(m) }) });
        await waitReady(account, c.id, isVideo);
        children.push(c.id);
      }
      const c = await ig(account, 'POST', `/${uid}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: text });
      await waitReady(account, c.id, false);
      creation = c.id;
    }
    const pub = await ig(account, 'POST', `/${uid}/media_publish`, { creation_id: creation });
    const info = await ig(account, 'GET', `/${pub.id}`, { fields: 'permalink' }).catch(() => ({}));
    return { remoteId: pub.id, url: info.permalink || null };
  },

  async feed({ account }) {
    const r = await ig(account, 'GET', '/me/media', { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username', limit: '20' });
    return (r.data || []).map((m) => ({
      id: m.id,
      author: m.username || 'me',
      handle: '@' + (m.username || ''),
      text: m.caption || '',
      media: [m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url].filter(Boolean),
      url: m.permalink,
      time: m.timestamp,
      stats: { likes: m.like_count, comments: m.comments_count },
    }));
  },
};
