// Feeds: columns from your accounts and from the open web (RSS, topics), side by side.
// Every story has a "Toast" button that starts a post about it.
import { h, icon, pb, pop, modal, ago, confirmBox } from '../ui.js';
import { state, api, load, platform, account } from '../api.js';

const cache = new Map();
const REFRESH_MS = 5 * 60_000;
const splitKw = (s = '') => s.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);

// Feed titles from the wild can be long-winded; tidy the common ones.
const tidyTitle = (t = '') => t
  .replace(/^Stories by (.+) on Medium$/i, '$1 · Medium')
  .replace(/^Hacker News: /, 'HN: ')
  .replace(/^Release notes from (.+)$/i, '$1 releases');

// Start a new post in Compose from a story.
export function toastThis(it, feedLabel) {
  state.draft = {
    id: null,
    text: [it.title || '', it.url || ''].filter(Boolean).join('\n\n'),
    overrides: {},
    mediaIds: [],
    targets: state.draft?.targets?.filter((t) => account(t)) || [],
    scheduledAt: null,
    inspiration: { title: it.title || (it.text || '').slice(0, 120), url: it.url, snippet: (it.text || '').slice(0, 400), source: it.author || it.handle || feedLabel || '' },
  };
  try { localStorage.setItem('toastyposty.draft', JSON.stringify(state.draft)); } catch {}
  location.hash = '#/compose';
}

