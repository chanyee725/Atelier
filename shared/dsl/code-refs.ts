// Code references on diagram nodes (docs/design/code-linked-nodes.md §1): where in the repo a feature lives.
// The DSL shorthand `code: "path[:start[-end]][#symbol]; ..."` is parsed here; the block JSON (`codeRefs`) is
// validated and merged in `shared/render/block-code.ts`.

import { tokenize } from './tokenizer.ts';

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
  if (!normalizeCodePath(p)) return 'path must name a file';
  return null;
}

/** `p` without '.' segments (`./a.py` → `a.py`); the stored form. Apply to paths that passed {@link codePathProblem}. */
export function normalizeCodePath(p: string): string {
  return p.includes('.') ? p.split('/').filter((s) => s !== '.').join('/') : p;
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
    // The first `#` starts the symbol and the rest is the symbol as written (`#`, `/` included), as in block JSON.
    // So paths with `#` are not supported here.
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
      const ref: CodeRef = { path: normalizeCodePath(path), start };
      if (end !== undefined && end !== start) ref.end = end;
      if (symbol) ref.symbol = symbol;
      refs.push(ref);
    }
  }
  return { refs, problems };
}

/**
 * The diagram code without `code:` attributes, for text that leaves the app as Eraser-style diagram code
 * (Eraser's handling of unknown attributes is not verified). An attribute list left empty is removed too.
 * Uses the DSL tokenizer, so `code:` inside quoted text or comments is kept. Text outside changed lists stays
 * byte-for-byte unchanged; a list that keeps entries is rebuilt with `, ` between them. Edge cases follow parseAttrs
 * where it reads the line the same way: single quotes are plain characters (`[label: 'a, code: b']` → `[label: 'a]`).
 * Lists with no closing `]` on their line or with malformed entries (`[foo bar code: x]`) are left as written:
 * the parser already reports them as errors.
 */
export function stripCodeAttrs(src: string): string {
  if (!src.includes('code')) return src;
  const { tokens } = tokenize(src);
  const cuts: Array<{ from: number; to: number; text: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.kind !== 'lbracket') continue;
    const open = tokens[i]!;
    // One attribute list: entries [first token, last token] between `[`, commas and `]`.
    const entries: Array<{ first: number; last: number; isCode: boolean }> = [];
    let j = i + 1;
    let close = -1;
    let entryStart = j;
    let sawColon = false; // the current entry's `key:` colon was seen
    const endEntry = (end: number) => {
      if (end >= entryStart) {
        const k = tokens[entryStart]!;
        entries.push({ first: entryStart, last: end, isCode: k.kind === 'word' && k.text === 'code' && tokens[entryStart + 1]?.kind === 'colon' });
      }
    };
    let depth = 0; // balanced nested `[...]` inside a value belongs to the value
    let stop = -1; // first `,`/`]` seen inside a nested bracket: where the entry ends if that bracket never closes
    for (; j < tokens.length; j++) {
      const k = tokens[j]!.kind;
      if (depth > 0 && stop < 0 && (k === 'comma' || k === 'rbracket')) stop = j;
      if (k === 'colon') sawColon = true;
      const lineEnd = k === 'newline' || k === 'eof' || k === 'lbrace' || k === 'rbrace';
      if (stop >= 0 && lineEnd) {
        // Unmatched `[` swallowed the rest of the line: restart right at the first `,`/`]` like a plain value.
        j = stop - 1;
        depth = 0;
        stop = -1;
        continue;
      }
      if (k === 'rbracket') {
        if (depth > 0) {
          depth--;
          continue;
        }
        endEntry(j - 1);
        close = j;
        break;
      }
      if (k === 'newline' || k === 'eof' || k === 'lbrace' || k === 'rbrace') break;
      if (k === 'lbracket') {
        // A bracket right after the entry's `key:` is nested only once the key's colon was seen.
        if (tokens[entryStart]?.kind === 'word' && sawColon) {
          depth++;
          continue;
        }
        break;
      }
      if (k === 'comma' && depth === 0) {
        endEntry(j - 1);
        entryStart = j + 1;
        sawColon = false;
      }
    }
    i = Math.max(i, j - 1);
    if (close < 0 || !entries.some((e) => e.isCode)) continue;
    const kept = entries.filter((e) => !e.isCode);
    const end = tokens[close]!;
    if (kept.length === 0) {
      // Drop the whole list and the whitespace before it, unless the list starts its line (keep the indentation).
      let from = open.offset;
      while (from > 0 && (src[from - 1] === ' ' || src[from - 1] === '\t')) from--;
      if (from === 0 || src[from - 1] === '\n') from = open.offset;
      cuts.push({ from, to: end.offset + 1, text: '' });
      continue;
    }
    // Rebuild the list from the kept entries' source text; everything outside the brackets is untouched.
    const text = kept.map((e) => src.slice(tokens[e.first]!.offset, tokens[e.last]!.offset + tokens[e.last]!.length)).join(', ');
    cuts.push({ from: open.offset, to: end.offset + 1, text: `[${text}]` });
  }
  let out = src;
  for (const { from, to, text } of cuts.reverse()) out = out.slice(0, from) + text + out.slice(to);
  return out;
}
