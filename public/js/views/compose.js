// Compose: write once, preview per platform, post now or schedule.
import { h, icon, pb, ava, pop, modal, busy, toastIcon, toLocalInput, fmtWhen, fmtTime } from '../ui.js';
import { BRAND_PATHS } from '../brands.js';
import { state, api, load, platform, account, media, mediaUrl } from '../api.js';

const DRAFT_KEY = 'toastyposty.draft';
const blank = () => ({ id: null, text: '', overrides: {}, mediaIds: [], targets: [], scheduledAt: null });
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter() : null;
const graphemes = (t) => (seg ? [...seg.segment(t)].map((s) => s.segment) : [...t]);
const TONES = ['Punchy', 'Friendly', 'Professional', 'Playful', 'Deadpan'];
const REWRITES = ['Make it shorter', 'Add a hook', 'Fix grammar & typos', 'Less salesy', 'Add relevant hashtags'];

function count(text, pid) {
  let t = text || '';
  if (pid === 'x') t = t.replace(/https?:\/\/\S+/g, 'x'.repeat(23));
  return graphemes(t).length;
}
const saveLocal = (d) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {} };
const loadLocal = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; } };

// Text with links/hashtags tinted and anything past the limit marked.
function richText(text, limit, over) {
  const chars = graphemes(text);
  const cut = over > 0 ? Math.max(0, chars.length - over) : chars.length;
  const ok = chars.slice(0, cut).join('');
  const parts = ok.split(/(https?:\/\/\S+|(?:^|(?<=\s))#[\wÀ-￿]+)/g).filter(Boolean);
  const nodes = parts.map((p) => (/^(https?:\/\/|#)/.test(p) ? h('span.lnk', p) : p));
  if (cut < chars.length) nodes.push(h('mark', { title: 'Over the limit' }, chars.slice(cut).join('')));
  return nodes;
}

export default function compose(root, { arg }) {
  if (arg) {
    const p = state.posts.find((x) => x.id === arg);
    if (p) state.draft = { id: p.id, text: p.text, overrides: structuredClone(p.overrides || {}), mediaIds: [...(p.mediaIds || [])], targets: [...p.targets], scheduledAt: p.scheduledAt };
  }
  if (!state.draft) state.draft = loadLocal() || blank();
  const d = state.draft;
  d.targets = d.targets.filter((t) => account(t));
  d.mediaIds = d.mediaIds.filter((m) => media(m));
  let tone = 'Punchy';
  let mode = d.scheduledAt ? 'later' : 'now';

  const touch = () => { saveLocal(d); renderPreviews(); updateMeta(); renderSlots(); };

  // ---------- Accounts ----------
  const accts = h('div.accts');
  function renderAccounts() {
    const chips = state.accounts.map((a) =>
      h('label.acct-chip' + (a.status !== 'ok' ? '.warn' : ''), { title: a.status === 'error' ? `Connection problem: ${a.lastError}` : a.status === 'pending' ? 'Needs authorization' : `${platform(a.platform)?.name}` },
        h('input', { type: 'checkbox', checked: d.targets.includes(a.id), onchange: (e) => { d.targets = e.target.checked ? [...d.targets, a.id] : d.targets.filter((x) => x !== a.id); touch(); } }),
        ava(a),
        h('span.nm', h('b', a.profile?.name || a.label), h('small', a.profile?.handle || platform(a.platform)?.name)),
        h('span.tick', icon('check'))));
    accts.replaceChildren(...chips, h('a.acct-chip.add', { href: '#/accounts' }, icon('plus', ''), state.accounts.length ? 'Add account' : 'Connect your first account'));
  }

  // ---------- Text ----------
  const textMeta = h('div.text-meta');
  const text = h('textarea.compose-text', {
    value: d.text, placeholder: 'What’s fresh out of the toaster?', 'aria-label': 'Post text',
    oninput: (e) => { d.text = e.target.value; grow(); touch(); },
  });
  const grow = () => { text.style.height = 'auto'; text.style.height = Math.max(160, text.scrollHeight + 2) + 'px'; };
  requestAnimationFrame(grow);
  const updateMeta = () => { textMeta.textContent = `${graphemes(d.text).length} characters`; };

  // ---------- Media ----------
  const fileInput = h('input', { type: 'file', accept: 'image/*,video/*', multiple: true, hidden: true, onchange: (e) => addFiles(e.target.files) });
  const mediaRow = h('div.media-row');
  function renderMedia() {
    const thumbs = d.mediaIds.map((mid) => {
      const m = media(mid);
      const vid = m.mime.startsWith('video/');
      return h('div.thumb',
        vid ? h('video', { src: mediaUrl(m), muted: true, playsinline: true, preload: 'metadata' }) : h('img', { src: mediaUrl(m), alt: m.alt || '' }),
        m.ai ? h('span.tag', 'AI') : null,
        vid ? h('span.alt', 'Video') : h('button.alt' + (m.alt ? '.has' : ''), { onclick: () => altModal(m), title: 'Describe this image for screen readers' }, m.alt ? 'ALT ✓' : '+ ALT'),
        h('button.rm', { 'aria-label': 'Remove', onclick: () => { d.mediaIds = d.mediaIds.filter((x) => x !== mid); renderMedia(); touch(); } }, '×'));
    });
    const drop = h('button.dropzone', {
      type: 'button',
      onclick: () => fileInput.click(),
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); },
    }, h('span', icon('image'), d.mediaIds.length ? 'Add more' : 'Add photo or video'));
    mediaRow.replaceChildren(...thumbs, drop);
  }
  async function addFiles(files) {
    for (const f of files) {
      try {
        const p = await prepare(f);
        const fd = new FormData();
        fd.append('file', p.file, p.file.name);
        if (p.width) { fd.append('width', p.width); fd.append('height', p.height); }
        const m = await api('/api/media', { method: 'POST', form: fd });
        state.media.push(m);
        d.mediaIds.push(m.id);
      } catch (e) { pop(e.message, { kind: 'err', title: 'Upload failed' }); }
    }
    fileInput.value = '';
    renderMedia();
    touch();
  }
  function altModal(m) {
    const ta = h('textarea', { value: m.alt || '', rows: 4, placeholder: 'e.g. A slice of sourdough toast topped with butter, on a blue plate.' });
    const canAI = !!state.providers?.vision;
    const mm = modal({
      title: 'Image description (alt text)',
      body: h('div',
        h('img', { src: mediaUrl(m), alt: '', style: { maxHeight: '260px', margin: '0 auto 16px', borderRadius: '12px' } }),
        h('label.field', h('span', 'Describe what’s in the image'), ta, h('small', 'Screen-reader users hear this. Bluesky, X and Instagram show it on the post.'))),
      foot: [
        canAI
          ? h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => { ta.value = (await api('/api/ai/alt', { method: 'POST', body: { mediaId: m.id } })).alt; }, 'Writing…') }, icon('sparkle'), 'Write it for me')
          : h('a.btn.locked', { href: '#/settings', title: 'Add an AI key in Settings' }, icon('lock'), 'Write it for me'),
        h('span.grow'),
        h('button.btn.primary', { onclick: async () => { await api(`/api/media/${m.id}`, { method: 'PATCH', body: { alt: ta.value } }); m.alt = ta.value; mm.close(); renderMedia(); touch(); } }, 'Save'),
      ],
    });
  }

  // ---------- Inspiration (from a feed item's "Toast this") ----------
  const inspoSec = h('div');
  function renderInspo() {
    const i = d.inspiration;
    if (!i) { inspoSec.replaceChildren(); inspoSec.className = ''; return; }
    inspoSec.className = 'composer-sec inspo';
    const canAI = !!state.providers?.text;
    inspoSec.replaceChildren(
      h('div.inspo-card',
        h('img.inspo-logo', { src: '/img/logo.svg', alt: '' }),
        h('div.inspo-body',
          h('span.inspo-k', 'Toasting from', i.source ? ` · ${i.source}` : ''),
          i.url ? h('a.inspo-t', { href: i.url, target: '_blank', rel: 'noopener' }, i.title || i.url, ' ↗') : h('b.inspo-t', i.title),
          i.snippet ? h('p', i.snippet.length > 220 ? i.snippet.slice(0, 220) + '…' : i.snippet) : null,
          h('div.row',
            canAI
              ? h('button.btn.butter.sm', { onclick: (e) => busy(e.currentTarget, writeAbout, 'Writing…') }, icon('sparkle'), 'Write a post about this')
              : h('a.btn.sm.locked', { href: '#/settings', title: 'Add a Claude or OpenAI key in Settings' }, icon('lock'), 'Write a post about this'),
            h('span.muted', { style: { fontSize: '12.5px' } }, canAI ? 'Uses your house voice and keeps the link.' : 'Needs an AI key. Or write your own take below.'))),
        h('button.btn.quiet.icon', { 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => { delete d.inspiration; saveLocal(d); renderInspo(); } }, h('span', { style: { fontSize: '20px', lineHeight: 1 } }, '×'))));
  }
  async function writeAbout() {
    const i = d.inspiration;
    const plats = [...new Set(d.targets.map((t) => account(t)?.platform).filter(Boolean))];
    const extra = d.text.replace(i.title || '', '').replace(i.url || '', '').trim();
    const notes = [
      'Write a post sharing this link with my followers. Say in my voice why it is worth a look. Do not just repeat the headline. Include the link exactly once, as written.',
      `Title: ${i.title || ''}`,
      i.source ? `Source: ${i.source}` : '',
      i.snippet ? `Summary from the feed: ${i.snippet}` : '',
      i.url ? `Link: ${i.url}` : '',
      extra ? `My own notes: ${extra}` : '',
    ].filter(Boolean).join('\n');
    const r = await api('/api/ai/caption', { method: 'POST', body: { notes, platforms: plats.length ? plats : ['x', 'bluesky', 'instagram'], tone } });
    d.text = r.base;
    text.value = r.base; grow();
    for (const [p, txt] of Object.entries(r.platforms || {})) d.overrides[p] = { ...(d.overrides[p] || {}), text: txt };
    if (r.reddit_title && plats.includes('reddit')) d.overrides.reddit = { ...(d.overrides.reddit || {}), title: r.reddit_title };
    touch();
    pop('Drafted a post for each platform. Tweak any of them in the previews.', { title: 'Drafted' });
  }

  // ---------- AI ----------
  const aiSec = h('div');
  let closeMenu = () => {};
  let closeDial = () => {};
  const onDocClick = (e) => { closeMenu(e); closeDial(e); };
  document.addEventListener('click', onDocClick);
  function renderAI() {
    const p = state.providers || {};
    if (!p.text) {
      aiSec.replaceChildren(h('div.lock-note', icon('lock'),
        h('div', h('b', { style: { color: 'var(--ink)' } }, 'AI drafting is locked. '), 'Add a Claude or OpenAI key to draft captions for each platform, rewrite posts, write alt text and generate images. '),
        h('a', { href: '#/settings' }, 'Add key →')));
      return;
    }
    const menuList = h('div.menu-list', { hidden: true }, REWRITES.map((r) => h('button', { onclick: (e) => { menuList.hidden = true; busy(rewriteBtn, () => rewrite(r), 'Rewriting…'); } }, r)));
    const rewriteBtn = h('button.btn', { 'aria-haspopup': 'menu', onclick: () => (menuList.hidden = !menuList.hidden) }, icon('wand'), 'Rewrite', icon('chevron'));
    closeMenu = (e) => { if (!rewriteBtn.parentElement?.contains(e.target)) menuList.hidden = true; };

    const prompt = h('input.input', { placeholder: 'Describe an image to generate…', 'aria-label': 'Image prompt' });
    const size = h('select.input', { 'aria-label': 'Image shape' }, h('option', { value: '1024x1024' }, 'Square'), h('option', { value: '1024x1536' }, 'Portrait'), h('option', { value: '1536x1024' }, 'Landscape'));
    aiSec.replaceChildren(
      h('div.ai-bar',
        h('button.btn.butter', { onclick: (e) => busy(e.currentTarget, draftAll, 'Drafting…') }, icon('sparkle'), 'Draft for each platform'),
        h('div.menu', rewriteBtn, menuList)),
      h('div.tones', h('span', 'Tone'), TONES.map((t) => h('button', { type: 'button', 'aria-pressed': String(t === tone), onclick: (e) => { tone = t; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t))),
      p.image
        ? h('div.img-gen', prompt, size, h('button.btn', { onclick: (e) => busy(e.currentTarget, () => generate(prompt.value, size.value), 'Generating…') }, icon('image'), 'Generate'))
        : h('div.img-gen', h('a.btn.sm.locked', { href: '#/settings', title: 'Image generation needs an OpenAI key' }, icon('lock'), 'Generate image · needs an OpenAI key')));
  }
  async function draftAll() {
    const plats = [...new Set(d.targets.map((t) => account(t)?.platform).filter(Boolean))];
    const img = d.mediaIds.map(media).find((m) => m?.mime.startsWith('image/'));
    if (!d.text.trim() && !img) return pop('Jot a few notes (or add a photo) and the AI will write the posts.', { kind: 'err', title: 'Nothing to work with' });
    const r = await api('/api/ai/caption', { method: 'POST', body: { notes: d.text, platforms: plats.length ? plats : ['x', 'bluesky', 'instagram'], tone, mediaId: img?.id } });
    d.text = r.base;
    text.value = r.base; grow();
    for (const [p, txt] of Object.entries(r.platforms || {})) d.overrides[p] = { ...(d.overrides[p] || {}), text: txt };
    if (r.reddit_title && plats.includes('reddit')) d.overrides.reddit = { ...(d.overrides.reddit || {}), title: r.reddit_title };
    touch();
    pop(`Wrote ${Object.keys(r.platforms || {}).length} versions. Tweak any of them in the previews.`, { title: 'Drafted' });
  }
  async function rewrite(instruction) {
    if (!d.text.trim()) return pop('Write something first.', { kind: 'err' });
    const r = await api('/api/ai/rewrite', { method: 'POST', body: { text: d.text, instruction: `${instruction}. Tone: ${tone}.` } });
    d.text = r.text;
    text.value = r.text; grow();
    touch();
  }
  async function generate(p, sz) {
    if (!p.trim()) return pop('Describe the image first.', { kind: 'err' });
    const m = await api('/api/ai/image', { method: 'POST', body: { prompt: p, size: sz } });
    state.media.push(m);
    d.mediaIds.push(m.id);
    renderMedia();
    touch();
    pop('Image added to your post.', { title: 'Generated' });
  }

  // ---------- Previews ----------
  const previews = h('aside.previews', { 'aria-label': 'Post previews' });
  function renderPreviews() {
    const plats = [...new Set(d.targets.map((t) => account(t)?.platform).filter(Boolean))];
    if (!plats.length) {
      previews.replaceChildren(h('div.previews-head', 'Preview'), h('div.empty-pv',
        h('img', { src: '/img/logo.svg', alt: '' }),
        h('b', 'Pick where to post'),
        state.accounts.length ? 'Select an account on the left to see exactly how the post will look there.' : 'Connect an account first, then you’ll see a live preview for each platform here.'));
      return;
    }
    const mediaList = d.mediaIds.map(media).filter(Boolean);
    previews.replaceChildren(h('div.previews-head', h('span', `Preview · ${plats.length} platform${plats.length > 1 ? 's' : ''}`)), ...plats.map((pid) => preview(pid, mediaList)));
  }

  function preview(pid, mediaList) {
    const P = platform(pid);
    const a = account(d.targets.find((t) => account(t)?.platform === pid));
    const o = (d.overrides[pid] ||= {});
    const custom = typeof o.text === 'string';
    const getText = () => (custom ? o.text : d.text);

    const doneEl = h('span.done');
    const body = h('div.pv-text');
    const titleEl = pid === 'reddit' ? h('div.pv-title') : null;
    const paint = () => {
      const t = getText();
      const n = count(t, pid);
      const over = n - P.limits.text;
      doneEl.className = 'done' + (over > 0 ? ' burnt' : '');
      doneEl.replaceChildren(toastIcon(n / P.limits.text), over > 0 ? `${over} over` : `${n} / ${P.limits.text}`);
      doneEl.title = over > 0 ? `Burnt: ${over} characters over ${P.name}'s limit` : `${P.limits.text - n} characters left`;
      body.className = 'pv-text' + (t ? '' : ' empty');
      body.replaceChildren(...(t ? richText(t, P.limits.text, over) : ['Your post text shows up here.']));
      if (titleEl) titleEl.textContent = o.title || (t.split('\n')[0] || 'Post title').slice(0, 300);
    };

    const imgs = mediaList.slice(0, Math.max(1, P.limits.images));
    const gallery = imgs.length
      ? h('div.pv-media.n' + Math.min(imgs.length, 4) + (pid === 'instagram' ? '.square' : ''),
        imgs.slice(0, 4).map((m) => (m.mime.startsWith('video/') ? h('div.vid', '▶ video') : h('img', { src: mediaUrl(m), alt: '' }))))
      : null;

    const warns = [];
    const hasVid = mediaList.some((m) => m.mime.startsWith('video/'));
    if (P.limits.requiresMedia && !mediaList.length) warns.push(`${P.name} needs a photo or video.`);
    if (P.limits.needsPublicUrl && !(state.config?.publicMedia === 'blob' || (state.config?.publicMedia === 'local' && state.settings?.publicBaseUrl))) warns.push(state.config?.hosted ? 'Instagram needs public media hosting. Connect a Vercel Blob store to this project (see Settings).' : 'Instagram needs a Public URL to fetch your media. Set one in Settings.');
    if (!P.limits.video && hasVid) warns.push(`Video isn’t supported for ${P.name} yet.`);
    if (mediaList.filter((m) => m.mime.startsWith('image/')).length > P.limits.images) warns.push(`${P.name} only takes ${P.limits.images} image${P.limits.images > 1 ? 's' : ''}; extras are skipped.`);
    if (pid === 'bluesky' && mediaList.some((m) => m.size > 1_000_000)) warns.push('One image is over Bluesky’s 1MB limit.');
    if (a && a.status !== 'ok') warns.push(`${a.label}: ${a.status === 'pending' ? 'needs authorization' : 'connection problem'}. Check Accounts.`);

    const opts = [];
    if (pid === 'reddit') {
      opts.push(
        h('label.field', h('span', 'Subreddit'), h('input', { value: o.subreddit || '', placeholder: a?.credentials?.defaultSubreddit || `u_${a?.credentials?.username || 'you'}`, oninput: (e) => { o.subreddit = e.target.value.trim(); saveLocal(d); } })),
        h('label.field', h('span', 'Title'), h('input', { value: o.title || '', placeholder: 'Uses the first line if empty', maxlength: 300, oninput: (e) => { o.title = e.target.value; saveLocal(d); paint(); } })));
    }
    if (pid === 'tiktok') {
      opts.push(h('label.field.full', h('span', 'Who can watch'), h('select', { onchange: (e) => { o.privacy = e.target.value; saveLocal(d); } },
        [['SELF_ONLY', 'Only me (required until TikTok audits your app)'], ['PUBLIC_TO_EVERYONE', 'Everyone'], ['MUTUAL_FOLLOW_FRIENDS', 'Friends'], ['FOLLOWER_OF_CREATOR', 'Followers']]
          .map(([v, l]) => h('option', { value: v, selected: (o.privacy || 'SELF_ONLY') === v }, l)))));
    }

    const card = h('article.card.pv',
      h('div.pv-top', pb(pid), h('span.nm', P.name), doneEl,
        h('button.btn.sm' + (custom ? '' : '.quiet'), {
          onclick: () => { if (custom) delete o.text; else o.text = d.text; saveLocal(d); renderPreviews(); },
          title: custom ? 'Go back to the main text' : `Write different text just for ${P.name}`,
        }, custom ? h('span', 'Use main text') : h('span', icon('edit'), ' Edit for ' + P.name.split(' ')[0]))),
      h('div.pv-post',
        ava(a, { badge: false }),
        h('div', { style: { minWidth: 0 } },
          h('div.pv-who', h('b', a?.profile?.name || a?.label || 'You'), h('span', `${a?.profile?.handle || ''} · now`)),
          titleEl, body, gallery)),
      custom ? h('div.pv-edit', h('textarea', { value: o.text, 'aria-label': `Text for ${P.name}`, oninput: (e) => { o.text = e.target.value; saveLocal(d); paint(); } })) : null,
      opts.length ? h('div.pv-opts', opts) : null,
      ...warns.map((w) => h('div.pv-warn', w)));
    paint();
    return card;
  }

  // ---------- The toaster: slots = accounts, dial = when, lever = post ----------
  const dock = h('div.dock');
  const slotsEl = h('div.slots', { 'aria-hidden': 'true' });
  const openingsEl = h('div.openings', { 'aria-hidden': 'true' });
  const hintEl = h('span.hint');
  const MAX_SLOTS = 5;

  function loaf(pid, i) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 66 72');
    s.setAttribute('class', 'loaf');
    s.innerHTML = '<path d="M10 26C1 24 0 8 14 5c7-5 31-5 38 0 14 3 13 19 4 21v40a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="#C47A3A" stroke="#24170F" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<path class="crumbfill" d="M15 28c-6-1-6-12 2-13.5 5-3.5 27-3.5 32 0 8 1.5 8 12.5 2 13.5v36a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2z" fill="#F3D9A4" style="transition:fill .5s"/>';
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 24 24');
    mark.innerHTML = `<path fill="currentColor" d="${BRAND_PATHS[pid] || ''}"/>`;
    return h('div.bread', { style: { '--i': i } }, s, h('span.mark', mark));
  }

  function renderSlots() {
    const picked = d.targets.map(account).filter(Boolean);
    const shown = picked.slice(0, MAX_SLOTS);
    const n = Math.max(2, shown.length);
    slotsEl.replaceChildren(...[...Array(n)].map((_, i) => {
      const a = shown[i];
      return h('div.well', a ? loaf(a.platform, i) : null);
    }), ...(picked.length > MAX_SLOTS ? [h('div.well.more', `+${picked.length - MAX_SLOTS}`)] : []));
    openingsEl.replaceChildren(...[...Array(n)].map((_, i) => h('i' + (shown[i] ? '' : '.off'))));
    hintEl.textContent = picked.length
      ? `${picked.length} slice${picked.length === 1 ? '' : 's'} loaded: ${[...new Set(picked.map((a) => platform(a.platform)?.name.split(' ')[0]))].join(', ')}`
      : 'Pick accounts above to load the toaster.';
    const lever = dock.querySelector('.lever');
    if (lever) lever.title = picked.length ? '' : 'Pick at least one account first';
  }

  const angleFor = () => {
    if (mode !== 'later' || !d.scheduledAt) return -130;
    const hrs = (Date.parse(d.scheduledAt) - Date.now()) / 3600e3;
    return -130 + Math.max(0.12, Math.sqrt(Math.min(Math.max(hrs, 0) / 48, 1))) * 260; // sqrt: near times still turn the knob visibly
  };
  const whenLabel = () => (mode === 'later' && d.scheduledAt ? fmtWhen(d.scheduledAt) : 'Right now');

  function renderDock() {
    const at = (days, hr) => { const t = new Date(); t.setDate(t.getDate() + days); t.setHours(hr, 0, 0, 0); return t; };
    const tonight = at(new Date().getHours() >= 20 ? 1 : 0, 20);
    const choose = (t) => {
      if (!t) { mode = 'now'; d.scheduledAt = null; }
      else { mode = 'later'; d.scheduledAt = t.toISOString(); }
      saveLocal(d);
      renderDock();
    };
    const custom = h('input', { type: 'datetime-local', min: toLocalInput(new Date()), value: mode === 'later' && d.scheduledAt ? toLocalInput(new Date(d.scheduledAt)) : '',
      onchange: (e) => e.target.value && choose(new Date(e.target.value)) });
    const opt = (label, t, sub) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(t ? mode === 'later' && d.scheduledAt === t.toISOString() : mode === 'now'), onclick: () => choose(t) }, label, h('small', sub));
    const popEl = h('div.dial-pop', { hidden: true, role: 'menu' },
      h('div.ttl', 'When should it pop?'),
      opt('Right now', null, 'pull the lever'),
      opt('In 1 hour', new Date(Math.ceil((Date.now() + 3600e3) / 300e3) * 300e3), fmtTime(new Date(Date.now() + 3600e3))),
      opt(tonight.getDate() === new Date().getDate() ? 'Tonight' : 'Tomorrow night', tonight, '8:00 PM'),
      opt('Tomorrow morning', at(1, 9), '9:00 AM'),
      h('label', 'Pick a time', custom));
    const dial = h('button.dial', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `When to post: ${whenLabel()}. Change`, style: { '--angle': angleFor() + 'deg' }, onclick: () => (popEl.hidden = !popEl.hidden) }, h('span.ring'), h('span.knob'));
    closeDial = (e) => { if (!dialWrap.contains(e.target)) popEl.hidden = true; };
    const dialWrap = h('div.dialwrap', dial, h('div.dial-read', h('span', mode === 'later' ? 'Pops' : 'Browning'), h('b', whenLabel())), popEl);

    const later = mode === 'later';
    const lever = h('button.lever', { type: 'button', 'aria-label': later ? `Schedule for ${whenLabel()}` : 'Toast it: post now', onclick: () => submit(later ? 'schedule' : 'now') },
      h('span.track', h('span.knob')),
      h('span.label', h('b', later ? 'Schedule' : 'Toast it'), h('small', later ? 'pull to set the timer' : 'pull to post now')));

    dock.replaceChildren(h('div.toaster',
      slotsEl,
      h('div.body', openingsEl, h('span.shine'),
        h('div.controls',
          h('div.left', dialWrap, h('div.sub', hintEl, h('button.btn.chrome.sm', { type: 'button', onclick: (e) => submit('draft', e.currentTarget) }, 'Save draft'))),
          lever),
        h('span.band')),
      h('div.feet', h('i'), h('i'))));
    renderSlots();
  }

  async function submit(action, btn) {
    if (action === 'schedule' && !d.scheduledAt) return pop('Turn the dial to pick a time.', { kind: 'err' });
    if (action === 'schedule' && Date.parse(d.scheduledAt) < Date.now() - 60000) return pop('That time has already passed. Turn the dial again.', { kind: 'err' });
    if (action !== 'draft' && !d.targets.length) return pop('The toaster’s empty. Pick at least one account up top.', { kind: 'err', title: 'No bread' });
    if (action !== 'draft' && !d.text.trim() && !d.mediaIds.length) return pop('Your post is empty.', { kind: 'err' });
    const body = { ...d, scheduledAt: mode === 'later' ? d.scheduledAt : null, action };

    if (action === 'draft') {
      return busy(btn, async () => {
        const post = await api('/api/posts', { method: 'POST', body });
        await load();
        d.id = post.id;
        saveLocal(d);
        pop('Saved as a draft. Find it in the Queue.', { title: 'Saved' });
      }, 'Saving…');
    }

    const toaster = dock.querySelector('.toaster');
    const lever = dock.querySelector('.lever');
    lever.disabled = true;
    toaster.classList.remove('popped', 'burnt');
    toaster.classList.add('loading');
    const started = Date.now();
    try {
      const post = await api('/api/posts', { method: 'POST', body });
      await new Promise((r) => setTimeout(r, Math.max(0, 900 - (Date.now() - started)))); // let it toast a moment
      await load();
      toaster.classList.remove('loading');
      const ok = action === 'schedule' || post.status === 'published';
      toaster.classList.add(ok ? 'popped' : 'burnt');
      if (action === 'schedule') pop(`It’ll pop ${fmtWhen(post.scheduledAt)}.`, { title: 'Timer set' });
      else {
        const res = Object.values(post.results || {});
        const okN = res.filter((r) => r.ok).length;
        if (post.status === 'published') pop(`Posted to ${okN} account${okN === 1 ? '' : 's'}.`, { title: 'Ding! Toasted' });
        else pop(`${okN} of ${res.length} went out. Open the Queue to see what burnt.`, { kind: 'err', title: post.status === 'failed' ? 'Burnt' : 'Half-baked' });
      }
      state.draft = blank();
      saveLocal(state.draft);
      setTimeout(() => (location.hash = '#/queue'), ok ? 1300 : 1800);
    } catch (e) {
      toaster.classList.remove('loading');
      toaster.classList.add('burnt');
      lever.disabled = false;
      pop(e.message, { kind: 'err', title: 'Burnt' });
    }
  }

  function reset() {
    state.draft = blank();
    saveLocal(state.draft);
    if (location.hash !== '#/compose') location.hash = '#/compose';
    else { root.replaceChildren(); compose(root, {}); }
  }

  // ---------- Page ----------
  root.append(
    h('div.page-head',
      h('div', h('span.tagline', d.id ? 'back in the toaster' : 'fresh out of the toaster'), h('h1', d.id ? 'Edit post' : 'New post'), h('p', 'Write it once, check how each platform will show it, then pull the lever.')),
      (d.id || d.text || d.mediaIds.length) ? h('button.btn.sm', { onclick: reset }, icon('plus'), 'Start fresh') : null),
    h('div.compose',
      h('section.card.composer',
        h('div.composer-sec', h('div.sec-label', h('span', 'Post to'), state.accounts.length ? h('a', { href: '#/accounts' }, 'Manage') : null), accts),
        inspoSec,
        h('div.composer-sec', text, textMeta),
        h('div.composer-sec', h('div.sec-label', h('span', 'Media')), mediaRow, fileInput),
        h('div.composer-sec', h('div.sec-label', h('span', 'AI assist'), state.providers?.text ? h('span.muted', { style: { fontSize: '12.5px' } }, state.providers.text === 'claude' ? 'Claude' : 'OpenAI') : null), aiSec),
        dock),
      previews));

  renderAccounts();
  renderMedia();
  renderAI();
  renderInspo();
  renderPreviews();
  renderDock();
  updateMeta();
  return () => document.removeEventListener('click', onDocClick);
}

// Shrink big images in the browser so they fit every platform (Bluesky ~1MB, Instagram wants JPEG).
async function prepare(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return { file, ...(await dims(file)) };
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { file };
  const needs = file.size > 950_000 || file.type !== 'image/jpeg' || Math.max(bmp.width, bmp.height) > 2048;
  if (!needs) return { file, width: bmp.width, height: bmp.height };
  const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), ht = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = ht;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, ht);
  ctx.drawImage(bmp, 0, 0, w, ht);
  let q = 0.88, blob;
  do { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); q -= 0.08; } while (blob.size > 950_000 && q > 0.4);
  return { file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), width: w, height: ht };
}
async function dims(file) {
  if (!file.type.startsWith('image/')) return {};
  const bmp = await createImageBitmap(file).catch(() => null);
  return bmp ? { width: bmp.width, height: bmp.height } : {};
}