function highlight(text, kws) {
  if (!text || !kws.length) return text;
  const re = new RegExp(`(${kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark.kw', part) : part));
}

const initial = (s = '') => ((s.replace(/^u\//, '').match(/[\p{L}\p{N}]/u)) || ['?'])[0].toUpperCase();

export default function feeds(root) {
  const board = h('div.board');
  const refreshers = [];

  function column(f) {
    const web = f.kind === 'web';
    const a = web ? null : account(f.accountId);
    const P = web ? null : platform(f.platform);
    const src = web ? state.webSources?.find((s) => s.id === f.source) : P?.feedTypes.find((t) => t.id === f.type);
    const isTopic = web && f.source === 'topic';
    const kws = splitKw(isTopic ? f.query : f.keywords);
    const userTitle = isTopic && f.title === 'Google News' ? '' : f.title; // older topic columns were auto-named
    const label = tidyTitle(userTitle) || (isTopic ? kws.map((k) => k[0].toUpperCase() + k.slice(1)).join(', ') : f.query ? `${src?.label}: ${f.query}` : src?.label) || 'Feed';
    const sub = web ? (isTopic ? 'Topic' : src?.label?.replace(/ \(.*\)$/, '')) : `${P?.name} · ${a?.profile?.handle || a?.label || 'account removed'}`;
    const body = h('div.feed-body');
    const fresh = h('span.feed-fresh');
    const multiSource = isTopic || !web;

    const paint = (items) => body.replaceChildren(...(items.length
      ? items.map((it) => story(it, kws, label, multiSource))
      : [h('div.feed-msg', kws.length ? `Nothing mentioning ${kws.join(', ')} yet.` : 'Nothing here yet.')]));
    const refresh = async (force) => {
      const c = cache.get(f.id);
      if (c && !force && Date.now() - c.at < REFRESH_MS) { fresh.textContent = `Updated ${ago(new Date(c.at).toISOString())} ago`; return paint(c.items); }
      if (!c) body.replaceChildren(...[1, 2, 3, 4].map(() => h('div.story.skeleton', h('i'), h('i'), h('i'))));
      try {
        const { items } = await api(`/api/feeds/${f.id}/items`);
        cache.set(f.id, { items, at: Date.now() });
        fresh.textContent = 'Updated just now';
        paint(items);
      } catch (e) {
        body.replaceChildren(h('div.feed-msg.err', icon('info'), h('span', e.message)));
      }
    };
    refresh(false);
    refreshers.push(() => refresh(true));

    return h('section.feed-col', { 'aria-label': label },
      h('header.feed-head',
        web ? h('span.pb.webpb', { 'aria-hidden': 'true' }, icon(isTopic ? 'tag' : 'rss')) : pb(f.platform),
        h('div.feed-title',
          h('h2', { title: label }, label),
          h('div.feed-sub', h('span', sub), fresh)),
        h('div.feed-tools',
          h('button.btn.quiet.icon', { 'aria-label': `Refresh ${label}`, title: 'Refresh', onclick: () => refresh(true) }, icon('refresh')),
          h('button.btn.quiet.icon.danger', { 'aria-label': `Remove ${label}`, title: 'Remove column', onclick: async () => {
            if (await confirmBox('Remove this column?', 'This only removes it from your Feeds page.', 'Remove')) {
              await api(`/api/feeds/${f.id}`, { method: 'DELETE' }); cache.delete(f.id); await load(); render();
            }
          } }, icon('trash')))),
      kws.length ? h('div.feed-kws', h('span', isTopic ? 'Tracking' : 'Only'), ...kws.map((k) => h('span.kw-chip', k))) : null,
      body);
  }

  function story(it, kws, feedLabel, showSource) {
    const thumb = it.media?.[0];
    const who = it.author || it.handle || '';
    const source = showSource && it.handle && it.handle !== who ? it.handle.replace(/^Hacker News: .*/, 'Hacker News') : null;
    const titleText = it.title || (it.text || '').slice(0, 140);
    const snippet = it.title && it.text && it.text !== it.title ? it.text : '';
    return h('article.story',
      h('div.story-meta',
        it.avatar ? h('img.story-ava', { src: it.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span.story-ava.ini', initial(who)),
        h('b', who),
        source ? h('span.story-src', source) : null,
        it.time ? h('time', { datetime: it.time, title: new Date(it.time).toLocaleString() }, ago(it.time)) : null),
      h('div.story-main',
        h('div.story-copy',
          it.url
            ? h('a.story-title', { href: it.url, target: '_blank', rel: 'noopener' }, highlight(titleText, kws))
            : h('div.story-title', highlight(titleText, kws)),
          snippet ? h('p.story-snip', highlight(snippet, kws)) : null),
        thumb ? h('img.story-thumb', { src: thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null),
      h('div.story-foot',
        Object.entries(it.stats || {}).filter(([, v]) => v !== undefined && v !== null).slice(0, 3).map(([k, v]) => h('span.story-stat', `${v} ${k}`)),
        h('span.grow'),
        it.url ? h('a.btn.quiet.sm.story-open', { href: it.url, target: '_blank', rel: 'noopener', title: 'Open the original' }, icon('ext'), 'Open') : null,
        h('button.btn.sm.toast-this', { type: 'button', onclick: () => toastThis(it, feedLabel), title: 'Start a post about this' },
          h('img', { src: '/img/logo.svg', alt: '' }), 'Toast')));
  }

  // ---------- Add a feed (modal) ----------
  function openAdder(preset) {
    let mode = preset?.acct ? 'acct' : 'web';
    const holder = h('div');
    const foot = h('div.row', { style: { width: '100%', justifyContent: 'flex-end' } });
    const m = modal({ title: 'Add a feed', titleIcon: icon('rss'), body: holder, foot: [foot] });
    const paint = () => {
      const form = mode === 'web' ? webForm(preset) : acctForm();
      holder.replaceChildren(
        h('div.seg', { style: { marginBottom: '18px', display: 'flex' } },
          h('button', { type: 'button', style: { flex: 1 }, 'aria-pressed': String(mode === 'web'), onclick: () => { mode = 'web'; paint(); } }, 'From the web'),
          h('button', { type: 'button', style: { flex: 1 }, 'aria-pressed': String(mode === 'acct'), onclick: () => { mode = 'acct'; paint(); } }, 'From your accounts')),
        form.el);
      foot.replaceChildren(h('button.btn', { onclick: () => m.close() }, 'Cancel'), form.submit ? h('button.btn.primary', { onclick: (e) => add(form.submit(), e.currentTarget, m) }, icon('plus'), 'Add feed') : null);
    };
    paint();
  }

  async function add(body, btn, m) {
    btn.disabled = true;
    const old = [...btn.childNodes];
    btn.replaceChildren(h('span.spin'), 'Checking feed…');
    try {
      await api('/api/feeds', { method: 'POST', body });
      await load();
      m.close();
      render();
      requestAnimationFrame(() => board.scrollTo({ left: board.scrollWidth, behavior: 'smooth' }));
      pop('Feed added. It refreshes on its own every few minutes.', { title: 'Added' });
    } catch (e) {
      pop(e.message, { kind: 'err', title: 'Couldn’t add that feed' });
      btn.disabled = false;
      btn.replaceChildren(...old);
    }
  }

  function webForm(preset) {
    const sources = state.webSources || [];
    let srcId = preset?.source || 'topic';
    const sel = h('select', { onchange: () => { srcId = sel.value; paintSrc(); } }, sources.map((s) => h('option', { value: s.id, selected: s.id === srcId }, s.label)));
    const q = h('input', { value: preset?.query || '' });
    const qLabel = h('span');
    const help = h('small');
    const kw = h('input', { placeholder: 'e.g. launch, release, algorand' });
    const kwField = h('label.field', h('span', 'Only show posts mentioning', h('span.muted', { style: { fontWeight: 500 } }, 'optional')), kw, h('small', 'Comma-separated. Leave blank to see everything.'));
    const title = h('input', { placeholder: 'Optional' });
    function paintSrc() {
      const s = sources.find((x) => x.id === srcId);
      q.placeholder = s?.hint || '';
      qLabel.textContent = srcId === 'topic' ? 'Keywords or topics' : srcId === 'rss' ? 'Feed link' : 'Which one';
      help.textContent = s?.help || '';
      kwField.hidden = srcId === 'topic';
    }
    paintSrc();
    setTimeout(() => q.focus(), 40);
    return {
      el: h('div',
        h('label.field', h('span', 'Source'), sel),
        h('label.field', qLabel, q, help),
        kwField,
        h('label.field', h('span', 'Column name'), title),
        h('p.muted', { style: { fontSize: '12.5px', margin: 0 } }, 'Free and public. No accounts or API keys, fetched by your own computer.')),
      submit: () => ({ source: srcId, query: q.value, keywords: kw.value, title: title.value }),
    };
  }

  function acctForm() {
    const usable = state.accounts.filter((a) => a.status === 'ok');
    if (!usable.length) return { el: h('div.lock-note', icon('info'), h('div', 'Connect an account first to add its timeline, a search, or a subreddit. '), h('a', { href: '#/accounts' }, 'Go to Accounts →')) };
    const acctSel = h('select', { onchange: () => paintTypes() }, usable.map((a) => h('option', { value: a.id }, `${platform(a.platform).name} · ${a.label}`)));
    const typeSel = h('select', { onchange: () => paintQuery() });
    const q = h('input');
    const qField = h('label.field', h('span', 'Search for'), q);
    const kw = h('input', { placeholder: 'e.g. launch, release' });
    const title = h('input', { placeholder: 'Optional' });
    function paintTypes() {
      typeSel.replaceChildren(...platform(account(acctSel.value).platform).feedTypes.map((t) => h('option', { value: t.id }, t.label)));
      paintQuery();
    }
    function paintQuery() {
      const t = platform(account(acctSel.value).platform).feedTypes.find((x) => x.id === typeSel.value);
      qField.hidden = !t?.query;
      q.placeholder = t?.query || '';
    }
    paintTypes();
    return {
      el: h('div',
        h('label.field', h('span', 'Account'), acctSel),
        h('label.field', h('span', 'Show'), typeSel),
        qField,
        h('label.field', h('span', 'Only show posts mentioning', h('span.muted', { style: { fontWeight: 500 } }, 'optional')), kw),
        h('label.field', h('span', 'Column name'), title)),
      submit: () => ({ accountId: acctSel.value, type: typeSel.value, query: q.value.trim(), keywords: kw.value, title: title.value.trim() }),
    };
  }

  // Starter ideas when the board is empty.
  const STARTERS = [
    { label: 'Track a topic', sub: 'Google News + HN + Reddit', source: 'topic', icon: 'tag' },
    { label: 'Hacker News', sub: 'Front page', source: 'hn', icon: 'rss' },
    { label: 'A Medium writer', sub: 'e.g. @loafpickle', source: 'medium', icon: 'rss' },
    { label: 'A YouTube channel', sub: 'paste the @handle', source: 'youtube', icon: 'rss' },
    { label: 'Any RSS link', sub: 'blogs, news, podcasts', source: 'rss', icon: 'globe' },
  ];

  function render() {
    refreshers.length = 0;
    if (!state.feeds.length) {
      board.replaceChildren(h('div.feeds-empty.card',
        h('img', { src: '/img/logo.svg', alt: '' }),
        h('h3', 'Nothing on the table yet'),
        h('p', 'Add a feed to follow a topic, a blog, a channel or your own timelines. Then hit Toast on anything worth sharing.'),
        h('div.starters', STARTERS.map((s) => h('button.starter', { type: 'button', onclick: () => openAdder({ source: s.source }) },
          h('span.pb.webpb', icon(s.icon)), h('span', h('b', s.label), h('small', s.sub)))))));
      return;
    }
    board.replaceChildren(...state.feeds.map(column));
  }

  root.append(
    h('div.page-head',
      h('div', h('span.tagline', 'the morning paper'), h('h1', 'Feeds'),
        h('p', 'Follow topics, blogs, channels, news and your own timelines. Hit Toast on anything to start a post about it.')),
      h('div.row',
        state.feeds.length ? h('button.btn.sm', { onclick: () => refreshers.forEach((r) => r()) }, icon('refresh'), 'Refresh all') : null,
        h('button.btn.primary', { onclick: () => openAdder() }, icon('plus'), 'Add feed'))),
    board,
    h('p.muted.feeds-note', 'Web feeds are free and need no keys. From your accounts: X charges for reading timelines on most plans, and Instagram/TikTok only show your own posts.'));
  render();

  const timer = setInterval(() => refreshers.forEach((r) => r()), REFRESH_MS);
  return () => clearInterval(timer);
}
