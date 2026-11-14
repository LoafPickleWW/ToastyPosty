// Video Studio engine: draws one frame of a photo-to-video template at time t, then the captions.
// Everything is sized relative to a 1080px-wide frame (u = W / 1080), so the same code draws the
// full-size export, the on-screen preview and the tiny live template thumbnails.

export const FORMATS = [
  { id: '9:16', label: '9:16', sub: 'TikTok · Reels', w: 1080, h: 1920 },
  { id: '4:5', label: '4:5', sub: 'Feed post', w: 1080, h: 1350 },
  { id: '1:1', label: '1:1', sub: 'Square', w: 1080, h: 1080 },
];

// ---------- Fonts (Google Fonts; Archivo + DM Mono are already on the page) ----------
export const FONTS = [
  { id: 'tiktok', family: 'TikTok Sans', weight: 800, label: 'TikTok Sans' },
  { id: 'montserrat', family: 'Montserrat', weight: 900, label: 'Montserrat' },
  { id: 'poppins', family: 'Poppins', weight: 700, label: 'Poppins' },
  { id: 'archivo', family: 'Archivo', weight: 900, label: 'Archivo', loaded: true },
  { id: 'anton', family: 'Anton', weight: 400, label: 'Anton', lh: 1.1 },
  { id: 'bebas', family: 'Bebas Neue', weight: 400, label: 'Bebas Neue', lh: 1.02 },
  { id: 'bangers', family: 'Bangers', weight: 400, label: 'Bangers', lh: 1.08 },
  { id: 'marker', family: 'Permanent Marker', weight: 400, label: 'Marker' },
  { id: 'pacifico', family: 'Pacifico', weight: 400, label: 'Pacifico', lh: 1.45 },
  { id: 'caveat', family: 'Caveat', weight: 700, label: 'Caveat', lh: 1.05 },
  { id: 'playfair', family: 'Playfair Display', weight: 800, italic: true, label: 'Playfair' },
  { id: 'courier', family: 'Courier Prime', weight: 700, label: 'Typewriter' },
];
const fontOf = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const fontCss = (id, px) => { const f = fontOf(id); return `${f.italic ? 'italic ' : ''}${f.weight} ${px}px "${f.family}", "Archivo", system-ui, sans-serif`; };

let fontLink;
export function ensureFonts() {
  if (!fontLink) {
    const fams = FONTS.filter((f) => !f.loaded).map((f) => `family=${f.family.replace(/ /g, '+')}:${f.italic ? `ital,wght@1,${f.weight}` : `wght@${f.weight}`}`);
    fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = `https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap`;
    document.head.append(fontLink);
  }
  const loads = [...FONTS.map((f) => fontCss(f.id, 40)), '500 40px "DM Mono"'].map((s) => document.fonts.load(s).catch(() => null));
  return Promise.all(loads);
}

// ---------- Caption looks ----------
export const STYLES = [
  { id: 'outline', label: 'Outline' },
  { id: 'box', label: 'TikTok box' },
  { id: 'soft', label: 'Subtitle' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'hard', label: 'Sticker' },
  { id: 'neon', label: 'Glow' },
  { id: 'plain', label: 'Plain' },
];
export const ANIMS = [
  ['pop', 'Pop in'], ['words', 'Word by word'], ['karaoke', 'Highlight words'], ['type', 'Typewriter'], ['fade', 'Fade'], ['none', 'None'],
];
export const COLORS = ['#FFFFFF', '#111111', '#FFE14D', '#FF3B5C', '#25F4EE', '#7CFF6B', '#FF8A00', '#C9A7FF'];

// Ready-made combos, based on what's common in short-form video right now.
export const LOOKS = [
  { id: 'hook', label: 'Hook', text: 'wait for the last one…', patch: { font: 'tiktok', style: 'outline', color: '#FFFFFF', size: 92, y: 0.2, anim: 'pop', caps: false } },
  { id: 'native', label: 'TikTok native', text: 'POV: you finally got the shot', patch: { font: 'tiktok', style: 'box', color: '#FFFFFF', size: 62, y: 0.5, anim: 'none', caps: false } },
  { id: 'subs', label: 'Bold subtitles', text: 'this is your sign to go', patch: { font: 'montserrat', style: 'outline', color: '#FFE14D', size: 84, y: 0.66, anim: 'words', caps: true } },
  { id: 'karaoke', label: 'Karaoke', text: 'every single word lights up', patch: { font: 'tiktok', style: 'outline', color: '#FFFFFF', size: 80, y: 0.66, anim: 'karaoke', caps: true } },
  { id: 'vlog', label: 'Vlog', text: 'a little weekend reset', patch: { font: 'caveat', style: 'shadow', color: '#FFFFFF', size: 108, y: 0.5, anim: 'fade', caps: false } },
  { id: 'retro', label: 'Retro', text: 'summer, on film', patch: { font: 'courier', style: 'soft', color: '#FFFFFF', size: 58, y: 0.7, anim: 'type', caps: false } },
  { id: 'loud', label: 'Loud', text: 'NO WAY', patch: { font: 'anton', style: 'hard', color: '#FFE14D', size: 170, y: 0.42, anim: 'pop', caps: true } },
];

