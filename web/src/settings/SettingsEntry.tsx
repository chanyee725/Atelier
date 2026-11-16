// 설정 row in the sidebar (#624): opens the one 설정 modal, loaded on first open so the editor bundle does not carry it.
import { Settings } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import { SidebarMenuButton } from '../components/ui/sidebar';

const SettingsDialog = lazy(() => import('./SettingsDialog'));

export function SettingsEntry() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SidebarMenuButton ref={trigger} data-testid="settings-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Settings aria-hidden />
        <span className="truncate">설정</span>
      </SidebarMenuButton>
      {open && (
        <Suspense fallback={null}>
          <SettingsDialog
            onClose={() => {
              setOpen(false);
              // The browser returns focus to the opener on close; this covers the case where it landed on <body>.
              requestAnimationFrame(() => {
                if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
              });
            }}
          />
        </Suspense>
      )}
    </>
  );
}
