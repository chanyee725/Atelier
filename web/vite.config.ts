import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { FONT_SIZE_STEPS, patchFontSizeSteps } from './src/canvas/sizeSteps.ts';
import { patchFontBase64 } from './src/canvas/fontBase64.ts';
import { KO_HINTS, patchKoHints } from './src/canvas/koHints.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../public', import.meta.url));
// Excalidraw's own fonts (OFL/MIT, shipped in the npm package). Served from /excalidraw/fonts/
// so the canvas never falls back to its CDN.
const excalidrawFonts = fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url));
// The canvas font (font id 9, "Liberation Sans" in Excalidraw) is Pretendard. Excalidraw 0.18 cannot register a font
// family (Fonts.register is private) and defines id 9 with one face and no unicode-range, so the one file it loads from
// /excalidraw/fonts/Liberation/ is replaced by web/fonts/drawing-sans-canvas.woff2: Pretendard Regular 1.3.9 (npm
// `pretendard`, SIL OFL-1.1, license text in shared/render/fonts/drawing-sans-OFL.txt) cut to Latin, Jamo and the 2,350
// KS X 1001 syllables (the other 8,822 modern syllables, e.g. 똠 햏 뷁, are drawn by a fallback font), renamed "Drawing Sans"
// (Pretendard is a reserved font name). Regenerate (repo root, fonttools==4.68.0, brotli==1.2.1):
//   python scripts/subset-canvas-font.py node_modules/pretendard/dist/web/static/woff2 web/fonts
// Text, SVG and PNG export all load fonts through that registration, so they follow. docs/design/code-linked-nodes.md §5.
const CANVAS_FONT = fileURLToPath(new URL('./fonts/drawing-sans-canvas.woff2', import.meta.url));
const FONT_OVERRIDES: Record<string, string> = { 'Liberation/LiberationSans-Regular.woff2': CANVAS_FONT };
// Bundled icon library (#734, scripts/import-icons.mjs): served at /icons/ in dev, copied next to the build.
const ICON_DIR = fileURLToPath(new URL('./icons', import.meta.url));
const ICON_PREFIX = '/icons/';
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

/**
 * Every rewrite of Excalidraw's bundle: the font fallback, the style panel's size steps (#292) and the SVG export's
 * font inlining (fontBase64.ts, #453).
 */
function patchExcalidraw(code: string, id: string, seen: PatchSeen): string | null {
  if (!EXCALIDRAW_DIST_RE.test(id)) return null;
  seen.excalidraw = true;
  const local = stripCdnFallback(code, id);
  const sized = patchFontSizeSteps(local ?? code);
  if (sized !== null) seen.sizeSteps = true;
  const inlined = patchFontBase64(sized ?? local ?? code);
  if (inlined !== null) seen.fontBase64 = true;
  const hinted = patchKoHints(inlined ?? sized ?? local ?? code);
  if (hinted !== null) seen.koHints = true;
  return hinted ?? inlined ?? sized ?? local;
}

/** Whether one bundling pass met Excalidraw's code, and which rewrites found their target in it. */
type PatchSeen = { excalidraw: boolean; sizeSteps: boolean; fontBase64: boolean; koHints: boolean };
const newSeen = (): PatchSeen => ({ excalidraw: false, sizeSteps: false, fontBase64: false, koHints: false });

/**
 * Fails the pass when Excalidraw was bundled but its size buttons or its font data URL were never found (a renamed
 * test id or a moved dist path), so the stock sizes or the export's stack overflow cannot silently come back.
 */
function assertPatched(seen: PatchSeen): void {
  if (seen.excalidraw && !seen.sizeSteps) {
    throw new Error('excalidraw-assets: the size buttons (fontSize-small) were not found in Excalidraw; update patchFontSizeSteps');
  }
  if (seen.excalidraw && !seen.fontBase64) {
    throw new Error('excalidraw-assets: the font data URL (toBase64) was not found in Excalidraw; update patchFontBase64');
  }
  if (seen.excalidraw && !seen.koHints) {
    throw new Error('excalidraw-assets: the ko-KR hints (canvasPanning) were not found in Excalidraw; update patchKoHints');
  }
}

/**
 * Changes whenever the rewrites change. It is part of the plugin's name, and Vite hashes plugin names into the
 * key of its dependency cache (node_modules/.vite), so a dev server re-bundles Excalidraw instead of serving a
 * copy rewritten by older code (#307).
 */
// The rewritten font spread, so a change inside patchFontBase64's helpers changes the id too.
const FONT_BASE64_SAMPLE = patchFontBase64('data:font/woff2;base64,String.fromCharCode(...new Uint8Array(x))');
const PATCH_ID = createHash('sha256')
  .update([stripCdnFallback, patchExcalidraw, patchFontSizeSteps, patchFontBase64, patchKoHints, JSON.stringify(KO_HINTS), FONT_BASE64_SAMPLE, FALLBACK_RE, JSON.stringify(FONT_SIZE_STEPS)].map(String).join('\n'))
  .digest('hex')
  .slice(0, 8);

function excalidrawAssets(): Plugin {
  let seen = newSeen();
  return {
    name: `excalidraw-assets-${PATCH_ID}`,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url.startsWith(ICON_PREFIX)) {
          const file = normalize(join(ICON_DIR, decodeURIComponent(url.slice(ICON_PREFIX.length))));
          if (!file.startsWith(ICON_DIR + sep) || !file.endsWith('.svg') || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader('content-type', 'image/svg+xml');
          createReadStream(file).pipe(res);
          return;
        }
        if (!url.startsWith(FONT_PREFIX)) return next();
        const name = decodeURIComponent(url.slice(FONT_PREFIX.length));
        const override = Object.hasOwn(FONT_OVERRIDES, name) ? FONT_OVERRIDES[name] : undefined;
        const file = override ?? normalize(join(excalidrawFonts, name));
        if ((!override && !file.startsWith(excalidrawFonts + sep)) || !existsSync(file) || !statSync(file).isFile()) return next();
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
      cpSync(ICON_DIR, join(outDir, ICON_PREFIX), { recursive: true, filter: (f) => !f.endsWith('.md') });
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