export const newCaption = (patch = {}) => ({
  id: Math.random().toString(36).slice(2, 10),
  text: 'Your caption', font: 'tiktok', style: 'outline', color: '#FFFFFF', size: 76,
  x: 0.5, y: 0.66, align: 'center', anim: 'pop', caps: false, from: null, to: null, ...patch,
});

// ---------- Math ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - (1 - k) ** 3;
const easeInOut = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const back = (k) => { const c = 1.70158; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
const rand = (i, salt = 0) => { const x = Math.sin(i * 127.1 + salt * 311.7 + 0.5) * 43758.5453; return x - Math.floor(x); };

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// ---------- Slides ----------
export function makeSlide(img, url, id) {
  const w = img.width, h = img.height;
  const b = document.createElement('canvas');
  b.width = 40; b.height = Math.max(1, Math.round((40 * h) / w));
  const bc = b.getContext('2d');
  if ('filter' in bc) bc.filter = 'blur(2px)';
  bc.drawImage(img, -2, -2, b.width + 4, b.height + 4);
  return { id, img, w, h, url, blur: { img: b, w: b.width, h: b.height } };
}

export async function loadSlide(blob, id) {
  let bmp = await createImageBitmap(blob);
  const big = Math.max(bmp.width, bmp.height);
  if (big > 2160) {
    const sc = 2160 / big;
    const r = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * sc), resizeHeight: Math.round(bmp.height * sc), resizeQuality: 'high' });
    bmp.close();
    bmp = r;
  }
  return makeSlide(bmp, URL.createObjectURL(blob), id);
}

// Stand-in photos so every template has something to show before you add your own.
let samples;
export function sampleSlides() {
  if (samples) return samples;
  const pal = [['#FFD45C', '#D7263D'], ['#A9DCC6', '#2F7D62'], ['#F3D9A4', '#C47A3A'], ['#FFB4C2', '#7A3E9D'], ['#9ED8FF', '#2856A3'], ['#FFE79A', '#E8742A']];
  samples = pal.map(([a, b], i) => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 750;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 600, 750);
    g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(0, 0, 600, 750);
    x.fillStyle = 'rgba(255,255,255,0.22)';
    x.beginPath(); x.arc(150 + i * 60, 220 + (i % 3) * 90, 150, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.beginPath(); x.arc(460 - i * 30, 600 - (i % 2) * 120, 210, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.font = '900 120px "Archivo", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(i + 1), 300, 375);
    return makeSlide(c, null, 'sample' + i);
  });
  return samples;
}

// ---------- Drawing helpers ----------
// Crop-to-fill an image into a rect. z >= 1 zooms in; px/py in -1..1 pan across the overflow.
function cover(ctx, s, x, y, w, h, z = 1, px = 0, py = 0) {
  const sc = Math.max(w / s.w, h / s.h) * Math.max(1, z);
  const sw = w / sc, sh = h / sc;
  const sx = ((s.w - sw) / 2) * (1 + clamp(px, -1, 1));
  const sy = ((s.h - sh) / 2) * (1 + clamp(py, -1, 1));
  ctx.drawImage(s.img, sx, sy, sw, sh, x, y, w, h);
}
// The whole photo, letterboxed over a blurred copy of itself (the "fit" option).
function photo(ctx, s, e, x, y, w, h, z = 1, px = 0, py = 0) {
  if (e.fit !== 'fit') return cover(ctx, s, x, y, w, h, z, px, py);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  cover(ctx, s.blur, x, y, w, h, 1.15);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x, y, w, h);
  const sc = Math.min(w / s.w, h / s.h) * z;
  const dw = s.w * sc, dh = s.h * sc;
  ctx.drawImage(s.img, x + (w - dw) / 2 + px * w * 0.03, y + (h - dh) / 2 + py * h * 0.03, dw, dh);
  ctx.restore();
}
const full = (ctx, s, e, z, px, py) => photo(ctx, s, e, 0, 0, e.W, e.H, z, px, py);

let noise;
function grain(ctx, e, amt) {
  if (!noise) {
    noise = document.createElement('canvas');
    noise.width = noise.height = 160;
    const nx = noise.getContext('2d');
    const d = nx.createImageData(160, 160);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    nx.putImageData(d, 0, 0);
  }
  const f = Math.floor(e.t * 24);
  ctx.save();
  ctx.globalAlpha = amt;
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(-rand(f, 7) * 160, -rand(f, 8) * 160);
  ctx.fillStyle = ctx.createPattern(noise, 'repeat');
  ctx.fillRect(0, 0, e.W + 160, e.H + 160);
  ctx.restore();
}
function vignette(ctx, e, amt) {
  const g = ctx.createRadialGradient(e.W / 2, e.H / 2, Math.min(e.W, e.H) * 0.32, e.W / 2, e.H / 2, Math.hypot(e.W, e.H) / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${amt})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, e.W, e.H);
}
function chip(ctx, e, text, x, y, alpha = 1) {
  if (alpha <= 0) return;
  const s = 44 * e.u;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontCss('tiktok', s);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + s * 1.2;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  rr(ctx, x - w / 2, y - s * 0.85, w, s * 1.7, s * 0.85); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y + s * 0.04);
  ctx.restore();
}

