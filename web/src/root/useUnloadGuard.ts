import { useEffect } from 'react';
import type { FileSession } from '../fileSession';

/** Warn before leaving with unsaved edits; on pagehide send them with keepalive. */
export function useUnloadGuard(session: FileSession) {
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (session.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const hide = () => session.saveOnHide();
    window.addEventListener('beforeunload', before);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('pagehide', hide);
    };
  }, [session]);
}
