// The infinite canvas: Excalidraw (MIT) with diagram blocks shown as image elements.
// Loaded lazily from CanvasPane so the editor shell does not wait for it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, getCommonBounds, newElementWith, restoreElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI, NormalizedZoomValue } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { Block } from '../api';
import type { BlockLayout, Scene } from '../../../shared/render/index.ts';
import { CanvasInsertMenu } from './CanvasInsertMenu';
import { DIAGRAM_TYPES } from '../dsl/templates';
import { prunedLayout } from '../dsl/adapter';
import { blockLabel, brokenNotice, type BrokenBlock } from './notice';
import { renderBlock, type BlockPicture } from './render';
import { baseFileId } from './resolution';
import type { CanvasHandle } from '../export/types';
import { applyScene, blockIdOf, blockImageSkeleton, findCopies, freeSignature, hash, layoutSig, layoutsFromImages, liveFrames, newBlockId, picturesFor, placeBlocks, sameDrawing, shiftForOrigin, splitScene, type PictureCache, type SceneEl } from './sync';
import { LayoutEditOverlay, focusCanvas, type EditStart } from './LayoutEditOverlay';
import { RunOverlay } from './RunOverlay';
import { MorphOverlay, MORPH_OPACITY, type Morphs } from './MorphOverlay';
import { willMorph } from './MorphLayer';
import { canPlace, endMorphOpacity, type PlaceEl } from './runPlace';
import { AgentCursors } from './AgentCursors';
import { openLayoutSession, sessionKey, type LayoutSession } from './layoutSession';
import { diagramChildren, parse } from '../../../shared/dsl/index.ts';
import { dslCodeRefs, mergeCodeRefs, type NodeCode } from '../../../shared/render/block-code.ts';
import { bindArrows, frameFor, sceneToFreeform } from './freeform';
import { CLEAN_APP_STATE, cleanElements, pretendardRefitIds } from './cleanStyle';
import { PANE_FIT, changedBlock, followView, openingView, refitView, rememberView } from './initialView';
import { useFontRefit } from './useFontRefit';
import './clean.css';
import { CodePanel } from './CodePanel';
import { LayoutBar } from './LayoutBar';
import { BlockCodePanel } from './BlockCodePanel';
import { useCanvasHandle } from './useCanvasHandle';
import { useSharpen } from './useSharpen';
import { NO_EMBEDS, UI_OPTIONS, fileData, fitFor, isGraphType, liveRects, newElId, picTheme, ready, theme, withLayout, type Edit, type Sess } from './canvasHelpers';
import { CodeBadges } from './CodeBadges';
import { codeInfoCache, shapeCode, shapeLabel, targetAfterNodes, targetAfterSelection, withoutOrphans, type CodeEl, type CodeTarget } from './codeLinks';
import { hitHandle, imageReason, layoutFrame, layoutHandles, toLayout, type LayoutFrame } from './layoutEdit';
import { askConfirm } from '../appDialog';
import { drawnBlock, lookKey, type PlanLook } from './planStyle';

export type CanvasData = { elements: unknown[]; appState: Record<string, unknown> };
/** Show (scroll to and select) this block's image; a new `n` is a new request. */
export type CanvasFocus = { blockId?: string; frameId?: string; n: number };

type Props = {
  canvas: CanvasData;
  blocks: Block[];
  focus: CanvasFocus | null;
  dark: boolean;
  onChange: (patch: { canvas?: CanvasData; blocks?: Block[] }) => void;
  /** Filled while this canvas is mounted, so export, the palette and shortcuts can reach it. */
  handle?: { current: CanvasHandle | null };
  /** Workspace path of the open file: live agent cursors (E56) of this file are drawn. */
  path?: string;
  /** The file's plan look (#971): the plan block is drawn with its steps' role icons and colours. */
  look?: PlanLook | null;
};

