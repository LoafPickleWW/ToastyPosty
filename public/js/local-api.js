// The "kitchen" that runs in your browser.
// Accounts, keys, posts, feeds, settings and media are saved in this browser (IndexedDB).
// Anything that has to reach a platform goes through the stateless /api relay, carrying only what it needs.
import * as idb from './db.js';
import { finalText } from './shop.js';
import * as zsai from './zerosignal.js';
import { captionRequest, rewriteRequest, altRequest } from './ai-prompts.js';

const CODE_KEY = 'toastyposty.code';
const uid = (p = '') => p + crypto.getRandomValues(new Uint32Array(2)).reduce((s, n) => s + n.toString(16).padStart(8, '0'), '').slice(0, 12);

const EMPTY = () => ({
  version: 2,
  accounts: [],
  posts: [],
  feeds: [],
  media: [],
  oauth: {},
  settings: {
    theme: 'butter',
    publicBaseUrl: '',
    brandVoice: '',
    defaultHashtags: '',
    amazonTag: '',
    shopUrl: '',
    disclosure: '',
    amazonDisclosure: '',
    shopmyCollections: false, // opt-in: import ShopMy collections via ShopMy's app data (not an official API)
    ai: {
      anthropicKey: '', openaiKey: '', textProvider: 'auto', claudeModel: 'claude-opus-5-5', openaiTextModel: 'gpt-5', openaiImageModel: 'gpt-image-1',
      // ZeroSignal: the AI wallet's recovery phrase (secret), its address, network and chosen models.
      zsMnemonic: '', zsAddress: '', zsTextModel: '', zsTextVision: false, zsImageModel: '',
    },
  },
});

let db = null;
let config = null;
const urls = new Map(); // media id -> object URL

// ---------- relay ----------
export class NeedsCode extends Error {}
export async function net(path, { method = 'POST', body, form } = {}) {
  const headers = {};
  const code = localStorage.getItem(CODE_KEY);
  if (code) headers['x-toasty-code'] = code;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  } catch {
    throw new Error('Couldn’t reach the Toasty Posty server. Check your connection.');
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && data.needsCode) throw new NeedsCode(data.error);
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
export const saveCode = (c) => localStorage.setItem(CODE_KEY, c);
export const getConfig = () => config;

// ---------- persistence ----------
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idb.set('db', db).catch((e) => console.error('[toasty] save failed', e)), 60);
}
const saveNow = () => { clearTimeout(saveTimer); return idb.set('db', db); };

export async function init() {
  config = await net('/api/config', { method: 'GET' });
  db = await idb.get('db');
  if (!db) {
    db = EMPTY();
    await importLegacy();
    await saveNow();
  }
  const base = EMPTY();
  db = { ...base, ...db, settings: { ...base.settings, ...db.settings, ai: { ...base.settings.ai, ...(db.settings?.ai || {}) } } };
  for (const [id, blob] of await idb.allMedia()) urls.set(id, URL.createObjectURL(blob));
  db.media = db.media.filter((m) => urls.has(m.id));
  idb.persist();
  // Posts caught mid-flight when the tab closed go back to where they were.
  for (const p of db.posts) {
    delete p._busy;
    if (p.status === 'publishing' || p.status === 'queued') p.status = p.scheduledAt ? 'scheduled' : 'failed';
  }
  save();
}

// The previous version stored data on the server in ./data/db.json. Bring it over once (local installs only).
async function importLegacy() {
  try {
    const res = await fetch('/api/legacy-data');
    if (!res.ok) return;
    const old = await res.json();
    Object.assign(db, {
      accounts: old.accounts || [],
      posts: (old.posts || []).map((p) => ({ ...p, mediaIds: [] })),
      feeds: old.feeds || [],
      settings: { ...db.settings, ...(old.settings || {}), ai: { ...db.settings.ai, ...(old.settings?.ai || {}) } },
    });
    await fetch('/api/legacy-data/done', { method: 'POST' });
    console.info('[toasty] imported data from the previous version');
  } catch {}
}

export const mediaUrl = (id) => urls.get(id) || '';