// Cached colour grades (applied once per photo, not every frame).
const grades = new WeakMap();
function graded(s, key, fn) {
  let m = grades.get(s);
  if (!m) grades.set(s, (m = {}));
  if (m[key]) return m[key];
  const sc = Math.min(1, 1280 / Math.max(s.w, s.h));
  const c = document.createElement('canvas');
  c.width = Math.round(s.w * sc); c.height = Math.round(s.h * sc);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(s.img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height);
  fn(d.data);
  x.putImageData(d, 0, 0);
  return (m[key] = { ...s, img: c, w: c.width, h: c.height });
}
const filmGrade = (p) => {
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    // fade + warm: lift blacks, desaturate a little, push to amber
    p[i] = clamp((lerp(r, l, 0.35) * 0.92 + 28) * 1.06, 0, 255);
    p[i + 1] = clamp(lerp(g, l, 0.35) * 0.9 + 22, 0, 255);
    p[i + 2] = clamp(lerp(b, l, 0.35) * 0.78 + 18, 0, 255);
  }
};

const scratch = new Map();
function scratchCanvas(W, H) {
  const k = W + 'x' + H;
  if (!scratch.has(k)) { const c = document.createElement('canvas'); c.width = W; c.height = H; scratch.set(k, c); }
  return scratch.get(k);
}

// ---------- Timelines ----------
const even = (n, per, tail = 0) => ({ total: n * per + tail, starts: [...Array(n)].map((_, i) => i * per) });
function step(e) {
  let i = 0;
  while (i < e.n - 1 && e.plan.starts[i + 1] <= e.t) i++;
  const start = e.plan.starts[i];
  const end = i + 1 < e.n ? e.plan.starts[i + 1] : e.plan.total;
  return { i, local: e.t - start, len: end - start, s: e.slides[i], prev: e.slides[i - 1] };
}

