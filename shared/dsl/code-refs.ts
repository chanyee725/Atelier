// Code references on diagram nodes (docs/design/code-linked-nodes.md §1): where in the repo a feature lives.
// The DSL shorthand `code: "path[:start[-end]][#symbol]; ..."` is parsed here; the block JSON (`codeRefs`) is
// validated and merged in `shared/render/block-code.ts`.

export interface CodeRef {
  /** Repo-relative, '/'-separated, no '..', no leading '/'. */
  path: string;
  /** 1-based, inclusive. */
  start: number;
  /** Optional, inclusive; absent means a single line (= start). */
  end?: number;
  symbol?: string;
  note?: string;
}

export const MAX_CODE_PATH = 500;
export const MAX_CODE_SYMBOL = 200;
export const MAX_CODE_NOTE = 300;
export const MAX_CODE_SPAN = 2000;

/** Why `p` is not a storable repo-relative path, or null. */
export function codePathProblem(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < 1 || p.length > MAX_CODE_PATH) return `path must be a string of 1-${MAX_CODE_PATH} characters`;
  if (p.includes('\0') || p.includes('\\')) return 'path must not contain NUL or backslash';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'path must be repo-relative';
  if (p.split('/').some((s) => s === '..' || s === '')) return "path must not have '..' or empty segments";
  return null;
}

export interface ParsedCodeAttr {
  refs: CodeRef[];
  /** One message per piece that was skipped. */
  problems: string[];
}

/** Parse one `code:` attribute value. Bad pieces are skipped and reported; the rest are kept. */
export function parseCodeAttr(text: string): ParsedCodeAttr {
  const refs: CodeRef[] = [];
  const problems: string[] = [];
  for (const raw of text.split(';')) {
    const piece = raw.trim();
    if (!piece) continue;
    let rest = piece;
    let symbol: string | undefined;
    const hash = rest.indexOf('#');
    if (hash >= 0) {
      symbol = rest.slice(hash + 1).trim();
      rest = rest.slice(0, hash).trim();
      if (!symbol || symbol.length > MAX_CODE_SYMBOL) {
        problems.push(`Bad symbol in code reference '${piece}'`);
        continue;
      }
    }
    // Line numbers follow the last colon, and only when what follows looks like a range.
    const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(rest);
    const path = (m ? m[1]! : rest).trim();
    const start = m ? Number(m[2]) : 1;
    const end = m && m[3] !== undefined ? Number(m[3]) : undefined;
    const bad = codePathProblem(path);
    if (bad) problems.push(`Bad code reference '${piece}': ${bad}`);
    else if (!Number.isSafeInteger(start) || start < 1 || (end !== undefined && (!Number.isSafeInteger(end) || end < start || end - start > MAX_CODE_SPAN))) {
      problems.push(`Bad line range in code reference '${piece}'`);
    } else {
      const ref: CodeRef = { path, start };
      if (end !== undefined && end !== start) ref.end = end;
      if (symbol) ref.symbol = symbol;
      refs.push(ref);
    }
  }
  return { refs, problems };
}

const CODE_ATTR = /(\[[^\]\n]*?)(?:,\s*)?\bcode\s*:\s*(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^,\]\n]*)\s*(,?)\s*/g;

/**
 * The diagram code without `code:` attributes, for text that leaves the app as Eraser-style diagram code
 * (Eraser's handling of unknown attributes is not verified). An attribute list left empty is removed too.
 */
export function stripCodeAttrs(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      let out = line;
      for (let i = 0; i < 20 && out.includes('code'); i++) {
        const next = out.replace(CODE_ATTR, (_m, head: string, comma: string) => (comma ? `${head}${head.endsWith('[') ? '' : ', '}` : head));
        if (next === out) break;
        out = next;
      }
      return out.replace(/\s*\[\s*,?\s*\]/g, '').replace(/,\s*\]/g, ']').replace(/\[\s*,\s*/g, '[');
    })
    .join('\n');
}
