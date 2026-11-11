// TikTok Content Posting API (Direct Post). Unaudited apps can only post privately (SELF_ONLY).
import crypto from 'node:crypto';
import { request, form } from '../http.js';

const API = 'https://open.tiktokapis.com';

async function tokenRequest(c, params) {
  const r = await request(`${API}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: c.clientKey, client_secret: c.clientSecret, ...params }),
  }, 'TikTok auth');
  if (r.error) throw new Error(`TikTok auth: ${r.error_description || r.error}`);
  return r;
}

function applyTokens(account, r) {
  Object.assign(account.credentials, {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    openId: r.open_id,
    _expiresAt: Date.now() + r.expires_in * 1000,
    _refreshExpiresAt: Date.now() + (r.refresh_expires_in || 0) * 1000,
  });
}

async function fresh(account) {
  const c = account.credentials;
  if (!c.accessToken) throw new Error('TikTok is not authorized yet. Open Accounts → TikTok → "Authorize with TikTok".');
  if (c.refreshToken && c._expiresAt && c._expiresAt < Date.now() + 5 * 60_000) {
    applyTokens(account, await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: c.refreshToken }));
  }
  return account.credentials.accessToken;
}

async function tt(account, path, body, { method = 'POST', query } = {}) {
  const t = await fresh(account);
  const r = await request(`${API}${path}${query ? '?' + new URLSearchParams(query) : ''}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body ? JSON.stringify(body) : undefined,
  }, 'TikTok');
  if (r.error && r.error.code && r.error.code !== 'ok') throw new Error(`TikTok: ${r.error.message || r.error.code}`);
  return r.data;
}

export default {
  id: 'tiktok',
  name: 'TikTok',
  limits: { text: 2200, images: 35, video: true, requiresMedia: true },
  fields: [
    { key: 'clientKey', label: 'Client Key' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
    { key: 'accessToken', label: 'Access Token (skip if you use Authorize)', secret: true, optional: true },
    { key: 'refreshToken', label: 'Refresh Token', secret: true, optional: true },
  ],
  feedTypes: [{ id: 'mine', label: 'My videos' }],
  oauth: true,

  // The browser makes the state (and checks it when TikTok sends the user back).
  authUrl(account, redirectUri, state) {
    if (!account.credentials.clientKey) throw new Error('Save your TikTok Client Key first.');
    const qs = new URLSearchParams({
      client_key: account.credentials.clientKey,
      scope: 'user.info.basic,video.publish,video.upload,video.list',
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${qs}`;
  },

  async exchange(account, code, redirectUri) {
    applyTokens(account, await tokenRequest(account.credentials, { code, grant_type: 'authorization_code', redirect_uri: redirectUri }));
  },

  async refresh(account) {
    const c = account.credentials;
    if (!c.refreshToken) throw new Error('No refresh token saved. Re-authorize TikTok.');
    applyTokens(account, await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: c.refreshToken }));
  },

  async verify(account) {
    if (!account.credentials.accessToken) return { profile: null, pending: true };
    const d = await tt(account, '/v2/user/info/', null, { method: 'GET', query: { fields: 'open_id,display_name,avatar_url,username' } }).catch(async () =>
      tt(account, '/v2/user/info/', null, { method: 'GET', query: { fields: 'open_id,display_name,avatar_url' } }));
    const u = d.user;
    return { profile: { handle: u.username ? '@' + u.username : u.display_name, name: u.display_name, avatar: u.avatar_url, url: u.username ? `https://www.tiktok.com/@${u.username}` : null } };
  },

  async creatorInfo(account) {
    return tt(account, '/v2/post/publish/creator_info/query/', {});
  },

  async publish({ account, text, options = {}, media }) {
    if (!media.length) throw new Error('TikTok posts need a video (or photos).');
    const info = await this.creatorInfo(account);
    const allowed = info.privacy_level_options || ['SELF_ONLY'];
    const privacy = allowed.includes(options.privacy) ? options.privacy : allowed.includes('SELF_ONLY') ? 'SELF_ONLY' : allowed[0];
    const video = media.find((m) => m.mime.startsWith('video/'));

    if (video) {
      const size = video.size;
      const CHUNK = 10 * 1024 * 1024;
      const count = size <= 64 * 1024 * 1024 ? 1 : Math.floor(size / CHUNK);
      const chunk = count === 1 ? size : CHUNK;
      const init = await tt(account, '/v2/post/publish/video/init/', {
        post_info: {
          title: text.slice(0, 2200),
          privacy_level: privacy,
          disable_comment: !!options.disableComment,
          disable_duet: !!options.disableDuet,
          disable_stitch: !!options.disableStitch,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count },
      });
      if (!video.data) throw new Error('The video did not arrive. It may be too big for this server; run Toasty Posty locally for large videos.');
      const buf = video.data;
      for (let i = 0; i < count; i++) {
        const start = i * chunk;
        const end = i === count - 1 ? size - 1 : start + chunk - 1;
        const res = await fetch(init.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': video.mime, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
          body: buf.subarray(start, end + 1),
        });
        if (!res.ok && res.status !== 206) throw new Error(`TikTok upload chunk ${i + 1}/${count} failed (${res.status}).`);
      }
      return { remoteId: init.publish_id, url: account.profile?.url || null, note: privacy === 'SELF_ONLY' ? 'Posted privately (SELF_ONLY). Unaudited TikTok apps can only post privately.' : 'TikTok is processing the video.' };
    }

    if (media.some((m) => m.mime.startsWith('image/') && !m.publicUrl)) throw new Error('TikTok photo posts need your images at a public address on a domain verified in your TikTok app. Videos work without it.');
    const photos = media.filter((m) => m.mime.startsWith('image/')).slice(0, 35);
    const init = await tt(account, '/v2/post/publish/content/init/', {
      post_info: { title: (options.title || text).slice(0, 90), description: text.slice(0, 4000), privacy_level: privacy, disable_comment: !!options.disableComment, auto_add_music: true },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: photos.map((m) => m.publicUrl) },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    });
    return { remoteId: init.publish_id, url: account.profile?.url || null };
  },

  async feed({ account }) {
    const d = await tt(account, '/v2/video/list/', { max_count: 20 }, { query: { fields: 'id,title,video_description,cover_image_url,share_url,create_time,like_count,comment_count,view_count' } });
    return (d.videos || []).map((v) => ({
      id: v.id,
      author: account.profile?.name || 'me',
      handle: account.profile?.handle || '',
      text: v.video_description || v.title || '',
      media: [v.cover_image_url].filter(Boolean),
      url: v.share_url,
      time: new Date(v.create_time * 1000).toISOString(),
      stats: { views: v.view_count, likes: v.like_count, comments: v.comment_count },
    }));
  },
};