// ---------- Templates ----------
const LIST = [
  {
    id: 'dump', name: 'Photo Dump', tag: 'Trending', per: 0.55, min: 0.25, max: 1.5,
    blurb: 'Snappy cuts on the beat with a zoom punch and flash on every photo. Set the pace to your song’s BPM.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local, s } = step(e);
      const k = easeOut(clamp(local / 0.24));
      const r = (rand(i) - 0.5) * 0.06 * (1 - k);
      ctx.save();
      ctx.translate(e.W / 2, e.H / 2); ctx.rotate(r); ctx.translate(-e.W / 2, -e.H / 2);
      full(ctx, s, e, 1.02 + 0.16 * (1 - k), (rand(i, 1) - 0.5) * 0.6, (rand(i, 2) - 0.5) * 0.6);
      ctx.restore();
      if (i > 0 && local < 0.08) { ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - local / 0.08)})`; ctx.fillRect(0, 0, e.W, e.H); }
    },
  },
  {
    id: 'memories', name: 'Soft Memories', tag: 'Aesthetic', per: 2.6, min: 1.4, max: 5,
    blurb: 'Slow drifting zooms, dreamy crossfades and a warm film grade. Made for recaps and “core memory” posts.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local } = step(e);
      const xf = Math.min(0.8, e.per * 0.4);
      const kb = (j, tt) => {
        const p = clamp(tt / (e.per + xf));
        full(ctx, e.slides[j], e, lerp(1.04, 1.18, j % 3 === 1 ? 1 - p : p), (j % 2 ? 1 : -1) * lerp(-0.6, 0.6, p), (rand(j) - 0.5) * 0.6);
      };
      if (i > 0 && local < xf) {
        kb(i - 1, e.t - e.plan.starts[i - 1] + xf);
        ctx.globalAlpha = easeInOut(local / xf);
      }
      kb(i, local + xf);
      ctx.globalAlpha = 1;
      if (e.t < 0.5) { ctx.fillStyle = `rgba(0,0,0,${1 - e.t / 0.5})`; ctx.fillRect(0, 0, e.W, e.H); }
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(255,160,80,0.22)';
      ctx.fillRect(0, 0, e.W, e.H);
      ctx.restore();
      vignette(ctx, e, 0.38);
      grain(ctx, e, 0.06);
    },
  },
  {
    id: 'beforeafter', name: 'Before & After', tag: 'Glow-up', per: 3.2, min: 1.8, max: 6, unit: 'pair',
    blurb: 'Photos pair up (1 & 2, 3 & 4…). A slider wipes from the before to the after. Great for makeovers, rooms and edits.',
    plan(n, per) {
      const pairs = Math.ceil(n / 2);
      return { total: pairs * per, starts: [...Array(n)].map((_, i) => Math.floor(i / 2) * per + (i % 2) * per * 0.55) };
    },
    draw(ctx, e) {
      const pairs = Math.ceil(e.n / 2);
      const j = Math.min(pairs - 1, Math.floor(e.t / e.per));
      const local = e.t - j * e.per;
      const a = e.slides[2 * j], b = e.slides[2 * j + 1];
      const z = 1.0 + 0.04 * (local / e.per);
      full(ctx, a, e, z);
      if (!b) return;
      const w = easeInOut(clamp((local - e.per * 0.32) / (e.per * 0.36)));
      if (w > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, e.W * w, e.H); ctx.clip();
        full(ctx, b, e, z);
        ctx.restore();
      }
      if (w > 0 && w < 1) {
        const x = e.W * w, u = e.u;
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 3 * u, 0, 6 * u, e.H);
        ctx.beginPath(); ctx.arc(x, e.H / 2, 44 * u, 0, 7);
        ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 20 * u; ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#24170F';
        ctx.font = fontCss('tiktok', 40 * u); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('‹ ›', x, e.H / 2);
      }
      chip(ctx, e, 'BEFORE', e.W / 2, e.H * 0.13, 1 - clamp(w * 2));
      chip(ctx, e, 'AFTER', e.W / 2, e.H * 0.13, clamp(w * 2 - 1));
    },
  },
  {
    id: 'countdown', name: 'Countdown', tag: 'Top list', per: 2.2, min: 1.2, max: 5,
    blurb: 'A numbered “top 5” list that counts down to #1, with a swipe between each pick. Put your best photo last.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local, s, prev } = step(e);
      const tr = Math.min(0.38, e.per * 0.3);
      const k = i > 0 ? easeInOut(clamp(local / tr)) : 1;
      if (k < 1) {
        ctx.save(); ctx.translate(-k * e.W, 0); full(ctx, prev, e, 1.05); ctx.restore();
        ctx.save(); ctx.translate((1 - k) * e.W, 0); full(ctx, s, e, 1); ctx.restore();
      } else full(ctx, s, e, 1 + 0.05 * clamp((local - tr) / e.per));
      const pk = clamp((local - (i > 0 ? tr * 0.7 : 0)) / 0.35);
      if (pk <= 0) return;
      const u = e.u;
      ctx.save();
      ctx.translate(150 * u, e.H * 0.2);
      ctx.scale(back(pk), back(pk));
      ctx.font = `400 ${240 * u}px "Anton", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = 24 * u; ctx.strokeStyle = '#111';
      const label = '#' + (e.n - i);
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = i === e.n - 1 ? '#FFE14D' : '#fff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    },
  },
  {
    id: 'swipe', name: 'Carousel Swipe', tag: 'Carousel', per: 2.2, min: 1, max: 5,
    blurb: 'Your photos as cards that swipe across like a carousel, with page dots. Turns a photo carousel into a Reel.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local, s, prev } = step(e);
      const u = e.u;
      const tr = Math.min(0.55, e.per * 0.4);
      const k = i > 0 ? clamp(local / tr) : 1;
      const m = back(k);
      cover(ctx, (k < 1 ? prev : s).blur, 0, 0, e.W, e.H, 1.1);
      if (k < 1) { ctx.globalAlpha = easeInOut(k); cover(ctx, s.blur, 0, 0, e.W, e.H, 1.1); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, e.W, e.H);
      const mg = 60 * u, cw = e.W - mg * 2;
      const ch = Math.min(e.H * 0.72, cw * 1.25), cy = e.H / 2 - 30 * u;
      const card = (sl, dx) => {
        ctx.save();
        ctx.translate(dx, 0);
        ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 16 * u;
        ctx.fillStyle = '#000';
        rr(ctx, mg, cy - ch / 2, cw, ch, 38 * u); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.clip();
        photo(ctx, sl, e, mg, cy - ch / 2, cw, ch, 1 + 0.03 * clamp(local / e.per));
        ctx.restore();
      };
      if (k < 1) card(prev, -m * (cw + mg * 1.5));
      card(s, (1 - m) * (cw + mg * 1.5));
      const dots = Math.min(e.n, 12), dy = cy + ch / 2 + 56 * u, gap = 26 * u;
      const active = Math.min(dots - 1, i);
      let x = e.W / 2 - ((dots - 1) * gap + 22 * u) / 2;
      for (let d = 0; d < dots; d++) {
        const on = d === active;
        ctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.5)';
        rr(ctx, x - 7 * u, dy - 7 * u, on ? 36 * u : 14 * u, 14 * u, 7 * u); ctx.fill();
        x += gap + (on ? 22 * u : 0);
      }
    },
  },
  {
    id: 'grid', name: 'Collage Reveal', tag: 'Collage', per: 1.4, min: 0.6, max: 4,
    blurb: 'Opens on a collage of up to 9 photos popping in, then zooms out of each tile into a full-screen shot.',
    plan(n, per) {
      const intro = Math.min(n, 9) * 0.16 + 0.9;
      return { total: intro + n * per, starts: [...Array(n)].map((_, i) => intro + i * per), intro };
    },
    draw(ctx, e) {
      const u = e.u;
      const m = Math.min(e.n, 9);
      const cols = m <= 2 ? 1 : m <= 6 ? 2 : 3, rows = Math.ceil(m / cols), g = 12 * u;
      const rowH = (e.H - g * (rows + 1)) / rows;
      const cells = [];
      for (let r = 0; r < rows; r++) {
        const cnt = r < rows - 1 ? cols : m - cols * (rows - 1);
        const cw = (e.W - g * (cnt + 1)) / cnt;
        for (let c = 0; c < cnt; c++) cells.push([g + c * (cw + g), g + r * (rowH + g), cw, rowH]);
      }
      const grid = (tt) => {
        ctx.fillStyle = '#F8F2E6';
        ctx.fillRect(0, 0, e.W, e.H);
        cells.forEach(([x, y, w, h], k) => {
          const a = clamp((tt - k * 0.16) / 0.32);
          if (a <= 0) return;
          const sc = lerp(0.55, 1, back(a));
          ctx.save();
          ctx.globalAlpha = clamp(a * 2);
          ctx.translate(x + w / 2, y + h / 2); ctx.scale(sc, sc);
          ctx.beginPath(); rr(ctx, -w / 2, -h / 2, w, h, 18 * u); ctx.clip();
          cover(ctx, e.slides[k], -w / 2, -h / 2, w, h);
          ctx.restore();
        });
      };
      if (e.t < e.plan.intro) return grid(e.t);
      const { i, local, s, prev } = step(e);
      const tr = Math.min(0.5, e.per * 0.45);
      if (local >= tr) return full(ctx, s, e, 1 + 0.05 * clamp((local - tr) / e.per));
      const k = easeInOut(local / tr);
      if (i === 0) grid(e.plan.intro); else full(ctx, prev, e, 1.05);
      if (i < m) {
        const [x, y, w, h] = cells[i];
        const R = [lerp(x, 0, k), lerp(y, 0, k), lerp(w, e.W, k), lerp(h, e.H, k)];
        ctx.save();
        ctx.beginPath(); rr(ctx, ...R, 18 * u * (1 - k)); ctx.clip();
        photo(ctx, s, e, ...R);
        ctx.restore();
      } else {
        ctx.globalAlpha = k; full(ctx, s, e, 1); ctx.globalAlpha = 1;
      }
    },
  },
  {
    id: 'polaroid', name: 'Polaroid Pile', tag: 'Scrapbook', per: 1.3, min: 0.6, max: 3,
    blurb: 'Each photo drops onto a growing pile of instant-film prints. Cosy, crafty and very save-able.',
    plan: (n, per) => even(n, per, 1),
    draw(ctx, e) {
      const { i, local, s } = step(e);
      const u = e.u;
      cover(ctx, s.blur, 0, 0, e.W, e.H, 1.2);
      ctx.fillStyle = 'rgba(30,18,10,0.35)';
      ctx.fillRect(0, 0, e.W, e.H);
      const fw = Math.min(e.W * 0.74, e.H * 0.52), pad = fw * 0.06, inner = fw - pad * 2, fh = pad + inner + fw * 0.2;
      for (let k = Math.max(0, i - 7); k <= i; k++) {
        const age = k === i ? local : 9;
        const a = easeOut(clamp(age / 0.42));
        const cx = e.W / 2 + (rand(k, 3) - 0.5) * e.W * 0.16, cy = e.H / 2 - 20 * u + (rand(k, 4) - 0.5) * e.H * 0.1;
        ctx.save();
        ctx.globalAlpha = clamp(age / 0.12);
        ctx.translate(cx, cy);
        ctx.rotate((rand(k, 5) - 0.5) * 0.28 + (1 - a) * 0.35);
        ctx.scale(lerp(1.7, 1, a), lerp(1.7, 1, a));
        if (k >= i - 1) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 36 * u; ctx.shadowOffsetY = 14 * u; }
        else { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-fw / 2 + 6 * u, -fh / 2 + 10 * u, fw, fh); }
        ctx.fillStyle = '#FBF8F1';
        ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
        ctx.shadowColor = 'transparent';
        cover(ctx, e.slides[k], -fw / 2 + pad, -fh / 2 + pad, inner, inner);
        ctx.restore();
      }
    },
  },
  {
    id: 'film', name: 'Vintage Reel', tag: 'Retro', per: 2, min: 1, max: 4,
    blurb: 'Faded film colour, grain, flicker, sprocket holes and a camcorder date stamp. Instant nostalgia.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local, s } = step(e);
      const u = e.u, f = Math.floor(e.t * 24), bar = 62 * u;
      ctx.fillStyle = '#0b0907';
      ctx.fillRect(0, 0, e.W, e.H);
      ctx.save();
      ctx.translate((rand(f, 1) - 0.5) * 6 * u, (rand(f, 2) - 0.5) * 8 * u);
      photo(ctx, graded(s, 'film', filmGrade), e, bar, 0, e.W - bar * 2, e.H, 1.03 + 0.04 * (local / e.per));
      ctx.restore();
      ctx.fillStyle = `rgba(0,0,0,${rand(f, 3) * 0.09})`;
      ctx.fillRect(0, 0, e.W, e.H);
      const leak = Math.max(0, Math.sin(e.t * 0.9 + 1.3)) ** 3;
      if (leak > 0.02) {
        const g = ctx.createRadialGradient(e.W, e.H * 0.3, 0, e.W, e.H * 0.3, e.W * 0.9);
        g.addColorStop(0, `rgba(255,120,40,${0.4 * leak})`); g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0, 0, e.W, e.H); ctx.restore();
      }
      if (i > 0 && local < 0.14) { ctx.fillStyle = `rgba(10,6,4,${1 - local / 0.14})`; ctx.fillRect(0, 0, e.W, e.H); }
      vignette(ctx, e, 0.6);
      grain(ctx, e, 0.14);
      ctx.fillStyle = '#0b0907';
      ctx.fillRect(0, 0, bar, e.H); ctx.fillRect(e.W - bar, 0, bar, e.H);
      ctx.fillStyle = 'rgba(236,228,212,0.85)';
      const sp = 88 * u, off = (e.t * 260 * u) % sp;
      for (let y = -sp + off; y < e.H; y += sp) {
        rr(ctx, bar / 2 - 14 * u, y, 28 * u, 44 * u, 7 * u); ctx.fill();
        rr(ctx, e.W - bar / 2 - 14 * u, y, 28 * u, 44 * u, 7 * u); ctx.fill();
      }
      const d = new Date();
      const stamp = `${String(d.getMonth() + 1).padStart(2, ' ')} ${String(d.getDate()).padStart(2, '0')} '${String(d.getFullYear()).slice(2)}`;
      ctx.save();
      ctx.font = `500 ${50 * u}px "DM Mono", "Courier New", monospace`;
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#FF9A3C'; ctx.shadowColor = 'rgba(255,120,30,0.9)'; ctx.shadowBlur = 14 * u;
      ctx.fillText(stamp, e.W - bar - 40 * u, e.H - Math.max(110 * u, e.H * 0.17));
      ctx.restore();
    },
  },
  {
    id: 'glitch', name: 'Glitch Cut', tag: 'Hype', per: 0.8, min: 0.35, max: 2,
    blurb: 'RGB split, screen shake and sliced frames on every cut. Pairs well with a hard-hitting drop.',
    plan: (n, per) => even(n, per),
    draw(ctx, e) {
      const { i, local, s } = step(e);
      const u = e.u, f = Math.floor(e.t * 30);
      const g = i > 0 ? 1 - clamp(local / 0.24) : 0;
      const z = 1.06 + 0.05 * (local / e.per);
      ctx.save();
      ctx.translate((rand(f, 1) - 0.5) * 40 * u * g, (rand(f, 2) - 0.5) * 40 * u * g);
      full(ctx, s, e, z);
      ctx.restore();
      if (g <= 0) return;
      const sc = scratchCanvas(e.W, e.H), sx = sc.getContext('2d');
      for (const [col, dx] of [['#FF0040', -26], ['#00E5FF', 26]]) {
        sx.globalCompositeOperation = 'source-over';
        sx.clearRect(0, 0, e.W, e.H);
        full(sx, s, e, z);
        sx.globalCompositeOperation = 'multiply';
        sx.fillStyle = col; sx.fillRect(0, 0, e.W, e.H);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.65 * g;
        ctx.drawImage(sc, dx * u * g, 0);
        ctx.restore();
      }
      const src = ctx.canvas;
      for (let b = 0; b < 7; b++) {
        if (rand(f, b + 10) > 0.6) continue;
        const y = rand(f, b + 20) * e.H, hgt = (20 + rand(f, b + 30) * 120) * u;
        ctx.drawImage(src, 0, y, e.W, hgt, (rand(f, b + 40) - 0.5) * 140 * u * g, y, e.W, hgt);
      }
    },
  },
];
export const TEMPLATE_LIST = LIST;
export const TEMPLATES = Object.fromEntries(LIST.map((t) => [t.id, t]));

