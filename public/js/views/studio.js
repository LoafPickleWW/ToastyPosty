// Video Studio: turn a handful of photos into a TikTok / Reels video, right in the browser.
// Pick a template, add captions, drop in a song, export an MP4 and add it to a post.
import { h, icon, pop, modal, busy, confirmBox } from '../ui.js';
import { state, api, media, mediaUrl } from '../api.js';
import {
  FORMATS, FONTS, STYLES, ANIMS, COLORS, LOOKS, TEMPLATE_LIST, TEMPLATES,
  renderFrame, timeline, captionWindow, paceOf, loadSlide, ensureFonts, recordVideo, pickMime, newCaption, fontCss,
} from '../studio/engine.js';
import { blankShop, cleanUrl, isAmazon } from '../shop.js';
import * as idb from '../db.js';

const DRAFT_KEY = 'toastyposty.draft';
const uid = () => Math.random().toString(36).slice(2, 10);
const PREVIEW_SCALE = 2 / 3; // preview canvas draws at 720px wide; the export is full 1080

// The project lives for this browser session, so hopping to Compose and back keeps your work.
const fresh = () => ({ template: 'dump', format: '9:16', fit: 'fill', pace: {}, slides: [], captions: [], audio: null, shopCta: '🔗 Link in bio' });
const proj = fresh();

// ---------- Saved in this browser (IndexedDB): survives refreshes until you clear it ----------
const snapshot = () => ({
  template: proj.template, format: proj.format, fit: proj.fit, pace: proj.pace, captions: proj.captions, shopCta: proj.shopCta,
  slides: proj.slides.map((s) => ({ id: s.id, mediaId: s.mediaId || null, product: s.product || null })),
  audio: proj.audio ? { name: proj.audio.name, offset: proj.audio.offset, volume: proj.audio.volume } : null,
});
let restored = false, restoring = null;
let savedMeta = '', savedIds = new Set(), savedAudio = null;
async function restore() {
  try {
    const meta = await idb.get('studio');
    if (meta) {
      const { slides = [], audio, ...rest } = meta;
      Object.assign(proj, fresh(), rest, { slides: [], audio: null });
      if (!TEMPLATES[proj.template]) proj.template = 'dump';
      if (!FORMATS.some((f) => f.id === proj.format)) proj.format = '9:16';
      for (const sm of slides) {
        const blob = await idb.getStudioFile(sm.id).catch(() => null);
        if (!blob) continue;
        try {
          const s = await loadSlide(blob, sm.id);
          Object.assign(s, { blob, mediaId: sm.mediaId || undefined, product: sm.product || undefined });
          proj.slides.push(s);
        } catch {}
      }
      const af = audio && (await idb.getStudioFile('audio').catch(() => null));
      if (af) {
        try {
          const ac = new AudioContext();
          const buffer = await ac.decodeAudioData(await af.arrayBuffer());
          ac.close();
          proj.audio = { ...audio, buffer, file: af };
        } catch {}
      }
    }
  } catch (e) { console.warn('[toasty] could not restore the video project', e); }
  savedMeta = JSON.stringify(snapshot());
  savedIds = new Set(proj.slides.map((s) => s.id));
  savedAudio = proj.audio?.file || null;
  restored = true;
}
async function persist() {
  if (!restored) return; // never overwrite the saved project before it has loaded
  try {
    const ids = new Set(proj.slides.map((s) => s.id));
    for (const s of proj.slides) if (!savedIds.has(s.id) && s.blob) await idb.putStudioFile(s.id, s.blob);
    for (const id of savedIds) if (!ids.has(id)) await idb.delStudioFile(id);
    savedIds = ids;
    const af = proj.audio?.file || null;
    if (af !== savedAudio) { af ? await idb.putStudioFile('audio', af) : await idb.delStudioFile('audio'); savedAudio = af; }
    const meta = JSON.stringify(snapshot());
    if (meta !== savedMeta) { await idb.set('studio', JSON.parse(meta)); savedMeta = meta; }
  } catch (e) { console.warn('[toasty] video project save failed', e); }
}

const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const fmtMB = (b) => (b / 1e6).toFixed(b > 1e7 ? 0 : 1) + ' MB';

