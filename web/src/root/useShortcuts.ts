import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toastAction } from '../activity/actionToast';
import type { Command } from '../commands';
import { exportCanvas } from '../export/actions';
import type { ExportOptions } from '../export/options';
import type { CanvasHandle } from '../export/types';
import type { FileSession } from '../fileSession';
import { CHORD_MS, chord } from '../home/model';
import { EXPORT_MENU_QUERY, IS_MAC } from '../platform';
import { shellKey, type Section } from '../projectNav';

type GlobalShortcuts = {
  fileOpen: boolean;
  session: FileSession;
  canvasHandle: RefObject<CanvasHandle | null>;
  exportOptions: RefObject<ExportOptions>;
  openExport: (open: boolean) => void;
  report: (job: Promise<string> | string) => Promise<unknown>;
  setExportOpen: (open: boolean) => void;
  setPaletteGroup: (group: Command['group']) => void;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
};

// Global shortcuts (capture phase, so they win over the canvas and the editor): Ctrl/Cmd+K palette,
// Ctrl/Cmd+E export, Shift+Alt+C copy as image. Tool keys, zoom, undo/redo, duplicate, delete and
// select all are the canvas's own keys, active while the canvas has focus.
export function useGlobalShortcuts({ fileOpen, session, canvasHandle, exportOptions, openExport, report, setExportOpen, setPaletteGroup, setPaletteOpen }: GlobalShortcuts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // A native modal <dialog> (settings) owns the keyboard: no palette, G P or export behind it.
      if (document.querySelector('dialog:modal')) return;
      // Mac uses only Cmd, everything else only Ctrl, so Mac's Ctrl+E/K stay with text fields.
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      const k = e.code;
      // Inside a text field, the document editor or the code editor these keys belong to the editor
      // (Ctrl+E is "code" in the document), so the export shortcuts step aside; the menu and palette still work.
      const editing = e.target instanceof Element && !!e.target.closest('.ProseMirror, input, textarea, select, .cm-editor, [contenteditable="true"], [contenteditable=""]');
      if (!mod && !e.shiftKey && !e.altKey && !editing && !e.isComposing && !e.repeat && !(e.target instanceof Element && e.target.closest('[role=dialog], [role=menu]'))) {
        if (k === 'KeyG') chord.g = Date.now();
        else if (k === 'KeyP' && Date.now() - chord.g < CHORD_MS) {
          e.preventDefault();
          e.stopPropagation(); // the canvas must not also take P as its own tool key
          setTimeout(() => (chord.g = 0));
          setExportOpen(false);
          setPaletteGroup('project');
          setPaletteOpen(true);
          return;
        }
      }
      if (mod && !e.shiftKey && !e.altKey && k === 'KeyK') {
        e.preventDefault();
        e.stopPropagation();
        setExportOpen(false);
        setPaletteGroup(undefined);
        setPaletteOpen((o) => !o);
      } else if (mod && !e.shiftKey && !e.altKey && k === 'KeyE' && fileOpen && !editing && window.matchMedia(EXPORT_MENU_QUERY).matches) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(false);
        openExport(true);
      } else if (!mod && e.shiftKey && e.altKey && k === 'KeyC' && fileOpen && !editing) {
        e.preventDefault();
        e.stopPropagation();
        void report(exportCanvas(canvasHandle.current, 'copy', session.getState().file?.title ?? '', exportOptions.current));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fileOpen, openExport, report, session]);
}

type ShellShortcuts = {
  showSection: (s: Section) => void;
  showBoard: () => void;
  onArchive: () => void;
  /** The latest new-file action (it changes every render). */
  newFile: RefObject<() => Promise<void>>;
};

// Shell shortcuts (doc 6 §5): A 홈, R 최근, B 보관함, N 새 파일. Never inside a text field,
// an editor, the canvas (its own tool keys) or a dialog: see shellKey.
export function useShellShortcuts({ showSection, showBoard, onArchive, newFile }: ShellShortcuts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = shellKey(e);
      if (!k) return;
      e.preventDefault();
      if (k === 'all') showSection({ kind: 'all' });
      else if (k === 'recent') showSection({ kind: 'recent' });
      else if (k === 'board') showBoard();
      else if (k === 'archive') onArchive();
      else if (k === 'new') void newFile.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSection, showBoard]);
}

/** Ctrl/Cmd+S (E540, #671): save now and say so. Autosave stays quiet: a toast per pause in typing would be noise. A Sonner toast (#899). */
export function useSaveShortcut(session: FileSession) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.code !== 'KeyS') return;
      e.preventDefault();
      const p = session.getState().path;
      if (!p) return;
      void session.flush().then(() => {
        const st = session.getState();
        if (st.path !== p) return;
        toastAction(st.statusAlert ? { type: 'save-failed', path: p } : { type: 'saved', path: p });
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [session]);
}