export const paceOf = (proj, id = proj.template) => proj.pace?.[id] ?? TEMPLATES[id].per;
export function timeline(proj, id = proj.template) {
  const slides = proj.slides.length ? proj.slides : sampleSlides();
  const per = paceOf(proj, id);
  return { ...TEMPLATES[id].plan(slides.length, per), n: slides.length, per, slides };
}
export function captionWindow(c, tl) {
  if (c.from == null) return [0, tl.total];
  const a = clamp(c.from, 0, tl.n - 1), b = clamp(c.to ?? c.from, a, tl.n - 1);
  return [tl.starts[a], b + 1 < tl.n ? tl.starts[b + 1] : tl.total];
}

// ---------- Captions ----------
const contrast = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? '#111111' : '#FFFFFF';
};

function layoutCaption(ctx, c, e) {
  const s = c.size * e.u;
  ctx.font = fontCss(c.font, s);
  const txt = c.caps ? c.text.toUpperCase() : c.text;
  const maxW = e.W * 0.86, space = ctx.measureText(' ').width;
  const lines = [];
  for (const para of txt.split('\n')) {
    let line = [], lw = 0;
    for (const t of para.split(/\s+/).filter(Boolean)) {
      const w = ctx.measureText(t).width;
      if (line.length && lw + space + w > maxW) { lines.push({ words: line, w: lw }); line = []; lw = 0; }
      lw += (line.length ? space : 0) + w;
      line.push({ t, w });
    }
    lines.push({ words: line, w: lw });
  }
  const lh = s * (fontOf(c.font).lh || 1.2);
  const bw = Math.max(0, ...lines.map((l) => l.w)), bh = lines.length * lh;
  const cx = c.x * e.W, cy = c.y * e.H, left = cx - bw / 2, top = cy - bh / 2;
  lines.forEach((L, li) => {
    let x = c.align === 'left' ? left : c.align === 'right' ? left + bw - L.w : cx - L.w / 2;
    L.y = top + lh * (li + 0.5);
    for (const w of L.words) { w.x = x; x += w.w + space; }
  });
  return { s, lines, lh, bw, bh, left, top, cx, cy };
}