// A product photo, fetched through the relay (browsers can't read other sites' pixels for the video canvas).
async function productImage(url) {
  const headers = { 'Content-Type': 'application/json' };
  const code = localStorage.getItem(CODE_KEY);
  if (code) headers['x-toasty-code'] = code;
  const res = await fetch('/api/unfurl/image', { method: 'POST', headers, body: JSON.stringify({ url }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t load that product photo.');
  return res.blob();
}

// ---------- helpers ----------
const mask = (v) => (!v ? '' : String(v).length <= 8 ? '••••' : '••••' + String(v).slice(-4));
const platformMeta = (id) => config.platforms.find((p) => p.id === id);
function publicAccount(a) {
  const secret = new Set((platformMeta(a.platform)?.fields || []).filter((f) => f.secret).map((f) => f.key));
  const credentials = {};
  for (const [k, v] of Object.entries(a.credentials || {})) if (!k.startsWith('_')) credentials[k] = secret.has(k) ? mask(v) : v;
  return { ...a, credentials };
}
function publicSettings(s) {
  return { ...s, ai: { ...s.ai, anthropicKey: mask(s.ai.anthropicKey), openaiKey: mask(s.ai.openaiKey), zsMnemonic: s.ai.zsMnemonic ? '••••' : '', hasAnthropic: !!s.ai.anthropicKey, hasOpenAI: !!s.ai.openaiKey, hasZeroSignal: !!s.ai.zsMnemonic } };
}
// What the server relay gets: everything but the ZeroSignal key, which never leaves this browser.
function relaySettings() {
  const { zsMnemonic, ...ai } = db.settings.ai;
  return { ...db.settings, ai };
}
function mergeSecrets(existing = {}, incoming = {}) {
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && (v === '' || v.startsWith('••••'))) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}
function providers() {
  const ai = db.settings.ai;
  // ZeroSignal only counts once its AI wallet is funded (Settings checks the balance and records it).
  const zsOn = !!(ai.zsMnemonic && ai.zsFunded);
  const zsText = zsOn && !!ai.zsTextModel;
  const zsVision = zsText && !!ai.zsTextVision;
  const text = ai.textProvider === 'openai' && ai.openaiKey ? 'openai'
    : ai.textProvider === 'claude' && ai.anthropicKey ? 'claude'
    : ai.textProvider === 'zerosignal' && zsText ? 'zerosignal'
    : ai.anthropicKey ? 'claude' : ai.openaiKey ? 'openai' : zsText ? 'zerosignal' : null;
  // Images go to whoever writes the captions when it can see them, else whichever key can.
  const vision = text === 'zerosignal' && zsVision ? 'zerosignal'
    : ai.anthropicKey ? 'claude' : ai.openaiKey ? 'openai' : zsVision ? 'zerosignal' : null;
  const image = ai.openaiKey ? 'openai' : zsOn && ai.zsImageModel ? 'zerosignal' : null;
  return { text, image, vision };
}
const fail = (msg) => { throw new Error(msg); };
const find = (list, id, what) => list.find((x) => x.id === id) || fail(`${what} not found`);

// ---------- accounts ----------
async function verify(acc) {
  try {
    const r = await net(`/api/p/${acc.platform}/verify`, { body: { account: acc } });
    acc.credentials = r.credentials;
    acc.profile = r.profile || acc.profile || null;
    acc.status = r.pending ? 'pending' : 'ok';
    acc.lastError = null;
  } catch (e) {
    if (e instanceof NeedsCode) throw e;
    acc.status = 'error';
    acc.lastError = e.message;
  }
  acc.checkedAt = new Date().toISOString();
  save();
  return publicAccount(acc);
}

// ---------- publishing ----------
const PUBLIC_MEDIA = { instagram: () => true, tiktok: (m) => m.mime.startsWith('image/') };

async function publishPost(post) {
  if (post._busy) return post;
  post._busy = true;
  post.status = 'publishing';
  post.results ||= {};
  save();
  const hosted = new Map(); // media id -> public URL (for Instagram/TikTok photos)
  const cleanup = [];
  try {
    const media = (post.mediaIds || []).map((id) => db.media.find((m) => m.id === id)).filter(Boolean);
    await Promise.all(post.targets.map(async (accountId) => {
      if (post.results[accountId]?.ok) return; // never double-post on retry
      const account = db.accounts.find((a) => a.id === accountId);
      if (!account) { post.results[accountId] = { ok: false, error: 'Account was removed.', at: new Date().toISOString() }; return; }
      try {
        const needsPublic = PUBLIC_MEDIA[account.platform] || (() => false);
        const meta = [];
        const form = new FormData();
        for (const m of media) {
          const blob = await idb.getMedia(m.id);
          const entry = { name: m.name, mime: m.mime, size: m.size, width: m.width, height: m.height, alt: m.alt || '' };
          if (needsPublic(m)) {
            if (!hosted.has(m.id)) {
              const fd = new FormData();
              fd.append('file', blob, m.name);
              fd.append('baseUrl', db.settings.publicBaseUrl || '');
              const { url } = await net('/api/media/public', { form: fd });
              hosted.set(m.id, url);
              if (account.platform === 'instagram') cleanup.push(url); // TikTok pulls later, so leave those
            }
            entry.publicUrl = hosted.get(m.id);
            form.append('media', new Blob([], { type: m.mime }), m.name); // keep file order aligned
          } else {
            form.append('media', blob, m.name);
          }
          meta.push(entry);
        }
        const base = (post.overrides?.[account.platform]?.text?.trim()) || post.text || '';
        const text = finalText(base, account.platform, post.shop, db.settings); // adds the #ad disclosure + product links
        form.append('payload', JSON.stringify({ account, text, options: post.overrides?.[account.platform] || {}, media: meta }));
        const r = await net(`/api/p/${account.platform}/publish`, { form });
        account.credentials = r.credentials;
        post.results[accountId] = { ok: true, url: r.result.url, remoteId: r.result.remoteId, note: r.result.note, at: new Date().toISOString() };
      } catch (e) {
        post.results[accountId] = { ok: false, error: e.message, at: new Date().toISOString() };
      }
    }));
    const outcomes = post.targets.map((t) => post.results[t]?.ok);
    post.status = outcomes.every(Boolean) ? 'published' : outcomes.some(Boolean) ? 'partial' : 'failed';
    post.publishedAt = new Date().toISOString();
  } finally {
    delete post._busy;
    save();
    for (const url of cleanup) net('/api/media/public/delete', { body: { url } }).catch(() => {});
  }
  return post;
}

// Called every few seconds by the open tab. Anything due (including while the tab was closed) goes out now.
export async function tick() {
  if (!db) return 0;
  const due = db.posts.filter((p) => p.status === 'scheduled' && p.scheduledAt && Date.parse(p.scheduledAt) <= Date.now());
  for (const p of due) await publishPost(p);
  return due.length;
}

// ---------- AI ----------
async function imageForm(mediaId, payload) {
  const m = db.media.find((x) => x.id === mediaId);
  const fd = new FormData();
  if (m && m.mime.startsWith('image/')) fd.append('image', await idb.getMedia(m.id), m.name);
  fd.append('payload', JSON.stringify(payload));
  return { fd, hasImage: !!(m && m.mime.startsWith('image/')) };
}

async function addMedia(blob, info) {
  const m = { id: uid('md_'), name: info.name || 'image.jpg', mime: blob.type || info.mime, size: blob.size, width: info.width || null, height: info.height || null, alt: '', createdAt: new Date().toISOString(), ...info.extra };
  await idb.putMedia(m.id, blob);
  urls.set(m.id, URL.createObjectURL(blob));
  db.media.push(m);
  save();
  return m;
}

// ---------- backup ----------
async function backup() {
  const media = [];
  for (const m of db.media) {
    const blob = await idb.getMedia(m.id);
    if (!blob) continue;
    const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    media.push({ id: m.id, data });
  }
  return { app: 'toasty-posty', version: 2, exportedAt: new Date().toISOString(), db, media };
}
async function restore(file) {
  if (file?.app !== 'toasty-posty' || !file.db) fail('That isn’t a Toasty Posty backup.');
  for (const { id, data } of file.media || []) {
    const blob = await (await fetch(data)).blob();
    await idb.putMedia(id, blob);
    urls.set(id, URL.createObjectURL(blob));
  }
  db = { ...EMPTY(), ...file.db };
  await saveNow();
}

// ---------- AI keys: reveal, and a small keys file to bring them back after a cleared browser ----------
async function setPayer(mnemonic) {
  const phrase = String(mnemonic || '').trim().split(/\s+/).join(' ');
  if (!phrase) fail('Paste the 25-word recovery phrase.');
  const words = phrase.split(' ').length;
  const address = await zsai.payerAddress(phrase).catch(() => fail(words === 25
    ? 'That recovery phrase has a typo: a word isn’t in the list or the last word doesn’t match. Check it and try again.'
    : `That’s ${words} words. ZeroSignal AI wallets use a 25-word Algorand recovery phrase.`));
  Object.assign(db.settings.ai, { zsMnemonic: phrase, zsAddress: address, zsFunded: false });
  zsai.forget();
}
const KEY_FIELDS = { anthropic: 'anthropicKey', openai: 'openaiKey', zerosignal: 'zsMnemonic' };
const AI_EXPORT = ['anthropicKey', 'openaiKey', 'textProvider', 'claudeModel', 'openaiTextModel', 'openaiImageModel', 'zsMnemonic', 'zsTextModel', 'zsTextVision', 'zsImageModel'];

async function keys(action, body) {
  const ai = db.settings.ai;
  if (action === 'reveal') {
    const field = KEY_FIELDS[body.which] || fail('Unknown key');
    return { value: ai[field] || fail('That key isn’t set.') };
  }
  if (action === 'export') {
    return { app: 'toasty-posty-keys', version: 1, exportedAt: new Date().toISOString(), ai: Object.fromEntries(AI_EXPORT.filter((k) => ai[k] !== undefined && ai[k] !== '').map((k) => [k, ai[k]])) };
  }
  if (action === 'import') {
    // Takes a keys file or a full backup (its AI settings only).
    const incoming = body?.app === 'toasty-posty-keys' ? body.ai : body?.app === 'toasty-posty' ? body.db?.settings?.ai : null;
    if (!incoming || typeof incoming !== 'object') fail('That isn’t a Toasty Posty keys file or backup.');
    const picked = Object.fromEntries(AI_EXPORT.filter((k) => k !== 'zsMnemonic' && incoming[k] !== undefined).map((k) => [k, incoming[k]]));
    db.settings.ai = mergeSecrets(ai, picked);
    if (incoming.zsMnemonic) await setPayer(incoming.zsMnemonic);
    zsai.forget();
    await saveNow();
    const got = ['anthropicKey', 'openaiKey', 'zsMnemonic'].filter((k) => incoming[k]).map((k) => ({ anthropicKey: 'Claude key', openaiKey: 'OpenAI key', zsMnemonic: 'ZeroSignal AI wallet' })[k]);
    return { settings: publicSettings(db.settings), providers: providers(), imported: got };
  }
  fail('Unknown keys request');
}

// ---------- ZeroSignal (runs in this tab; the relay never sees the AI wallet) ----------
async function zerosignal(action, body) {
  const ai = db.settings.ai;
  const done = async () => { await saveNow(); return { settings: publicSettings(db.settings), providers: providers() }; };
  const needWallet = () => ai.zsMnemonic || fail('Create or import a ZeroSignal AI wallet first.');
  switch (action) {
    case 'new': {
      const { mnemonic, address } = await zsai.newPayer();
      Object.assign(ai, { zsMnemonic: mnemonic, zsAddress: address, zsFunded: false });
      zsai.forget();
      return done();
    }
    case 'import': {
      await setPayer(body.mnemonic);
      return done();
    }
    case 'reveal': needWallet(); return { mnemonic: ai.zsMnemonic };
    case 'models': needWallet(); return { models: await zsai.models(ai) };
    case 'checkup': needWallet(); return zsai.checkup(ai);
    case 'balances': {
      needWallet();
      const b = await zsai.balances(ai);
      const funded = b.algo >= zsai.ALGO_READY && b.optedIn && b.usdc > 0;
      if (!!ai.zsFunded !== funded) { ai.zsFunded = funded; await saveNow(); }
      return { ...b, providers: providers() };
    }
    case 'optin': needWallet(); return zsai.optIn(ai);
    case 'wallets': return zsai.wallets();
    case 'connect': return { address: await zsai.connectWallet(body.wallet) };
    case 'disconnect': await zsai.disconnectWallet(); return { ok: true };
    case 'topup': needWallet(); return zsai.topUp(ai, { usdc: body.usdc, algo: body.algo });
  }
  fail('Unknown ZeroSignal request');
}

// ---------- the router the views talk to ----------
export async function handle(path, { method = 'GET', body = {}, form } = {}) {
  const [p] = path.split('?');
  const seg = p.split('/').filter(Boolean).slice(1); // drop "api"
  const [res, id, action] = seg;
  const M = method.toUpperCase();

  // Product link previews: name / brand / price / photo from an affiliate link.
  if (res === 'collection') {
    if (!db.settings.shopmyCollections) fail('Collection import is off. Turn it on in Settings → Selling & affiliate links.');
    return net('/api/collection', { body: { url: body.url, optIn: true } });
  }
  if (res === 'unfurl') return id === 'image' ? productImage(body.url) : net('/api/unfurl', { body: { url: body.url } });

  if (res === 'state') {
    return {
      accounts: db.accounts.map(publicAccount),
      posts: db.posts,
      feeds: db.feeds,
      media: db.media,
      settings: publicSettings(db.settings),
      platforms: config.platforms,
      webSources: config.webSources,
      providers: providers(),
      config: { publicMedia: config.publicMedia, hosted: config.hosted, locked: config.locked, maxUpload: config.maxUpload },
    };
  }

  if (res === 'accounts') {
    if (!id && M === 'POST') {
      const meta = platformMeta(body.platform) || fail('Unknown platform');
      const missing = meta.fields.filter((f) => !f.optional && !body.credentials?.[f.key]);
      if (missing.length) fail('Missing: ' + missing.map((f) => f.label).join(', '));
      const acc = { id: uid('a_'), platform: body.platform, label: body.label || meta.name, credentials: mergeSecrets({}, body.credentials), createdAt: new Date().toISOString() };
      db.accounts.push(acc);
      return verify(acc);
    }
    const acc = find(db.accounts, id, 'Account');
    if (M === 'DELETE') {
      db.accounts = db.accounts.filter((a) => a.id !== id);
      db.feeds = db.feeds.filter((f) => f.accountId !== id);
      save();
      return { ok: true };
    }
    if (M === 'PATCH') {
      if (body.label !== undefined) acc.label = body.label;
      if (body.credentials) acc.credentials = mergeSecrets(acc.credentials, body.credentials);
      return verify(acc);
    }
    if (action === 'verify') return verify(acc);
    if (action === 'refresh') {
      const r = await net(`/api/p/${acc.platform}/refresh`, { body: { account: acc } });
      acc.credentials = r.credentials;
      return verify(acc);
    }
  }

  if (res === 'oauth' && id === 'tiktok') {
    const acc = find(db.accounts, body.accountId, 'Account');
    const redirectUri = redirectFor();
    const state = uid('') + uid('') + '.' + btoa(location.origin).replace(/=+$/, '');
    db.oauth[state] = { accountId: acc.id, at: Date.now(), redirectUri };
    save();
    return net('/api/p/tiktok/auth-url', { body: { account: acc, redirectUri, state } });
  }
  if (res === 'oauth-finish') {
    const pending = db.oauth[body.state];
    delete db.oauth[body.state];
    if (!pending || Date.now() - pending.at > 30 * 60_000) fail('That TikTok login expired. Click “Authorize with TikTok” again.');
    const acc = find(db.accounts, pending.accountId, 'Account');
    const r = await net('/api/p/tiktok/exchange', { body: { account: acc, code: body.code, redirectUri: pending.redirectUri } });
    acc.credentials = r.credentials;
    return verify(acc);
  }

  if (res === 'media') {
    if (!id && M === 'POST') {
      const file = form.get('file');
      if (!file || !/^(image|video)\//.test(file.type)) fail('Images and videos only.');
      return addMedia(file, { name: file.name, width: Number(form.get('width')) || null, height: Number(form.get('height')) || null });
    }
    const m = find(db.media, id, 'Media');
    if (M === 'PATCH') { if (typeof body.alt === 'string') m.alt = body.alt.slice(0, 1500); save(); return { ok: true }; }
    if (M === 'DELETE') {
      await idb.delMedia(id);
      URL.revokeObjectURL(urls.get(id));
      urls.delete(id);
      db.media = db.media.filter((x) => x.id !== id);
      for (const post of db.posts) post.mediaIds = (post.mediaIds || []).filter((x) => x !== id);
      save();
      return { ok: true };
    }
  }

  if (res === 'posts') {
    if (!id && M === 'POST') {
      let post = body.id && db.posts.find((x) => x.id === body.id);
      if (post && ['publishing', 'published'].includes(post.status)) fail('That post already went out.');
      if (!post) { post = { id: uid('p_'), createdAt: new Date().toISOString(), results: {} }; db.posts.push(post); }
      Object.assign(post, { text: body.text || '', overrides: body.overrides || {}, mediaIds: body.mediaIds || [], targets: body.targets || [], scheduledAt: body.scheduledAt || null, shop: body.shop || null, updatedAt: new Date().toISOString() });
      if (body.action !== 'draft' && !post.targets.length) fail('Pick at least one account to post to.');
      post.status = body.action === 'schedule' ? 'scheduled' : body.action === 'now' ? 'queued' : 'draft';
      if (post.status === 'scheduled' && !post.scheduledAt) fail('Pick a time to schedule it.');
      save();
      if (body.action === 'now') await publishPost(post);
      return post;
    }
    const post = find(db.posts, id, 'Post');
    if (M === 'DELETE') { db.posts = db.posts.filter((x) => x.id !== id); save(); return { ok: true }; }
    if (action === 'publish') return publishPost(post);
    if (action === 'unschedule') { if (post.status === 'scheduled') post.status = 'draft'; save(); return post; }
  }

  if (res === 'feeds') {
    if (!id && M === 'POST') {
      let f;
      if (body.source) {
        f = { id: uid('f_'), kind: 'web', platform: 'web', source: body.source, query: (body.query || '').trim(), keywords: (body.keywords || '').trim(), title: (body.title || '').trim() };
        const r = await net('/api/web/items', { body: { feed: f } }); // fails fast on typos and dead links
        if (!f.title && f.source !== 'topic') f.title = r.title || '';
      } else {
        const acc = find(db.accounts, body.accountId, 'Account');
        f = { id: uid('f_'), accountId: acc.id, platform: acc.platform, type: body.type, query: body.query || '', keywords: (body.keywords || '').trim(), title: body.title || '' };
      }
      db.feeds.push(f);
      save();
      return f;
    }
    const f = find(db.feeds, id, 'Feed');
    if (M === 'DELETE') { db.feeds = db.feeds.filter((x) => x.id !== id); save(); return { ok: true }; }
    if (action === 'items') {
      if (f.kind === 'web') return { items: (await net('/api/web/items', { body: { feed: f } })).items };
      const acc = find(db.accounts, f.accountId, 'The account for this feed');
      const r = await net(`/api/p/${acc.platform}/feed`, { body: { account: acc, feed: f } });
      acc.credentials = r.credentials;
      save();
      return { items: r.items };
    }
  }

  if (res === 'settings' && M === 'PUT') {
    const s = db.settings;
    for (const k of ['theme', 'publicBaseUrl', 'brandVoice', 'defaultHashtags', 'amazonTag', 'shopUrl', 'disclosure', 'amazonDisclosure']) if (typeof body[k] === 'string') s[k] = body[k].trim();
    if (typeof body.shopmyCollections === 'boolean') s.shopmyCollections = body.shopmyCollections;
    if (body.ai) {
      const { clearAnthropic, clearOpenAI, clearZeroSignal, zsMnemonic, zsAddress, ...rest } = body.ai; // the AI wallet is only set through /api/zs
      s.ai = mergeSecrets(s.ai, rest);
      if (clearAnthropic) s.ai.anthropicKey = '';
      if (clearOpenAI) s.ai.openaiKey = '';
      if (clearZeroSignal) { s.ai.zsMnemonic = ''; s.ai.zsAddress = ''; s.ai.zsFunded = false; zsai.forget(); }
    }
    await saveNow();
    return { settings: publicSettings(s), providers: providers() };
  }

  if (res === 'zs') return zerosignal(id, body);
  if (res === 'keys') return keys(id, body);

  if (res === 'ai') {
    const settings = relaySettings();
    const p = providers();
    const zs = db.settings.ai;
    const mediaBlob = async (mediaId) => {
      const m = mediaId && db.media.find((x) => x.id === mediaId && x.mime.startsWith('image/'));
      return m ? idb.getMedia(m.id) : null;
    };
    if (id === 'caption' && p.text === 'zerosignal') {
      // A photo goes to ZeroSignal if its model can see; otherwise the Claude/OpenAI path below handles it.
      const photo = await mediaBlob(body.mediaId);
      if (!photo || !p.vision || p.vision === 'zerosignal') {
        const image = p.vision === 'zerosignal' ? photo : null;
        return zsai.jsonCall(zs, { ...captionRequest(settings, { notes: body.notes || '', platforms: body.platforms || [], tone: body.tone, hasImage: !!image }), image });
      }
    }
    if (id === 'rewrite' && p.text === 'zerosignal') return zsai.jsonCall(zs, rewriteRequest(settings, { text: body.text, instruction: body.instruction }));
    if (id === 'alt' && p.vision === 'zerosignal') {
      const m = find(db.media, body.mediaId, 'Image');
      const r = await zsai.jsonCall(zs, { ...altRequest(), image: await idb.getMedia(m.id) });
      m.alt = r.alt;
      save();
      return r;
    }
    if (id === 'image' && p.image === 'zerosignal') {
      const blob = await zsai.generateImage(zs, { prompt: body.prompt, size: body.size });
      const [w, h] = (body.size || '1024x1024').split('x').map(Number);
      return addMedia(blob, { name: 'ai-toast.' + (blob.type.split('/')[1] || 'png'), width: w, height: h, extra: { ai: true, prompt: body.prompt } });
    }
    if (id === 'caption') {
      const payload = { settings, notes: body.notes || '', platforms: body.platforms || [], tone: body.tone };
      if (body.mediaId) {
        const { fd, hasImage } = await imageForm(body.mediaId, payload);
        if (hasImage) return net('/api/ai/caption-image', { form: fd });
      }
      return net('/api/ai/caption', { body: payload });
    }
    if (id === 'rewrite') return net('/api/ai/rewrite', { body: { settings, text: body.text, instruction: body.instruction } });
    if (id === 'alt') {
      const m = find(db.media, body.mediaId, 'Image');
      const { fd } = await imageForm(m.id, { settings });
      const r = await net('/api/ai/alt', { form: fd });
      m.alt = r.alt;
      save();
      return r;
    }
    if (id === 'image') {
      const r = await net('/api/ai/image', { body: { settings, prompt: body.prompt, size: body.size } });
      const blob = await (await fetch(`data:${r.mime};base64,${r.data}`)).blob();
      const [w, h] = (body.size || '1024x1024').split('x').map(Number);
      return addMedia(blob, { name: 'ai-toast.jpg', width: w, height: h, extra: { ai: true, prompt: body.prompt } });
    }
  }

  if (res === 'test-public') {
    const m = db.media.find((x) => x.mime.startsWith('image/')) || fail('Upload any image in Compose first, then test.');
    const fd = new FormData();
    fd.append('file', await idb.getMedia(m.id), m.name);
    fd.append('baseUrl', db.settings.publicBaseUrl || '');
    return net('/api/media/public', { form: fd });
  }

  if (res === 'backup') return backup();
  if (res === 'restore') { await restore(body); return { ok: true }; }

  fail(`Unknown request: ${M} ${path}`);
}

// TikTok only redirects to https. On Vercel that's this site; self-hosted it's your tunnel (Public URL).
export function redirectFor() {
  const base = location.protocol === 'https:' ? location.origin : (db.settings.publicBaseUrl || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) fail('TikTok needs an https address to send you back to. Set Public URL in Settings (self-hosted) or use your Vercel site.');
  return `${base}/oauth-tiktok`;
}
