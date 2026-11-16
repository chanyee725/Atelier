// Applies an outside change of the open document to the live editor (E520): changed blocks update in place,
// new blocks fade in, removed blocks fade out, and selection and scroll stay where they are.
// ProseMirror only (no React), so tests can run it in Node.
import type { Editor } from '@tiptap/core';
import { Node as PMNode, Slice, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { diffBlocks, blocksOf } from './liveDiff.ts';
import { MOTION_MS } from '../lib/liveMotion.ts';
import { isEmptyDoc, withTrailingParagraph } from './model.ts';

/** How long a removed block fades before it is taken out (matches the CSS in index.css). */
export const EXIT_MS = MOTION_MS.exit;
/** How long the enter / touch classes stay on a block (the CSS animations are at most MOTION_MS.move long). */
export const ENTER_MS = MOTION_MS.move + 40;
export const LIVE_META = 'liveApply';

type Cls = 'live-enter' | 'live-exit' | 'live-touch';
/** A block an undo or redo took out while it faded, at its place in the document now (see LiveState.gone). */
type Gone = { pos: number; node: PMNode };
type DecoMeta = { add?: { from: number; to: number; cls: Cls }[]; clear?: Cls; gone?: Gone[] };
/**
 * An invisible mark on a fading block the user typed in (#567, #577): `orig` is the block as the outside change
 * removed it. Once an undo brings it back to exactly that, the user's edits are gone and the removal is finished.
 */
type KeptSpec = { cls: 'live-kept'; orig: PMNode };
/**
 * `deco`: node decorations that carry the animation classes. `gone`: fading blocks an undo or redo took out (#569).
 * ProseMirror's history files a transaction appended to an undo on the redo stack (and one appended to a redo on the
 * undo stack) even with addToHistory false, so the next redo or undo puts such a block back; it is taken out again.
 */
type LiveState = { deco: DecorationSet; gone: Gone[] };
/** How many taken-out blocks are watched for coming back. */
const GONE_MAX = 20;
const key = new PluginKey<LiveState>('liveApply');

/** The animation decorations of the live-apply plugin (empty when the plugin is not installed). */
export const liveDecorations = (state: EditorState): DecorationSet => key.getState(state)?.deco ?? DecorationSet.empty;

/** Node decorations that carry the animation classes. Positions follow the document through other edits. */
export function liveApplyPlugin(): Plugin<LiveState> {
  return new Plugin<LiveState>({
    key,
    state: {
      init: () => ({ deco: DecorationSet.empty, gone: [] }),
      apply(tr, st) {
        const set = st.deco;
        let next = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        // The user edited inside a fading block (#567): they keep it, so it stops fading and is not flushed
        // (deleting it outside history would drop the undo step of their typing).
        if (tr.docChanged && !tr.getMeta(LIVE_META)) {
          const kept = next.find(undefined, undefined, (s) => s.cls === 'live-exit').filter((d) => touchedBy(tr, d.from, d.to));
          if (kept.length) {
            next = next.remove(kept);
            // Remember the block as it was removed, so undoing the typing can finish the removal (#577).
            const origs = kept.map((d) => tr.before.nodeAt(tr.mapping.invert().map(d.from, 1)));
            next = next.add(
              tr.doc,
              kept.flatMap((d, i) => {
                const orig = origs[i];
                return orig ? [Decoration.node(d.from, d.to, {}, { cls: 'live-kept', orig } satisfies KeptSpec)] : [];
              }),
            );
          }
        }
        const m = tr.getMeta(key) as DecoMeta | undefined;
        if (m?.clear) next = next.remove(next.find(undefined, undefined, (s) => s.cls === m.clear));
        if (m?.add?.length) next = next.add(tr.doc, m.add.map((a) => Decoration.node(a.from, a.to, { class: a.cls }, { cls: a.cls })));
        let gone = st.gone;
        if (tr.docChanged && gone.length)
          gone = gone.flatMap((g) => {
            const r = tr.mapping.mapResult(g.pos, -1);
            return r.deletedAcross ? [] : [{ pos: r.pos, node: g.node }];
          });
        if (m?.gone?.length) {
          const fresh = m.gone;
          gone = [...gone.filter((g) => !fresh.some((f) => f.pos === g.pos && f.node.eq(g.node))), ...fresh].slice(-GONE_MAX);
        }
        return gone === st.gone && next === set ? st : { deco: next, gone };
      },
    },
    props: { decorations: (s) => key.getState(s)?.deco },
    // A user edit while blocks fade out (#554): take them out in the same update, so the JSON the editor
    // saves already matches the outside file instead of still holding the removed blocks.
    // An undo that brings a kept block back to how the outside change removed it finishes that removal too (#577),
    // or the next save would write the removed block back.
    appendTransaction(trs, _old, state) {
      if (!trs.some((t) => t.docChanged && !t.getMeta(LIVE_META))) return null;
      return exitFlush(state, trs.some((t) => t.docChanged && isHistoryTransaction(t)));
    },
  });
}

/** Whether a change of `tr` lands strictly inside the block at [from, to) of `tr.doc`. */
function touchedBy(tr: Transaction, from: number, to: number): boolean {
  const maps = tr.mapping.maps;
  let hit = false;
  maps.forEach((map, i) => {
    if (hit) return;
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_a, _b, start, end) => {
      if (hit) return;
      const s = rest.map(start, -1);
      const e = rest.map(end, 1);
      if (s > from && e < to) hit = true;
    });
  });
  return hit;
}

