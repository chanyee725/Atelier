// The open file and its saving, outside React. Components subscribe to the slice they draw
// (useSession), so an edit that only moves a block re-renders the canvas and nothing else.
// Saving: edits are debounced, saves run one at a time, retryable failures back off, 409 stops for a choice.
// Outside changes (server SSE events) close or reload the open file through `external`.
import { ApiError, FILE_FORMAT_VERSION, type DpxFile } from './api.ts';
import { externalAction, type WorkspaceEvent } from './externalChange.ts';
import { isRetryableSaveError, RELOAD_STOPPED, saveProblemText } from './saveRetry.ts';
import { migrateDocument } from './doc/model.ts';

export const SAVE_DELAY = 700;
/** Status texts while saving and after a save (the header shows them as a save dot). */
export const SAVING = '저장 중이에요…';
export const SAVED_STATUS = '저장했어요';
export const RETRY_MIN = 1000;
export const RETRY_MAX = 30000;

export type FilePatch = Partial<Pick<DpxFile, 'title' | 'document' | 'blocks' | 'canvas'>>;
export type SessionState = {
  path: string | null;
  file: DpxFile | null;
  /** Bumped on every load from disk so the panes restart from the loaded content. */
  loadSeq: number;
  /** An outside change applied to the open file without a reload (the panes update in place); `seq` counts them. */
  live: { seq: number; document: unknown } | null;
  status: string;
  /** True while the status is a problem (failed save or conflict). */
  statusAlert: boolean;
  /** Set when a save got 409: the server's current revision, so "overwrite" can re-send against it. */
  conflict: { revision?: number } | null;
};

type Deps = {
  saveFile: (path: string, f: DpxFile, keepalive: boolean) => Promise<{ revision: number }>;
  /** After each successful save (the file list shows the new title/revision). */
  onSaved?: () => void;
  /** A save got 404: the file or its folder was removed (another tab) and the SSE event was missed. The file is already closed. */
  onGone?: () => void;
};

export type FileSession = ReturnType<typeof createFileSession>;

