import { useEffect, useState } from 'react';

/**
 * Open state for a Radix dropdown menu that closes on Esc by itself and keeps that Esc from reaching anything else.
 * Needed in the phone drawer: the menu and the drawer sheet run on separate copies of Radix's layer stack, so one Esc
 * would close both (and the drawer would also swallow the menu's own close). The window capture listener runs first.
 */
export function useMenuState() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return { open, onOpenChange: setOpen };
}