function drawWord(ctx, c, t, x, y, s, ink) {
  switch (c.style) {
    case 'outline':
      ctx.lineWidth = s * 0.18; ctx.strokeStyle = '#000'; ctx.strokeText(t, x, y);
      ctx.fillStyle = ink; ctx.fillText(t, x, y); break;
    case 'box':
      ctx.fillStyle = ink === c.color ? contrast(c.color) : ink; ctx.fillText(t, x, y); break;
    case 'shadow':
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s * 0.3; ctx.shadowOffsetY = s * 0.06;
      ctx.fillStyle = ink; ctx.fillText(t, x, y);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; break;
    case 'hard':
      ctx.fillStyle = '#000'; ctx.fillText(t, x + s * 0.07, y + s * 0.08);
      ctx.lineWidth = s * 0.08; ctx.strokeStyle = '#000'; ctx.strokeText(t, x, y);
      ctx.fillStyle = ink; ctx.fillText(t, x, y); break;
    case 'neon':
      ctx.shadowColor = ink; ctx.shadowBlur = s * 0.6; ctx.fillStyle = ink; ctx.fillText(t, x, y);
      ctx.shadowBlur = s * 0.18; ctx.fillStyle = '#FFFFFF'; ctx.fillText(t, x, y);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; break;
    default:
      ctx.fillStyle = ink; ctx.fillText(t, x, y);
  }
}