export default function ExcalidrawCanvas({ canvas, blocks, focus, dark, onChange, handle, path, look = null }: Props) {
  // Blocks are drawn and laid out with the plan look in their code (planStyle.ts); writes keep the saved code.
  const lookRef = useRef(look);
  lookRef.current = look;
  const looks = lookKey(look);
  const drawnOf = useCallback(<B extends Block>(b: B): B => drawnBlock(b, lookRef.current), []);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Only diagram blocks are selected: hide Excalidraw's "double-click to crop" hint, since that opens the code.
  const [blockSelected, setBlockSelected] = useState(false);
  // Excalidraw's "move the canvas" hint is for an empty canvas; with elements on it the hint only covers them (#438).
  const [hidePanHint, setHidePanHint] = useState(false);
  // Blocks whose code has errors (they show their last good picture), for the notice on the canvas.
  const [broken, setBroken] = useState<BrokenBlock[]>([]);
  // Blocks drawn with their saved layout left out because the code changed a lot (design §4.2).
  const [resets, setResets] = useState<ReadonlySet<string>>(new Set());
  // Picture size per file id, to keep a block's scale when its picture changes.
  const sizes = useRef(new Map<string, BlockPicture>());
  // The picture each block shows, so a block whose code did not change is not rendered again.
  const picCache = useRef<PictureCache<BlockPicture>>(new Map());
  // Blocks whose code changed from outside and are animating old → new (E520); their image is nearly hidden meanwhile.
  const [morphs, setMorphs] = useState<Morphs>(new Map());
  const morphOpacity = useRef(new Map<string, number>());
  const darkRef = useRef(dark);
  darkRef.current = dark;
  // The theme the pictures in `picCache` (and so on the canvas) are drawn in; a switch draws every block again.
  const shownTheme = useRef(picTheme(dark));
  const want = picTheme(dark);
  const draw = useCallback(
    (list: readonly Block[]) => {
      if (shownTheme.current !== want) {
        shownTheme.current = want;
        picCache.current.clear();
      }
      return picturesFor(list.map(drawnOf), picCache.current, (b) => renderBlock(b, want));
    },
    // A new look draws the plan block again (its drawn code changes, so its cache entry misses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [want, looks, drawnOf],
  );
  // The run overlay reads pictures by the image's file id (a sharpened variant maps back to its base picture).
  const pictureOf = useCallback((fileId: string) => sizes.current.get(baseFileId(fileId)), []);
  const wrap = useRef<HTMLDivElement>(null);
  // In the 둘 다 view the canvas sits in the split's right pane (#976): it fits content with a 48px margin.
  const inSplit = () => !!wrap.current?.closest('[data-split-canvas]');
  const blocksRef = useRef(blocks);
  const canvasRef = useRef(canvas);
  const onChangeRef = useRef(onChange);
  blocksRef.current = blocks;
  canvasRef.current = canvas;
  onChangeRef.current = onChange;
  const sigRef = useRef<string | null>(null);
  // Blocks removed by deleting their image, kept so undo can bring them back.
  const graveyard = useRef(new Map<string, Block>());
  // Block id → the one image element that shows it; other images with that block id are copies.
  const owners = useRef(new Map<string, string>());
  // Block id → layout text last seen on its image's customData; a block takes the image's layout only when that changes (an undo).
  const seenLayouts = useRef(new Map<string, string>());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  apiRef.current = api;
  const pathRef = useRef(path);
  pathRef.current = path;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusDone = useRef(0);

  // Layout edit mode (design §5): the one selected block, its session (opened ahead, so a press can enter at once),
  // the block being edited and where its layout sits on screen.
  const [selBlock, setSelBlock] = useState<string | null>(null);
  const [sess, setSess] = useState<Sess | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [frame, setFrame] = useState<LayoutFrame | null>(null);
  // Why the selected block cannot be laid out by hand, shown after a try.
  const [notice, setNotice] = useState<{ blockId: string; text: string } | null>(null);
  const selRef = useRef(selBlock);
  selRef.current = selBlock;
  const sessRef = useRef(sess);
  sessRef.current = sess;
  const editRef = useRef<Edit | null>(null);
  const startN = useRef(0);
  // Opacity the edited block image had before it was hidden under the overlay.
  const hiddenOpacity = useRef(100);

  // "기능 코드" panel (docs/design/code-linked-nodes.md §3): the node or shape whose code it shows.
  const [codeTarget, setCodeTarget] = useState<CodeTarget | null>(null);
  const codeTargetRef = useRef(codeTarget);
  const blockPanelRef = useRef(false);
  codeTargetRef.current = codeTarget;
  const [infoOf] = useState(codeInfoCache);
  const codeOf = useCallback(
    (blockId: string) => {
      const b = blocksRef.current.find((x) => x.id === blockId);
      return b ? infoOf(b) : undefined;
    },
    [infoOf],
  );
  // Badges are placed again when any block's code or code refs change (not on a move).
  const codeSeen = useRef<{ list: readonly unknown[]; n: number }>({ list: [], n: 0 });
  {
    const list = blocks.flatMap((b) => [b.id, b.code, b.codeRefs]);
    const old = codeSeen.current.list;
    if (list.length !== old.length || list.some((x, i) => x !== old[i])) codeSeen.current = { list, n: codeSeen.current.n + 1 };
  }
  const codeVersion = codeSeen.current.n;
  // Selection (and edit mode) last seen by handleChange: the panel follows only changes of it.
  const selSeen = useRef('');

  const imageOf = (els: readonly ExcalidrawElement[], blockId: string) => els.find((e) => !e.isDeleted && blockIdOf(e as unknown as SceneEl) === blockId) as ExcalidrawImageElement | undefined;

  /** Where the block's layout lands in the wrapper, from its image and the view; null while its picture is not current. */
  const frameOf = useCallback((img: ExcalidrawImageElement, st: AppState, b: Block): LayoutFrame | null => {
    const pic = sizes.current.get(baseFileId(img.fileId ?? ''));
    const el = wrap.current;
    if (!pic || !el) return null;
    const d = drawnBlock(b, lookRef.current);
    let origin = pic.anchor && pic.anchor.key === hash(`${shownTheme.current}\n${d.type}\n${d.code}`) ? pic.anchor : null;
    // A picture drawn with its layout left out (§4.2) has no anchor, but it is what the session composes for that layout.
    const s = ready(sessRef.current, d);
    if (!pic.anchor && pic.layoutReset && s) origin = { key: '', ...(s.compose(b.layout).scene.origin ?? { x: 0, y: 0 }) };
    if (!origin) return null;
    const r = el.getBoundingClientRect();
    return layoutFrame(img, { width: pic.width, origin }, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetX: st.offsetLeft - r.left, offsetY: st.offsetTop - r.top });
  }, []);

  const sameFrame = (a: LayoutFrame | null, b: LayoutFrame | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.k === b.k);

  /** Place the overlay again from the edited block's image and picture (both can change without a scene change). */
  const refreshFrame = useCallback(() => {
    const ed = editRef.current;
    const xapi = apiRef.current;
    const b = ed && blocksRef.current.find((x) => x.id === ed.blockId);
    if (!xapi || !ed || !b) return;
    const img = imageOf(xapi.getSceneElements(), ed.blockId);
    const f = img ? frameOf(img, xapi.getAppState(), b) : null;
    setFrame((old) => (sameFrame(old, f) ? old : f));
  }, [frameOf]);

  /** Leave layout edit mode: show the image again, and select it unless the press that ended the mode selects something. */
  const exitEdit = useCallback((reselect: boolean) => {
    const ed = editRef.current;
    if (!ed) return;
    editRef.current = null;
    setEdit(null);
    setFrame(null);
    const xapi = apiRef.current;
    if (!xapi) return;
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, ed.blockId);
    if (!img) return;
    xapi.updateScene({
      elements: els.map((e) => (e === img && e.opacity === 0 ? newElementWith(img, { opacity: hiddenOpacity.current }) : e)),
      ...(reselect ? { appState: { selectedElementIds: { [img.id]: true } } } : {}),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  /** Enter layout edit mode for a block: tidy its layout first (§4.3), hide its image under the overlay. */
  const enterEdit = useCallback(
    (blockId: string, start: EditStart | null) => {
      const xapi = apiRef.current;
      const b = blocksRef.current.find((x) => x.id === blockId);
      if (!xapi || !b) return;
      const els = xapi.getSceneElementsIncludingDeleted();
      const img = imageOf(els, blockId);
      if (!img) return;
      const pruned = prunedLayout(b);
      hiddenOpacity.current = img.opacity || 100;
      // The tidy-up goes through the image like any layout change, so block and image agree; it is not an undo step.
      const patch = pruned ? { opacity: 0, customData: withLayout(img.customData, pruned.layout) } : { opacity: 0 };
      editRef.current = { blockId, start };
      setEdit(editRef.current);
      setNotice(null);
      setFrame(frameOf(img, xapi.getAppState(), b));
      xapi.updateScene({ elements: els.map((e) => (e === img ? newElementWith(img, patch) : e)), appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    },
    [frameOf],
  );

  /** Store a block's layout on its image; `IMMEDIATELY` makes it one undo step (design §5.6). */
  const writeLayout = useCallback((blockId: string, layout: BlockLayout | undefined) => {
    const xapi = apiRef.current;
    if (!xapi) return;
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, blockId);
    if (!img) return;
    xapi.updateScene({ elements: els.map((e) => (e === img ? newElementWith(img, { customData: withLayout(img.customData, layout) }) : e)), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }, []);

  const resetLayout = useCallback(
    (blockId: string) => {
      if (blocksRef.current.find((b) => b.id === blockId)?.layout) writeLayout(blockId, undefined);
    },
    [writeLayout],
  );

  /** Palette `레이아웃 편집`: enter for the selected block, or say why not. */
  const tryEdit = useCallback(async () => {
    if (editRef.current) return exitEdit(true);
    const xapi = apiRef.current;
    const id = selRef.current;
    const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
    if (!xapi || !id || !b) return;
    const img = imageOf(xapi.getSceneElements(), id);
    const why = (img && imageReason(img)) ?? null;
    const s = why ? null : await openLayoutSession(drawnOf(b));
    const reason = why ?? (s && 'reason' in s ? s.reason : null);
    if (reason) return setNotice({ blockId: id, text: reason });
    if (selRef.current === id) enterEdit(id, null);
  }, [enterEdit, exitEdit]);

  /** Palette and bar `자유 도형으로 바꾸기`: replace the selected graph block with plain shapes, as one undo step (#38). */
  const toFreeform = useCallback(async () => {
    if (editRef.current) exitEdit(false);
    const xapi = apiRef.current;
    const id = selRef.current;
    const b = id ? blocksRef.current.find((x) => x.id === id) : undefined;
    if (!xapi || !id || !b) return;
    const first = imageOf(xapi.getSceneElements(), id);
    const why = first && imageReason(first, 'freeform');
    if (why) return setNotice({ blockId: id, text: why });
    const s = await openLayoutSession(drawnOf(b), 'freeform');
    if ('reason' in s) return setNotice({ blockId: id, text: s.reason });
    const els = xapi.getSceneElementsIncludingDeleted();
    const img = imageOf(els, id);
    if (!img) return;
    // Checked again: the image may have been rotated or cropped while the session was opening.
    const late = imageReason(img, 'freeform');
    if (late) return setNotice({ blockId: id, text: late });
    const { scene } = s.compose(b.layout);
    // Code references (block JSON plus the DSL `code:` attribute) travel to the shapes.
    const children = diagramChildren(parse(b.code, b.type === 'bpmn' ? 'bpmn' : undefined).ast);
    const codeRefs = mergeCodeRefs(b.codeRefs, children ? dslCodeRefs(children) : undefined);
    const { skeletons, bindings } = sceneToFreeform(scene, { x: img.x, y: img.y, width: img.width, height: img.height }, () => Math.random().toString(36).slice(2, 12), codeRefs);
    const converted = convertToExcalidrawElements(skeletons as never, { regenerateIds: false }) as unknown as ExcalidrawElement[];
    // A block inside a frame leaves its shapes in that frame.
    const frameId = frameFor(img, els);
    const inFrame = frameId ? converted.map((e) => ({ ...e, frameId })) : converted;
    const made = bindArrows(inFrame, bindings);
    xapi.updateScene({
      // The shapes take the image's place in the stacking order (inside its frame, if any).
      elements: els.flatMap((e) => (e === img ? [newElementWith(img, { isDeleted: true }), ...made] : [e])),
      // Nothing stays selected (#971): selecting every new shape drew a square selection outline over each rounded box
      // and arrow (it read as double borders) and opened Excalidraw's style panel, which shows only on a selection.
      appState: { selectedElementIds: {}, selectedGroupIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    focusCanvas(wrap.current);
  }, [exitEdit]);

  // Show the requested block once its image is on the canvas (a new block's image arrives after its picture is drawn).
  const tryFocus = useCallback(() => {
    const f = focusRef.current;
    const xapi = apiRef.current;
    if (!f || !xapi || focusDone.current === f.n) return;
    const el = xapi.getSceneElements().find((e) => (f.frameId ? e.id === f.frameId && !e.isDeleted : blockIdOf(e as unknown as SceneEl) === f.blockId));
    if (!el) return;
    focusDone.current = f.n;
    xapi.updateScene({ appState: { selectedElementIds: { [el.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
    xapi.scrollToContent(el, { fitToViewport: true, viewportZoomFactor: 0.7, animate: true });
    // Move focus to the canvas, so Enter opens the block's code right away.
    wrap.current?.querySelector<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
  }, []);
  useEffect(tryFocus, [api, focus, tryFocus]);

  const { refitNowOrLater, refitWaiting } = useFontRefit(api, apiRef);

  // Built once per mount (CanvasPane remounts on file switch/reload).
  const initialData = useMemo(
    () => async () => {
      const pics = await draw(blocks);
      for (const p of pics) sizes.current.set(p.fileId, p);
      for (const b of blocks) seenLayouts.current.set(b.id, layoutSig(b.layout));
      // Shapes saved hand-drawn (older builds, the insert menu before E58) open clean. Versions stay as saved, so
      // opening alone writes nothing: the clean style reaches the disk with the user's next edit.
      const tidy = cleanElements(canvas.elements as ExcalidrawElement[]);
      // Texts that changed font are measured in it; versions stay, so their new size is saved with that edit too.
      // Before the font has loaded they would be measured with a fallback (and could grow their shape for good):
      // they wait for it instead (refitPending).
      const restored = restoreElements(tidy.elements as ExcalidrawElement[], null);
      // Texts saved in the old font (id 9 was Liberation Sans) are measured in Pretendard too, so none overflows.
      const free = refitNowOrLater(restored, [...new Set([...tidy.refit, ...pretendardRefitIds(restored)])], false) as typeof restored;
      sigRef.current = freeSignature(free);
      // A block goes back into the frame it was saved in, if that frame is still there (#83).
      const placed = placeBlocks(liveFrames(blocks, free as unknown as SceneEl[]), pics, liveRects(free));
      const images = restoreElements(
        placed.map((b, i) => blockImageSkeleton(b, pics[i].fileId, newElId(b.id)) as unknown as ExcalidrawElement),
        null,
      );
      const elements = [...free, ...images];
      // First open fits everything (at most 100%); a view the user left the file at is kept (E494).
      const live = elements.filter((e) => !e.isDeleted);
      const box = wrap.current?.getBoundingClientRect();
      // A reload while an agent writes follows the block it added or redrew (#1043).
      const hit = changedBlock(path, blocks.map((b, i) => ({ id: b.id, width: pics[i]!.width, height: pics[i]!.height })));
      const hitEl = hit ? live.find((e) => blockIdOf(e as unknown as SceneEl) === hit) : undefined;
      const view = openingView(path, live.length ? getCommonBounds(live) : null, box?.width ?? 0, box?.height ?? 0, fitFor(live, inSplit() ? PANE_FIT : undefined), hitEl ? getCommonBounds([hitEl]) : null);
      const files = Object.fromEntries(pics.map((p) => [p.fileId, fileData(p)]));
      if (!view) return { elements, files, appState: CLEAN_APP_STATE, scrollToContent: true };
      return { elements, files, appState: { ...CLEAN_APP_STATE, scrollX: view.scrollX, scrollY: view.scrollY, zoom: { value: view.zoom as NormalizedZoomValue } } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // An animation ended: the image gets its own opacity back and the overlay goes away.
  const endMorph = useCallback(
    (blockId: string) => {
      setMorphs((m) => {
        if (!m.has(blockId)) return m;
        const n = new Map(m);
        n.delete(blockId);
        return n;
      });
      const orig = morphOpacity.current.get(blockId);
      morphOpacity.current.delete(blockId);
      const xapi = apiRef.current;
      if (orig === undefined || !xapi) return;
      const next = endMorphOpacity(xapi.getSceneElementsIncludingDeleted() as unknown as PlaceEl[], blockId, orig, (e, opacity) => newElementWith(e as unknown as ExcalidrawElement, { opacity }) as unknown as PlaceEl);
      if (next) xapi.updateScene({ elements: next as unknown as ExcalidrawElement[], captureUpdate: CaptureUpdateAction.NEVER });
    },
    [],
  );

  // What the images depend on: which blocks exist and their type and code, not where they sit. Dragging a
  // block changes `blocks` on every frame; `drawn` keeps its identity then, so nothing below runs.
  const drawnRef = useRef(blocks);
  if (!sameDrawing(drawnRef.current, blocks)) drawnRef.current = blocks;
  const drawn = drawnRef.current;

  // Keep block images in step with the block list: new code → new picture, new block → new image, removed block → gone.
  useEffect(() => {
    if (!api) return;
    let live = true;
    const blocks = blocksRef.current;
    void draw(blocks).then((pics) => {
      if (!live) return;
      setBroken(pics.flatMap((p, i) => (p.errors > 0 || p.failed ? [{ id: blocks[i]!.id, type: blocks[i]!.type, errors: p.errors, lastGood: p.lastGood, failed: p.failed }] : [])));
      setResets(new Set(pics.flatMap((p, i) => (p.layoutReset ? [blocks[i]!.id] : []))));
      for (const p of pics) sizes.current.set(p.fileId, p);
      const files = api.getFiles();
      const add = pics.filter((p) => !files[p.fileId]).map((p) => fileData(p));
      if (add.length) api.addFiles(add);
      const els = api.getSceneElementsIncludingDeleted();
      const index = new Map(blocks.map((b, i) => [b.id, i]));
      const shown = new Set<string>();
      const morphs2 = new Map<string, { from: Scene; fileId: string }>();
      let changed = false;
      const next: ExcalidrawElement[] = els.map((el) => {
        const bid = blockIdOf(el as unknown as SceneEl);
        if (bid === null || el.isDeleted) return el;
        const i = index.get(bid);
        if (i === undefined || shown.has(bid)) {
          changed = true;
          return newElementWith(el, { isDeleted: true });
        }
        shown.add(bid);
        const p = pics[i];
        const img = el as ExcalidrawImageElement;
        // The image carries the block's layout, so undo of a layout edit comes back through it (design §5.6).
        const want = blocks[i]!.layout;
        const layoutStale = layoutSig(img.customData?.layout as never) !== layoutSig(want);
        if (baseFileId(img.fileId ?? '') === p.fileId && !layoutStale) return el;
        changed = true;
        const { layout: _old, ...rest } = img.customData ?? {};
        const customData = want ? { ...rest, layout: want } : rest;
        seenLayouts.current.set(bid, layoutSig(want));
        if (baseFileId(img.fileId ?? '') === p.fileId) return newElementWith(img, { customData });
        // Keep the zoom the block was shown at, so a bigger diagram takes more room instead of shrinking.
        const old = sizes.current.get(baseFileId(img.fileId ?? ''));
        const scale = old && old.width > 0 ? img.width / old.width : 1;
        // When only the layout changed, its origin stays where it was on screen, so moving a node left does not push
        // the whole block right. Code edits, resets and error pictures leave the block where it is.
        const at = shiftForOrigin(img, old, p);
        // A code change animates (the overlay shows old → new); a layout drag, a reset or a theme switch swaps at once.
        // Only where the overlay can be placed (not rotated or hidden), and never on the block in layout edit (#556).
        const animate =
          !layoutStale && canPlace(img as unknown as PlaceEl) && editRef.current?.blockId !== bid && old?.scene && p.scene && willMorph(old.scene, p.scene, darkRef.current);
        let opacity: number | undefined;
        if (animate) {
          if (!morphOpacity.current.has(bid)) morphOpacity.current.set(bid, img.opacity);
          morphs2.set(bid, { from: old!.scene!, fileId: p.fileId });
          opacity = MORPH_OPACITY;
        }
        return newElementWith(img, { fileId: p.fileId as FileId, width: p.width * scale, height: p.height * scale, ...at, customData, ...(opacity !== undefined ? { opacity } : {}) });
      });
      const missing = blocks.filter((b) => !shown.has(b.id));
      if (missing.length) {
        changed = true;
        const mpics = missing.map((b) => pics[index.get(b.id)!]!);
        const skeletons = placeBlocks(liveFrames(missing, next as unknown as SceneEl[]), mpics, liveRects(next)).map(
          (b, i) => blockImageSkeleton(b, mpics[i]!.fileId, newElId(b.id)) as unknown as ExcalidrawElement,
        );
        next.push(...restoreElements(skeletons, null));
      }
      if (morphs2.size) setMorphs((m) => new Map([...m, ...morphs2]));
      if (changed) api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
      // A block added or redrawn at another size (an agent writing) comes into view at a readable zoom, unless the
      // user has moved the view (#1043).
      const hit = changedBlock(pathRef.current, blocks.map((b, i) => ({ id: b.id, width: pics[i]!.width, height: pics[i]!.height })));
      const box = wrap.current?.getBoundingClientRect();
      if (changed && hit && box) {
        const live = api.getSceneElements().filter((e) => !e.isDeleted);
        const hitEl = live.find((e) => blockIdOf(e as unknown as SceneEl) === hit);
        const st = api.getAppState();
        const fit = followView(pathRef.current, live.length ? getCommonBounds(live) : null, hitEl ? getCommonBounds([hitEl]) : null, box.width, box.height, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value }, fitFor(live, inSplit() ? PANE_FIT : undefined));
        if (fit) api.updateScene({ appState: { scrollX: fit.scrollX, scrollY: fit.scrollY, zoom: { value: fit.zoom as NormalizedZoomValue } }, captureUpdate: CaptureUpdateAction.NEVER });
      }
      // A comment edit keeps the same picture (no scene change) but gives it a new anchor: the overlay needs it.
      else refreshFrame();
      tryFocus();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, drawn, draw, tryFocus, refreshFrame]);

  const sharpenFor = useSharpen(apiRef, sizes);

  // The pane's size changed (divider dragged, window resized): fit again, unless the user has zoomed or panned.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !api || typeof ResizeObserver === 'undefined' || !el.closest('[data-split-canvas]')) return;
    let raf = 0;
    // The observer also reports the size it starts at: that is no resize, and refitting then would undo the opening
    // view (a reload that follows the block an agent changed, #1043).
    const start = el.getBoundingClientRect();
    let size = `${start.width}x${start.height}`;
    const run = () => {
      raf = 0;
      const box = el.getBoundingClientRect();
      if (`${box.width}x${box.height}` === size) return;
      size = `${box.width}x${box.height}`;
      const live = api.getSceneElements().filter((e) => !e.isDeleted);
      if (!live.length) return;
      const st = api.getAppState();
      const next = refitView(pathRef.current, getCommonBounds(live), box.width, box.height, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value }, fitFor(live, PANE_FIT));
      if (next) api.updateScene({ appState: { scrollX: next.scrollX, scrollY: next.scrollY, zoom: { value: next.zoom as NormalizedZoomValue } }, captureUpdate: CaptureUpdateAction.NEVER });
    };
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(run);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [api]);

  const handleChange = useCallback((sceneEls: readonly ExcalidrawElement[], appState: AppState) => {
    // The view is kept for the file's next open; not while the scene is still loading (Excalidraw's default view).
    if (!appState.isLoading) rememberView(pathRef.current, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value });
    const sel = sceneEls.filter((e) => appState.selectedElementIds[e.id] && !e.isDeleted);
    const view = `${appState.zoom.value}|${sceneEls.map((e) => (e.type === 'image' && !e.isDeleted && blockIdOf(e as unknown as SceneEl) !== null ? `${e.id}:${(e as ExcalidrawImageElement).fileId}:${Math.round(e.width)}` : '')).join('')}`;
    sharpenFor(view);
    // Only the idle case (selection tool, nothing selected, no box drag) shows that hint; other hints (arrow, erase) stay.
    // Text editing and an active search keep their own hints (type text, Escape closes search).
    const searching = appState.openSidebar?.name === 'default' && appState.openSidebar.tab === 'search' && !!appState.searchMatches?.length;
    setHidePanHint(appState.activeTool.type === 'selection' && sel.length === 0 && !appState.selectionElement && !appState.editingTextElement && !searching && sceneEls.some((e) => !e.isDeleted));
    setBlockSelected(sel.length > 0 && sel.every((e) => blockIdOf(e as unknown as SceneEl) !== null));
    setSelBlock(sel.length === 1 ? blockIdOf(sel[0] as unknown as SceneEl) : null);
    const selSig = `${sel.map((e) => e.id).sort().join(',')}|${editRef.current?.blockId ?? ''}`;
    if (selSig !== selSeen.current) {
      selSeen.current = selSig;
      const view = { ids: sel.map((e) => e.id), editing: editRef.current?.blockId ?? null };
      setCodeTarget((prev) => targetAfterSelection(prev, view, sceneEls as unknown as readonly CodeEl[]));
    }
    const ed = editRef.current;
    if (ed) {
      // While editing, the overlay follows zoom, pan and the block image; a deleted image (undo, another tab) ends it.
      const img = imageOf(sceneEls, ed.blockId);
      const b = blocksRef.current.find((x) => x.id === ed.blockId);
      if (!img || !b) exitEdit(false);
      else {
        const f = frameOf(img, appState, b);
        setFrame((old) => (sameFrame(old, f) ? old : f));
      }
    }
    let elements = sceneEls;
    let cur = blocksRef.current;
    // Texts that waited for the clean font while the scene was still empty are measured once they are in (#305).
    if (apiRef.current) {
      const late = refitWaiting(elements);
      if (late?.changed) {
        elements = late.elements;
        apiRef.current.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      }
    }
    // Hand-drawn shapes that come in by paste, the library or copied styles are made clean on the spot.
    const tidy = cleanElements(elements, (e, patch) => newElementWith(e, patch as Partial<ExcalidrawElement>));
    if (tidy.changed && apiRef.current) {
      // Only the texts that changed font are measured again (#270).
      elements = refitNowOrLater(tidy.elements, tidy.refit, true);
      apiRef.current.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
    }
    // A copied block image (duplicate, paste, alt-drag) becomes a new block with the same code.
    const copies = findCopies(elements as unknown as readonly SceneEl[], owners.current);
    const xapi = apiRef.current;
    if (copies.length && xapi) {
      const retag = new Map<string, string>();
      const added: Block[] = [];
      for (const c of copies) {
        const src = cur.find((b) => b.id === c.blockId);
        if (!src) continue;
        const id = newBlockId();
        retag.set(c.id, id);
        owners.current.set(id, c.id);
        // Geometry comes from the image below (applyScene).
        added.push({ ...src, id });
      }
      if (retag.size) {
        elements = elements.map((e) => (retag.has(e.id) ? newElementWith(e, { customData: { ...e.customData, blockId: retag.get(e.id)! } }) : e));
        cur = [...cur, ...added];
        xapi.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      }
    }
    const split = splitScene(elements as unknown as readonly SceneEl[]);
    for (const b of cur) if (split.deleted.has(b.id)) graveyard.current.set(b.id, b);
    // A deleted image's layout is not "seen" any more: if undo brings the image back, the block takes its layout again.
    for (const id of split.deleted) seenLayouts.current.delete(id);
    let next = applyScene(cur, split, layoutsFromImages(split.layouts, seenLayouts.current));
    // An image came back (undo) for a block that was deleted on the canvas.
    const back = [...split.geometry.keys()].filter((id) => !cur.some((b) => b.id === id) && graveyard.current.has(id));
    if (back.length) {
      next = [
        ...next,
        ...back.map((id) => {
          const g = split.geometry.get(id)!;
          const old = graveyard.current.get(id)!;
          graveyard.current.delete(id);
          const { frameId: _old, ...rest } = old;
          const f = split.frames.get(id);
          return { ...rest, x: g.x, y: g.y, w: g.w, h: g.h, ...(f ? { frameId: f } : {}) };
        }),
      ];
    }
    const sig = freeSignature(split.free);
    const patch: { canvas?: CanvasData; blocks?: Block[] } = {};
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      patch.canvas = { ...canvasRef.current, elements: split.free as unknown[] };
    }
    if (next !== blocksRef.current) patch.blocks = [...next];
    if (patch.canvas || patch.blocks) onChangeRef.current(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the code panel from anywhere but a text field. Added at mount, so it runs before the layout overlay's
  // own Escape (which stops the event) and one press both closes the panel and leaves edit mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || !codeTargetRef.current) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      // The "다이어그램 코드" panel is on top and the code panel is hidden behind it: leave Esc to that panel.
      if (blockPanelRef.current) return;
      // Esc belongs to the topmost layer: an open menu, list or popover closes first. Only open layers count: Excalidraw's
      // own menus, an open native popover, or a menu/list that holds focus (so a persistent list elsewhere never blocks Esc).
      if (document.querySelector('.excalidraw [role="menu"], .excalidraw [role="listbox"], .excalidraw .dropdown-menu, .excalidraw .popover, [popover]:popover-open')) return;
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="listbox"]')) return;
      setCodeTarget(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** A `</>` badge was clicked: show that code and select its block image or shape, so the click target is clear. */
  const openCode = useCallback(
    (t: CodeTarget) => {
      const xapi = apiRef.current;
      if (!xapi) return;
      if (editRef.current && !(t.kind === 'node' && t.blockId === editRef.current.blockId)) exitEdit(false);
      const el = t.kind === 'node' ? imageOf(xapi.getSceneElements(), t.blockId) : xapi.getSceneElements().find((e) => e.id === t.id && !e.isDeleted);
      setCodeTarget(t);
      if (el) xapi.updateScene({ appState: { selectedElementIds: { [el.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exitEdit],
  );

  // Double-click on a diagram block opens its code instead of Excalidraw's image crop.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !api) return;
    const onDbl = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      const { x, y } = viewportCoordsToSceneCoords(e, api.getAppState());
      const hit = [...api.getSceneElements()]
        .reverse()
        .find((s) => blockIdOf(s as unknown as SceneEl) !== null && x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height);
      if (!hit) return;
      e.stopPropagation();
      e.preventDefault();
      setEditing(blockIdOf(hit as unknown as SceneEl));
    };
    // Enter on a selected block opens its code too (Excalidraw would start cropping).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || !(e.target instanceof HTMLElement) || e.target.closest('aside, input, textarea, [contenteditable]')) return;
      const st = api.getAppState();
      const sel = api.getSceneElements().filter((s) => st.selectedElementIds[s.id]);
      if (sel.length !== 1) return;
      const bid = blockIdOf(sel[0] as unknown as SceneEl);
      if (bid === null) return;
      e.stopPropagation();
      e.preventDefault();
      setEditing(bid);
    };
    // Layout edit mode (design §5.2): pressing a node of the one selected block enters it and goes on as a drag; any
    // other press on the canvas while editing leaves it (and does what it would do anyway).
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('[data-layout-edit]'))) return;
      if (!(e.target instanceof HTMLCanvasElement)) return;
      if (editRef.current) return exitEdit(false);
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const st = api.getAppState();
      if (st.activeTool.type !== 'selection') return;
      const sel = api.getSceneElements().filter((s) => st.selectedElementIds[s.id]);
      const img = sel.length === 1 ? (sel[0] as ExcalidrawImageElement) : null;
      const bid = img && blockIdOf(img as unknown as SceneEl);
      const b = bid ? blocksRef.current.find((x) => x.id === bid) : undefined;
      if (!img || !bid || !b) return;
      const { x, y } = viewportCoordsToSceneCoords(e, st);
      if (x < img.x || x > img.x + img.width || y < img.y || y > img.y + img.height) return;
      // No session (still being made, or a block that cannot be laid out: sequence, ERD, an error): this press moves
      // the block, like before, and says nothing; the palette's try is where the reason shows.
      const ls = ready(sessRef.current, drawnOf(b));
      const f = ls && frameOf(img, st, b);
      if (!ls || !f) return;
      const scene = ls.compose(b.layout).scene;
      const r = el.getBoundingClientRect();
      const hit = hitHandle(layoutHandles(scene.handles, scene.origin), toLayout(f, { x: e.clientX - r.left, y: e.clientY - r.top }));
      if (!hit) return;
      // A node was hit, but a locked or turned image cannot be edited: say why instead of entering.
      const why = imageReason(img);
      if (why) return setNotice({ blockId: bid, text: why });
      e.stopPropagation();
      e.preventDefault();
      enterEdit(bid, { id: hit.id, clientX: e.clientX, clientY: e.clientY, shift: false, n: ++startN.current });
    };
    // A press outside the canvas (sidebar, top bar, document) leaves edit mode too; a modal (the palette) does not.
    const onOutside = (e: PointerEvent) => {
      if (!editRef.current || !(e.target instanceof Node) || el.contains(e.target)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      exitEdit(true);
    };
    el.addEventListener('dblclick', onDbl, true);
    el.addEventListener('keydown', onKey, true);
    el.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      el.removeEventListener('dblclick', onDbl, true);
      el.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onDown, true);
    };
  }, [api, enterEdit, exitEdit, frameOf]);

  // The session for the selected (or edited) block, opened ahead and again whenever its code changes.
  const sessId = edit?.blockId ?? selBlock;
  const sessFound = sessId ? blocks.find((b) => b.id === sessId) : undefined;
  const sessBlock = sessFound && drawnBlock(sessFound, look);
  const sessFor = sessBlock ? sessionKey(sessBlock) : null;
  useEffect(() => {
    const b = sessBlock;
    if (!b) return setSess(null);
    let live = true;
    void openLayoutSession(b).then((s) => live && setSess({ blockId: b.id, key: sessionKey(b), s }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessId, sessFor]);

  // Edit mode ends when its block goes away or its code can no longer be laid out by hand (an error, another kind).
  // While that block's code panel is open an error is judged later: typing passes through broken code, so the last
  // picture stays (not editable) and the verdict comes when the panel closes.
  const editFound = edit ? blocks.find((b) => b.id === edit.blockId) : undefined;
  const editBlock = useMemo(() => editFound && drawnBlock(editFound, look), [editFound, look]);
  const editSess = ready(sess, editBlock);
  useEffect(() => {
    if (!edit) return;
    if (!editBlock) return exitEdit(false);
    if (sess && sess.blockId === edit.blockId && sess.key === sessionKey(editBlock) && 'reason' in sess.s) {
      if (editing === edit.blockId) return;
      setNotice({ blockId: edit.blockId, text: sess.s.reason });
      exitEdit(true);
    }
  }, [edit, editBlock, sess, exitEdit, editing]);
  // While the code changes, the new session and picture come a moment later; the overlay keeps the last picture it
  // placed (not editable) instead of leaving the hidden block blank.
  const lastShown = useRef<{ blockId: string; sess: LayoutSession; frame: LayoutFrame } | null>(null);
  if (!edit) lastShown.current = null;
  else if (editSess && frame) lastShown.current = { blockId: edit.blockId, sess: editSess, frame };
  const kept = edit && !(editSess && frame) && lastShown.current?.blockId === edit.blockId ? lastShown.current : null;
  const overlaySess = editSess && frame ? editSess : kept?.sess;
  const overlayFrame = editSess && frame ? frame : kept?.frame;
  // A fresh session (or the first one) can place a picture whose layout was left out; place the overlay again.
  useEffect(refreshFrame, [api, editSess, refreshFrame]);
  // A notice belongs to one try; it goes when another block is selected, or after a while.
  useEffect(() => {
    if (!notice) return;
    if (selBlock && selBlock !== notice.blockId) return setNotice(null);
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, selBlock]);

  // Wheel over the overlay goes to Excalidraw's canvas: it zooms at the pointer (tracked on document) and pans.
  const forwardWheel = useCallback((e: WheelEvent) => {
    const c = wrap.current?.querySelector('canvas.interactive') ?? wrap.current?.querySelector('.excalidraw canvas');
    c?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  useCanvasHandle(api, handle, { wrap, shownTheme, sizes, blocksRef, editRef, selRef, drawnOf }, { tryEdit, toFreeform, resetLayout });

  const block = editing ? blocks.find((b) => b.id === editing) : undefined;
  blockPanelRef.current = !!block;
  useEffect(() => {
    if (editing && !block) setEditing(null);
  }, [editing, block]);
  // Closing the code panel (or opening another block's) tidies the layout of the block it showed (design §4.3).
  const prevEditing = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevEditing.current;
    prevEditing.current = editing;
    if (!prev || prev === editing) return;
    const b = blocksRef.current.find((x) => x.id === prev);
    const pruned = b && prunedLayout(b);
    if (pruned) onChangeRef.current({ blocks: blocksRef.current.map((x) => (x.id === prev ? pruned : x)) });
  }, [editing]);
  // What the code panel shows; nothing when its node or shape is gone (a rename, an undo).
  const editCodeNodes = useMemo(() => {
    const info = edit ? codeOf(edit.blockId) : undefined;
    return info ? new Set(Object.keys(info.nodes)) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, codeOf, codeVersion]);
  let codeView: { label: string; code: NodeCode; orphans: number; clean?: () => void } | null = null;
  if (codeTarget?.kind === 'node') {
    const b = blocks.find((x) => x.id === codeTarget.blockId);
    const info = b && infoOf(b);
    if (b && info && Object.hasOwn(info.nodes, codeTarget.node)) {
      codeView = {
        label: info.labels[codeTarget.node] ?? codeTarget.node,
        code: info.nodes[codeTarget.node]!,
        orphans: info.orphans.length,
        clean: async () => {
          if (!(await askConfirm({ title: `연결이 끊긴 코드 ${info.orphans.length}개를 지울까요?`, ok: '지우기', danger: true }))) return;
          onChangeRef.current({
            blocks: blocksRef.current.map((x) => {
              if (x.id !== b.id) return x;
              const { codeRefs: _old, ...rest } = x;
              const kept = withoutOrphans(x.codeRefs, info.orphans);
              return kept ? { ...rest, codeRefs: kept } : rest;
            }),
          });
        },
      };
    }
  } else if (codeTarget?.kind === 'shape' && api) {
    const els = api.getSceneElements() as unknown as readonly CodeEl[];
    const el = els.find((e) => e.id === codeTarget.id && !e.isDeleted);
    const code = shapeCode(el);
    if (el && code) codeView = { label: shapeLabel(els, el), code, orphans: 0 };
  }
  useEffect(() => {
    if (codeTarget && !codeView) setCodeTarget(null);
  });
  const patchBlock = (p: Partial<Block>) => onChangeRef.current({ blocks: blocksRef.current.map((b) => (b.id === editing ? { ...b, ...p } : b)) });

  return (
    <div ref={wrap} className={`relative h-full w-full${blockSelected ? ' block-selected' : ''}${hidePanHint ? ' hide-pan-hint' : ''}${!block && codeTarget?.kind === 'node' && codeView ? ' code-panel-open' : ''}`} data-canvas="excalidraw">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange}
        theme={theme(dark)}
        langCode="ko-KR"
        UIOptions={UI_OPTIONS}
        validateEmbeddable={NO_EMBEDS}
        aiEnabled={false}
      />
      <CanvasInsertMenu
        api={api}
        wrap={wrap}
        onBlock={(b) => {
          onChangeRef.current({ blocks: [...blocksRef.current, b] });
          setEditing(b.id);
        }}
      />
      {api && wrap.current && <MorphOverlay api={api} wrap={wrap.current} morphs={morphs} pictureOf={pictureOf} dark={dark} onDone={endMorph} />}
      {api && wrap.current && <RunOverlay api={api} wrap={wrap.current} pictureOf={pictureOf} hide={edit?.blockId ?? null} />}
      {api && wrap.current && (
        <CodeBadges api={api} wrap={wrap.current} codeOf={codeOf} pictureOf={pictureOf} hide={edit?.blockId ?? null} version={codeVersion} active={codeTarget} onOpen={openCode} />
      )}
      {api && wrap.current && path && <AgentCursors api={api} wrap={wrap.current} file={path} />}
      {edit && editBlock && overlaySess && overlayFrame && wrap.current && (
        <LayoutEditOverlay
          layout={editBlock.layout}
          session={overlaySess}
          frame={overlayFrame}
          stale={!!kept}
          dark={dark}
          wrap={wrap.current}
          start={edit.start}
          onCommit={(l) => writeLayout(edit.blockId, l)}
          onExit={() => exitEdit(true)}
          onOpenCode={() => setEditing(edit.blockId)}
          onWheel={forwardWheel}
          codeNodes={editCodeNodes}
          activeNode={codeTarget?.kind === 'node' && codeTarget.blockId === edit.blockId ? codeTarget.node : null}
          onSelect={(ids) => {
            const info = codeOf(edit.blockId);
            if (info) setCodeTarget((prev) => targetAfterNodes(prev, edit.blockId, ids, info));
          }}
        />
      )}
      <LayoutBar
        editing={!!edit}
        broken={!!(edit && sess && sess.blockId === edit.blockId && 'reason' in sess.s)}
        moved={!!(editBlock ?? (selBlock ? blocks.find((b) => b.id === selBlock) : undefined))?.layout}
        notice={!edit && notice && notice.blockId === selBlock ? notice.text : null}
        convertible={!edit && !!selBlock && isGraphType(blocks.find((b) => b.id === selBlock)?.type)}
        onFreeform={() => void toFreeform()}
        onReset={() => {
          const id = edit?.blockId ?? selBlock;
          if (id) resetLayout(id);
          // The button took focus; Ctrl+Z right after must still reach Excalidraw.
          focusCanvas(wrap.current);
        }}
        onDone={() => {
          exitEdit(true);
          focusCanvas(wrap.current);
        }}
      />
      {broken.length > 0 && !block && (
        <div role="status" aria-label="코드 오류 안내" className="absolute bottom-16 left-3 z-10 flex max-w-[min(26rem,calc(100%-1.5rem))] flex-col gap-1 rounded-lg border bg-background p-2 text-xs shadow">
          {broken.map((b) => (
            <button key={b.id} type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setEditing(b.id)}>
              {brokenNotice(b, blockLabel(b, blocks, DIAGRAM_TYPES.find((t) => t.id === b.type)?.label ?? b.type))}
            </button>
          ))}
        </div>
      )}
      {!block && codeView && (
        <CodePanel
          key={codeTarget?.kind === 'node' ? `${codeTarget.blockId}:${codeTarget.node}` : codeTarget?.kind === 'shape' ? codeTarget.id : ''}
          label={codeView.label}
          code={codeView.code}
          orphans={codeView.orphans}
          onCleanOrphans={codeView.clean}
          onClose={() => {
            setCodeTarget(null);
            focusCanvas(wrap.current);
          }}
        />
      )}
      {block && path && <BlockCodePanel file={path} block={block} dark={dark} reset={resets.has(block.id)} onPatch={patchBlock} onClose={() => setEditing(null)} />}
    </div>
  );
}
