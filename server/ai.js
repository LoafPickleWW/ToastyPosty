// AI helpers. Claude (Anthropic) drafts text and reads images; OpenAI drafts text and generates images.
// Keys come from Settings and are only ever sent to the provider you picked.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const PLATFORM_STYLE = {
  x: 'X/Twitter: max 280 characters, punchy, 0-2 hashtags.',
  bluesky: 'Bluesky: max 300 characters, conversational, hashtags optional and sparse.',
  reddit: 'Reddit: no hashtags, no marketing voice, genuine and community-minded. Body text only (title is separate).',
  instagram: 'Instagram: up to 2200 characters, a hook in the first line, line breaks, then 5-12 relevant hashtags at the end.',
  tiktok: 'TikTok: short hook-first caption under 150 characters plus 3-6 hashtags.',
};

export function providers(settings) {
  const ai = settings.ai;
  const text = ai.textProvider === 'openai' && ai.openaiKey ? 'openai'
    : ai.textProvider === 'claude' && ai.anthropicKey ? 'claude'
    : ai.anthropicKey ? 'claude' : ai.openaiKey ? 'openai' : null;
  return { text, image: ai.openaiKey ? 'openai' : null, vision: ai.anthropicKey ? 'claude' : ai.openaiKey ? 'openai' : null };
}

function imagePart(media, provider) {
  if (!media?.data || !media.mime?.startsWith('image/') || media.size > 4.5e6) return null;
  const data = Buffer.from(media.data).toString('base64');
  const mime = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(media.mime) ? media.mime : 'image/jpeg';
  return provider === 'claude'
    ? { type: 'image', source: { type: 'base64', media_type: mime, data } }
    : { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } };
}

function friendly(err, who) {
  if (err instanceof Anthropic.AuthenticationError) return new Error('Your Anthropic API key was rejected. Check it in Settings.');
  if (err instanceof Anthropic.RateLimitError) return new Error('Claude is rate-limited right now. Try again in a minute.');
  if (err instanceof Anthropic.APIError) return new Error(`Claude: ${err.message}`);
  if (err?.status === 401) return new Error(`Your ${who} API key was rejected. Check it in Settings.`);
  return new Error(`${who}: ${err?.message || err}`);
}

// One structured-output call to whichever text provider is active.
async function jsonCall(settings, { system, prompt, schema, image }) {
  const p = providers(settings);
  const ai = settings.ai;
  if (!p.text) throw new Error('No AI key set. Add a Claude or OpenAI key in Settings.');
  const useVisionProvider = image && p.vision ? p.vision : p.text;

  if (useVisionProvider === 'claude') {
    const client = new Anthropic({ apiKey: ai.anthropicKey });
    const model = ai.claudeModel || 'claude-opus-5-5';
    const img = imagePart(image, 'claude');
    const params = {
      model,
      max_tokens: 16000,
      system,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [...(img ? [img] : []), { type: 'text', text: prompt }] }],
    };
    let res;
    try {
      // Opus/Sonnet: if a safety classifier declines, the API retries on a fallback model in the same call.
      res = model.startsWith('claude-haiku')
        ? await client.messages.create(params)
        : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      throw friendly(err, 'Claude');
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to write this one. Try rephrasing your notes.');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  }

  const client = new OpenAI({ apiKey: ai.openaiKey });
  const img = imagePart(image, 'openai');
  try {
    const res = await client.chat.completions.create({
      model: ai.openaiTextModel || 'gpt-5',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [...(img ? [img] : []), { type: 'text', text: prompt }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'toast', strict: true, schema } },
    });
    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    throw friendly(err, 'OpenAI');
  }
}

const systemPrompt = (settings) =>
  [
    'You are the line cook at Toasty Posty, a social media scheduler. You write social posts that sound like a real person, not a brand bot.',
    'Never invent facts, stats, links, prices, or quotes that were not given. If the notes are thin, keep the post short instead of padding.',
    settings.brandVoice ? `The account owner describes their voice like this:\n<voice>\n${settings.brandVoice}\n</voice>` : '',
    settings.defaultHashtags ? `Hashtags they like to use when relevant: ${settings.defaultHashtags}` : '',
  ].filter(Boolean).join('\n\n');

export async function draftCaptions(settings, { notes, platforms, tone, image }) {
  const plats = platforms.filter((p) => PLATFORM_STYLE[p]);
  if (!plats.length) plats.push('x');
  const props = Object.fromEntries(plats.map((p) => [p, { type: 'string' }]));
  const schema = {
    type: 'object',
    properties: {
      base: { type: 'string', description: 'A general-purpose version of the post' },
      platforms: { type: 'object', properties: props, required: plats, additionalProperties: false },
      reddit_title: { type: 'string' },
    },
    required: ['base', 'platforms', 'reddit_title'],
    additionalProperties: false,
  };
  const prompt = [
    image ? 'An image is attached; it is what the post is about. Describe only what is actually visible.' : '',
    notes ? `<notes>\n${notes}\n</notes>` : 'There are no notes; write from the image alone.',
    tone ? `Tone: ${tone}.` : '',
    'Write one version per platform following these rules:',
    ...plats.map((p) => '- ' + PLATFORM_STYLE[p]),
    'reddit_title: a plain, specific Reddit title under 300 characters (empty string if reddit is not listed).',
  ].filter(Boolean).join('\n');
  return jsonCall(settings, { system: systemPrompt(settings), prompt, schema, image });
}

export async function rewrite(settings, { text, instruction }) {
  const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
  return jsonCall(settings, {
    system: systemPrompt(settings),
    prompt: `Rewrite this social post. Instruction: ${instruction}\nKeep any links exactly as written.\n<post>\n${text}\n</post>`,
    schema,
  });
}

export async function altText(settings, { image }) {
  const schema = { type: 'object', properties: { alt: { type: 'string' } }, required: ['alt'], additionalProperties: false };
  return jsonCall(settings, {
    system: 'You write image alt text for screen-reader users: one or two plain sentences, under 400 characters, describing what matters in the image. Include any visible text verbatim.',
    prompt: 'Write alt text for the attached image.',
    schema,
    image,
  });
}

export async function generateImage(settings, { prompt, size }) {
  if (!settings.ai.openaiKey) throw new Error('Image generation needs an OpenAI key in Settings.');
  const client = new OpenAI({ apiKey: settings.ai.openaiKey });
  try {
    const res = await client.images.generate({
      model: settings.ai.openaiImageModel || 'gpt-image-1',
      prompt,
      size: size || '1024x1024',
      output_format: 'jpeg',
      n: 1,
    });
    return Buffer.from(res.data[0].b64_json, 'base64');
  } catch (err) {
    throw friendly(err, 'OpenAI');
  }
}
