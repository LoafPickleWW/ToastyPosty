// Vercel entry point: every /api/* request is routed here (see vercel.json).
// Vercel normally keeps the original path in req.url; the __path query is a fallback in case it doesn't.
import app from '../server/app.js';

export default function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.searchParams.get('__path');
  if (p !== null) {
    u.searchParams.delete('__path');
    if (!u.pathname.startsWith('/api/')) u.pathname = `/api/${p}`;
    req.url = u.pathname + u.search;
  }
  return app(req, res);
}
