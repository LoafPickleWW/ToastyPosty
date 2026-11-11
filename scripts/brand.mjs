// Renders Toasty Posty's share image + icon set from SVG.  Run: npm run brand
// Outputs into public/: og.png, apple-touch-icon.png, icon-192.png, icon-512.png,
// icon-maskable-512.png, favicon.ico, favicon.svg. Fonts (OFL, Google Fonts) are cached in scripts/.fonts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { BRAND_PATHS } from '../public/js/brands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const FONT_DIR = path.join(ROOT, 'scripts', '.fonts');

// ---------- fonts ----------
async function ensureFonts() {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const specs = ['Archivo:wdth,wght@125,900', 'Archivo:wght@500;700', 'Yellowtail', 'DM+Mono:wght@500'];
  const files = [];
  for (const spec of specs) {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${spec}`)).text(); // plain UA gets .ttf
    for (const [, url] of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/g)) {
      const file = path.join(FONT_DIR, url.split('/').slice(-3).join('_'));
      if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
      files.push(file);
    }
  }
  return [...new Set(files)];
}

// ---------- pieces ----------
const logoInner = fs.readFileSync(path.join(PUB, 'img', 'logo.svg'), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/id="chrome"/g, 'id="logoChrome"').replace(/url\(#chrome\)/g, 'url(#logoChrome)');
const logo = (x, y, size) => `<g transform="translate(${x} ${y}) scale(${size / 64})">${logoInner}</g>`;

const TILE = { x: '#000000', bluesky: '#1185FE', reddit: '#FF4500', instagram: 'url(#ig)', tiktok: '#000000' };
const tile = (id, x, y, s) => `
  <g transform="translate(${x} ${y})">
    <rect width="${s}" height="${s}" rx="${s * 0.28}" fill="${TILE[id]}"/>
    <g transform="translate(${s * 0.21} ${s * 0.21}) scale(${(s * 0.58) / 24})"><path fill="#fff" d="${BRAND_PATHS[id]}"/></g>
  </g>`;

const checker = (id, a = 0.035) => `
  <pattern id="${id}" width="56" height="56" patternUnits="userSpaceOnUse">
    <rect width="28" height="28" fill="#24170F" opacity="${a}"/><rect x="28" y="28" width="28" height="28" fill="#24170F" opacity="${a}"/>
  </pattern>`;

const chromeGrad = `
  <linearGradient id="chromeBand" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#DCE0E3"/><stop offset=".5" stop-color="#9BA3AA"/>
    <stop offset=".54" stop-color="#E6E9EC"/><stop offset=".8" stop-color="#B9C0C6"/><stop offset="1" stop-color="#F5F6F7"/>
  </linearGradient>
  <radialGradient id="ig" cx="0.3" cy="1.07" r="1.2">
    <stop offset="0" stop-color="#FDF497"/><stop offset=".05" stop-color="#FDF497"/><stop offset=".45" stop-color="#FD5949"/>
    <stop offset=".6" stop-color="#D6249F"/><stop offset=".9" stop-color="#285AEB"/>
  </radialGradient>`;

// ---------- the share card (1200x630) ----------
function ogSvg() {
  const plats = ['x', 'bluesky', 'reddit', 'instagram', 'tiktok'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>${checker('chk')}${chromeGrad}</defs>
  <rect width="1200" height="630" fill="#F3ECDD"/>
  <rect width="1200" height="630" fill="url(#chk)"/>
  <rect x="0" y="0" width="1200" height="14" fill="url(#chromeBand)"/>
  <rect x="0" y="13" width="1200" height="2" fill="#24170F" opacity=".25"/>

  <!-- toaster -->
  <circle cx="250" cy="330" r="190" fill="#A9DCC6" opacity=".35"/>
  ${logo(80, 150, 340)}

  <!-- words -->
  <text x="500" y="150" font-family="Archivo" font-weight="900" font-stretch="expanded" font-size="18" letter-spacing="4.5" fill="#8F7B6A">FREE · OPEN SOURCE · BY LOAFPICKLE</text>
  <text x="494" y="262" font-family="Yellowtail" font-size="116" fill="#24170F">Toasty Posty</text>
  <text x="500" y="340" font-family="Archivo" font-weight="900" font-stretch="expanded" font-size="40" fill="#D7263D">WRITE ONCE.</text>
  <text x="500" y="390" font-family="Archivo" font-weight="900" font-stretch="expanded" font-size="40" fill="#24170F">TOAST IT EVERYWHERE.</text>
  <text x="500" y="440" font-family="Archivo" font-weight="500" font-size="23" fill="#5E4A3C">Schedule posts to X, Bluesky, Reddit, Instagram &amp; TikTok.</text>
  ${plats.map((p, i) => tile(p, 500 + i * 70, 474, 54)).join('')}
  <text x="500" y="576" font-family="DM Mono" font-weight="500" font-size="18" fill="#8F7B6A">Your keys stay in your browser. No sign-up.</text>
</svg>`;
}

// ---------- icons ----------
const iconSvg = ({ size, pad = 0, bg = null, radius = 0 }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ''}
  ${logo(pad, pad, size - pad * 2)}
</svg>`;

function render(svg, fontFiles, width) {
  return new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Archivo' },
  }).render().asPng();
}

// PNG-in-ICO container (supported by every modern browser and Windows).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

const fontFiles = await ensureFonts();
const out = (name, buf) => { fs.writeFileSync(path.join(PUB, name), buf); console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`); };

out('og.png', render(ogSvg(), fontFiles));
out('apple-touch-icon.png', render(iconSvg({ size: 180, pad: 18, bg: '#F3ECDD' }), fontFiles));
out('icon-192.png', render(iconSvg({ size: 192, pad: 10 }), fontFiles));
out('icon-512.png', render(iconSvg({ size: 512, pad: 26 }), fontFiles));
out('icon-maskable-512.png', render(iconSvg({ size: 512, pad: 92, bg: '#F3ECDD' }), fontFiles)); // safe zone for Android masks
out('favicon.ico', ico([16, 32, 48].map((size) => ({ size, buf: render(iconSvg({ size, pad: 0 }), fontFiles) }))));
fs.copyFileSync(path.join(PUB, 'img', 'logo.svg'), path.join(PUB, 'favicon.svg'));
console.log('  favicon.svg (copied from img/logo.svg)\nDone.');
