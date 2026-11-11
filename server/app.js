// Toasty Posty API: a stateless proxy.
// Your accounts, keys, posts and media live in YOUR browser. Each request carries what it needs,
// this server forwards it to the platform or AI provider, and forgets it. Nothing is stored here.
// The same app runs locally (server/index.js) and on Vercel (api/index.js).
import express from 'express';
import multer from 'multer';
import { platforms, list as platformList } from './platforms/index.js';
import * as ai from './ai.js';
import * as rss from './rss.js';
import * as mediaHost from './media-host.js';

const ACCESS_CODE = process.env.ACCESS_CODE || '';
const MAX_UPLOAD = process.env.VERCEL ? Math.floor(4.4 * 1024 * 1024) : 512 * 1024 * 1024; // Vercel caps request bodies at 4.5MB

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD, files: 12 } });

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[toasty]', req.path, e.message);
  const tooBig = e.code === 'LIMIT_FILE_SIZE';
  res.status(tooBig ? 413 : e.status >= 400 && e.status < 500 ? 400 : 502).json({
    error: tooBig ? 'That file is too big to send through this server. On Vercel the limit is about 4MB per request; run Toasty Posty locally for big videos.' : e.message,
  });
});

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const P = (id) => platforms[id] || (() => { throw bad('Unknown platform'); })();

// Optional: set ACCESS_CODE on your deployment so strangers can't use your server as a relay.
app.use('/api', (req, res, next) => {
  if (!ACCESS_CODE || req.path === '/config' || req.path === '/check-code') return next();
  if (req.get('x-toasty-code') === ACCESS_CODE) return next();
  res.status(401).json({ error: 'This Toasty Posty needs its access code.', needsCode: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    platforms: platformList(),
    webSources: rss.publicSources(),
    publicMedia: mediaHost.mode(), // 'blob' on Vercel with Blob storage, 'local' when self-hosted, null otherwise
    hosted: !!process.env.VERCEL,
    locked: !!ACCESS_CODE,
    maxUpload: MAX_UPLOAD,
  });
});

app.post('/api/check-code', (req, res) => res.json({ ok: !ACCESS_CODE || req.body.code === ACCESS_CODE }));

// ---------- Platforms ----------
// The browser sends the account (with credentials). Platforms may refresh tokens or cache ids on it,
// so we always send the credentials back for the browser to save.
const back = (account, extra) => ({ ...extra, credentials: account.credentials });

app.post('/api/p/:platform/verify', wrap(async (req, res) => {
  const { account } = req.body;
  const r = await P(req.params.platform).verify(account);
  res.json(back(account, { profile: r.profile || null, pending: !!r.pending }));
}));

app.post('/api/p/:platform/refresh', wrap(async (req, res) => {
  const p = P(req.params.platform);
  if (!p.refresh) throw bad('This platform has no token refresh.');
  await p.refresh(req.body.account);
  res.json(back(req.body.account, {}));
}));

app.post('/api/p/:platform/feed', wrap(async (req, res) => {
  const { account, feed } = req.body;
  const items = (await P(req.params.platform).feed({ account, feed })).filter((it) => rss.matchesKeywords(it, feed.keywords));
  res.json(back(account, { items }));
}));

// multipart: "payload" (JSON) + "media" files in the same order as payload.media
app.post('/api/p/:platform/publish', upload.array('media', 12), wrap(async (req, res) => {
  const payload = JSON.parse(req.body.payload || '{}');
  const files = req.files || [];
  const media = (payload.media || []).map((m, i) => ({ ...m, data: files[i]?.buffer || null }));
  const result = await P(req.params.platform).publish({ account: payload.account, text: payload.text || '', options: payload.options || {}, media });
  res.json(back(payload.account, { result }));
}));

app.post('/api/p/tiktok/auth-url', wrap(async (req, res) => {
  res.json({ url: platforms.tiktok.authUrl(req.body.account, req.body.redirectUri, req.body.state) });
}));

app.post('/api/p/tiktok/exchange', wrap(async (req, res) => {
  const { account, code, redirectUri } = req.body;
  await platforms.tiktok.exchange(account, code, redirectUri);
  res.json(back(account, {}));
}));

// ---------- Public media (Instagram + TikTok photos fetch media from a URL) ----------
app.post('/api/media/public', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('No file.');
  res.json(await mediaHost.put(req.file, req.body.baseUrl));
}));
app.post('/api/media/public/delete', wrap(async (req, res) => {
  await mediaHost.remove(req.body.url).catch(() => {});
  res.json({ ok: true });
}));
mediaHost.mountLocal(app);

// ---------- Web feeds ----------
app.post('/api/web/items', wrap(async (req, res) => res.json(await rss.webItems(req.body.feed))));

// ---------- AI ----------
app.post('/api/ai/caption', wrap(async (req, res) => {
  const { settings, notes, platforms: plats, tone } = req.body;
  res.json(await ai.draftCaptions(settings, { notes: notes || '', platforms: plats || [], tone }));
}));
app.post('/api/ai/caption-image', upload.single('image'), wrap(async (req, res) => {
  const p = JSON.parse(req.body.payload || '{}');
  const image = req.file ? { data: req.file.buffer, mime: req.file.mimetype, size: req.file.size } : null;
  res.json(await ai.draftCaptions(p.settings, { notes: p.notes || '', platforms: p.platforms || [], tone: p.tone, image }));
}));
app.post('/api/ai/rewrite', wrap(async (req, res) => res.json(await ai.rewrite(req.body.settings, req.body))));
app.post('/api/ai/alt', upload.single('image'), wrap(async (req, res) => {
  const p = JSON.parse(req.body.payload || '{}');
  if (!req.file) throw bad('Pick an image.');
  res.json(await ai.altText(p.settings, { image: { data: req.file.buffer, mime: req.file.mimetype, size: req.file.size } }));
}));
app.post('/api/ai/image', wrap(async (req, res) => {
  const buf = await ai.generateImage(req.body.settings, req.body);
  res.json({ data: buf.toString('base64'), mime: 'image/jpeg' });
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

export default app;
