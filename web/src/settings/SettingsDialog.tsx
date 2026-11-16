// The one 설정 modal (#624): a narrow section list on the left (a <select> on top below 768px) and the chosen
// section on the right. A native modal <dialog> gives the inert page, focus containment, Esc and focus return. While
// it is open it holds the session stream open, so every section reads the same store (#625); the sections stay
// mounted and only the chosen one shows, so unsaved edits survive switching. The chosen section id is remembered in
// this browser. Loaded lazily from SettingsEntry and the /dispatch screen.
import { X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { connect, setState, useDispatch } from '../dispatch/store';
import { cn } from '../lib/utils';
import { SettingsContext } from './context';
import { useDispatchStatus } from './DispatchOff';
import { BTN } from './LimitsForm';
import { SECTION_KEY, SECTIONS, firstSection, settingsLoad, stopEscWhileOpen, type SectionId } from './model';
import { SECTION_COMPONENTS } from './slots';
import './limits.css';

const remembered = () => {
  try {
    return localStorage.getItem(SECTION_KEY);
  } catch {
    return null;
  }
};

export default function SettingsDialog({ section, onClose }: { section?: SectionId; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const selectId = useId();
  const [current, setCurrent] = useState<SectionId>(() => firstSection(section, remembered()));
  const pick = (id: SectionId) => {
    setCurrent(id);
    try {
      localStorage.setItem(SECTION_KEY, id);
    } catch {
      /* storage off: the choice lasts until the modal closes */
    }
  };

  // Hold the session stream open while the modal is; 다시 시도 clears the failed mark and connects again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => connect(), [attempt]);
  const status = useDispatchStatus();
  const ready = useDispatch((s) => s.ready);
  const unavailable = useDispatch((s) => s.unavailable);
  const ctx = useMemo(
    () => ({
      load: settingsLoad(status, ready, unavailable),
      retry: () => {
        setState({ unavailable: false });
        setAttempt((a) => a + 1);
      },
    }),
    [status, ready, unavailable],
  );

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // Start on the chosen section's nav item (the <select> below 768px, where the list is hidden).
      const item = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
      (item && item.offsetParent ? item : d.querySelector<HTMLElement>(`#${CSS.escape(selectId)}`))?.focus();
    }
    // Below 768px the sidebar is a Radix Sheet that listens for Esc on document (capture), so one Esc would close
    // the Sheet too and unmount the 설정 row focus returns to (#552). Stop the key at window, before document; the
    // dialog's own close request still runs, since it is the key's default action, not a listener.
    return stopEscWhileOpen(window, () => !!ref.current?.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="settings-dialog"
      onClose={onClose}
      className="settings-dialog m-auto h-[min(680px,calc(100dvh-2rem))] w-[min(800px,calc(100vw-1rem))] max-w-none overflow-hidden rounded-lg border bg-background p-0 text-foreground shadow-md max-md:h-[calc(100dvh-1rem)]"
    >
      <SettingsContext.Provider value={ctx}>
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <h2 id={titleId} className="text-sm font-semibold">
              설정
            </h2>
            <button type="button" aria-label="설정 닫기" onClick={() => ref.current?.close()} className={cn(BTN, 'ml-auto px-2 text-muted-foreground')}>
              <X aria-hidden className="size-4" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 max-md:flex-col">
            <nav ref={navRef} aria-label="설정 항목" className="w-44 shrink-0 overflow-y-auto border-r p-2 max-md:hidden">
              <ul className="flex flex-col gap-0.5">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-section={s.id}
                      aria-current={current === s.id ? 'page' : undefined}
                      onClick={() => pick(s.id)}
                      className={cn(
                        'flex h-8 w-full items-center rounded-md px-2.5 text-left text-sm text-muted-foreground transition-colors duration-[120ms] motion-reduce:transition-none hover:bg-muted/60 hover:text-foreground',
                        // Not by colour alone: the current item is also bold and carries a bar (WCAG 1.4.1).
                        'aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_2px_0_0_var(--primary)]',
                      )}
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="hidden shrink-0 border-b px-4 py-2 max-md:block">
              <label htmlFor={selectId} className="sr-only">
                설정 항목
              </label>
              <select
                id={selectId}
                data-testid="settings-section-select"
                value={current}
                onChange={(e) => pick(e.target.value as SectionId)}
                className="h-11 w-full rounded-md border bg-background px-2 text-sm"
              >
                {SECTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto p-5 max-md:p-4">
              {SECTIONS.map((s) => {
                const Section = SECTION_COMPONENTS[s.id];
                return (
                  <div key={s.id} data-settings-section={s.id} hidden={current !== s.id}>
                    <Section />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsContext.Provider>
    </dialog>
  );
}