/**
 * The transaction that deletes every block marked `live-exit` (and, after an undo, every kept block that is back to
 * its removed form), or null when none is.
 */
function exitFlush(state: EditorState, undone = false): Transaction | null {
  const st = key.getState(state);
  if (!st) return null;
  const set = st.deco;
  // `watch`: blocks the outside change removed. Taken out by an undo or redo, they are watched for coming back (#569).
  const found: { from: number; to: number; watch: boolean }[] = set
    .find(undefined, undefined, (s) => s.cls === 'live-exit')
    .map((d) => ({ from: d.from, to: d.to, watch: undone }));
  if (undone) {
    const back = set.find(undefined, undefined, (s) => s.cls === 'live-kept').filter((d) => {
      const n = state.doc.nodeAt(d.from);
      return !!n && d.from + n.nodeSize === d.to && n.eq((d.spec as KeptSpec).orig);
    });
    // A kept block holds the user's typing: a redo that brings it back brings their typing back, so it is not watched.
    found.push(...back.map((d) => ({ from: d.from, to: d.to, watch: false })));
    // A block an earlier undo or redo took out that this one put back (the history replays its removal backwards).
    for (const g of st.gone) {
      const n = state.doc.nodeAt(g.pos);
      if (n && n.eq(g.node) && !found.some((f) => f.from < g.pos + n.nodeSize && g.pos < f.to)) found.push({ from: g.pos, to: g.pos + n.nodeSize, watch: true });
    }
  }
  found.sort((a, b) => b.from - a.from);
  if (!found.length) return null;
  const tr = state.tr;
  const watched: { step: number; from: number; node: PMNode }[] = [];
  for (const d of found) {
    if (d.watch) watched.push({ step: tr.steps.length, from: d.from, node: state.doc.nodeAt(d.from)! });
    tr.delete(d.from, d.to);
  }
  const gone = watched.map((w) => ({ pos: tr.mapping.slice(w.step).map(w.from, -1), node: w.node }));
  tr.setMeta(key, { clear: 'live-exit', ...(gone.length ? { gone } : {}) } satisfies DecoMeta);
  tr.setMeta('addToHistory', false);
  return tr;
}

const docOf = (schema: Schema, json: unknown): PMNode | null => {
  try {
    const j = isEmptyDoc(json) ? { type: 'doc', content: [{ type: 'paragraph' }] } : withTrailingParagraph(json);
    const n = schema.nodeFromJSON(j);
    n.check();
    return n;
  } catch {
    return null;
  }
};

/** Replace only what differs inside a block of the same type (keeps a cursor in the unchanged text). */
function updateInPlace(tr: Transaction, pos: number, from: PMNode, to: PMNode) {
  const attrsChanged = Object.keys(to.attrs).some((k) => !(from.type.name === 'heading' && k === 'id' && !to.attrs[k]) && to.attrs[k] !== from.attrs[k]);
  if (attrsChanged) {
    const attrs = { ...to.attrs };
    if (from.type.name === 'heading' && !attrs.id) attrs.id = from.attrs.id;
    tr.setNodeMarkup(pos, undefined, attrs);
  }
  const start = from.content.findDiffStart(to.content);
  if (start == null) return;
  const end = from.content.findDiffEnd(to.content);
  if (!end) return;
  let { a, b } = end;
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  tr.replace(pos + 1 + start, pos + 1 + a, new Slice(to.content.cut(start, b), 0, 0));
}

type Planned = { key: number; tie: number; run: () => void };

/**
 * The transaction that turns the editor's document into `target`, or null when they already match.
 * Removed blocks are only marked (`live-exit`) when `fadeOut`, deleted otherwise.
 */
