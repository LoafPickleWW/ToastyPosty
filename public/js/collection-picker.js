// Pick products out of a ShopMy collection (opt-in: asked the first time, or in Settings). Resolves with the chosen products,
// or [] if the window is closed. Each product: { name, brand, price, image, url, store }.
import { h, icon, modal, pop } from './ui.js';
import { api, state, emit } from './api.js';

export const collectionsOn = () => !!state.settings?.shopmyCollections;

export function pickFromCollection(url, { max = 30, verb = 'Add' } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const body = h('div.cpick', h('p.muted', h('span.spin'), ' Loading the collection…'));
    const count = h('span.cpick-count');
    const addBtn = h('button.btn.primary', { type: 'button', disabled: true }, icon('plus'), verb);
    const m = modal({ title: 'Pick products', titleIcon: icon('tag'), wide: true, body, foot: [count, h('span.grow'), h('button.btn', { type: 'button', onclick: () => m.close() }, 'Cancel'), addBtn], onClose: () => finish([]) });

    api('/api/collection', { method: 'POST', body: { url } }).then((c) => {
      const chosen = new Set();
      let q = '';
      const grid = h('div.cpick-grid');
      const search = h('input.input', { type: 'search', placeholder: 'Search by name, brand or store', 'aria-label': 'Search products', oninput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
      const shown = () => c.items.map((it, i) => [it, i]).filter(([it]) => !q || `${it.name} ${it.brand} ${it.store} ${it.category}`.toLowerCase().includes(q));
      const update = () => {
        count.textContent = `${chosen.size} of ${c.items.length} selected` + (chosen.size >= max ? ` (max ${max})` : '');
        addBtn.disabled = !chosen.size;
        addBtn.replaceChildren(icon('plus'), chosen.size ? `${verb} ${chosen.size}` : verb);
      };
      function paint() {
        grid.replaceChildren(...shown().map(([it, i]) => {
          const on = chosen.has(i);
          return h('label.cpick-item' + (on ? '.on' : ''),
            h('input', { type: 'checkbox', checked: on, onchange: (e) => {
              if (e.target.checked && chosen.size >= max) { e.target.checked = false; return; }
              e.target.checked ? chosen.add(i) : chosen.delete(i);
              e.target.closest('.cpick-item').classList.toggle('on', e.target.checked);
              update();
            } }),
            it.image ? h('img', { src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span.cpick-noimg', it.store || 'No photo'),
            h('span.cpick-t', it.brand ? h('small', it.brand) : null, h('b', it.name), h('span', [it.price && `$${it.price}`, it.store].filter(Boolean).join(' · '))));
        }));
      }
      const pickShown = (on) => { for (const [, i] of shown()) { if (on && chosen.size >= max) break; on ? chosen.add(i) : chosen.delete(i); } paint(); update(); };
      body.replaceChildren(
        h('div.cpick-head', h('div', h('b', c.title), c.description ? h('p.muted', c.description) : null, h('small.muted', `${c.items.length} products from ${c.source}. Each keeps its ShopMy link, so your commission is tracked.`))),
        h('div.cpick-bar', search, h('button.btn.sm', { type: 'button', onclick: () => pickShown(true) }, `Select ${q ? 'shown' : 'first ' + Math.min(max, c.items.length)}`), h('button.btn.sm.quiet', { type: 'button', onclick: () => pickShown(false) }, 'Clear')),
        grid);
      addBtn.onclick = () => { const out = [...chosen].sort((a, b) => a - b).map((i) => c.items[i]); finish(out); m.close(); };
      paint(); update();
      search.focus();
    }).catch((e) => { done = true; reject(e); m.close(); });
  });
}

// Shown where a collection link is pasted and the person chose "Not now".
export const OFF_NOTE = 'That’s a whole ShopMy collection. Paste it again to turn on collection import, or paste the product links instead.';

// The first time someone pastes a collection link: ask right there instead of sending them to Settings.
// Resolves true once it's on (it stays on; it can be turned off in Settings → Selling & affiliate links).
export function askToEnable() {
  if (collectionsOn()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const yes = h('button.btn.primary', { type: 'button' }, icon('check'), 'Turn on & load');
    const m = modal({
      title: 'Load this ShopMy collection?',
      titleIcon: icon('tag'),
      body: h('div.optin-ask',
        h('p', 'Toasty Posty can open the collection and let you pick products from it, with each one’s photo, brand, price and your own ShopMy link already filled in.'),
        h('ul',
          h('li', 'It reads the collection the same way ShopMy’s website does. That isn’t an official ShopMy API, so it could stop working if ShopMy changes things, and ShopMy’s terms may not cover it.'),
          h('li', 'Only the product details are kept. Nothing about the collection’s owner.'),
          h('li', 'You can turn it off any time in Settings → Selling & affiliate links.'))),
      foot: [h('button.btn', { type: 'button', onclick: () => { finish(false); m.close(); } }, 'Not now'), h('span.grow'), yes],
      onClose: () => finish(false),
    });
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        const r = await api('/api/settings', { method: 'PUT', body: { shopmyCollections: true } });
        state.settings = r.settings;
        state.providers = r.providers;
        emit();
        finish(true);
        m.close();
      } catch (e) { yes.disabled = false; pop(e.message, { kind: 'err', title: 'Couldn’t turn it on' }); }
    };
  });
}

// Ask if needed, then pick. Resolves null if they said "Not now".
export async function openCollection(url, opts) {
  if (!(await askToEnable())) return null;
  return pickFromCollection(url, opts);
}
