// fetch helpers with readable errors.
export class PlatformError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function request(url, opts = {}, label = 'API') {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new PlatformError(`${label}: couldn't reach ${new URL(url).host} (${e.cause?.code || e.message}). Check your internet connection or the server URL.`, 0);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok) {
    const msg = extractError(body) || `${res.status} ${res.statusText}`;
    throw new PlatformError(`${label}: ${msg}`, res.status, body);
  }
  return body;
}

function extractError(b) {
  if (!b) return '';
  if (typeof b === 'string') return b.slice(0, 300);
  return (
    b.error?.message ||
    b.error_description ||
    (typeof b.error === 'string' ? b.error : '') ||
    b.message ||
    b.detail ||
    b.title ||
    b.errors?.[0]?.message ||
    b.errors?.[0]?.detail ||
    (b.json?.errors?.length ? b.json.errors.map((e) => e.join(' ')).join('; ') : '') ||
    ''
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const form = (obj) =>
  new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
