// 설정 row and modal (E509c): edit the usage-limit and session-length guards. A native modal <dialog> gives the inert
// page, focus containment, Esc and focus return to the 설정 row. The form itself is LimitsForm, shared with the
// 설정 page (#587), which the modal links to for team settings, models and per-provider usage.
import { Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { SidebarMenuButton } from '../components/ui/sidebar';
import { cn } from '../lib/utils';
import { BTN, LimitsForm } from './LimitsForm';
import { stopEscWhileOpen } from './model';
import './limits.css';

export function SettingsEntry() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SidebarMenuButton ref={trigger} data-testid="settings-trigger" aria-haspopup="dialog" title="한도 설정" onClick={() => setOpen(true)}>
        <Settings aria-hidden />
        <span className="truncate">설정</span>
      </SidebarMenuButton>
      {open && (
        <LimitsDialog
          onClose={() => {
            setOpen(false);
            // The browser returns focus to the opener on close; this covers the case where it landed on <body>.
            requestAnimationFrame(() => {
              if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
            });
          }}
        />
      )}
    </>
  );
}

function LimitsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Below 768px the sidebar is a Radix Sheet that listens for Esc on document (capture), so one Esc would close
    // the Sheet too and unmount the 설정 row focus returns to (#552). Stop the key at window, before document; the
    // dialog's own close request still runs, since it is the key's default action, not a listener.
    return stopEscWhileOpen(window, () => !!ref.current?.open);
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="settings-dialog"
      onClose={onClose}
      className="limits-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-1rem))] max-w-none overflow-y-auto rounded-lg border bg-background p-0 text-foreground shadow-md"
    >
      <LimitsForm
        labelledBy={titleId}
        autoFocus
        className="p-4"
        header={
          <header className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-sm font-semibold">
              설정
            </h2>
            {/* On /dispatch only the hash changes, so close the modal too. */}
            <a href="/dispatch#settings" onClick={() => ref.current?.close()} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              전체 설정 열기
            </a>
            <button type="button" onClick={() => ref.current?.close()} className={cn(BTN, 'ml-auto text-muted-foreground')}>
              닫기
            </button>
          </header>
        }
      />
    </dialog>
  );
}
