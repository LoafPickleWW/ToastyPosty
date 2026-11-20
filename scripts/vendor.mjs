// Bundles the browser-side ZeroSignal SDK, algosdk and use-wallet into one ES module.
// The app has no bundler, so this is the one file that needs one. Runs before start, dev and build.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(ROOT, 'scripts/vendor/zerosignal-entry.js');
const out = path.join(ROOT, 'public/js/vendor/zerosignal.js');

// Skip when the bundle is newer than the lockfile and the entry (npm start shouldn't rebuild every time).
const newer = (a, b) => fs.existsSync(a) && fs.existsSync(b) && fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs;
if (!process.argv.includes('--force') && newer(out, path.join(ROOT, 'package-lock.json')) && newer(out, entry)) process.exit(0);

await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // Node-only paths in the SDK (its undici fetch, the CLI) are never reached in a browser.
  conditions: ['browser', 'import', 'default'],
  external: ['node:*', 'undici'],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  inject: [path.join(ROOT, 'scripts/vendor/buffer-shim.js')],
  logLevel: 'warning',
});
console.log(`Bundled ZeroSignal + use-wallet → ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
