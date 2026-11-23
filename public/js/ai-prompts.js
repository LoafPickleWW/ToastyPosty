// The prompts and output schemas behind every AI feature, shared by the server (Claude, OpenAI)
// and the browser (ZeroSignal), so each provider is asked exactly the same thing.

export const PLATFORM_STYLE = {
  x: 'X/Twitter: max 280 characters, punchy, 0-2 hashtags.',
  bluesky: 'Bluesky: max 300 characters, conversational, hashtags optional and sparse.',
  reddit: 'Reddit: no hashtags, no marketing voice, genuine and community-minded. Body text only (title is separate).',
  instagram: 'Instagram: up to 2200 characters, a hook in the first line, line breaks, then 5-12 relevant hashtags at the end.',
  tiktok: 'TikTok: short hook-first caption under 150 characters plus 3-6 hashtags.',
};

export const systemPrompt = (settings) =>
  [
    'You are the line cook at Toasty Posty, a social media scheduler. You write social posts that sound like a real person, not a brand bot.',
    'Never invent facts, stats, links, prices, or quotes that were not given. If the notes are thin, keep the post short instead of padding.',
    settings.brandVoice ? `The account owner describes their voice like this:\n<voice>\n${settings.brandVoice}\n</voice>` : '',
    settings.defaultHashtags ? `Hashtags they like to use when relevant: ${settings.defaultHashtags}` : '',
  ].filter(Boolean).join('\n\n');

// Each builder returns { system, prompt, schema } for one structured-output call.
export function captionRequest(settings, { notes, platforms, tone, hasImage }) {
  const plats = (platforms || []).filter((p) => PLATFORM_STYLE[p]);
  if (!plats.length) plats.push('x');
  const props = Object.fromEntries(plats.map((p) => [p, { type: 'string' }]));
  const schema = {
    type: 'object',
    properties: {
      base: { type: 'string', description: 'The finished main post, polished and ready to publish anywhere' },
      platforms: { type: 'object', properties: props, required: plats, additionalProperties: false },
      reddit_title: { type: 'string' },
    },
    required: ['base', 'platforms', 'reddit_title'],
    additionalProperties: false,
  };
  const prompt = [
    hasImage ? 'An image is attached; it is what the post is about. Describe only what is actually visible.' : '',
    notes ? `<notes>\n${notes}\n</notes>` : 'There are no notes; write from the image alone.',
    tone ? `Tone: ${tone}.` : '',
    'base: the finished main version of the post, written properly in the requested tone and ready to publish. Treat the notes as raw material: rewrite and polish them, do not copy them back.',
    'Then write one version per platform following these rules:',
    ...plats.map((p) => '- ' + PLATFORM_STYLE[p]),
    'reddit_title: a plain, specific Reddit title under 300 characters (empty string if reddit is not listed).',
  ].filter(Boolean).join('\n');
  return { system: systemPrompt(settings), prompt, schema };
}

export function rewriteRequest(settings, { text, instruction }) {
  return {
    system: systemPrompt(settings),
    prompt: `Rewrite this social post. Instruction: ${instruction}\nKeep any links exactly as written.\n<post>\n${text}\n</post>`,
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  };
}

export function altRequest() {
  return {
    system: 'You write image alt text for screen-reader users: one or two plain sentences, under 400 characters, describing what matters in the image. Include any visible text verbatim.',
    prompt: 'Write alt text for the attached image.',
    schema: { type: 'object', properties: { alt: { type: 'string' } }, required: ['alt'], additionalProperties: false },
  };
}
