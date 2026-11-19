// New agent activity and app events while the app is open (E537 #654, E540 #671). Since #811 nothing pops up on the
// page: every event goes to the 알림함 (the bell, inboxStore.ts) only. While the page is hidden and notifications are
// on (설정 > 일반, dispatch/lib/notify.ts), start, finish and error activity also goes out as a browser notification
// (app events do the same from notifyApp, appToasts.ts). Renders nothing.
import { useEffect, useRef } from 'react';
import type { ToastTarget } from './appEvents';
import { setToastOpener, watchAppEvents } from './appToasts';
import { activitySentence } from '../../../shared/dispatch/agent-activity.ts';
import { alertsOn } from '../dispatch/lib/notify';
import { alertRoute } from './activity';
import { onNewActivity } from './store';

/** onOpen: a document's path; onSession: a session id (where a browser notification's click goes). */
export function ActivityAlerts({ onOpen, onSession }: { onOpen: (path: string) => void; onSession: (id: string) => void }) {
  const open = useRef(onOpen);
  open.current = onOpen;
  const openSession = useRef(onSession);
  openSession.current = onSession;

  useEffect(
    () =>
      onNewActivity((e) => {
        if (alertRoute(e, { visible: document.visibilityState === 'visible', notify: alertsOn() }) !== 'notification') return;
        try {
          const n = new Notification('에이전트 활동', { body: activitySentence(e), tag: `activity:${e.id}` });
          n.onclick = () => {
            window.focus();
            open.current(e.file);
            n.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }),
    [],
  );
  useEffect(() => {
    watchAppEvents();
    const go = (target: ToastTarget) => ('file' in target ? open.current(target.file) : openSession.current(target.session));
    setToastOpener((t) => t.target && go(t.target));
  }, []);
  return null;
}