export function planLive(state: EditorState, target: PMNode, fadeOut: boolean): { tr: Transaction; exits: number } | null {
  const doc = state.doc;
  // Blocks still fading out from an earlier apply are already gone: they never take part in the diff
  // (else a new block of the same type would be matched with one and deleted with it) and are deleted now.
  const exiting = new Set(liveDecorations(state).find(undefined, undefined, (s) => s.cls === 'live-exit').map((d) => d.from));
  const oldNodes: PMNode[] = [];
  const offsets: number[] = [];
  const stale: { from: number; to: number }[] = [];
  doc.forEach((n, off) => {
    if (exiting.has(off)) {
      stale.push({ from: off, to: off + n.nodeSize });
      return;
    }
    oldNodes.push(n);
    offsets.push(off);
  });
  const newNodes: PMNode[] = [];
  target.forEach((n) => newNodes.push(n));
  const edits = diffBlocks(
    oldNodes.map((n) => n.toJSON()),
    newNodes.map((n) => n.toJSON()),
  );
  if (!edits.length && !stale.length) return null;
  const tr = state.tr;
  const adds: { step: number; from: number; size: number; cls: Cls }[] = [];
  const exitAt: { step: number; from: number; to: number }[] = [];
  const posOf = (i: number) => (i < offsets.length ? offsets[i]! : doc.content.size);
  const jobs: Planned[] = stale.map((x) => ({ key: x.from, tie: 0, run: () => void tr.delete(x.from, x.to) }));
  for (const e of edits) jobs.push(planEdit(e));
  function planEdit(e: (typeof edits)[number]): Planned {
    if (e.op === 'insert') {
      const pos = posOf(e.before);
      return {
        key: pos,
        tie: 1 + (newNodes.length - e.to),
        run: () => {
          const node = newNodes[e.to]!;
          adds.push({ step: tr.steps.length, from: pos, size: node.nodeSize, cls: 'live-enter' });
          tr.insert(pos, node);
        },
      };
    }
    const pos = offsets[e.from]!;
    const old = oldNodes[e.from]!;
    if (e.op === 'remove')
      return {
        key: pos,
        tie: 0,
        run: () => {
          if (fadeOut) exitAt.push({ step: tr.steps.length, from: pos, to: pos + old.nodeSize });
          else tr.delete(pos, pos + old.nodeSize);
        },
      };
    return {
      key: pos,
      tie: 0,
      run: () => {
        const before = tr.steps.length;
        updateInPlace(tr, pos, old, newNodes[e.to]!);
        if (tr.steps.length > before) adds.push({ step: before, from: pos, size: old.nodeSize, cls: 'live-touch' });
      },
    };
  }
  // Last place first, so earlier positions stay valid; at one place the change of a block goes before an insert in front of it.
  jobs.sort((x, y) => y.key - x.key || x.tie - y.tie);
  for (const j of jobs) j.run();
  const meta: DecoMeta = { add: [] };
  for (const a of adds) {
    const m = tr.mapping.slice(a.step);
    meta.add!.push({ from: m.map(a.from, 1), to: m.map(a.from + a.size, -1), cls: a.cls });
  }
  for (const x of exitAt) {
    const m = tr.mapping.slice(x.step);
    meta.add!.push({ from: m.map(x.from, 1), to: m.map(x.to, -1), cls: 'live-exit' });
  }
  tr.setMeta(key, meta);
  tr.setMeta('addToHistory', false);
  tr.setMeta(LIVE_META, true);
  return { tr, exits: exitAt.length };
}

const exitTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const clearTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

/** Delete every block marked `live-exit`. */
function flushExits(editor: Editor) {
  const view = editor.view;
  if (!view || (view as { isDestroyed?: boolean }).isDestroyed) return;
  const tr = exitFlush(view.state);
  if (!tr) return;
  view.dispatch(tr.setMeta(LIVE_META, true));
}

const later = (map: WeakMap<object, ReturnType<typeof setTimeout>>, owner: object, ms: number, f: () => void) => {
  const old = map.get(owner);
  if (old) clearTimeout(old);
  map.set(owner, setTimeout(f, ms));
};

/**
 * Apply the new document to the editor. Returns false when it cannot be read (the caller reloads the file instead).
 * Calls that follow each other quickly share one pending fade-out and one cleanup, so a burst never stacks animations.
 */
export function applyLiveDocument(editor: Editor, doc: unknown, reduced: boolean): boolean {
  const view = editor.view;
  if (!view) return false;
  const target = docOf(editor.schema, doc);
  if (!target) return false;
  const plan = planLive(view.state, target, true);
  if (!plan) return true;
  view.dispatch(plan.tr);
  // Removed blocks fade for EXIT_MS and are then deleted together; a later call keeps the same timer.
  if (plan.exits || liveDecorations(view.state).find(undefined, undefined, (s) => s.cls === 'live-exit').length) {
    if (!exitTimers.has(editor)) {
      exitTimers.set(
        editor,
        setTimeout(() => {
          exitTimers.delete(editor);
          flushExits(editor);
        }, reduced ? 120 : EXIT_MS),
      );
    }
  }
  later(clearTimers, editor, ENTER_MS, () => {
    const v = editor.view;
    if (!v || (v as { isDestroyed?: boolean }).isDestroyed) return;
    v.dispatch(v.state.tr.setMeta(key, { clear: 'live-enter' } satisfies DecoMeta).setMeta('addToHistory', false).setMeta(LIVE_META, true));
    v.dispatch(v.state.tr.setMeta(key, { clear: 'live-touch' } satisfies DecoMeta).setMeta('addToHistory', false).setMeta(LIVE_META, true));
  });
  return true;
}

export { blocksOf };