export default function studio(root, { arg }) {
  let playing = false, t = 0, playStart = 0, raf = 0, dirty = true, lastThumb = 0;
  let selected = proj.captions[0]?.id || null, showSafe = false, boxes = {};
  let audioCtx = null, audioSrc = null;
  let exporting = null;

  ensureFonts().then(() => { dirty = true; paintFontButtons(); });

  // ---------- Stage ----------
  const canvas = h('canvas.st-canvas', { tabindex: '0', 'aria-label': 'Video preview. Drag a caption to move it; drag its corner to resize.' });
  const ctx = canvas.getContext('2d');
  const screen = h('div.st-screen', canvas);
  const fmt = () => FORMATS.find((f) => f.id === proj.format) || FORMATS[0];
  function sizeCanvas() {
    const f = fmt();
    canvas.width = Math.round(f.w * PREVIEW_SCALE);
    canvas.height = Math.round(f.h * PREVIEW_SCALE);
    screen.style.setProperty('--ar', `${f.w} / ${f.h}`);
    screen.style.setProperty('--arn', String(f.w / f.h));
    dirty = true;
  }
  sizeCanvas();

  const playBtn = h('button.btn.icon.st-play', { type: 'button', 'aria-label': 'Play', onclick: () => (playing ? pause() : play()) });
  const scrub = h('input.st-scrub', { type: 'range', min: 0, step: 0.01, value: 0, 'aria-label': 'Seek', oninput: (e) => seek(Number(e.target.value)) });
  const timeEl = h('span.st-time');
  const lenEl = h('div.st-len');
  const fmtSeg = h('div.seg', { role: 'group', 'aria-label': 'Video shape' });
  function renderFmt() {
    fmtSeg.replaceChildren(...FORMATS.map((f) => h('button', { type: 'button', 'aria-pressed': String(proj.format === f.id), title: f.sub, onclick: () => { proj.format = f.id; sizeCanvas(); renderFmt(); renderTemplates(); } }, f.label)));
  }
  const safeBox = h('label.st-check', h('input', { type: 'checkbox', onchange: (e) => { showSafe = e.target.checked; dirty = true; } }), 'Show app buttons');
  const exportBtn = h('button.btn.primary.st-export', { type: 'button', onclick: () => doExport() }, icon('film'), 'Export video');
  const progress = h('div.st-progress', { hidden: true }, h('div.st-bar', h('i')), h('span', 'Recording…'), h('button.btn.sm', { type: 'button', onclick: () => exporting?.abort() }, 'Cancel'));

  function updatePlayBtn() {
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function play() {
    const tl = timeline(proj);
    if (t >= tl.total - 0.05) t = 0;
    playing = true;
    playStart = performance.now() - t * 1000;
    startAudio();
    updatePlayBtn();
  }
  function pause() { playing = false; stopAudio(); updatePlayBtn(); dirty = true; }
  function seek(v) {
    t = v;
    if (playing) { playStart = performance.now() - t * 1000; startAudio(); }
    dirty = true;
  }

  function startAudio() {
    stopAudio();
    if (!proj.audio || !playing) return;
    audioCtx ||= new AudioContext();
    audioCtx.resume();
    const g = audioCtx.createGain();
    g.gain.value = proj.audio.volume ?? 1;
    audioSrc = audioCtx.createBufferSource();
    audioSrc.buffer = proj.audio.buffer;
    audioSrc.connect(g).connect(audioCtx.destination);
    audioSrc.start(0, (proj.audio.offset || 0) + t);
  }
  function stopAudio() { try { audioSrc?.stop(); } catch {} audioSrc = null; }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const tl = timeline(proj);
    if (playing) {
      t = (now - playStart) / 1000;
      if (t >= tl.total) { t = 0; playStart = now; startAudio(); }
      dirty = true;
    }
    if (dirty) {
      boxes = renderFrame(ctx, proj, t, { selected: drag ? null : selected, safe: showSafe, settled: !playing });
      if (drag) { const b = boxes[drag.id]; if (b) outline(b); }
      scrub.max = tl.total.toFixed(2);
      scrub.value = String(Math.min(t, tl.total));
      timeEl.textContent = `${fmtT(Math.min(t, tl.total))} / ${fmtT(tl.total)}`;
      dirty = false;
    }
    if (now - lastThumb > 70 && !exporting) { lastThumb = now; drawThumbs(now / 1000); }
  }
  const outline = (b) => {
    ctx.save(); ctx.strokeStyle = '#FFD45C'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
  };

  // ---------- Drag captions on the video ----------
  let drag = null;
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
  };
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = toCanvas(e);
    const hs = 30 * (canvas.width / 1080);
    const sb = selected && boxes[selected];
    const c = proj.captions.find((cc) => cc.id === selected);
    if (sb && c && Math.hypot(x - (sb.x + sb.w), y - (sb.y + sb.h)) < hs * 1.6) {
      const cx = c.x * canvas.width, cy = c.y * canvas.height;
      drag = { id: c.id, mode: 'size', d0: Math.max(10, Math.hypot(x - cx, y - cy)), s0: c.size };
    } else {
      const hit = [...proj.captions].reverse().find((cc) => { const b = boxes[cc.id]; return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; });
      if (!hit) { if (selected) { selected = null; renderCaptions(); dirty = true; } return; }
      if (selected !== hit.id) { selected = hit.id; renderCaptions(); }
      drag = { id: hit.id, mode: 'move', ox: x - hit.x * canvas.width, oy: y - hit.y * canvas.height };
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      const [x, y] = toCanvas(e);
      const over = Object.values(boxes).some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      canvas.style.cursor = over ? 'move' : 'default';
      return;
    }
    const c = proj.captions.find((cc) => cc.id === drag.id);
    if (!c) return;
    const [x, y] = toCanvas(e);
    if (drag.mode === 'move') {
      c.x = Math.min(0.95, Math.max(0.05, (x - drag.ox) / canvas.width));
      c.y = Math.min(0.97, Math.max(0.03, (y - drag.oy) / canvas.height));
      // snap to the centre line
      if (Math.abs(c.x - 0.5) < 0.02) c.x = 0.5;
    } else {
      const cx = c.x * canvas.width, cy = c.y * canvas.height;
      c.size = Math.round(Math.min(260, Math.max(24, (drag.s0 * Math.hypot(x - cx, y - cy)) / drag.d0)));
    }
    dirty = true;
  });
  const endDrag = () => { if (drag) { drag = null; dirty = true; renderCaptions(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- Photos ----------
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
  const photosEl = h('div');
  let dragIdx = null;
  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return pop('Pick photos (JPG, PNG, WebP or HEIC your browser can open).', { kind: 'err' });
    for (const f of list) {
      try { const s = await loadSlide(f, uid()); s.blob = f; proj.slides.push(s); }
      catch { pop(`Couldn’t open ${f.name}.`, { kind: 'err' }); }
    }
    fileIn.value = '';
    changed();
  }
  const postImages = () => (state.draft?.mediaIds || loadDraft()?.mediaIds || []).map(media).filter((m) => m?.mime.startsWith('image/'));
  async function importFromPost(quiet) {
    const imgs = postImages().filter((m) => !proj.slides.some((s) => s.mediaId === m.id));
    if (!imgs.length) return quiet ? null : pop('There are no new photos in your post to bring over.', { kind: 'err' });
    for (const m of imgs) {
      try {
        const blob = await fetch(mediaUrl(m)).then((r) => r.blob());
        const s = await loadSlide(blob, uid());
        s.mediaId = m.id;
        s.blob = blob;
        proj.slides.push(s);
      } catch {}
    }
    changed();
    pop(`Brought over ${imgs.length} photo${imgs.length === 1 ? '' : 's'} from your post.`, { title: 'Loaded' });
  }
  function move(from, to) {
    if (to < 0 || to >= proj.slides.length || from === to) return;
    const [s] = proj.slides.splice(from, 1);
    proj.slides.splice(to, 0, s);
    changed();
  }
  function renderPhotos() {
    const n = proj.slides.length;
    const tpl = TEMPLATES[proj.template];
    const items = proj.slides.map((s, i) => h('div.st-ph', {
      draggable: 'true',
      ondragstart: (e) => { dragIdx = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); },
      ondragover: (e) => { if (dragIdx !== null) { e.preventDefault(); e.currentTarget.classList.add('over'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('over'); if (dragIdx !== null) move(dragIdx, i); dragIdx = null; },
      ondragend: () => { dragIdx = null; },
    },
      h('img', { src: s.url, alt: `Photo ${i + 1}`, draggable: 'false' }),
      h('span.st-n', proj.template === 'beforeafter' ? `${Math.floor(i / 2) + 1}${i % 2 ? 'B' : 'A'}` : proj.template === 'countdown' ? `#${n - i}` : String(i + 1)),
      h('button.rm', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { URL.revokeObjectURL(s.url); proj.slides.splice(i, 1); changed(); } }, '×'),
      h('div.st-mv',
        h('button', { type: 'button', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => move(i, i - 1) }, '‹'),
        h('button', { type: 'button', 'aria-label': 'Move later', disabled: i === n - 1, onclick: () => move(i, i + 1) }, '›'))));
    const drop = h('button.dropzone.st-drop', {
      type: 'button',
      onclick: () => fileIn.click(),
      ondragover: (e) => { if (dragIdx === null) { e.preventDefault(); drop.classList.add('over'); } },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); },
    }, h('span', icon('image'), n ? 'Add more' : 'Add photos'));
    const fromPost = postImages().filter((m) => !proj.slides.some((s) => s.mediaId === m.id)).length;
    const hint = proj.template === 'beforeafter' ? 'Photos pair up in order: 1A is the before, 1B the after.'
      : proj.template === 'countdown' ? 'The first photo is the highest number; the last one is #1.'
      : proj.template === 'grid' ? 'The first 9 photos make the opening collage.'
      : 'Drag to reorder. 5 to 15 photos works best.';
    photosEl.replaceChildren(
      h('div.st-strip', ...items, drop),
      n ? '' : h('p.st-hint', 'Until you add photos, the preview uses sample cards so you can try the templates.'),
      h('div.st-row',
        fromPost ? h('button.btn.sm.butter', { type: 'button', onclick: (e) => busy(e.currentTarget, () => importFromPost(), 'Loading…') }, icon('image'), `Use ${fromPost} photo${fromPost === 1 ? '' : 's'} from my post`) : null,
        h('div.seg', { role: 'group', 'aria-label': 'How photos fit the frame' },
          h('button', { type: 'button', 'aria-pressed': String(proj.fit === 'fill'), title: 'Crop photos to fill the frame', onclick: () => { proj.fit = 'fill'; changed(); } }, 'Fill frame'),
          h('button', { type: 'button', 'aria-pressed': String(proj.fit === 'fit'), title: 'Show the whole photo over a blurred background', onclick: () => { proj.fit = 'fit'; changed(); } }, 'Whole photo')),
        n > 1 ? h('button.btn.sm.quiet', { type: 'button', onclick: () => { for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [proj.slides[i], proj.slides[j]] = [proj.slides[j], proj.slides[i]]; } changed(); } }, 'Shuffle') : null,
        n > 1 ? h('button.btn.sm.quiet', { type: 'button', onclick: () => { proj.slides.reverse(); changed(); } }, 'Reverse') : null,
        n ? h('button.btn.sm.quiet.danger', { type: 'button', onclick: () => { proj.slides.forEach((s) => URL.revokeObjectURL(s.url)); proj.slides = []; changed(); } }, 'Clear') : null),
      n ? h('p.st-hint', hint) : '',
      proj.template === 'shop' ? productsEditor() : '',
      fileIn);
  }

  // Shop the Look: one product per photo, plus the end-card call to action.
  const draftProducts = () => (state.draft?.shop?.products || loadDraft()?.shop?.products || []).filter((p) => p.name || p.url);
  function productsEditor() {
    const n = proj.slides.length;
    const ctaIn = h('input.input', { value: proj.shopCta, maxlength: 40, 'aria-label': 'End card call to action', oninput: (e) => { proj.shopCta = e.target.value; dirty = true; } });
    const fromPost = draftProducts();
    const rows = proj.slides.map((s, i) => {
      const p = (s.product ||= { name: '', brand: '', price: '', url: '' });
      const set = (k) => (e) => { p[k] = e.target.value; dirty = true; if (k === 'url') priceIn.disabled = isAmazon(cleanUrl(p.url)); };
      const priceIn = h('input.input', { value: p.price, placeholder: 'Price', disabled: isAmazon(p.url), title: isAmazon(p.url) ? 'Amazon doesn’t allow prices you type in yourself' : '', 'aria-label': `Price ${i + 1}`, oninput: set('price') });
      return h('div.st-prod',
        h('img', { src: s.url, alt: '' }), h('span.st-n', String(i + 1)),
        h('div.st-prod-f',
          h('input.input', { value: p.name, placeholder: 'Product name', 'aria-label': `Product ${i + 1} name`, oninput: set('name') }),
          h('div.st-prod-row',
            h('input.input', { value: p.brand, placeholder: 'Brand', 'aria-label': `Brand ${i + 1}`, oninput: set('brand') }),
            priceIn),
          h('input.input', { value: p.url, placeholder: 'Affiliate link (goes into your post)', inputmode: 'url', 'aria-label': `Link ${i + 1}`, oninput: set('url') })));
    });
    return h('div.st-prods',
      h('div.st-prods-head', h('b', 'Products'), h('span', 'One per photo. Shown on a card over each photo.')),
      n ? h('div.st-prod-list', rows) : h('p.st-hint', 'Add a photo of each product (or each outfit piece) above, then name them here.'),
      fromPost.length && n ? h('button.btn.sm.butter', { type: 'button', onclick: () => {
        proj.slides.forEach((s, i) => { if (fromPost[i] && !(s.product?.name || s.product?.url)) s.product = { name: '', brand: '', price: '', ...fromPost[i] }; });
        changed();
      } }, icon('tag'), `Fill in from my post’s ${fromPost.length} product${fromPost.length === 1 ? '' : 's'}`) : '',
      h('div.st-field.st-cta', h('span', 'End card says'), ctaIn,
        h('div.st-looks', ['🔗 Link in bio', '💬 Comment "SHOP" for links', '🛍️ Shop my LTK', '🛒 Links on my storefront'].map((t) =>
          h('button', { type: 'button', onclick: () => { proj.shopCta = t; ctaIn.value = t; dirty = true; } }, t)))));
  }

  // ---------- Templates ----------
  const tplEl = h('div');
  let thumbs = [];
  function renderTemplates() {
    const f = fmt();
    const tpl = TEMPLATES[proj.template];
    thumbs = [];
    const cards = TEMPLATE_LIST.map((tp) => {
      const c = h('canvas', { width: 120, height: Math.round((120 * f.h) / f.w), 'aria-hidden': 'true' });
      thumbs.push([tp.id, c.getContext('2d')]);
      return h('button.st-tpl', { type: 'button', 'aria-pressed': String(tp.id === proj.template), onclick: () => { proj.template = tp.id; t = 0; if (playing) play(); changed(); } },
        h('span.st-tpl-art', c, h('span.st-tag', tp.tag)), h('b', tp.name));
    });
    const per = paceOf(proj);
    const unit = tpl.unit || 'photo';
    const pace = h('input', { type: 'range', min: tpl.min, max: tpl.max, step: 0.05, value: per, 'aria-label': `Seconds per ${unit}`,
      oninput: (e) => { proj.pace[proj.template] = Number(e.target.value); paceOut.textContent = paceLabel(); dirty = true; updateLen(); } });
    const paceLabel = () => { const p = paceOf(proj); return `${p.toFixed(2)}s per ${unit}` + (proj.template === 'dump' || proj.template === 'glitch' ? ` · ≈${Math.round(60 / p)} BPM` : ''); };
    const paceOut = h('output', paceLabel());
    tplEl.replaceChildren(
      h('div.st-tpls', cards),
      h('div.st-tpl-info', h('b', tpl.name), h('p', tpl.blurb)),
      h('label.field.st-pace', h('span', 'Pace ', paceOut), pace,
        h('small', proj.template === 'dump' ? 'Tip: one photo per beat. 60 ÷ your song’s BPM = seconds per photo.' : 'Slide to speed up or slow down.')));
  }
  function drawThumbs(sec) {
    for (const [id, tctx] of thumbs) {
      const tl = timeline(proj, id);
      renderFrame(tctx, proj, sec % tl.total, { template: id, captions: false });
    }
  }

  // ---------- Captions ----------
  const capsEl = h('div');
  let fontButtons = [];
  function paintFontButtons() { fontButtons.forEach(([b, id]) => { b.style.font = fontCss(id, 15); }); }
  function addCaption(patch, text) {
    const c = newCaption({ ...patch, text: text || 'Your caption' });
    // Don't stack a new caption right on top of one that's already there.
    const taken = (y) => proj.captions.some((o) => o.from == null && c.from == null && Math.abs(o.y - y) < 0.08);
    for (const dy of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3]) {
      const y = c.y + dy;
      if (y > 0.1 && y < 0.82 && !taken(y)) { c.y = Math.round(y * 100) / 100; break; }
    }
    proj.captions.push(c);
    selected = c.id;
    if (!playing) t = Math.min(t, 0.6); // replay the entrance so the animation shows
    renderCaptions();
    dirty = true;
    return c;
  }
  function captionEachPhoto() {
    const n = timeline(proj).n;
    const base = proj.captions.find((c) => c.id === selected) || {};
    const { id, text, from, to, ...look } = base;
    for (let i = 0; i < n; i++) proj.captions.push(newCaption({ ...look, text: proj.template === 'countdown' ? `Pick #${n - i}` : `Photo ${i + 1}`, from: i, to: i }));
    selected = proj.captions[proj.captions.length - n].id;
    renderCaptions();
    dirty = true;
    pop(`Added ${n} captions, one per photo. Click any of them to change the words.`, { title: 'Captioned' });
  }
  function renderCaptions() {
    const tl = timeline(proj);
    fontButtons = [];
    const list = proj.captions.map((c, i) => {
      const open = c.id === selected;
      const [a, b] = captionWindow(c, tl);
      const head = h('div.st-cap-head', { onclick: () => { selected = open ? null : c.id; if (!open && (t < a || t > b)) t = a + Math.min(0.4, (b - a) / 2); renderCaptions(); dirty = true; } },
        h('span.st-cap-aa', { style: { font: fontCss(c.font, 16) } }, 'Aa'),
        h('span.st-cap-t', c.text.trim() || 'Empty caption'),
        h('span.st-cap-when', c.from == null ? 'Whole video' : c.to != null && c.to !== c.from ? `Photos ${c.from + 1}–${c.to + 1}` : `Photo ${c.from + 1}`),
        h('button.btn.quiet.icon', { type: 'button', 'aria-label': 'Duplicate caption', title: 'Duplicate', onclick: (e) => { e.stopPropagation(); const d = { ...c, id: uid(), y: Math.min(0.95, c.y + 0.08) }; proj.captions.splice(i + 1, 0, d); selected = d.id; renderCaptions(); dirty = true; } }, icon('copy')),
        h('button.btn.quiet.icon.danger', { type: 'button', 'aria-label': 'Delete caption', title: 'Delete', onclick: (e) => { e.stopPropagation(); proj.captions.splice(i, 1); if (selected === c.id) selected = null; renderCaptions(); dirty = true; } }, icon('trash')));
      if (!open) return h('div.st-cap', head);
      return h('div.st-cap.open', head, editor(c, tl));
    });
    capsEl.replaceChildren(
      h('div.st-looks', h('span', 'Quick looks'), LOOKS.map((l) => h('button', { type: 'button', title: `Add a ${l.label.toLowerCase()} caption`, onclick: () => addCaption(l.patch, l.text) }, l.label))),
      h('div.st-row',
        h('button.btn.sm', { type: 'button', onclick: () => addCaption({}, 'Your caption') }, icon('plus'), 'Add caption'),
        h('button.btn.sm.quiet', { type: 'button', onclick: captionEachPhoto, title: 'One caption timed to each photo, in the selected caption’s style' }, icon('type'), 'Caption each photo')),
      list.length ? h('div.st-caps', list) : h('p.st-hint', 'No captions yet. Pick a quick look above, or add a plain one. Then drag it around on the video.'));
    paintFontButtons();
  }
  function editor(c, tl) {
    const up = (patch, rerender) => { Object.assign(c, patch); dirty = true; if (rerender) renderCaptions(); };
    const ta = h('textarea', { value: c.text, rows: 2, 'aria-label': 'Caption text', placeholder: 'Type your caption. Enter for a new line.', oninput: (e) => { up({ text: e.target.value }); ta.closest('.st-cap').querySelector('.st-cap-t').textContent = e.target.value.trim() || 'Empty caption'; } });
    const fonts = h('div.st-fonts', FONTS.map((f) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(c.font === f.id), onclick: () => up({ font: f.id }, true) }, f.label);
      fontButtons.push([b, f.id]);
      return b;
    }));
    const styles = h('div.tones', STYLES.map((s) => h('button', { type: 'button', 'aria-pressed': String(c.style === s.id), onclick: () => up({ style: s.id }, true) }, s.label)));
    const custom = h('input.st-color', { type: 'color', value: c.color, 'aria-label': 'Custom colour', oninput: (e) => up({ color: e.target.value.toUpperCase() }) , onchange: () => renderCaptions() });
    const colors = h('div.st-swatches', COLORS.map((col) => h('button', { type: 'button', style: { '--c': col }, 'aria-label': `Colour ${col}`, 'aria-pressed': String(c.color.toUpperCase() === col), onclick: () => up({ color: col }, true) })), custom);
    const size = h('input', { type: 'range', min: 24, max: 260, step: 1, value: c.size, 'aria-label': 'Text size', oninput: (e) => { up({ size: Number(e.target.value) }); sizeOut.textContent = e.target.value; } });
    const sizeOut = h('output', String(c.size));
    const seg = (label, opts, key) => h('div.seg', { role: 'group', 'aria-label': label }, opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(c[key] === v), onclick: () => up({ [key]: v }, true) }, l)));
    const pos = h('div.seg', { role: 'group', 'aria-label': 'Position' },
      [['Top', 0.2], ['Middle', 0.5], ['Bottom', 0.7]].map(([l, y]) => h('button', { type: 'button', 'aria-pressed': String(Math.abs(c.y - y) < 0.03 && c.x === 0.5), onclick: () => up({ y, x: 0.5 }, true) }, l)));
    const anim = h('select', { 'aria-label': 'Animation', onchange: (e) => { up({ anim: e.target.value }); t = captionWindow(c, timeline(proj))[0]; dirty = true; } }, ANIMS.map(([v, l]) => h('option', { value: v, selected: c.anim === v }, l)));
    const photoOpts = (sel) => [...Array(tl.n)].map((_, i) => h('option', { value: i, selected: sel === i }, `Photo ${i + 1}`));
    const when = h('select', { 'aria-label': 'When it shows', onchange: (e) => { const v = e.target.value; up(v === 'all' ? { from: null, to: null } : { from: 0, to: 0 }, true); } },
      h('option', { value: 'all', selected: c.from == null }, 'Whole video'), h('option', { value: 'some', selected: c.from != null }, 'Only on some photos'));
    const range = c.from == null ? null : h('div.st-range',
      h('select', { 'aria-label': 'From photo', onchange: (e) => { const f = Number(e.target.value); up({ from: f, to: Math.max(f, c.to ?? f) }, true); t = captionWindow(c, timeline(proj))[0] + 0.3; } }, photoOpts(c.from)),
      h('span', 'to'),
      h('select', { 'aria-label': 'To photo', onchange: (e) => up({ to: Math.max(c.from, Number(e.target.value)) }, true) }, photoOpts(c.to ?? c.from)));
    return h('div.st-cap-body',
      ta,
      h('div.st-field', h('span', 'Font'), fonts),
      h('div.st-field', h('span', 'Style'), styles),
      h('div.st-field', h('span', c.style === 'box' ? 'Box colour' : 'Colour'), colors),
      h('div.st-field', h('span', 'Size ', sizeOut), size),
      h('div.st-grid2',
        h('div.st-field', h('span', 'Position'), pos),
        h('div.st-field', h('span', 'Align'), seg('Align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], 'align'))),
      h('div.st-grid2',
        h('div.st-field', h('span', 'Animation'), anim),
        h('div.st-field', h('span', 'Shows'), when)),
      range,
      h('label.st-check', h('input', { type: 'checkbox', checked: c.caps, onchange: (e) => up({ caps: e.target.checked }) }), 'ALL CAPS'),
      h('p.st-hint', 'Drag the caption on the video to move it. Drag the yellow corner dot to resize.'));
  }

  // ---------- Music ----------
  const musicEl = h('div');
  const audioIn = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: (e) => addAudio(e.target.files[0]) });
  async function addAudio(file) {
    if (!file) return;
    try {
      audioCtx ||= new AudioContext();
      const buffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
      proj.audio = { buffer, name: file.name, offset: 0, volume: 1, file };
      if (playing) startAudio();
      renderMusic();
    } catch { pop('That audio file couldn’t be read. Try an MP3, M4A or WAV.', { kind: 'err' }); }
    audioIn.value = '';
  }
  function renderMusic() {
    const a = proj.audio;
    musicEl.replaceChildren(
      a
        ? h('div',
          h('div.st-song', icon('music'), h('b', a.name), h('span.muted', fmtT(a.buffer.duration)),
            h('button.btn.quiet.icon.danger', { type: 'button', 'aria-label': 'Remove song', onclick: () => { stopAudio(); proj.audio = null; renderMusic(); } }, icon('trash'))),
          h('label.field', h('span', 'Start the song at ', h('output', fmtT(a.offset))),
            h('input', { type: 'range', min: 0, max: Math.max(0, a.buffer.duration - 1).toFixed(1), step: 0.1, value: a.offset, oninput: (e) => { a.offset = Number(e.target.value); e.target.previousElementSibling.querySelector('output').textContent = fmtT(a.offset); }, onchange: () => playing && startAudio() }),
            h('small', 'Skip to the chorus or the drop.')),
          h('label.field', h('span', 'Volume'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a.volume, oninput: (e) => { a.volume = Number(e.target.value); }, onchange: () => playing && startAudio() })))
        : h('button.btn.sm', { type: 'button', onclick: () => audioIn.click() }, icon('music'), 'Add a song'),
      h('p.st-hint', 'Use music you have the rights to. For a trending sound from TikTok or Instagram, export silent and add the sound in their app, where it’s licensed.'),
      audioIn);
  }

  // ---------- Export ----------
  function updateLen() {
    const tl = timeline(proj);
    const s = tl.total;
    lenEl.textContent = `${s.toFixed(1)}s · ${s < 3 ? 'very short: add photos or slow the pace' : s <= 15 ? 'quick and loopable' : s <= 60 ? 'good length for TikTok & Reels' : s <= 90 ? 'long for a Reel' : 'over 90s: Reels may cut it'}`;
  }
  async function doExport() {
    if (exporting) return;
    if (!proj.slides.length) return pop('Add your photos first. The sample cards are just for trying templates.', { kind: 'err', title: 'No photos yet' });
    pause();
    const ac = new AbortController();
    exporting = ac;
    exportBtn.disabled = true;
    progress.hidden = false;
    const bar = progress.querySelector('i'), label = progress.querySelector('span');
    try {
      const out = await recordVideo(proj, { signal: ac.signal, onProgress: (p) => { bar.style.width = (p * 100).toFixed(1) + '%'; label.textContent = `Recording… ${Math.round(p * 100)}% · keep this tab open`; } });
      if (out) showResult(out);
    } catch (e) {
      pop(e.message, { kind: 'err', title: 'Export failed' });
    } finally {
      exporting = null;
      exportBtn.disabled = false;
      progress.hidden = true;
      bar.style.width = '0';
      dirty = true;
    }
  }
  function showResult(out) {
    const ext = out.type === 'video/mp4' ? 'mp4' : 'webm';
    const file = new File([out.blob], `toasty-video-${new Date().toISOString().slice(0, 10)}.${ext}`, { type: out.type });
    const url = URL.createObjectURL(file);
    const notes = [];
    if (ext !== 'mp4') notes.push('This browser could only make a WebM video. TikTok accepts it, but Instagram Reels needs MP4. Chrome or Edge can export MP4.');
    if (state.config?.hosted && file.size > 4e6) notes.push(`This video is ${fmtMB(file.size)}. On the hosted version, posts can only carry about 4MB, so post it from a local install or download it and upload it in the app.`);
    const m = modal({
      title: 'Your video is ready',
      titleIcon: icon('film'),
      body: h('div.st-result',
        h('video', { src: url, controls: true, playsinline: true, autoplay: true, loop: true, muted: !proj.audio }),
        h('div',
          h('p.st-meta', `${out.width}×${out.height} · ${out.duration.toFixed(1)}s · ${ext.toUpperCase()} · ${fmtMB(file.size)}`),
          ...notes.map((n) => h('div.pv-warn', n)),
          h('p.st-hint', 'Add it to a post to schedule it to TikTok or Instagram, or download it.'))),
      foot: [
        h('a.btn', { href: url, download: file.name }, icon('download'), 'Download'),
        h('span.grow'),
        h('button.btn.primary', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => { await addToPost(file, out); m.close(); }, 'Adding…') }, icon('send'), 'Add to a post'),
      ],
      onClose: () => setTimeout(() => URL.revokeObjectURL(url), 1000),
    });
  }
  async function addToPost(file, out) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('width', out.width);
    fd.append('height', out.height);
    const m = await api('/api/media', { method: 'POST', form: fd });
    state.media.push(m);
    const d = state.draft || loadDraft() || { id: null, text: '', overrides: {}, mediaIds: [], targets: [], scheduledAt: null };
    d.mediaIds = [...(d.mediaIds || []), m.id];
    const words = proj.captions.map((c) => c.text.trim()).filter(Boolean);
    if (!d.text?.trim() && words.length) d.text = words[0];
    // Shop the Look: carry the products (with their links) into the post's "Shop this post".
    const prods = proj.template === 'shop' ? proj.slides.map((s) => s.product).filter((p) => p && (p.name || p.url)) : [];
    if (prods.length) {
      d.shop = { ...blankShop(), ...(d.shop || {}) };
      for (const p of prods) {
        const url = cleanUrl(p.url);
        if (url && d.shop.products.some((x) => x.url === url)) continue;
        d.shop.products.push({ name: p.name || '', brand: p.brand || '', price: p.price || '', url });
      }
      if (/comment/i.test(proj.shopCta)) { d.shop.cta = 'comment'; d.shop.keyword = (proj.shopCta.match(/"([^"]+)"/)?.[1] || 'SHOP').toUpperCase(); }
    }
    state.draft = d;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
    pop('The video is in your post. Pick TikTok or Instagram and pull the lever.', { title: 'Added' });
    location.hash = '#/compose';
  }

  function changed() {
    dirty = true;
    renderPhotos();
    renderTemplates();
    renderCaptions();
    updateLen();
  }

  // ---------- Page ----------
  const sec = (title, sub, body) => h('section.card.st-sec', h('div.st-sec-head', h('h2', title), sub ? h('span', sub) : null), body);
  root.append(
    h('div.page-head',
      h('div', h('span.tagline', 'lights, camera, toast'), h('h1', 'Video Studio'),
        h('p', 'Turn a set of photos into a vertical video for TikTok and Reels. Pick a trending template, add captions and a song, then export an MP4. It’s all made in your browser.'))),
    h('div.studio',
      h('div.st-stage.card',
        screen,
        h('div.st-controls', playBtn, scrub, timeEl),
        lenEl,
        h('div.st-row.st-between', fmtSeg, safeBox),
        exportBtn,
        progress,
        h('p.st-hint', `Exports at 1080p, 30fps, as ${(pickMime(false) || 'video/webm').includes('mp4') ? 'MP4' : 'WebM'}. Recording takes as long as the video.`)),
      h('div.st-panel',
        sec('1. Photos', null, photosEl),
        sec('2. Template', 'what’s working on TikTok & Reels', tplEl),
        sec('3. Captions', 'add, style, drag, resize', capsEl),
        sec('4. Music', 'optional', musicEl),
        h('div.st-reset',
          h('span', icon('check'), 'Your project saves in this browser as you work.'),
          h('button.btn.sm.danger', { type: 'button', onclick: clearProject }, icon('trash'), 'Clear project')))));

  async function clearProject() {
    if (!(await confirmBox('Clear this video project?', 'This removes the photos, captions, products and song from the Video Studio in this browser. Your posts and any videos you exported or added to posts stay put.', 'Clear project'))) return;
    pause();
    proj.slides.forEach((s) => URL.revokeObjectURL(s.url));
    Object.assign(proj, fresh());
    selected = null; t = 0;
    try { await idb.clearStudio(); await idb.set('studio', null); } catch {}
    savedMeta = JSON.stringify(snapshot()); savedIds = new Set(); savedAudio = null;
    sizeCanvas(); renderFmt(); renderMusic(); changed();
    pop('Fresh start. The Video Studio is empty.', { title: 'Cleared' });
  }

  const boot = () => {
    selected = proj.captions.some((c) => c.id === selected) ? selected : proj.captions[0]?.id || null;
    sizeCanvas();
    renderFmt();
    updatePlayBtn();
    renderMusic();
    changed();
    if (arg === 'post' && restored) { // wait for the saved project, then add the post's photos to it
      arg = null;
      history.replaceState(null, '', '#/studio');
      importFromPost(true);
    }
  };
  boot();
  let alive = true;
  if (!restored) {
    photosEl.replaceChildren(h('p.st-hint', 'Loading your saved project…'));
    (restoring ||= restore()).then(() => alive && boot());
  }
  const saver = setInterval(persist, 1000);
  window.addEventListener('pagehide', persist);
  raf = requestAnimationFrame(loop);

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && (e.target === canvas || e.target === document.body)) { proj.captions = proj.captions.filter((c) => c.id !== selected); selected = null; renderCaptions(); dirty = true; }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    alive = false;
    clearInterval(saver);
    window.removeEventListener('pagehide', persist);
    persist();
    cancelAnimationFrame(raf);
    exporting?.abort();
    stopAudio();
    audioCtx?.close();
    document.removeEventListener('keydown', onKey);
  };
}

function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; } }
