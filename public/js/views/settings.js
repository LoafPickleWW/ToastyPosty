// Settings: AI keys, voice, public URL, theme, data.
import { h, icon, pop, busy, confirmBox, modal } from '../ui.js';
import { state, api, emit, load } from '../api.js';
import { explorer, ALGO_READY, DEFAULT_TEXT_MODEL } from '../zerosignal.js';

const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (best writing)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster)'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'],
];

export default function settings(root) {
  const s = state.settings;
  const ai = s.ai;
  const keyTag = (on) => h('span.' + (on ? 'key-on' : 'key-off'), on ? 'Saved' : 'Not set');

  const anth = h('input', { type: 'password', autocomplete: 'off', placeholder: ai.hasAnthropic ? `Saved (${ai.anthropicKey}). Paste to replace.` : 'sk-ant-…' });
  const oai = h('input', { type: 'password', autocomplete: 'off', placeholder: ai.hasOpenAI ? `Saved (${ai.openaiKey}). Paste to replace.` : 'sk-…' });
  const provider = h('select', [['auto', 'Automatic (Claude, then OpenAI, then ZeroSignal)'], ['claude', 'Claude'], ['openai', 'OpenAI'], ['zerosignal', 'ZeroSignal']].map(([v, l]) => h('option', { value: v, selected: ai.textProvider === v }, l)));
  const cModel = h('select', CLAUDE_MODELS.map(([v, l]) => h('option', { value: v, selected: ai.claudeModel === v }, l)));
  const oText = h('input', { value: ai.openaiTextModel, placeholder: 'gpt-5' });
  const oImg = h('input', { value: ai.openaiImageModel, placeholder: 'gpt-image-1' });
  const voice = h('textarea', { value: s.brandVoice, rows: 5, placeholder: 'e.g. Casual and a little dry. Lowercase is fine. Never says “excited to announce.” Talks about indie games, dev tools and pickles.' });
  const tags = h('input', { value: s.defaultHashtags, placeholder: '#indiedev #gamedev' });
  const pub = h('input', { value: s.publicBaseUrl, placeholder: 'https://your-tunnel.trycloudflare.com' });
  const port = location.port || 4848;

  const rerender = () => { root.replaceChildren(); settings(root); };

  // A saved key's field with a Show/Hide button. Showing puts the real key in the box, so it can be copied.
  function revealable(input, which, has) {
    if (!has) return input;
    input.style.flex = '1';
    input.style.minWidth = '0';
    const btn = h('button.btn.sm', { type: 'button', onclick: async () => {
      if (input.type === 'text') { input.type = 'password'; input.value = ''; btn.textContent = 'Show'; return; }
      try {
        const r = await api('/api/keys/reveal', { method: 'POST', body: { which } });
        input.type = 'text'; input.value = r.value; input.select();
        btn.textContent = 'Hide';
      } catch (e) { pop(e.message, { kind: 'err' }); }
    } }, 'Show');
    return h('div.row', { style: { flexWrap: 'nowrap' } }, input, btn);
  }

  // A small file with just the AI keys and the ZeroSignal wallet, for when browser data gets cleared.
  function keysRow() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!(await confirmBox('Import these keys?', 'Keys in the file replace the ones saved here. Everything else stays as it is.', 'Import'))) return;
        const r = await api('/api/keys/import', { method: 'POST', body: data });
        state.settings = r.settings; state.providers = r.providers; emit();
        pop(r.imported.length ? 'Imported: ' + r.imported.join(', ') + '.' : 'AI settings imported (the file had no keys).', { title: 'Keys back' });
        rerender();
      } catch (e) { pop(e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e.message, { kind: 'err' }); }
    } });
    return h('div.field', { style: { marginTop: '18px', marginBottom: 0 } },
      h('span', 'Keep your keys safe'),
      h('div.row',
        h('button.btn.sm', { onclick: (e) => busy(e.currentTarget, async () => {
          const data = await api('/api/keys/export', { method: 'POST' });
          const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: 'toasty-posty-keys-' + new Date().toISOString().slice(0, 10) + '.json' });
          document.body.append(a); a.click(); a.remove();
          pop('Keys file downloaded. Anyone with it can use your AI keys and spend your AI wallet, so keep it private.', { title: 'Saved' });
        }, 'Packing…') }, 'Download keys file'),
        h('button.btn.sm', { onclick: () => file.click() }, 'Import keys file'),
        file),
      h('small', 'Your Claude and OpenAI keys and your ZeroSignal AI wallet, in one small file. If this browser’s data is ever cleared, import it here to get them back. A full backup from “Your data” works here too.'));
  }
  const cfg = state.config || {};

  // Instagram/TikTok photos: where does public media come from on this install?
  function publicMediaSection() {
    if (cfg.hosted) {
      return h('section.card.set',
        h('h2', 'Public media'),
        h('p', 'Instagram downloads your photos from a web address instead of accepting uploads. On Vercel that address comes from Vercel Blob storage. Each file is uploaded right before posting and deleted once Instagram has it.'),
        cfg.publicMedia === 'blob'
          ? h('div.status-box.ok', '✓ Vercel Blob is connected. Instagram posts are ready.')
          : h('div.status-box.pending', 'Not set up yet. In your Vercel project open Storage → Create → Blob, connect it to this project, then redeploy. Free tier is plenty.'),
        cfg.publicMedia === 'blob' ? h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => { const r = await api('/api/test-public', { method: 'POST' }); window.open(r.url, '_blank'); }, 'Uploading…') }, icon('ext'), 'Test with an image') : null);
    }
    return h('section.card.set',
      h('h2', 'Public URL'),
      h('p', 'Only needed for Instagram and TikTok. Instagram downloads your photos from a web address, and TikTok only sends logins back to https. A free tunnel gives your computer that address.'),
      h('label.field', h('span', 'Public https address'), pub,
        h('small', 'Run ', h('code', `cloudflared tunnel --url http://127.0.0.1:${port}`), ' and paste the https address it prints. Only media you’re posting and the TikTok login page can be reached through it.')),
      h('div.row',
        h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, () => save({ publicBaseUrl: pub.value.trim().replace(/\/$/, '') }, 'Public URL saved.'), 'Saving…') }, 'Save'),
        h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
          await save({ publicBaseUrl: pub.value.trim().replace(/\/$/, '') }, 'Saved. Testing…');
          const r = await api('/api/test-public', { method: 'POST' });
          window.open(r.url, '_blank');
        }, 'Testing…') }, icon('ext'), 'Test with an image')));
  }

  // Affiliate selling: used by "Shop this post" in Compose and the Shop the Look video template.
  function shopSection() {
    const tag = h('input', { value: s.amazonTag || '', placeholder: 'yourname-20', spellcheck: false });
    const shopUrl = h('input', { value: s.shopUrl || '', placeholder: 'https://www.shopltk.com/explore/yourname', inputmode: 'url' });
    const disc = h('input', { value: s.disclosure || '', placeholder: '#ad I earn a commission from links in this post.' });
    const amz = h('input', { value: s.amazonDisclosure || '', placeholder: '#CommissionsEarned' });
    const shopmy = h('input', { type: 'checkbox', checked: !!s.shopmyCollections, onchange: (e) => save({ shopmyCollections: e.target.checked }, e.target.checked ? 'ShopMy collection import is on.' : 'ShopMy collection import is off.') });
    return h('section.card.set',
      h('h2', 'Selling & affiliate links'),
      h('p', 'Used when you add product links to a post. The disclosure goes at the top of every shoppable post, where people see it before “more”.'),
      h('div.two',
        h('label.field', h('span', 'Amazon Associates tracking tag'), tag, h('small', 'Added to full Amazon product links automatically. Short amzn.to links keep the tag they were made with.')),
        h('label.field', h('span', 'Your shop link'), shopUrl, h('small', 'Your LTK, ShopMy or Amazon storefront. Used as the one “shop everything” link on X, Bluesky and Reddit; keep it in your Instagram and TikTok bio too.'))),
      h('div.two',
        h('label.field', h('span', 'Disclosure'), disc, h('small', 'Keep it plain and up front. “#ad” or “I earn a commission” both work.')),
        h('label.field', h('span', 'Extra disclosure for Amazon links'), amz, h('small', 'Check the wording your Amazon Associates agreement asks for.'))),
      h('label.optin', shopmy, h('span', h('b', 'Import ShopMy collections'),
        h('small', 'Paste a shopmy.us/collections/… link to load every product in it (photo, name, brand, price and its ShopMy link). This uses ShopMy’s own app data, not an official API: it may stop working if ShopMy changes it, and ShopMy’s terms may not allow it. Only the product details are kept.'))),
      h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, () => save({ amazonTag: tag.value.trim(), shopUrl: shopUrl.value.trim(), disclosure: disc.value.trim(), amazonDisclosure: amz.value.trim() }, 'Selling settings saved.'), 'Saving…') }, 'Save'));
  }

  // ZeroSignal: private AI paid per request in USDC, from an "AI wallet" kept in this browser.
  // Setup is four steps: create the wallet -> fund it with ALGO -> opt in to USDC -> send USDC.
  function zeroSignalSection() {
    const sec = h('section.card.set');
    const stepsBox = h('div');
    const statusBox = h('div');
    const fundBox = h('div');
    const modelBox = h('div');
    const adopt = (r) => { state.settings = r.settings; state.providers = r.providers; emit(); };


    // Copy with a fallback for browsers that block the clipboard API, and say so if both fail.
    function copyBtn(text, label = 'Copy') {
      const btn = h('button.btn.sm', { type: 'button', onclick: async () => {
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch {
          const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
          document.body.append(ta); ta.select();
          try { ok = document.execCommand('copy'); } catch {}
          ta.remove();
        }
        if (!ok) return pop('Your browser blocked copying. Select the address and copy it by hand.', { kind: 'err' });
        btn.textContent = 'Copied ✓';
        setTimeout(() => (btn.textContent = label), 1600);
      } }, label);
      return btn;
    }
    const addressRow = () => h('div.zs-addr', h('code', ai.zsAddress), copyBtn(ai.zsAddress, 'Copy address'));
    const fmt = (n, d = 4) => (+n.toFixed(d)).toString();

    // ---------- the four steps ----------
    function step(n, title, stateName, ...body) {
      return h('li.zs-step.is-' + stateName,
        h('span.zs-num', stateName === 'done' ? '✓' : String(n)),
        h('div.zs-step-main', h('b', title), stateName === 'todo' ? null : body));
    }

    function renderSteps(b, err) {
      if (!ai.hasZeroSignal) {
        const phrase = h('input', { type: 'password', autocomplete: 'off', placeholder: '25-word Algorand recovery phrase' });
        stepsBox.replaceChildren(h('ol.zs-steps',
          step(1, 'Create your AI wallet', 'current',
            h('p', 'A small wallet just for AI, kept in this browser. Requests are paid from it, so your main wallet never signs anything here.'),
            h('div.row',
              h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
                adopt(await api('/api/zs/new', { method: 'POST' }));
                pop('Next, send it some ALGO.', { title: 'AI wallet created' });
                rerender();
              }, 'Creating…') }, 'Create AI wallet')),
            h('details.zs-more', h('summary', 'Or import one you already have'),
              h('div.row', { style: { flexWrap: 'nowrap', marginTop: '8px' } }, phrase,
                h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => {
                  adopt(await api('/api/zs/import', { method: 'POST', body: { mnemonic: phrase.value } }));
                  phrase.value = '';
                  pop('AI wallet imported.', { title: 'Saved' });
                  rerender();
                }, 'Importing…') }, 'Import')))),
          step(2, 'Fund it with ALGO', 'todo'),
          step(3, 'Opt in to USDC', 'todo'),
          step(4, 'Send USDC', 'todo')));
        return;
      }
      if (!b) {
        stepsBox.replaceChildren(err ? h('div.status-box.error', err, ' ', h('button.btn.sm', { onclick: refresh }, 'Try again')) : h('p.muted', 'Reading the AI wallet’s balance…'));
        return;
      }
      // A wallet that has joined the escrow already paid its deposit, so step 2 only needs fee money free.
      const done = [true, b.algoOk, b.optedIn, b.usdc > 0];
      const cur = done.indexOf(false);
      const st = (i) => (done[i] ? 'done' : i === cur ? 'current' : 'todo');
      const short = ai.zsAddress.slice(0, 6) + '…' + ai.zsAddress.slice(-4);

      stepsBox.replaceChildren(...[
        cur === -1 ? h('div.status-box.ok', `✓ Ready. The AI wallet has ${fmt(b.usdc, 2)} USDC.`) : null,
        cur === -1 && b.lowAlgo ? h('div.status-box.pending', `Low on ALGO for network fees (${fmt(b.spendableAlgo, 3)} free). Send about 0.2 ALGO to the AI wallet soon so requests keep going through.`) : null,
        h('ol.zs-steps',
          step(1, 'Create your AI wallet', 'done',
            h('div.row', h('code', short), copyBtn(ai.zsAddress, 'Copy address'),
              h('a', { href: explorer(ai.zsAddress), target: '_blank', rel: 'noopener', style: { fontSize: '13px' } }, 'Explorer'))),
          step(2, 'Fund it with ALGO', st(1),
            h('p', done[1] ? `Has ${fmt(b.algo, 3)} ALGO (${fmt(b.spendableAlgo, 3)} free for fees).` : b.joined ? `Out of ALGO for network fees: ${fmt(b.spendableAlgo, 3)} free. Send about 0.2 ALGO to this address.` : `Send about 1 ALGO to this address from any Algorand wallet or exchange. It covers network fees, the USDC opt-in and ZeroSignal’s refundable deposit. It has ${fmt(b.algo, 3)} ALGO now; ${ALGO_READY} is the least that works.`),
            done[1] ? null : addressRow()),
          step(3, 'Opt in to USDC', st(2),
            done[2] ? h('p', 'Opted in. The wallet can hold USDC.') : [
              h('p', 'An Algorand account has to opt in before it can receive USDC. The AI wallet signs this itself; it costs 0.001 ALGO and sets aside 0.1 ALGO.'),
              h('button.btn' + (cur === 2 ? '.primary' : ''), { disabled: !b.canOptIn, onclick: (e) => busy(e.currentTarget, async () => {
                await api('/api/zs/optin', { method: 'POST' });
                pop('The AI wallet can now receive USDC.', { title: 'Opted in' });
                refresh();
              }, 'Opting in…') }, 'Opt in to USDC'),
              b.canOptIn ? null : h('p.muted', { style: { fontSize: '12.5px', margin: '6px 0 0' } }, 'Available once the wallet has about 0.2 ALGO.')]),
          step(4, 'Send USDC', st(3),
            done[3] ? h('p', `Has ${fmt(b.usdc, 2)} USDC.`) : [
              h('p', `Send USDC to this address. A few dollars covers hundreds of captions on most models.`),
              addressRow(),
              h('p.zs-warn', `Send USDC on the Algorand network only (asset ID ${b.usdcAssetId}). USDC sent from Ethereum, Solana or another chain will be lost.`),
              b.optedIn ? null : h('p.muted', { style: { fontSize: '12.5px', margin: '6px 0 0' } }, 'Opt in first (step 3), or the transfer will be rejected.')])),
        h('div.row', { style: { margin: '4px 0 16px' } },
          h('button.btn.sm', { onclick: (e) => busy(e.currentTarget, refresh, 'Checking…') }, 'Refresh balance'),
          cur === -1 ? null : h('span.muted', { style: { fontSize: '12.5px' } }, `Checks again every few seconds. Wallet ${short}.`))].filter(Boolean));
    }

    let timer = null;
    let lastBalances = '';
    async function refresh() {
      clearTimeout(timer);
      if (!ai.hasZeroSignal) return;
      try {
        const b = await api('/api/zs/balances', { method: 'POST' });
        if (JSON.stringify(b.providers) !== JSON.stringify(state.providers)) { state.providers = b.providers; emit(); }
        delete b.providers;
        // Only redraw when something changed, so a poll never wipes a selection or a click in progress.
        const key = JSON.stringify(b);
        if (key !== lastBalances) { lastBalances = key; renderSteps(b); }
        // Keep checking while a step is waiting on a transfer from outside.
        const ready = b.ready;
        if (!ready) timer = setTimeout(() => sec.isConnected && refresh(), 8000);
      } catch (e) { lastBalances = ''; renderSteps(null, e.message); }
    }

    // ---------- full read-only checkup, for when something still fails ----------
    async function checkup() {
      statusBox.replaceChildren(h('div.status-box.info', 'Checking the chain and the nodes…'));
      try {
        const r = await api('/api/zs/checkup', { method: 'POST' });
        const mark = { pass: '✓ ', warn: '! ', fail: '✗ ' };
        statusBox.replaceChildren(
          h('div.status-box.' + (r.failed ? 'pending' : 'ok'), r.failed ? 'Something still needs attention:' : '✓ Everything checks out.'),
          h('ul.zs-checks', r.checks.map((c) => h('li.' + c.status, h('b', mark[c.status] || ''), c.message))));
      } catch (e) { statusBox.replaceChildren(h('div.status-box.error', e.message)); }
    }

    // ---------- shortcut: steps 2-4 in one approval from Pera, Defly or Lute ----------
    async function renderFund() {
      fundBox.replaceChildren(h('p.muted', 'Loading wallets…'));
      let w;
      try { w = await api('/api/zs/wallets', { method: 'POST' }); } catch (e) { fundBox.replaceChildren(h('div.status-box.error', e.message)); return; }
      const inner = h('div', { style: { marginTop: '10px' } });
      if (!w.address) {
        inner.append(
          h('p', { style: { margin: '0 0 8px' } }, 'Connect your wallet and it sends ALGO and USDC in one go, with the opt-in included. You approve it in your wallet.'),
          h('div.row', w.list.map((x) => h('button.btn', { onclick: (e) => busy(e.currentTarget, async () => { await api('/api/zs/connect', { method: 'POST', body: { wallet: x.id } }); renderFund(); }, 'Connecting…') },
            x.icon ? h('img', { src: x.icon, alt: '', width: 18, height: 18, style: { borderRadius: '4px' } }) : null, x.name))));
      } else {
        const usdc = h('input', { type: 'number', min: '0', step: '0.5', value: '5', inputmode: 'decimal' });
        const algo = h('input', { type: 'number', min: '0', step: '0.1', value: '1', inputmode: 'decimal' });
        inner.append(
          h('p', { style: { margin: '0 0 8px' } }, 'Sending from ', h('code', w.address.slice(0, 6) + '…' + w.address.slice(-4)), '.'),
          h('div.two',
            h('label.field', h('span', 'USDC to send'), usdc),
            h('label.field', h('span', 'ALGO to send'), algo)),
          h('div.row',
            h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
              if (!(await confirmBox('Send real funds?', `Your wallet will ask you to approve sending ${usdc.value || 0} USDC and ${algo.value || 0} ALGO to your AI wallet. This is real money on Algorand mainnet.`, 'Continue'))) return;
              const r = await api('/api/zs/topup', { method: 'POST', body: { usdc: usdc.value, algo: algo.value } });
              pop(`Confirmed in transaction ${r.txid.slice(0, 10)}…`, { title: 'Topped up' });
              refresh();
            }, 'Approve in your wallet…') }, 'Send to AI wallet'),
            h('button.btn.sm', { onclick: (e) => busy(e.currentTarget, async () => { await api('/api/zs/disconnect', { method: 'POST' }); renderFund(); }, 'Disconnecting…') }, 'Disconnect wallet')));
      }
      fundBox.replaceChildren(h('details.zs-more', { open: !!w.address }, h('summary', 'Have Pera, Defly or Lute? Top up in one step'), inner));
    }

    // ---------- models the network routes to right now ----------
    // Starts on the default (a cheap GLM Flash that also reads images); the full list loads by itself,
    // and picking a model saves it straight away.
    const pick = { text: ai.zsTextModel || DEFAULT_TEXT_MODEL, vision: ai.zsTextModel ? !!ai.zsTextVision : true, image: ai.zsImageModel || '' };
    function renderModels(list, note) {
      const price = (m) => (m.inPrice != null ? ` · $${m.inPrice.toFixed(2)} in / $${(m.outPrice ?? 0).toFixed(2)} out per 1M` : '');
      const label = (m) => m.id + (m.id === DEFAULT_TEXT_MODEL ? ' (default)' : '') + (m.vision ? ' · sees images' : '') + price(m);
      const withCurrent = (arr, cur) => (cur && !arr.some((m) => m.id === cur.id) ? [cur, ...arr] : arr);
      const textList = withCurrent(list ? list.filter((m) => m.text) : [], { id: pick.text, vision: pick.vision });
      const imgList = withCurrent(list ? list.filter((m) => m.image) : [], pick.image ? { id: pick.image } : null);
      const tSel = h('select', { onchange: async () => {
        const m = textList.find((x) => x.id === tSel.value);
        Object.assign(pick, { text: tSel.value, vision: !!m?.vision });
        await save({ ai: { zsTextModel: pick.text, zsTextVision: pick.vision } }, `${pick.text} writes your posts now.`);
      } }, textList.map((m) => h('option', { value: m.id, selected: m.id === pick.text }, label(m))));
      const iSel = h('select', { onchange: async () => {
        pick.image = iSel.value;
        await save({ ai: { zsImageModel: pick.image } }, pick.image ? `${pick.image} makes your images now.` : 'ZeroSignal image generation is off.');
      } }, h('option', { value: '' }, 'None'), imgList.map((m) => h('option', { value: m.id, selected: m.id === pick.image }, label(m))));
      modelBox.replaceChildren(
        h('div.two',
          h('label.field', h('span', 'Text model'), tSel, h('small', note || 'Models that “see images” can also write from your photos and do alt text.')),
          h('label.field', h('span', 'Image model'), iSel, h('small', 'Optional. Used for image generation when there’s no OpenAI key.'))));
    }
    async function loadModels() {
      renderModels(null, 'Loading the other models…');
      try {
        const r = await api('/api/zs/models', { method: 'POST' });
        renderModels(r.models, r.models.length ? null : 'No other models are reachable right now.');
      } catch (e) {
        renderModels(null, 'Couldn’t load the other models: ' + e.message);
      }
    }

    async function showPhrase(e) {
      await busy(e.currentTarget, async () => {
        const r = await api('/api/keys/reveal', { method: 'POST', body: { which: 'zerosignal' } });
        const m = modal({ title: 'AI wallet recovery phrase', body: [
          h('p', { style: { marginTop: 0, color: 'var(--ink-2)' } }, 'Anyone with these 25 words can spend this wallet. Keep them somewhere private. They’re also in your keys file and backup.'),
          h('code', { style: { display: 'block', padding: '12px', lineHeight: 1.7 } }, r.value)],
          foot: [copyBtn(r.value, 'Copy'), h('button.btn.primary', { onclick: () => m.close() }, 'Done')] });
      }, 'Opening…');
    }

    function switchWallet() {
      const phrase = h('input', { type: 'password', autocomplete: 'off', placeholder: '25-word Algorand recovery phrase' });
      const m = modal({ title: 'Use a different AI wallet', body: [
        h('p', { style: { marginTop: 0, color: 'var(--ink-2)' } }, 'This replaces the AI wallet saved here. Any USDC in the current one stays on chain, so save its recovery phrase first if you want it back.'),
        h('label.field', h('span', 'Recovery phrase'), phrase)],
        foot: [
          h('button.btn', { onclick: () => m.close() }, 'Cancel'),
          h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
            adopt(await api('/api/zs/import', { method: 'POST', body: { mnemonic: phrase.value } }));
            m.close();
            pop('AI wallet switched.', { title: 'Saved' });
            rerender();
          }, 'Importing…') }, 'Use this wallet')] });
      phrase.focus();
    }

    sec.append(
      h('h2', 'ZeroSignal'),
      h('p', 'Private AI with no account and no API key. Each request is encrypted in this browser, passed through a relay so the node that answers never learns who you are, and paid per request in USDC on Algorand from a small AI wallet kept here. ',
        h('a', { href: 'https://docs.zerosignal.ai', target: '_blank', rel: 'noopener' }, 'How it works')),
      stepsBox);

    renderSteps(null);
    if (!ai.hasZeroSignal) return sec;

    sec.append(
      fundBox,
      h('h3.zs-sub', 'Models'),
      modelBox,
      h('h3.zs-sub', 'Wallet'),
      statusBox,
      h('div.row',
        h('button.btn.sm', { onclick: (e) => busy(e.currentTarget, checkup, 'Checking…') }, 'Run full checkup'),
        h('button.btn.sm', { onclick: showPhrase }, 'Show recovery phrase'),
        h('button.btn.sm', { onclick: switchWallet }, 'Use a different wallet'),
        h('button.btn.sm.danger', { onclick: async () => {
          if (!(await confirmBox('Remove the AI wallet?', 'Any USDC in it stays on chain, but you’ll need the recovery phrase or a keys file to get it back.', 'Remove'))) return;
          await save({ ai: { clearZeroSignal: true } }, 'AI wallet removed.');
          rerender();
        } }, 'Remove AI wallet')));
    refresh();
    renderFund();
    loadModels();
    return sec;
  }

  function dataSection() {
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!(await confirmBox('Restore this backup?', 'It replaces everything Toasty Posty has saved in this browser right now.', 'Restore'))) return;
        await api('/api/restore', { method: 'POST', body: data });
        await load();
        pop('Backup restored.', { title: 'Restored' });
        rerender();
      } catch (e) { pop(e.message, { kind: 'err' }); }
      file.value = '';
    } });
    return h('section.card.set',
      h('h2', 'Your data'),
      h('p', 'Accounts, keys, posts, feeds and media are saved in this browser on this device, and nowhere else. The server only relays requests to the networks and keeps nothing. Clearing your browser data erases it, and another browser or device starts empty, so keep a backup.'),
      h('div.row',
        h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
          const data = await api('/api/backup');
          const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `toasty-posty-backup-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); a.remove();
          pop('Backup downloaded. It contains your keys, so keep it somewhere safe.', { title: 'Saved' });
        }, 'Packing…') }, 'Download backup'),
        h('button.btn', { onclick: () => file.click() }, 'Restore from backup'),
        file),
      h('p.muted', { style: { fontSize: '12.5px', margin: '14px 0 0' } }, 'No telemetry, no sign-up. MIT licensed.'));
  }
  async function save(body, msg) {
    const r = await api('/api/settings', { method: 'PUT', body });
    state.settings = r.settings;
    state.providers = r.providers;
    emit();
    pop(msg, { title: 'Saved' });
  }

  root.append(
    h('div.page-head', h('div', h('span.tagline', 'under the crumb tray'), h('h1', 'Settings'), h('p', 'AI keys, how your posts should sound, and how the app looks.'))),
    h('div.settings',
      h('section.card.set',
        h('h2', 'AI assist'),
        h('p', 'Optional. Add a key to unlock caption drafts for each platform, rewrites and alt text. Image generation needs an OpenAI key or a ZeroSignal image model. Keys stay on this computer and only go to the provider they belong to. No key? ZeroSignal (below) works without one.'),
        h('div.two',
          h('label.field', h('span', 'Claude (Anthropic) API key', keyTag(ai.hasAnthropic)), revealable(anth, 'anthropic', ai.hasAnthropic), h('small', 'Get one at ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'))),
          h('label.field', h('span', 'OpenAI API key', keyTag(ai.hasOpenAI)), revealable(oai, 'openai', ai.hasOpenAI), h('small', 'Get one at ', h('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener' }, 'platform.openai.com')))),
        h('div.two',
          h('label.field', h('span', 'Who writes captions'), provider),
          h('label.field', h('span', 'Claude model'), cModel)),
        h('div.two',
          h('label.field', h('span', 'OpenAI text model'), oText),
          h('label.field', h('span', 'OpenAI image model'), oImg)),
        h('div.row',
          h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, async () => {
            await save({ ai: { anthropicKey: anth.value, openaiKey: oai.value, textProvider: provider.value, claudeModel: cModel.value, openaiTextModel: oText.value.trim(), openaiImageModel: oImg.value.trim() } }, 'AI settings updated.');
            rerender();
          }, 'Saving…') }, 'Save AI settings'),
          ai.hasAnthropic ? h('button.btn.sm.danger', { onclick: async () => { await save({ ai: { clearAnthropic: true } }, 'Claude key removed.'); rerender(); } }, 'Remove Claude key') : null,
          ai.hasOpenAI ? h('button.btn.sm.danger', { onclick: async () => { await save({ ai: { clearOpenAI: true } }, 'OpenAI key removed.'); rerender(); } }, 'Remove OpenAI key') : null),
        keysRow()),

      zeroSignalSection(),

      h('section.card.set',
        h('h2', 'Your voice'),
        h('p', 'The AI reads this before every draft. Be specific about words you use, words you’d never use, and who you’re talking to.'),
        h('label.field', h('span', 'How you write'), voice),
        h('label.field', h('span', 'Hashtags you like'), tags, h('small', 'Only used when they fit the post.')),
        h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, () => save({ brandVoice: voice.value, defaultHashtags: tags.value }, 'Voice saved.'), 'Saving…') }, 'Save voice')),

      shopSection(),

      publicMediaSection(),

      h('section.card.set',
        h('h2', 'Appearance'),
        h('p', 'Butter is light, Burnt is dark, Auto follows your system.'),
        h('div.themes', [['butter', 'Butter'], ['burnt', 'Burnt'], ['auto', 'Auto']].map(([v, l]) =>
          h('label.theme-opt', h('input', { type: 'radio', name: 'theme', value: v, checked: (s.theme === v) || (v === 'butter' && !['burnt', 'auto'].includes(s.theme)), onchange: () => save({ theme: v }, `${l} it is.`) }), h('span.sw.' + v), l)))),

      dataSection()));
}
