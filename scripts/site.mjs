// Build for Vercel: copy public/ to dist/ and fill in %SITE_URL% (canonical links, share images, sitemap).
// SITE_URL comes from the SITE_URL env var, else the Vercel production domain, else the deployment URL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

export function siteUrl() {
  const raw = process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'http://localhost:4848';
  return raw.replace(/\/+$/, '');
}

export const TEMPLATED = /\.(html|txt|xml|webmanifest)$/;
export const fill = (text, url) => text.replaceAll('%SITE_URL%', url);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = siteUrl();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(SRC, OUT, { recursive: true });
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEMPLATED.test(e.name)) {
        const t = fs.readFileSync(p, 'utf8');
        if (t.includes('%SITE_URL%')) { fs.writeFileSync(p, fill(t, url)); n++; }
      }
    }
  };
  walk(OUT);
  console.log(`Built dist/ for ${url} (${n} files had the site URL filled in).`);
}
