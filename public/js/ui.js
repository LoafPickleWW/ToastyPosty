// Tiny DOM kit: h() builds elements, icons, badges, pop() notifications, modal().
import { BRAND_PATHS } from './brands.js';

export function h(tag, attrs = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---- Icons (24px, stroke) ----
const P = {
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  queue: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  feeds: '<rect x="3.5" y="4" width="7" height="16" rx="2"/><rect x="13.5" y="4" width="7" height="10" rx="2"/>',
  accounts: '<circle cx="8" cy="9" r="3.2"/><path d="M2.8 19c.7-3 2.7-4.6 5.2-4.6s4.5 1.6 5.2 4.6"/><circle cx="17" cy="8" r="2.5"/><path d="M15.6 13.2c2.6-.3 4.8 1.2 5.6 4.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.6 1H21a2 2 0 1 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-8.5 9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  wand: '<path d="M5 19L16 8M14 6l4 4"/><path d="M19 3v3M17.5 4.5h3M7 3v2M6 4h2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  book: '<path d="M5 4.5h9a4 4 0 0 1 4 4V20H9a4 4 0 0 1-4-4z"/><path d="M5 16a3 3 0 0 1 3-3h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  rss: '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.6" fill="currentColor"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
  tag: '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = P[name] || '';
  return s;
}

// Little toast icon that browns as `r` (0..1+) climbs toward the limit.
export function toastIcon(r) {
  const stops = [[0, [246, 217, 160]], [0.6, [228, 172, 96]], [0.9, [184, 100, 42]], [1, [122, 62, 20]], [1.01, [42, 26, 18]]];
  let c = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (r <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = Math.max(0, Math.min(1, (r - a) / (b - a)));
      c = ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
      break;
    }
  }
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="M5.5 10.2C2.6 9.8 2.4 4.6 6.6 3.6c2.3-1.9 8.5-1.9 10.8 0 4.2 1 4 6.2 1.1 6.6v8.8a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2z" fill="rgb(${c.join(',')})" stroke="#7A3E14" stroke-width="1.6" stroke-linejoin="round"/>`;
  return s;
}

export const $ = (s, root = document) => root.querySelector(s);

const NAMES = { x: 'X', bluesky: 'Bluesky', reddit: 'Reddit', instagram: 'Instagram', tiktok: 'TikTok' };
// Platform badge: the real logo on its brand-colored tile.
export function pb(p, lg) {
  const el = h('span.pb' + (lg ? '.lg' : ''), { 'data-p': p, role: 'img', 'aria-label': NAMES[p] || p });
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', BRAND_PATHS[p] || '');
  s.append(path);
  el.append(s);
  return el;
}

const initials = (s = '?') => s.replace(/^[@u/]+/, '').slice(0, 1).toUpperCase() || '?';
export function ava(account, { badge = true } = {}) {
  const name = account?.profile?.name || account?.label || '?';
  const face = account?.profile?.avatar
    ? h('img', { src: account.profile.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(h('span.ini', initials(name))) })
    : h('span.ini', initials(name));
  return h('span.ava', face, badge && account ? pb(account.platform) : null);
}

// ---- Notifications: a slice of toast pops up ----
export function pop(msg, { kind = 'ok', title } = {}) {
  const box = document.getElementById('toaster');
  box.querySelectorAll('.pop').forEach((p) => p.remove());
  const el = h('div.pop' + (kind === 'err' ? '.err' : ''), { role: kind === 'err' ? 'alert' : 'status', onclick: () => sink(el) },
    h('img', { src: '/img/logo.svg', alt: '' }),
    h('div', title ? h('b', title) : null, msg));
  box.append(el);
  setTimeout(() => sink(el), kind === 'err' ? 7000 : 3400);
}
function sink(el) {
  if (!el.isConnected || el.classList.contains('out')) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 260);
}

// ---- Modal ----
export function modal({ title, titleIcon, body, foot, wide, onClose }) {
  const prevFocus = document.activeElement;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); prevFocus?.focus?.(); onClose?.(); };
  const esc = (e) => e.key === 'Escape' && close();
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h3', titleIcon || null, title), h('button.btn.quiet.icon', { 'aria-label': 'Close', onclick: () => close() }, h('span', { style: { fontSize: '22px', lineHeight: 1 } }, '×'))),
    h('div.modal-body', body),
    foot ? h('div.modal-foot', foot) : null);
  const scrim = h('div.scrim', { onmousedown: (e) => e.target === scrim && close() }, box);
  document.body.append(scrim);
  document.addEventListener('keydown', esc);
  setTimeout(() => (box.querySelector('.modal-body input, .modal-body textarea, .modal-body select') || box.querySelector('.modal-head button'))?.focus(), 30);
  return { close, box };
}

export function confirmBox(title, text, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: h('p', { style: { margin: 0, color: 'var(--ink-2)' } }, text),
      foot: [
        h('button.btn', { onclick: () => { done = true; m.close(); resolve(false); } }, 'Cancel'),
        h('button.btn.primary', { onclick: () => { done = true; m.close(); resolve(true); } }, okLabel),
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

export async function busy(btn, fn, label = 'Working…') {
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.classList.add('busy');
  btn.replaceChildren(h('span.spin'), label);
  try { return await fn(); }
  catch (e) { pop(e.message, { kind: 'err', title: 'Burnt' }); }
  finally { btn.disabled = false; btn.classList.remove('busy'); btn.replaceChildren(...old); }
}

// ---- Time helpers ----
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso) => {
  const d = new Date(iso), t = new Date();
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};
export const fmtWhen = (iso) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
export const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const STATUS_WORD = { draft: 'Draft', scheduled: 'Scheduled', queued: 'Posting', publishing: 'Posting', published: 'Posted', partial: 'Partly posted', failed: 'Failed' };
export const pill = (status) => h('span.pill.' + status, STATUS_WORD[status] || status);
