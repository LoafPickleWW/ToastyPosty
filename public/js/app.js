// App shell: tabs, top-bar status, router.
import { h, icon, pop, fmtWhen } from './ui.js';
import { state, load, subscribe, api } from './api.js';
import * as kitchen from './local-api.js';
import compose from './views/compose.js';
import queue from './views/rack.js';
import feeds from './views/spread.js';
import accounts from './views/pantry.js';
import settings from './views/settings.js';

const ROUTES = [
  { id: 'compose', label: 'Compose', icon: 'pen', view: compose },
  { id: 'queue', label: 'Queue', icon: 'queue', view: queue },
  { id: 'feeds', label: 'Feeds', icon: 'feeds', view: feeds },
  { id: 'accounts', label: 'Accounts', icon: 'accounts', view: accounts },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings },
];

const viewEl = document.getElementById('view');
let current = null;
let cleanup = null;

function route() {
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.scrim').forEach((s) => s.remove());
  current = r;
  viewEl.replaceChildren();
  const out = r.view(viewEl, { arg: rest.join('/') });
  if (typeof out === 'function') cleanup = out;
  viewEl.append(h('footer.foot-note',
    h('span', 'Toasty Posty · free & open source · your keys stay in this browser · ', h('a', { href: '/about' }, 'About')),
    h('span', 'Made by ', h('a', { href: 'https://loafpickle.com', target: '_blank', rel: 'noopener' }, 'LoafPickle'))));
  renderChrome();
  window.scrollTo({ top: 0 });
}

function renderChrome() {
  const scheduled = state.posts.filter((p) => p.status === 'scheduled');
  const failed = state.posts.filter((p) => ['failed', 'partial'].includes(p.status)).length;
  document.getElementById('tabs').replaceChildren(...ROUTES.map((r) =>
    h('a.tab', { href: '#/' + r.id, 'aria-current': current?.id === r.id ? 'page' : null },
      icon(r.icon), h('span', r.label),
      r.id === 'queue' && (scheduled.length || failed) ? h('span.count', { title: failed ? `${failed} failed` : `${scheduled.length} scheduled` }, failed ? '!' : scheduled.length) : null)));

  const next = scheduled.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const ai = state.providers?.text;
  // replaceChildren() prints null as the text "null", so drop empty slots first.
  document.getElementById('status').replaceChildren(...[
    next ? h('a.pill.scheduled.next', { href: '#/queue', style: { textDecoration: 'none' } }, 'Next: ' + fmtWhen(next.scheduledAt)) : null,
    h('a.pill.ai' + (ai ? '' : '.off'), { href: '#/settings', title: ai ? 'AI drafting is on' : 'Add an AI key in Settings' }, ai ? (ai === 'claude' ? 'Claude' : 'OpenAI') : 'AI off'),
  ].filter(Boolean));
}

function applyTheme() {
  const t = state.settings?.theme;
  document.documentElement.dataset.theme = ['butter', 'burnt', 'auto'].includes(t) ? t : 'butter';
}

// Old links from the first version.
const LEGACY = { toaster: 'compose', rack: 'queue', spread: 'feeds', pantry: 'accounts', kitchen: 'settings' };
window.addEventListener('hashchange', () => {
  if (/tiktok_(code|error)=/.test(location.hash)) return void finishTikTok().then(route);
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (LEGACY[id]) return location.replace(location.hash.replace(id, LEGACY[id]));
  route();
});
subscribe(() => { applyTheme(); renderChrome(); });

// ---------- Boot ----------

// If this deployment has an ACCESS_CODE, ask for it once and remember it in this browser.
function askForCode(message) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Access code', 'aria-label': 'Access code' });
    const err = h('p.muted', { style: { minHeight: '1.4em', margin: '8px 0 0' } }, message || '');
    const go = async () => {
      kitchen.saveCode(input.value.trim());
      const r = await fetch('/api/check-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value.trim() }) }).then((x) => x.json()).catch(() => ({}));
      if (r.ok) resolve();
      else { err.textContent = 'That code didn’t work.'; input.select(); }
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    viewEl.replaceChildren(h('div.card.empty', { style: { maxWidth: '440px', margin: '40px auto' } },
      h('img', { src: '/img/logo.svg', alt: '' }),
      h('h3', 'Staff only'),
      h('p', 'This Toasty Posty asks for an access code. Your posts and keys still stay in your own browser.'),
      h('div.row', { style: { justifyContent: 'center' } }, input, h('button.btn.primary', { onclick: go }, 'Come in')),
      err));
    input.focus();
  });
}

// TikTok sends you back to /oauth-tiktok, which forwards here with ?tiktok_code=…&tiktok_state=…
async function finishTikTok() {
  const m = location.hash.match(/[?&]tiktok_code=([^&]+)&tiktok_state=([^&]+)/);
  const err = location.hash.match(/[?&]tiktok_error=([^&]+)/);
  if (!m && !err) return;
  history.replaceState(null, '', location.pathname + '#/accounts');
  if (err) return pop('TikTok said: ' + decodeURIComponent(err[1]), { kind: 'err', title: 'Not authorized' });
  try {
    const a = await api('/api/oauth-finish', { method: 'POST', body: { code: decodeURIComponent(m[1]), state: decodeURIComponent(m[2]) } });
    a.status === 'ok' ? pop(`${a.profile?.handle || 'TikTok'} is connected.`, { title: 'Authorized' }) : pop(a.lastError || 'TikTok login didn’t finish.', { kind: 'err' });
  } catch (e) {
    pop(e.message, { kind: 'err', title: 'Not authorized' });
  }
}

// Scheduled posts go out from whichever tab is open. A browser lock keeps two tabs from both posting.
async function runScheduler() {
  const once = async () => {
    const n = await kitchen.tick().catch((e) => { console.error('[toasty] scheduler', e); return 0; });
    if (n) { await load(); pop(`${n} scheduled post${n === 1 ? '' : 's'} went out.`, { title: 'Ding! Toasted' }); }
  };
  const loop = async () => { await once(); setTimeout(loop, 15_000); };
  if (navigator.locks) navigator.locks.request('toasty-posty-scheduler', () => new Promise(() => loop()));
  else loop();
}

async function boot() {
  for (let attempt = 0; ; attempt++) {
    try {
      await kitchen.init();
      await load();
      break;
    } catch (e) {
      if (e instanceof kitchen.NeedsCode) { await askForCode(attempt ? 'That code didn’t work.' : ''); continue; }
      throw e;
    }
  }
  applyTheme();
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (LEGACY[id]) location.replace(location.hash.replace(id, LEGACY[id]));
  await finishTikTok();
  route();
  runScheduler();
}

boot().catch((e) => {
  viewEl.replaceChildren(h('div.empty.card',
    h('img', { src: '/img/logo.svg', alt: '' }),
    h('h3', 'The toaster is unplugged'),
    h('p', 'Toasty Posty couldn’t start. If you run it yourself, make sure ', h('code', 'npm start'), ' is running, then refresh.'),
    h('p.muted', e.message)));
  pop('Couldn’t start', { kind: 'err' });
});
