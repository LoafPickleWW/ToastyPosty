// Run Toasty Posty on your own computer: `npm start`.
// Serves the web app + the stateless API. Your data lives in the browser you open it in.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './app.js';
import { fill, TEMPLATED } from '../scripts/site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4848);
const HOST = process.env.HOST || '127.0.0.1';
const LEGACY_DB = path.join(ROOT, 'data', 'db.json');

const server = express();

// Through a tunnel (for Instagram/TikTok), only public media and the TikTok login page are reachable.
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
server.use((req, res, next) => {
  if (LOCAL.has(req.hostname)) return next();
  if (req.path.startsWith('/pub/') || req.path.startsWith('/oauth-tiktok') || /\.(svg|png|ico|css|js|webmanifest)$/.test(req.path)) return next();
  res.status(403).send('This Toasty Posty kitchen is staff only.');
});

// One-time move from the old version, which kept data in ./data/db.json. The browser imports it on first run.
server.get('/api/legacy-data', (req, res) => {
  if (!fs.existsSync(LEGACY_DB)) return res.status(404).json({ error: 'none' });
  res.type('json').send(fs.readFileSync(LEGACY_DB, 'utf8'));
});
server.post('/api/legacy-data/done', (req, res) => {
  if (fs.existsSync(LEGACY_DB)) fs.renameSync(LEGACY_DB, LEGACY_DB.replace(/\.json$/, `.imported-${Date.now()}.json`));
  res.json({ ok: true });
});

server.use(api);

// Pages carry %SITE_URL% placeholders (canonical links, share images). Fill them in for whatever host you opened.
server.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const rel = req.path === '/' ? 'index.html' : req.path.slice(1) + (path.extname(req.path) ? '' : '.html');
  const file = path.join(ROOT, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(ROOT, 'public')) || !TEMPLATED.test(file) || !fs.existsSync(file)) return next();
  res.type(path.extname(file) === '.webmanifest' ? 'application/manifest+json' : path.extname(file));
  res.send(fill(fs.readFileSync(file, 'utf8'), `${req.protocol}://${req.get('host')}`));
});
server.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

server.listen(PORT, HOST, () => {
  console.log(`\n  🍞🥒  Toasty Posty is warm at http://localhost:${PORT}\n      Your data lives in the browser you open it in. This server stores nothing.\n`);
});
