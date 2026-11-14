// Settings: AI keys, voice, public URL, theme, data.
import { h, icon, pop, busy, confirmBox } from '../ui.js';
import { state, api, emit, load } from '../api.js';

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
  const provider = h('select', [['auto', 'Automatic (Claude if both are set)'], ['claude', 'Claude'], ['openai', 'OpenAI']].map(([v, l]) => h('option', { value: v, selected: ai.textProvider === v }, l)));
  const cModel = h('select', CLAUDE_MODELS.map(([v, l]) => h('option', { value: v, selected: ai.claudeModel === v }, l)));
  const oText = h('input', { value: ai.openaiTextModel, placeholder: 'gpt-5' });
  const oImg = h('input', { value: ai.openaiImageModel, placeholder: 'gpt-image-1' });
  const voice = h('textarea', { value: s.brandVoice, rows: 5, placeholder: 'e.g. Casual and a little dry. Lowercase is fine. Never says “excited to announce.” Talks about indie games, dev tools and pickles.' });
  const tags = h('input', { value: s.defaultHashtags, placeholder: '#indiedev #gamedev' });
  const pub = h('input', { value: s.publicBaseUrl, placeholder: 'https://your-tunnel.trycloudflare.com' });
  const port = location.port || 4848;

  const rerender = () => { root.replaceChildren(); settings(root); };
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
    return h('section.card.set',
      h('h2', 'Selling & affiliate links'),
      h('p', 'Used when you add product links to a post. The disclosure goes at the top of every shoppable post, where people see it before “more”.'),
      h('div.two',
        h('label.field', h('span', 'Amazon Associates tracking tag'), tag, h('small', 'Added to full Amazon product links automatically. Short amzn.to links keep the tag they were made with.')),
        h('label.field', h('span', 'Your shop link'), shopUrl, h('small', 'Your LTK, ShopMy or Amazon storefront. Used as the one “shop everything” link on X, Bluesky and Reddit; keep it in your Instagram and TikTok bio too.'))),
      h('div.two',
        h('label.field', h('span', 'Disclosure'), disc, h('small', 'Keep it plain and up front. “#ad” or “I earn a commission” both work.')),
        h('label.field', h('span', 'Extra disclosure for Amazon links'), amz, h('small', 'Check the wording your Amazon Associates agreement asks for.'))),
      h('button.btn.primary', { onclick: (e) => busy(e.currentTarget, () => save({ amazonTag: tag.value.trim(), shopUrl: shopUrl.value.trim(), disclosure: disc.value.trim(), amazonDisclosure: amz.value.trim() }, 'Selling settings saved.'), 'Saving…') }, 'Save'));
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
        h('p', 'Optional. Add a key to unlock caption drafts for each platform, rewrites and alt text. Image generation needs an OpenAI key. Keys stay on this computer and only go to the provider they belong to.'),
        h('div.two',
          h('label.field', h('span', 'Claude (Anthropic) API key', keyTag(ai.hasAnthropic)), anth, h('small', 'Get one at ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'))),
          h('label.field', h('span', 'OpenAI API key', keyTag(ai.hasOpenAI)), oai, h('small', 'Get one at ', h('a', { href: 'https://platform.openai.com/api-keys', target: '_blank', rel: 'noopener' }, 'platform.openai.com')))),
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
          ai.hasOpenAI ? h('button.btn.sm.danger', { onclick: async () => { await save({ ai: { clearOpenAI: true } }, 'OpenAI key removed.'); rerender(); } }, 'Remove OpenAI key') : null)),

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