function drawCaption(ctx, c, e, start, end) {
  if (!c.text.trim() || e.t < start || e.t > end) return null;
  const a = e.t - start, dur = Math.max(0.3, end - start);
  const L = layoutCaption(ctx, c, e);
  const words = L.lines.flatMap((l) => l.words);
  if (!words.length) return null;
  const s = L.s;
  let alpha = end < e.total - 0.01 ? clamp((end - e.t) / 0.15) : 1;
  let scale = 1;
  if (c.anim === 'fade') alpha *= clamp(a / 0.4);
  if (c.anim === 'pop') { scale = lerp(0.4, 1, back(clamp(a / 0.32))); alpha *= clamp(a / 0.1); }
  const rate = Math.min(0.32, (dur * 0.7) / words.length);
  const chars = words.reduce((n, w) => n + w.t.length, 0);
  const cps = Math.min(0.055, (dur * 0.6) / Math.max(1, chars));
  const shownChars = c.anim === 'type' ? Math.floor(a / cps) : Infinity;
  const active = c.anim === 'karaoke' ? Math.min(words.length - 1, Math.floor(a / Math.min(0.5, (dur * 0.9) / words.length))) : -1;
  const accent = /^#(FFE14D|FF8A00|7CFF6B)$/i.test(c.color) ? '#25F4EE' : '#FFE14D';
  const pad = c.style === 'box' || c.style === 'soft' ? s * 0.32 : s * 0.15;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(L.cx, L.cy); ctx.scale(scale, scale); ctx.translate(-L.cx, -L.cy);
  ctx.font = fontCss(c.font, s);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;

  let wi = 0, ci = 0;
  const plan = L.lines.map((line) => line.words.map((w) => {
    const idx = wi++;
    const start = ci; ci += w.t.length;
    let text = w.t, ws = 1;
    if (c.anim === 'words') { const wt = a - idx * rate; if (wt < 0) return null; ws = lerp(0.6, 1, back(clamp(wt / 0.16))); }
    if (c.anim === 'type') { if (shownChars <= start) return null; text = w.t.slice(0, shownChars - start); }
    return { ...w, text, ws, idx };
  }).filter(Boolean));

  if (c.style === 'box' || c.style === 'soft') {
    ctx.fillStyle = c.style === 'box' ? c.color : 'rgba(0,0,0,0.6)';
    L.lines.forEach((line, li) => {
      const vis = plan[li];
      if (!vis.length) return;
      const last = vis[vis.length - 1];
      const x0 = vis[0].x, x1 = last.x + ctx.measureText(last.text).width;
      rr(ctx, x0 - pad, line.y - L.lh / 2 - s * 0.04, x1 - x0 + pad * 2, L.lh + s * 0.08, s * 0.24);
      ctx.fill();
    });
  }
  L.lines.forEach((line, li) => {
    for (const w of plan[li]) {
      const ink = w.idx === active ? accent : c.color;
      if (w.ws !== 1) {
        const mx = w.x + w.w / 2;
        ctx.save(); ctx.translate(mx, line.y); ctx.scale(w.ws, w.ws); ctx.translate(-mx, -line.y);
        drawWord(ctx, c, w.text, w.x, line.y, s, ink);
        ctx.restore();
      } else drawWord(ctx, c, w.text, w.x, line.y, s, ink);
    }
  });
  ctx.restore();
  return { x: L.left - pad, y: L.top - pad * 0.6, w: L.bw + pad * 2, h: L.bh + pad * 1.2 };
}

