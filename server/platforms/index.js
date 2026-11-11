import x from './x.js';
import bluesky from './bluesky.js';
import reddit from './reddit.js';
import instagram from './instagram.js';
import tiktok from './tiktok.js';

export const platforms = { x, bluesky, reddit, instagram, tiktok };

// What the browser is allowed to know about each platform.
export const list = () =>
  Object.values(platforms).map((p) => ({
    id: p.id,
    name: p.name,
    limits: p.limits,
    fields: p.fields,
    feedTypes: p.feedTypes,
    oauth: !!p.oauth,
    refresh: !!p.refresh,
  }));
