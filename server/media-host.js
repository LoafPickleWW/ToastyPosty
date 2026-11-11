// Instagram (and TikTok photo posts) download media from a public URL instead of accepting uploads.
// On Vercel: put the file in Vercel Blob (needs a Blob store connected to the project).
// Self-hosted: keep it in a temp folder and serve it at /pub/<file> through your tunnel's Public URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TMP = path.join(os.tmpdir(), 'toasty-posty-public');
const hasBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

export const mode = () => (hasBlob() ? 'blob' : process.env.VERCEL ? null : 'local');

const extFor = (mime, name) => path.extname(name || '') || ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4', 'video/quicktime': '.mov' }[mime] || '.bin');

export async function put(file, baseUrl) {
  const name = crypto.randomBytes(10).toString('hex') + extFor(file.mimetype, file.originalname);
  if (hasBlob()) {
    const { put: blobPut } = await import('@vercel/blob');
    const b = await blobPut(`toasty/${name}`, file.buffer, { access: 'public', contentType: file.mimetype, addRandomSuffix: false });
    return { url: b.url };
  }
  if (process.env.VERCEL) throw new Error('Instagram needs public media. Connect a Vercel Blob store to this project (Storage → Blob) and redeploy.');
  const base = (baseUrl || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Instagram needs a public https address. Set Public URL in Settings (e.g. a Cloudflare tunnel).');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, name), file.buffer);
  setTimeout(() => fs.rm(path.join(TMP, name), () => {}), 6 * 3600e3).unref?.(); // tidy up later
  return { url: `${base}/pub/${name}` };
}

export async function remove(url) {
  if (!url) return;
  if (hasBlob() && /vercel-storage\.com/.test(url)) {
    const { del } = await import('@vercel/blob');
    return del(url);
  }
  const m = url.match(/\/pub\/([a-f0-9]+\.\w+)$/);
  if (m) fs.rm(path.join(TMP, m[1]), () => {});
}

export function mountLocal(app) {
  app.get('/pub/:name', (req, res) => {
    if (!/^[a-f0-9]+\.\w+$/.test(req.params.name)) return res.status(404).end();
    res.sendFile(path.join(TMP, req.params.name), (err) => err && res.status(404).end());
  });
}
