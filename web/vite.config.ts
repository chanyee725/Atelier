import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { FONT_SIZE_STEPS, patchFontSizeSteps } from './src/canvas/sizeSteps.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../public', import.meta.url));
// Excalidraw's own fonts (OFL/MIT, shipped in the npm package). Served from /excalidraw/fonts/
// so the canvas never falls back to its CDN.
const excalidrawFonts = fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url));
// The canvas font (font id 9, "Liberation Sans" in Excalidraw) is Pretendard. Excalidraw 0.18 cannot register a font
// family (Fonts.register is private) and defines id 9 with one face and no unicode-range, so the one file it loads from
// /excalidraw/fonts/Liberation/ is replaced by web/fonts/drawing-sans-canvas.woff2: Pretendard Regular 1.3.9 (npm
// `pretendard`, SIL OFL-1.1, license text in shared/render/fonts/drawing-sans-OFL.txt) cut to Latin, Jamo and the 2,350
// KS X 1001 syllables, renamed "Drawing Sans" (Pretendard is a reserved font name). Regenerate (repo root, fonttools==4.68.0):
//   python scripts/subset-canvas-font.py node_modules/pretendard/dist/web/static/woff2 web/fonts
// Text, SVG and PNG export all load fonts through that registration, so they follow. docs/design/code-linked-nodes.md §5.
const CANVAS_FONT = fileURLToPath(new URL('./fonts/drawing-sans-canvas.woff2', import.meta.url));
const FONT_OVERRIDES: Record<string, string> = { 'Liberation/LiberationSans-Regular.woff2': CANVAS_FONT };
const ASSET_BASE = '/excalidraw/';
const FONT_PREFIX = `${ASSET_BASE}fonts/`;
// Matches both the minified prod chunk and the readable dev chunk (`"X", \`...\``).
const FALLBACK_RE = /"ASSETS_FALLBACK_URL",\s*`https:\/\/esm\.sh\/\$\{[^`]*`[^`]*`[^`]*\}\/dist\/prod\/`\)/;
const EXCALIDRAW_DIST_RE = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/]/;

/**
 * Excalidraw always appends https://esm.sh/... as a second font source. Point that fallback at our
 * own copy, so no font request can leave the machine. Throws if the code moves, so a dependency
 * update cannot silently bring the CDN back.
 */
function stripCdnFallback(code: string, id: string): string | null {
  if (!EXCALIDRAW_DIST_RE.test(id) || !code.includes('ASSETS_FALLBACK_URL')) return null;
  if (!code.includes('https://esm.sh/')) return null;
  const out = code.replace(FALLBACK_RE, `"ASSETS_FALLBACK_URL",window.location.origin+"${ASSET_BASE}")`);
  if (out === code || out.includes('https://esm.sh/')) throw new Error('excalidraw-assets: CDN fallback URL not found; update FALLBACK_RE');
  return out;
}

/** Every rewrite of Excalidraw's bundle: the font fallback and the style panel's size steps (#292). */
function patchExcalidraw(code: string, id: string, seen: PatchSeen): string | null {
  if (!EXCALIDRAW_DIST_RE.test(id)) return null;
  seen.excalidraw = true;
  const local = stripCdnFallback(code, id);
  const sized = patchFontSizeSteps(local ?? code);
  if (sized !== null) seen.sizeSteps = true;
  return sized ?? local;
}

/** Whether one bundling pass met Excalidraw's code, and whether the size steps were rewritten in it. */
type PatchSeen = { excalidraw: boolean; sizeSteps: boolean };
const newSeen = (): PatchSeen => ({ excalidraw: false, sizeSteps: false });

/**
 * Fails the pass when Excalidraw was bundled but its size buttons were never found (a renamed test id or a
 * moved dist path), so the stock sizes cannot silently come back.
 */
function assertPatched(seen: PatchSeen): void {
  if (seen.excalidraw && !seen.sizeSteps) {
    throw new Error('excalidraw-assets: the size buttons (fontSize-small) were not found in Excalidraw; update patchFontSizeSteps');
  }
}

/**
 * Changes whenever the rewrites change. It is part of the plugin's name, and Vite hashes plugin names into the
 * key of its dependency cache (node_modules/.vite), so a dev server re-bundles Excalidraw instead of serving a
 * copy rewritten by older code (#307).
 */
const PATCH_ID = createHash('sha256')
  .update([stripCdnFallback, patchExcalidraw, patchFontSizeSteps, FALLBACK_RE, JSON.stringify(FONT_SIZE_STEPS)].map(String).join('\n'))
  .digest('hex')
  .slice(0, 8);

function excalidrawAssets(): Plugin {
  let seen = newSeen();
  return {
    name: `excalidraw-assets-${PATCH_ID}`,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(FONT_PREFIX)) return next();
        const name = decodeURIComponent(url.slice(FONT_PREFIX.length));
        const file = FONT_OVERRIDES[name] ?? normalize(join(excalidrawFonts, name));
        if ((!FONT_OVERRIDES[name] && !file.startsWith(excalidrawFonts + sep)) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    buildStart() {
      seen = newSeen();
    },
    transform(code, id) {
      const out = patchExcalidraw(code, id, seen);
      return out === null ? null : { code: out, map: null };
    },
    // Build only: the dev server's own pipeline never sees the pre-bundled Excalidraw.
    generateBundle() {
      assertPatched(seen);
    },
    writeBundle() {
      cpSync(excalidrawFonts, join(outDir, FONT_PREFIX), { recursive: true });
      for (const [name, file] of Object.entries(FONT_OVERRIDES)) cpSync(file, join(outDir, FONT_PREFIX, name));
    },
  };
}

/** The same rewrites inside the dev server's dependency optimizer, which bundles Excalidraw on its own. */
function excalidrawAssetsDeps() {
  let seen = newSeen();
  return {
    name: 'excalidraw-assets-deps',
    buildStart() {
      seen = newSeen();
    },
    transform(code: string, id: string) {
      const out = patchExcalidraw(code, id, seen);
      return out === null ? null : { code: out, map: null };
    },
    buildEnd() {
      assertPatched(seen);
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), excalidrawAssets()],
  publicDir: false,
  // The dev server pre-bundles Excalidraw (dist/dev/) outside the plugin pipeline above, so the
  // same rewrites run inside the dependency optimizer too.
  optimizeDeps: {
    rolldownOptions: { plugins: [excalidrawAssetsDeps()] },
  },
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
    // changeOrigin: the server rejects Host headers other than its own port.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.DRAW_PORT ?? 4330}`, changeOrigin: true } },
  },
});
