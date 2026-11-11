// Queue: scheduled, drafts, posted, failed, plus a week strip.
import { h, icon, pb, pop, busy, pill, fmtTime, fmtDay, confirmBox } from '../ui.js';
import { state, api, load, subscribe, account, media, mediaUrl } from '../api.js';

const FILTERS = [
  ['upcoming', 'Scheduled'],
  ['draft', 'Drafts'],
  ['done', 'Posted'],
  ['trouble', 'Failed'],
  ['all', 'All'],
];
// Days brown as they fill up: untoasted bread to dark toast.
const SHADES = [['#F6E3BA', '#2A190E'], ['#EBC27F', '#2A190E'], ['#D69550', '#2A190E'], ['#A9602A', '#FFF4E2'], ['#6E3A16', '#FFF4E2']];
const when = (p) => p.scheduledAt || p.publishedAt || p.updatedAt || p.createdAt;

export default function queue(root) {
  let filter = state.posts.some((p) => ['failed', 'partial'].includes(p.status)) && !state.posts.some((p) => p.status === 'scheduled') ? 'trouble' : 'upcoming';
  const weekEl = h('div.week');
  const tools = h('div.q-tools');
  const list = h('div');

  function renderWeek() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    weekEl.replaceChildren(...[...Array(7)].map((_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      const ps = state.posts.filter((p) => p.status !== 'draft' && (p.scheduledAt || p.publishedAt) && Date.parse(p.scheduledAt || p.publishedAt) >= d && Date.parse(p.scheduledAt || p.publishedAt) < next);
      const shade = SHADES[Math.min(ps.length, SHADES.length - 1)];
      return h('div.day' + (i === 0 ? '.today' : ''), { title: `${ps.length} post${ps.length === 1 ? '' : 's'}`, style: { '--toast': shade[0], '--toast-ink': shade[1] } },
        h('span.dn', d.toLocaleDateString([], { weekday: 'short' })),
        h('span.dd', d.getDate()),
        h('span.slots', ps.map((p) => h('i.' + p.status))));
    }));
  }

  function renderTools() {
    const n = (f) => state.posts.filter(match(f)).length;
    tools.replaceChildren(
      h('div.seg', { role: 'tablist' }, FILTERS.map(([id, label]) => h('button', { role: 'tab', 'aria-pressed': String(filter === id), onclick: () => { filter = id; render(); } }, `${label}${id !== 'all' && n(id) ? ` · ${n(id)}` : ''}`))),
      h('a.btn.primary.sm', { href: '#/compose' }, icon('plus'), 'New post'));
  }

  const match = (f) => ({
    upcoming: (p) => ['scheduled', 'queued', 'publishing'].includes(p.status),
    draft: (p) => p.status === 'draft',
    done: (p) => p.status === 'published',
    trouble: (p) => ['failed', 'partial'].includes(p.status),
    all: () => true,
  }[f]);

  function item(p) {
    const acts = [];
    if (['draft', 'scheduled', 'failed'].includes(p.status)) acts.push(h('a.btn.sm', { href: '#/compose/' + p.id }, icon('edit'), 'Edit'));
    if (['draft', 'scheduled'].includes(p.status)) acts.push(h('button.btn.sm', { onclick: (e) => busy(e.currentTarget, () => publish(p), 'Posting…') }, icon('send'), 'Post now'));
    if (['failed', 'partial'].includes(p.status)) acts.push(h('button.btn.sm.primary', { onclick: (e) => busy(e.currentTarget, () => publish(p), 'Retrying…') }, icon('refresh'), 'Retry failed'));
    if (p.status === 'scheduled') acts.push(h('button.btn.sm.quiet', { title: 'Move back to drafts', onclick: async () => { await api(`/api/posts/${p.id}/unschedule`, { method: 'POST' }); await load(); pop('Moved back to drafts.'); } }, icon('undo'), 'Unschedule'));
    acts.push(h('button.btn.sm.quiet.icon.danger', { 'aria-label': 'Delete', title: 'Delete', onclick: async () => {
      if (await confirmBox('Delete this post?', 'It’s removed from Toasty Posty. Anything already published stays up on the platforms.', 'Delete')) {
        await api(`/api/posts/${p.id}`, { method: 'DELETE' }); await load();
      }
    } }, icon('trash')));

    const results = Object.entries(p.results || {});
    const thumbs = (p.mediaIds || []).map(media).filter(Boolean).slice(0, 4);
    return h('article.card.q-item.st-' + p.status,
      h('div.q-time', p.status === 'draft' ? 'Draft' : fmtTime(when(p))),
      h('div.q-body',
        h('div.q-text' + (p.text ? '' : '.empty'), p.text || 'Media only'),
        thumbs.length ? h('div.q-thumbs', thumbs.map((m) => (m.mime.startsWith('video/') ? h('span.pill.plain', '▶ video') : h('img', { src: mediaUrl(m), alt: m.alt || '' })))) : null,
        h('div.q-meta', pill(p.status), p.targets.map((t) => { const a = account(t); return a ? h('span.pill.plain', { title: a.label }, pb(a.platform), a.profile?.handle || a.label) : null; })),
        results.length ? h('div.q-results', results.map(([aid, r]) => {
          const a = account(aid);
          return h('div', { class: r.ok ? 'ok' : 'err' },
            r.ok ? '✓ ' : '✗ ', h('b', a?.label || 'Removed account'), ': ',
            r.ok ? (r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'View post ↗') : 'Posted') : r.error,
            r.note ? h('div.note-l', r.note) : null);
        })) : null),
      h('div.q-actions', acts));
  }

  async function publish(p) {
    const r = await api(`/api/posts/${p.id}/publish`, { method: 'POST' });
    await load();
    r.status === 'published' ? pop('Posted everywhere it needed to go.', { title: 'Ding! Toasted' }) : pop('Some accounts failed. The error is on the post.', { kind: 'err', title: 'Burnt' });
  }

  function renderList() {
    const ps = state.posts.filter(match(filter)).sort((a, b) => (filter === 'upcoming' ? Date.parse(when(a)) - Date.parse(when(b)) : Date.parse(when(b)) - Date.parse(when(a))));
    if (!ps.length) {
      const copy = {
        upcoming: ['Nothing scheduled', 'The toaster’s cold. Write a post and schedule it to see it here.'],
        draft: ['No drafts', 'Posts you save for later land here.'],
        done: ['Nothing posted yet', 'Once something goes out, you’ll find it here with links to the live posts.'],
        trouble: ['No failed posts', 'Nothing burnt. Nice.'],
        all: ['No posts yet', 'Start with a new post.'],
      }[filter];
      list.replaceChildren(h('div.card.empty', h('img', { src: '/img/logo.svg', alt: '' }), h('h3', copy[0]), h('p', copy[1]), h('a.btn.primary', { href: '#/compose' }, icon('pen'), 'Write a post')));
      return;
    }
    const groups = new Map();
    for (const p of ps) {
      const k = p.status === 'draft' ? 'Drafts' : fmtDay(when(p));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    list.replaceChildren(...[...groups].flatMap(([k, items]) => [h('h2.q-day', k), ...items.map(item)]));
  }

  function render() { renderWeek(); renderTools(); renderList(); }

  root.append(
    h('div.page-head', h('div', h('span.tagline', 'the toast rack'), h('h1', 'Queue'), h('p', 'Everything scheduled, drafted, posted or failed. Failed posts show the platform’s exact error, and Retry only re-sends to the accounts that failed.'))),
    weekEl,
    h('div.week-legend', h('span', 'This week:'), ...SHADES.slice(0, 4).map((sh, i) => h('span', h('i', { style: { background: sh[0] } }), ['empty', '1 post', '2 posts', '3+ posts'][i]))),
    tools, list,
    h('div.note', { style: { marginTop: '24px' } }, icon('info'),
      h('span', h('b', 'Keep a tab open. '), 'Your posts live in this browser, so scheduled posts go out while Toasty Posty is open in a tab (it can be in the background). Anything that came due while it was closed goes out the moment you open it again.')));
  render();
  return subscribe(render);
}
