// Shared state + a tiny pub/sub. api() talks to the in-browser kitchen (local-api.js),
// which keeps your data in this browser and only uses the server as a stateless relay.
import * as kitchen from './local-api.js';

export const state = { accounts: [], posts: [], feeds: [], media: [], settings: null, platforms: [], webSources: [], providers: {}, config: {}, draft: null };
const subs = new Set();
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
export const emit = () => subs.forEach((f) => f(state));

export const api = (path, opts) => kitchen.handle(path, opts);

export async function load() {
  Object.assign(state, await api('/api/state'));
  emit();
}

export const platform = (id) => state.platforms.find((p) => p.id === id);
export const account = (id) => state.accounts.find((a) => a.id === id);
export const media = (id) => state.media.find((m) => m.id === id);
export const mediaUrl = (m) => kitchen.mediaUrl(m.id);