// TikTok / Reels put buttons over these areas: keep captions out of them.
function safeZones(ctx, e) {
  const u = e.u;
  ctx.save();
  ctx.fillStyle = 'rgba(215,38,61,0.2)';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([10 * u, 8 * u]); ctx.lineWidth = 3 * u;
  const zones = e.H / e.W > 1.6
    ? [[0, 0, e.W, e.H * 0.085, 'Top tabs'], [e.W * 0.86, e.H * 0.42, e.W * 0.14, e.H * 0.42, ''], [0, e.H * 0.84, e.W, e.H * 0.16, 'Username, caption & sound']]
    : [[0, e.H * 0.88, e.W, e.H * 0.12, 'Caption area']];
  ctx.font = `600 ${30 * u}px "Archivo", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [x, y, w, h, label] of zones) {
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    if (label) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(label, x + w / 2, y + h / 2); ctx.fillStyle = 'rgba(215,38,61,0.2)'; }
  }
  ctx.restore();
}

// ---------- One frame ----------
// Returns the on-canvas box of each visible caption (for click-to-select and dragging).
export function renderFrame(ctx, proj, t, { template, captions = true, selected, safe } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const id = template || proj.template;
  const tl = timeline(proj, id);
  const e = { W, H, u: W / 1080, slides: tl.slides, n: tl.n, per: tl.per, plan: tl, total: tl.total, fit: proj.fit, t: clamp(t, 0, tl.total - 1e-4) };
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  TEMPLATES[id].draw(ctx, e);
  ctx.restore();
  const boxes = {};
  if (!captions) return boxes;
  for (const c of proj.captions) {
    const [a, b] = captionWindow(c, tl);
    const box = drawCaption(ctx, c, e, a, b);
    if (box) boxes[c.id] = box;
  }
  if (safe) safeZones(ctx, e);
  const sel = selected && boxes[selected];
  if (sel) {
    ctx.save();
    ctx.strokeStyle = '#FFD45C'; ctx.lineWidth = 4 * e.u; ctx.setLineDash([14 * e.u, 10 * e.u]);
    ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFD45C'; ctx.strokeStyle = '#24170F'; ctx.lineWidth = 3 * e.u;
    ctx.beginPath(); ctx.arc(sel.x + sel.w, sel.y + sel.h, 22 * e.u, 0, 7); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  return boxes;
}

// ---------- Export ----------
export function pickMime(withAudio) {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = withAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4D4028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4D4028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Records the video in real time (an 8-second video takes about 8 seconds).
export async function recordVideo(proj, { onProgress, signal } = {}) {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw new Error('This browser can’t record video. Try Chrome, Edge or Firefox.');
  await ensureFonts();
  const f = FORMATS.find((x) => x.id === proj.format) || FORMATS[0];
  const canvas = document.createElement('canvas');
  canvas.width = f.w; canvas.height = f.h;
  const ctx = canvas.getContext('2d', { alpha: false });
  const tl = timeline(proj);
  renderFrame(ctx, proj, 0);
  const stream = canvas.captureStream(30);

  let ac, src;
  if (proj.audio) {
    ac = new AudioContext();
    await ac.resume();
    const dest = ac.createMediaStreamDestination();
    const gain = ac.createGain();
    src = ac.createBufferSource();
    src.buffer = proj.audio.buffer;
    src.connect(gain).connect(dest);
    const vol = proj.audio.volume ?? 1, now = ac.currentTime, end = now + tl.total;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.setValueAtTime(vol, Math.max(now, end - 1.2)); // fade the song out over the last moment
    gain.gain.linearRampToValueAtTime(0, end);
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }
  const mimeType = pickMime(!!proj.audio);
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (ev) => rej(ev.error || new Error('Recording failed.')); });
  rec.start(500);
  src?.start(0, proj.audio.offset || 0);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      if (signal?.aborted) return resolve();
      const t = (performance.now() - t0) / 1000;
      renderFrame(ctx, proj, Math.min(t, tl.total));
      onProgress?.(Math.min(1, t / tl.total));
      if (t >= tl.total + 0.15) return resolve();
      // A timer, not requestAnimationFrame: rAF stalls whenever the page is covered, which drops frames.
      setTimeout(tick, 1000 / 40);
    };
    tick();
  });
  rec.stop();
  try { src?.stop(); } catch {}
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  ac?.close();
  if (signal?.aborted) return null;
  const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), type, width: f.w, height: f.h, duration: tl.total };
}
