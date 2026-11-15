// How an outside change of the open document is applied (E520): a diff of the top-level blocks, so the editor can
// update changed blocks in place, fade new ones in and fade removed ones out instead of swapping the whole document.
// Pure (JSON in, edits out), so it runs under `node --test`.

type BlockJSON = { type?: string; attrs?: Record<string, unknown>; content?: unknown[]; [k: string]: unknown };

/** Signature of a block. A heading's link id is ignored: the editor gives ids to headings that have none. */
export function blockSig(b: unknown): string {
  const n = b as BlockJSON;
  if (n && typeof n === 'object' && n.type === 'heading' && n.attrs && 'id' in n.attrs) {
    const { id: _id, ...attrs } = n.attrs;
    return JSON.stringify({ ...n, attrs });
  }
  return JSON.stringify(b);
}

const typeOf = (b: unknown) => (b as BlockJSON | null)?.type ?? '';

export type BlockEdit =
  /** Old block `from` becomes new block `to` (same type): its text and attributes change in place. */
  | { op: 'update'; from: number; to: number }
  /** New block `to` is added before old block `before` (`before` = old length: at the end). */
  | { op: 'insert'; to: number; before: number }
  /** Old block `from` is gone. */
  | { op: 'remove'; from: number };

/** Longest-common-subsequence matches of two signature lists, as [oldIndex, newIndex] pairs. */
function matches(a: string[], b: string[]): [number, number][] {
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const out: [number, number][] = [];
  for (let i = 0; i < lo; i++) out.push([i, i]);
  const n = ea - lo;
  const m = eb - lo;
  if (n > 0 && m > 0) {
    if (n * m > 4_000_000) {
      // Too big for the table: treat the middle as one changed hunk.
    } else {
      const w = m + 1;
      const t = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--) t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a[lo + i] === b[lo + j]) {
          out.push([lo + i, lo + j]);
          i++;
          j++;
        } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) i++;
        else j++;
      }
    }
  }
  for (let k = 0; k < a.length - ea; k++) out.push([ea + k, eb + k]);
  return out;
}

/**
 * Edits that turn the block list `from` into `to`. Unchanged blocks produce nothing. Between two unchanged blocks,
 * old and new blocks of the same type pair up as in-place updates (in order); the rest are removed or inserted.
 */
export function diffBlocks(from: unknown[], to: unknown[]): BlockEdit[] {
  const a = from.map(blockSig);
  const b = to.map(blockSig);
  const keep = matches(a, b);
  const edits: BlockEdit[] = [];
  const hunk = (a0: number, a1: number, b0: number, b1: number) => {
    let i = a0;
    let j = b0;
    while (i < a1 && j < b1) {
      if (typeOf(from[i]) === typeOf(to[j])) {
        edits.push({ op: 'update', from: i, to: j });
        i++;
        j++;
      } else if (a1 - i > b1 - j) edits.push({ op: 'remove', from: i++ });
      else edits.push({ op: 'insert', to: j++, before: i });
    }
    while (i < a1) edits.push({ op: 'remove', from: i++ });
    while (j < b1) edits.push({ op: 'insert', to: j++, before: a1 });
  };
  let pa = 0;
  let pb = 0;
  for (const [i, j] of keep) {
    hunk(pa, i, pb, j);
    pa = i + 1;
    pb = j + 1;
  }
  hunk(pa, from.length, pb, to.length);
  return edits;
}

/** Top-level blocks of a document JSON (empty for anything that is not one). */
export const blocksOf = (doc: unknown): unknown[] => {
  const c = (doc as { content?: unknown } | null)?.content;
  return Array.isArray(c) ? c : [];
};
