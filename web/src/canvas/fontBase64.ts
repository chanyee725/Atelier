// SVG export inlines each used font as `data:font/woff2;base64,...` (Excalidraw's subset-shared chunk, `toBase64`).
// It first tries to cut the font to the used glyphs with WebAssembly, which our CSP blocks (no 'unsafe-eval'), so it
// falls back to the whole file. That fallback builds the byte string with `String.fromCharCode(...bytes)`: one
// argument per byte, which overflows the call stack for the 171 KB canvas font (web/fonts/drawing-sans-canvas.woff2),
// so the export kept a loopback url(...) instead of the font. The build rewrites that one call to convert in chunks.

/** Only the module that holds `toBase64` builds this data URL. */
const MARKER = 'data:font/woff2;base64,';

/** Bytes per `String.fromCharCode.apply` call: far below any engine's argument limit. */
export const CHUNK = 0x2000;

/** `String.fromCharCode(...new Uint8Array(x))`, minified (prod) or readable (dev). */
const SPREAD_RE = /String\.fromCharCode\(\s*\.\.\.\s*new Uint8Array\(\s*([\w$]+)\s*\)\s*\)/g;

/** The same byte string, `CHUNK` bytes per call. Self-contained: it is pasted into Excalidraw's bundle as source. */
const chunked = (bytesExpr: string) =>
  `((b)=>{let s="";for(let i=0;i<b.length;i+=${CHUNK})s+=String.fromCharCode.apply(null,b.subarray(i,i+${CHUNK}));return s})(new Uint8Array(${bytesExpr}))`;

/**
 * Excalidraw's bundle with the font fallback's byte string built in chunks: null when `code` does not build the
 * font data URL. Throws when the spread is not found exactly once, so a dependency update cannot silently bring the
 * stack overflow back.
 */
export function patchFontBase64(code: string): string | null {
  if (!code.includes(MARKER)) return null;
  let hits = 0;
  const out = code.replace(SPREAD_RE, (_m, bytes: string) => (hits++, chunked(bytes)));
  if (hits !== 1) throw new Error(`excalidraw-assets: the font base64 spread was found ${hits} times; update patchFontBase64`);
  return out;
}
