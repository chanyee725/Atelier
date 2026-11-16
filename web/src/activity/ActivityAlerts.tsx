// New agent activity while the app is open (E537, #654): a toast when the page is in view, a browser notification
// when it is hidden and notifications are on (설정 > 일반, dispatch/lib/notify.ts). Start, finish and error only;
// progress stays in the bell's feed, where every toast can be found again. Toasts sit in one popover="manual" region
// (no light dismiss), close themselves after a while unless hovered or focused, and never take focus.
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { activitySentence } from '../../../shared/dispatch/agent-activity.ts';
import { alertsOn } from '../dispatch/lib/notify';
import { alertRoute, type ActivityEvent } from './activity';
import { onNewActivity } from './store';
import './activity.css';

const SHOW_MS = 6_000;
const MAX_TOASTS = 3;

type Toast = { id: string; text: string; kind: ActivityEvent['kind']; color?: string };

/** Screen readers hear the toast's text (ariaNotify where there is one, else the polite live region). */
function announce(text: string, region: HTMLElement | null) {
  const doc = document as Document & { ariaNotify?: (s: string) => void };
  if (typeof doc.ariaNotify === 'function') doc.ariaNotify(text);
  else if (region) region.textContent = text;
}

export function ActivityAlerts({ onOpen }: { onOpen: (path: string) => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const held = useRef(false);
  const open = useRef(onOpen);
  open.current = onOpen;

  const close = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  };
  const later = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => (held.current ? later(id) : close(id)), SHOW_MS),
    );
  };

  useEffect(
    () =>
      onNewActivity((e) => {
        const route = alertRoute(e, { visible: document.visibilityState === 'visible', notify: alertsOn() });
        const text = activitySentence(e);
        if (route === 'notification') {
          try {
            const n = new Notification('에이전트 활동', { body: text, tag: `activity:${e.id}` });
            n.onclick = () => {
              window.focus();
              open.current(e.file);
              n.close();
            };
          } catch {
            // Some browsers only allow notifications from a service worker.
          }
          return;
        }
        if (route !== 'toast') return;
        setToasts((t) => [...t.filter((x) => x.id !== e.id), { id: e.id, text, kind: e.kind, ...(e.color ? { color: e.color } : {}) }].slice(-MAX_TOASTS));
        later(e.id);
        announce(text, live.current);
      }),
    [],
  );
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The region is in the top layer only while it has toasts.
  useEffect(() => {
    const el = box.current;
    if (!el?.showPopover) return;
    const shown = el.matches(':popover-open');
    if (toasts.length && !shown) el.showPopover();
    else if (!toasts.length && shown) el.hidePopover();
  }, [toasts.length]);

  // Closing the focused toast moves focus to the next one, else back to the page.
  const dismiss = (id: string, e: React.MouseEvent) => {
    const li = (e.currentTarget as HTMLElement).closest('li');
    const next = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector<HTMLElement>('button');
    close(id);
    if (next) next.focus();
    else (document.querySelector<HTMLElement>('[data-activity-bell]') ?? document.body).focus();
  };

  return (
    <>
      <p ref={live} className="sr-only" aria-live="polite" />
      <div
        ref={box}
        popover="manual"
        role="region"
        aria-label="에이전트 알림"
        className="activity-toasts"
        data-activity-toasts=""
        onMouseEnter={() => (held.current = true)}
        onMouseLeave={() => (held.current = false)}
        onFocus={() => (held.current = true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) held.current = false;
        }}
      >
        <ol>
          {toasts.map((t) => (
            <li key={t.id} className="activity-toast" data-activity-toast={t.id} data-kind={t.kind}>
              <span className="activity-dot" aria-hidden style={t.color && /^#[0-9a-f]{6}$/i.test(t.color) ? { background: t.color } : undefined} />
              <span className="activity-text">{t.text}</span>
              <button type="button" className="activity-close" aria-label="알림 닫기" onClick={(e) => dismiss(t.id, e)}>
                <X aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
