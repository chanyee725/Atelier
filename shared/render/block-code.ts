// Per-block code references (`block.codeRefs` in `.dpx.json`), keyed by node name like `layout.items`.
// Rules shared by the server (checks saves) and the web (merges DSL refs for display / free-form conversion).
// Design: docs/design/code-linked-nodes.md §1.
import { codePathProblem, MAX_CODE_NOTE, MAX_CODE_SPAN, MAX_CODE_SYMBOL, type CodeRef } from '../dsl/code-refs.ts';

export type { CodeRef };

/** Sub-format version this code understands. A `codeRefs` with a higher `v` is kept verbatim. */
export const BLOCK_CODE_VERSION = 1;
export const MAX_CODE_NODES = 2000;
export const MAX_CODE_NODE_NAME = 200;
export const MAX_CODE_REFS = 20;
export const MAX_CODE_SUMMARY = 500;

export interface NodeCode {
  summary?: string;
  refs: CodeRef[];
}

export interface BlockCode {
  v: number;
  nodes: Record<string, NodeCode>;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function refProblem(r: unknown, at: string): string | null {
  if (!isObj(r)) return `${at} must be an object`;
  const p = codePathProblem(r.path);
  if (p) return `${at}.${p}`;
  if (!Number.isInteger(r.start) || (r.start as number) < 1) return `${at}.start must be an integer >= 1`;
  if (r.end !== undefined) {
    if (!Number.isInteger(r.end) || (r.end as number) < (r.start as number)) return `${at}.end must be an integer >= start`;
    if ((r.end as number) - (r.start as number) > MAX_CODE_SPAN) return `${at} spans more than ${MAX_CODE_SPAN} lines`;
  }
  if (r.symbol !== undefined && (typeof r.symbol !== 'string' || r.symbol.length > MAX_CODE_SYMBOL)) return `${at}.symbol must be a string of at most ${MAX_CODE_SYMBOL} characters`;
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.length > MAX_CODE_NOTE)) return `${at}.note must be a string of at most ${MAX_CODE_NOTE} characters`;
  return null;
}

/** Why `c` is not storable block code, or null. A `v` above {@link BLOCK_CODE_VERSION} is only checked to be an integer. */
export function blockCodeProblem(c: unknown, at = 'codeRefs'): string | null {
  if (!isObj(c)) return `${at} must be an object`;
  if (!Number.isInteger(c.v) || (c.v as number) < 1) return `${at}.v must be an integer >= 1`;
  if ((c.v as number) > BLOCK_CODE_VERSION) return null;
  if (!isObj(c.nodes)) return `${at}.nodes must be an object`;
  const keys = Object.keys(c.nodes);
  if (keys.length > MAX_CODE_NODES) return `${at}.nodes has more than ${MAX_CODE_NODES} entries`;
  for (const k of keys) {
    if (k.length < 1 || k.length > MAX_CODE_NODE_NAME) return `${at}.nodes keys must be 1-${MAX_CODE_NODE_NAME} characters`;
    if (k === '__proto__') return `${at}.nodes must not have a "__proto__" key`;
    const n = c.nodes[k];
    const where = `${at}.nodes["${k.slice(0, 40)}"]`;
    if (!isObj(n)) return `${where} must be an object`;
    if (n.summary !== undefined && (typeof n.summary !== 'string' || n.summary.length > MAX_CODE_SUMMARY)) return `${where}.summary must be a string of at most ${MAX_CODE_SUMMARY} characters`;
    if (!Array.isArray(n.refs)) return `${where}.refs must be an array`;
    if (n.refs.length > MAX_CODE_REFS) return `${where}.refs has more than ${MAX_CODE_REFS} entries`;
    for (let i = 0; i < n.refs.length; i++) {
      const p = refProblem(n.refs[i], `${where}.refs[${i}]`);
      if (p) return p;
    }
  }
  return null;
}

const cleanRef = (r: CodeRef): CodeRef => {
  const o: CodeRef = { path: r.path, start: r.start };
  if (r.end !== undefined) o.end = r.end;
  if (r.symbol !== undefined) o.symbol = r.symbol;
  if (r.note !== undefined) o.note = r.note;
  return o;
};

/** Copy of block code that passed {@link blockCodeProblem}, unknown fields dropped. A newer `v` comes back as is. */
export function cleanBlockCode(c: BlockCode): BlockCode {
  if (c.v > BLOCK_CODE_VERSION) return c;
  return {
    v: c.v,
    nodes: Object.fromEntries(
      Object.entries(c.nodes).map(([k, n]) => [k, { ...(n.summary !== undefined ? { summary: n.summary } : {}), refs: n.refs.map(cleanRef) }]),
    ),
  };
}

const sameRef = (a: CodeRef, b: CodeRef) => a.path === b.path && a.start === b.start && (a.end ?? a.start) === (b.end ?? b.start) && a.symbol === b.symbol;

/**
 * Block JSON merged with the refs parsed from the DSL `code:` attribute (`dsl`: node name -> refs).
 * The block wins: its summary and refs stay as they are; a DSL ref is added only when the block has no ref with the
 * same path, range and symbol. Total refs per node stay within {@link MAX_CODE_REFS}. Pure; inputs are not changed.
 * A block `codeRefs` with a newer `v` is not understood, so only the DSL refs are returned.
 */
export function mergeCodeRefs(block: BlockCode | undefined, dsl: Record<string, CodeRef[]> | undefined): Record<string, NodeCode> {
  const out: Record<string, NodeCode> = {};
  if (block && block.v <= BLOCK_CODE_VERSION && isObj(block.nodes)) {
    for (const [k, n] of Object.entries(block.nodes)) out[k] = { ...(n.summary !== undefined ? { summary: n.summary } : {}), refs: n.refs.map(cleanRef) };
  }
  for (const [k, refs] of Object.entries(dsl ?? {})) {
    if (k === '__proto__' || !refs.length) continue;
    const node = out[k] ?? (out[k] = { refs: [] });
    for (const r of refs) {
      if (node.refs.length >= MAX_CODE_REFS) break;
      if (!node.refs.some((x) => sameRef(x, r))) node.refs.push(cleanRef(r));
    }
  }
  return out;
}

/** Node name -> refs from a parsed graph's `code` attributes (walks groups). */
export function dslCodeRefs(children: readonly { kind: string; name: string; code?: CodeRef[]; children?: unknown[] }[]): Record<string, CodeRef[]> {
  const out: Record<string, CodeRef[]> = {};
  const walk = (list: readonly { kind: string; name: string; code?: CodeRef[]; children?: unknown[] }[]) => {
    for (const c of list) {
      if (c.kind === 'node' && c.code?.length) out[c.name] = c.code;
      if (c.kind === 'group' && c.children) walk(c.children as never);
    }
  };
  walk(children);
  return out;
}