export function createFileSession(deps: Deps) {
  let state: SessionState = { path: null, file: null, loadSeq: 0, live: null, status: '', statusAlert: false, conflict: null };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<SessionState>) => {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof SessionState)[]) if (!Object.is(state[k], patch[k])) changed = true;
    if (!changed) return;
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  // dirty: local edits not yet on disk. editSeq tells a finished save whether newer edits arrived meanwhile.
  let dirty = false;
  let editSeq = 0;
  let inFlight = false;
  let retryDelay = 0;
  let conflicted = false;
  // Set when a reload was stopped because the save failed: that notice stays until a save succeeds.
  let reloadStopped = false;
  // An outside-change reload is already running.
  let reloading = false;
  // Path and newest revision of a change event that arrived while `reloading` (null: none). The path is kept because
  // the user may open another file while the old one is still being read (#568).
  let pendingReload: { path: string; revision: number } | null = null;
  // While a move of the open file is in flight, saves wait: a PUT now would go to the old path.
  let holds = 0;

  const setStatus = (status: string, statusAlert = false) => set({ status, statusAlert });
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, ms);
  };

  function save(keepalive = false) {
    // Saves run one at a time so each PUT carries the revision returned by the previous one.
    saving = saving.then(async () => {
      const p = state.path;
      const f = state.file;
      if (!p || !f || !dirty || conflicted || holds > 0) return;
      const seq = editSeq;
      inFlight = true;
      if (!reloadStopped) setStatus(SAVING);
      try {
        const saved = await deps.saveFile(p, f, keepalive);
        if (state.path !== p) return;
        if (state.file) set({ file: { ...state.file, revision: saved.revision } });
        retryDelay = 0;
        if (editSeq === seq) {
          dirty = false;
          reloadStopped = false;
          setStatus(SAVED_STATUS);
        }
        deps.onSaved?.();
      } catch (e) {
        if (state.path !== p) return;
        // A retry or refusal must not hide the notice that the reload was stopped.
        const problem = (text: string) => setStatus(saveProblemText(text, reloadStopped), true);
        if (e instanceof ApiError && e.status === 404) {
          close();
          deps.onGone?.();
        } else if (e instanceof ApiError && e.status === 409) {
          clearTimer();
          conflicted = true;
          set({ conflict: { revision: e.revision } });
          problem('다른 곳에서 바뀌었어요');
        } else if (!isRetryableSaveError(e)) {
          // The server refused this request (4xx); retrying the same body would fail forever.
          // Keep a pending edit timer: a newer edit may already have fixed the body.
          const newer = e instanceof ApiError && e.status === 422 && (state.file?.version ?? 1) > FILE_FORMAT_VERSION;
          problem(newer ? '더 새 버전에서 만든 파일이라 저장하지 않았어요' : '저장하지 못했어요. 내용이나 파일 이름을 확인해 주세요');
        } else {
          retryDelay = Math.min(RETRY_MAX, Math.max(RETRY_MIN, retryDelay * 2));
          problem('저장하지 못했어요. 잠시 뒤 다시 시도할게요');
          // A pending edit timer will save sooner; otherwise back off and retry.
          if (timer === null) schedule(retryDelay);
        }
      } finally {
        inFlight = false;
      }
    });
    return saving;
  }

  // The open file is gone (deleted or moved away): drop it and its pending save, or the timer would write to a path that no longer exists.
  const close = () => {
    clearTimer();
    dirty = false;
    conflicted = false;
    reloadStopped = false;
    set({ conflict: null, path: null, file: null, status: '', statusAlert: false });
  };

  // Once queued saves are done, re-read the open file and hand it to `onReload` if still clean and newer. Then run once
  // more if a change event newer than what we now hold arrived meanwhile.
  const reload = (p: string, read: (p: string) => Promise<DpxFile>, onReload: (p: string, f: DpxFile) => void) => {
    reloading = true;
    pendingReload = null;
    let readRevision = 0;
    void saving
      .then(() => (dirty || state.path !== p ? null : read(p)))
      .then((f) => {
        if (f) readRevision = f.revision;
        if (f && !dirty && state.path === p && f.revision > (state.file?.revision ?? 0)) onReload(p, f);
      })
      .catch(() => {})
      .finally(() => {
        reloading = false;
        const pending = pendingReload;
        pendingReload = null;
        if (pending === null || dirty || inFlight || state.path !== pending.path) return;
        // What this run read only counts when it read the same file.
        const held = Math.max(pending.path === p ? readRevision : 0, state.file?.revision ?? 0);
        if (pending.revision > held) reload(pending.path, read, onReload);
      });
  };

  const flush = async () => {
    clearTimer();
    await save();
  };

  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setStatus,
    /** Local edits not on disk yet. */
    isDirty: () => dirty,
    /** Leaving now would lose something: unsaved edits or a save still running. */
    hasUnsaved: () => dirty || inFlight,
    /** Pause saving (a move of the open file is running); call the returned function to resume. Pending edits then save. */
    hold() {
      holds += 1;
      clearTimer();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0 && dirty && !conflicted) schedule(0);
      };
    },
    /** Resolves once queued saves are done. */
    idle: () => saving,
    save,
    flush,
    /** Save before a lazy-chunk reload. False (and a notice) when edits are still unsaved or in conflict. */
    async flushForReload() {
      await flush();
      if (!dirty && !conflicted) return true;
      reloadStopped = true;
      setStatus(RELOAD_STOPPED, true);
      return false;
    },
    edit(patch: FilePatch) {
      if (!state.file) return;
      set({ file: { ...state.file, ...patch } });
      dirty = true;
      editSeq += 1;
      if (!conflicted && !reloadStopped) setStatus('');
      schedule(SAVE_DELAY);
    },
    load(p: string, f: DpxFile) {
      clearTimer();
      dirty = false;
      retryDelay = 0;
      conflicted = false;
      reloadStopped = false;
      // A file from before the document editor gets its diagrams listed in the document (once: the next save stores the current format version).
      set({ conflict: null, path: p, file: { ...f, document: migrateDocument(f) }, loadSeq: state.loadSeq + 1, live: null, status: '', statusAlert: false });
    },
    /**
     * An outside change of the open, clean file, taken in without a reload: the file is replaced, `loadSeq` stays (the
     * panes keep their zoom, scroll and selection) and `live` tells the document pane what to apply.
     */
    applyLive(p: string, f: DpxFile) {
      if (state.path !== p || dirty) return;
      const file = { ...f, document: migrateDocument(f) };
      set({ file, live: { seq: (state.live?.seq ?? 0) + 1, document: file.document } });
    },
    /** Start the panes over from the current file (a live change could not be applied in place). */
    remount() {
      set({ loadSeq: state.loadSeq + 1 });
    },
    close,
    /** The open file was renamed or moved by this tab: keep its content and pending save, write to the new path from now on. */
    rename(p: string, revision?: number) {
      // The server raises the revision when a file lands on a name that was deleted before, so take the new one.
      if (state.path) set({ path: p, ...(revision !== undefined && state.file ? { file: { ...state.file, revision } } : {}) });
    },
    /**
     * A server `workspace` event (other tabs, outside edits). 'close': the open file was deleted or moved
     * away and has been dropped. 'reload': it changed on disk with nothing unsaved, so once queued saves are
     * done it is re-read and handed to `onReload` if still clean and newer. The caller refreshes the file list.
     */
    external(e: WorkspaceEvent, read: (p: string) => Promise<DpxFile>, onReload: (p: string, f: DpxFile) => void) {
      const act = externalAction(e, state.path, dirty || inFlight);
      if (act === 'close') close();
      else if (act === 'reload') {
        // An event that lands while a reload runs is kept (newest revision only) and read once more afterwards, so a
        // burst of PUTs never leaves the tab on an older revision. An event without a revision always asks again.
        const rev = e.kind === 'change' && typeof e.revision === 'number' ? e.revision : Infinity;
        // A pending event for a file that is no longer open is replaced, not merged.
        const p = state.path!;
        if (reloading) pendingReload = { path: p, revision: pendingReload?.path === p ? Math.max(pendingReload.revision, rev) : rev };
        else reload(p, read, onReload);
      }
      return act;
    },
    /** 409 choice: re-send local edits against the server's revision. */
    async overwrite() {
      await saving;
      const f = state.file;
      const rev = state.conflict?.revision;
      if (!f || rev === undefined) return;
      conflicted = false;
      set({ file: { ...f, revision: rev }, conflict: null });
      dirty = true;
      clearTimer();
      await save();
    },
    /** On pagehide: send pending edits with keepalive. */
    saveOnHide() {
      // Skip when a PUT is already running: it holds the same revision, so a second one would only 409.
      if (!dirty || inFlight || conflicted) return;
      clearTimer();
      void save(true);
    },
  };
}
