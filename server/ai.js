// AI helpers. Claude (Anthropic) drafts text and reads images; OpenAI drafts text and generates images.
// Keys come from Settings and are only ever sent to the provider you picked.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { captionRequest, rewriteRequest, altRequest } from '../public/js/ai-prompts.js';

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

// One structured-output call to whichever text provider is active. Always streamed, so long
// answers don't hit request timeouts; `onText(delta)` sees the JSON as it's written, and
// `onText(summary, { thinking: true })` is Claude's reasoning summary before it writes, and
// `onText('', { reset: true })` means start over (a fallback model took over mid-answer).
async function jsonCall(settings, { system, prompt, schema, image }, onText = () => {}) {
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
      // A short summary of the reasoning is streamed so the app can show what it's thinking.
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [...(img ? [img] : []), { type: 'text', text: prompt }] }],
    };
    let res;
    try {
      // Opus/Sonnet: if a safety classifier declines, the API retries on a fallback model in the same call.
      const stream = model.startsWith('claude-haiku')
        ? client.messages.stream(params)
        : client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'fallback') onText('', { reset: true });
        else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
        else if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') onText(event.delta.thinking, { thinking: true });
      }
      res = await stream.finalMessage();
    } catch (err) {
      throw friendly(err, 'Claude');
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to write this one. Try rephrasing your notes.');
    // Only the answer from the model that finished counts (after the last fallback switch, if any).
    const lastSwitch = res.content.map((b) => b.type).lastIndexOf('fallback');
    const text = res.content.slice(lastSwitch + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  }

  const client = new OpenAI({ apiKey: ai.openaiKey });
  const img = imagePart(image, 'openai');
  try {
    const stream = await client.chat.completions.create({
      model: ai.openaiTextModel || 'gpt-5',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [...(img ? [img] : []), { type: 'text', text: prompt }] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'toast', strict: true, schema } },
      stream: true,
    });
    let text = '';
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) { text += delta; onText(delta); }
    }
    return JSON.parse(text);
  } catch (err) {
    throw friendly(err, 'OpenAI');
  }
}

export const draftCaptions = (settings, { notes, platforms, tone, image }, onText) =>
  jsonCall(settings, { ...captionRequest(settings, { notes, platforms, tone, hasImage: !!image }), image }, onText);

export const rewrite = (settings, { text, instruction }, onText) => jsonCall(settings, rewriteRequest(settings, { text, instruction }), onText);

export const altText = (settings, { image }) => jsonCall(settings, { ...altRequest(), image });

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
