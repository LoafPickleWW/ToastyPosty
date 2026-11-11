// Accounts: one card per platform, connect as many accounts as you like, with key guides.
import { h, icon, pb, ava, pop, modal, busy, confirmBox } from '../ui.js';
import { state, api, load, subscribe, platform } from '../api.js';
import { guide, GUIDES } from '../guides.js';

const BLURB = {
  bluesky: 'Easiest to set up. Just an app password.',
  x: 'Posting works on the entry API tier.',
  reddit: 'Text, link and image posts to any sub.',
  instagram: 'Photos, carousels and Reels.',
  tiktok: 'Videos and photo posts.',
};

export default function accounts(root) {
  const grid = h('div.plats');

  function card(P) {
    const accts = state.accounts.filter((a) => a.platform === P.id);
    const g = GUIDES[P.id];
    return h('section.card.plat',
      h('div.plat-head', pb(P.id, true),
        h('div.grow', h('h3', P.name), h('small', BLURB[P.id] || '')),
        g ? h('span.pill.plain', { title: `Setup takes about ${g.time}` }, '⏱ ' + g.time.split(' (')[0]) : null),
      h('div.plat-accts',
        accts.length
          ? accts.map((a) => h('button.pa', { onclick: () => manage(a) },
            ava(a, { badge: false }),
            h('span.who', h('b', a.profile?.name || a.label), h('small', a.profile?.handle || a.label)),
            h('span.st.' + (a.status || 'ok'), a.status === 'ok' ? 'Connected' : a.status === 'pending' ? 'Authorize' : 'Problem')))
          : h('div.plat-empty', 'No accounts connected')),
      h('div.plat-foot',
        h('button.btn.primary.sm', { onclick: () => connect(P) }, icon('plus'), accts.length ? 'Add another' : 'Connect'),
        h('button.btn.sm.quiet', { onclick: () => modal({ title: `Getting ${P.name} keys`, titleIcon: pb(P.id), body: guide(P.id, h) }) }, icon('book'), 'How to get keys')));
  }

  function credForm(P, existing) {
    const inputs = {};
    const fields = P.fields.map((f) => {
      const saved = existing?.credentials?.[f.key] || '';
      inputs[f.key] = h('input', {
        type: f.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: false,
        placeholder: f.secret && saved ? `Saved (${saved}). Leave blank to keep.` : f.placeholder || '',
        value: f.secret ? '' : saved,
      });
      return h('label.field', h('span', f.label, f.optional ? h('span.muted', { style: { fontWeight: 500 } }, 'optional') : null), inputs[f.key]);
    });
    const label = h('input', { value: existing?.label || '', placeholder: `e.g. ${P.name} · Personal` });
    return {
      el: h('div', h('label.field', h('span', 'Nickname'), label, h('small', 'Just for you, to tell accounts apart.')), ...fields),
      values: () => ({ label: label.value.trim(), credentials: Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value.trim()])) }),
    };
  }

  const privacy = (P) => h('div.status-box.info', '🔒 Saved only on this computer, and only ever sent to ', P.name, '.');

  function connect(P) {
    const form = credForm(P);
    const m = modal({
      title: `Connect ${P.name}`, titleIcon: pb(P.id), wide: true,
      body: h('div.split', h('div', privacy(P), form.el), guide(P.id, h)),
      foot: [
        h('button.btn', { onclick: () => m.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
          const a = await api('/api/accounts', { method: 'POST', body: { platform: P.id, ...form.values() } });
          await load();
          m.close();
          if (a.status === 'ok') pop(`${a.profile?.handle || a.label} is connected.`, { title: 'Connected' });
          else { pop(a.status === 'pending' ? 'Saved. One more step: authorize it.' : a.lastError || 'Those keys didn’t work.', { kind: a.status === 'pending' ? 'ok' : 'err' }); manage(a); }
        }, 'Testing…') }, 'Save & test connection'),
      ],
    });
  }

  function manage(a) {
    const P = platform(a.platform);
    const form = credForm(P, a);
    const status = a.status === 'ok'
      ? h('div.status-box.ok', `✓ Connected as ${a.profile?.handle || a.label}. Checked ${new Date(a.checkedAt).toLocaleString()}.`)
      : a.status === 'pending'
        ? h('div.status-box.pending', 'Keys saved. Click “Authorize with TikTok” to finish connecting.')
        : h('div.status-box.error', '✗ ', a.lastError || 'Connection problem.');
    const m = modal({
      title: a.profile?.name || a.label, titleIcon: pb(a.platform), wide: true,
      body: h('div.split', h('div', status, form.el), guide(P.id, h)),
      foot: [
        h('button.btn.danger', { onclick: async () => {
          if (await confirmBox('Disconnect this account?', `Deletes the saved keys for ${a.label} and any feed columns using it. Nothing changes on ${P.name}.`, 'Disconnect')) {
            await api(`/api/accounts/${a.id}`, { method: 'DELETE' }); await load(); m.close(); pop('Account disconnected.');
          }
        } }, icon('trash'), 'Disconnect'),
        h('span.grow'),
        P.oauth ? h('button.btn', { onclick: () => {
          api('/api/oauth/tiktok', { method: 'POST', body: { accountId: a.id } })
            .then(({ url }) => { m.close(); location.href = url; })
            .catch((e) => pop(e.message, { kind: 'err' }));
        } }, icon('ext'), 'Authorize with TikTok') : null,
        P.refresh ? h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => { await api(`/api/accounts/${a.id}/refresh`, { method: 'POST' }); await load(); pop('Token refreshed.'); }, 'Refreshing…') }, icon('refresh'), 'Refresh token') : null,
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          const r = await api(`/api/accounts/${a.id}/verify`, { method: 'POST' });
          await load();
          r.status === 'ok' ? pop('Connection works.', { title: 'All good' }) : pop(r.lastError || 'Needs authorization', { kind: 'err' });
        }, 'Testing…') }, 'Test'),
        h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
          const r = await api(`/api/accounts/${a.id}`, { method: 'PATCH', body: form.values() });
          await load();
          m.close();
          r.status === 'error' ? pop(r.lastError, { kind: 'err' }) : pop('Saved.');
        }, 'Saving…') }, 'Save'),
      ],
    });
  }

  const render = () => grid.replaceChildren(...state.platforms.map(card));
  root.append(
    h('div.page-head', h('div', h('span.tagline', 'stock the bread box'), h('h1', 'Accounts'), h('p', 'Connect each network with your own developer keys. Every card has a step-by-step guide.'))),
    grid,
    h('div.note', icon('info'), h('span', h('b', 'Saved in this browser. '), 'Your keys and accounts are stored only in this browser on this device. When you post, they pass through Toasty Posty’s server on the way to the network, which forwards them and keeps nothing. No sign-up, no tracking. Back them up from Settings.')));
  render();
  return subscribe(render);
}
