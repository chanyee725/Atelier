// New agent activity while the app is open (E537, #654): a toast when the page is in view, a browser notification
// when it is hidden and notifications are on (설정 > 일반, dispatch/lib/notify.ts). Start, finish and error only;
// progress stays in the bell's feed, where every toast can be found again. App events (E540, #671: files, sessions,
// models, settings, runs; activity/appToasts.ts) share the same stack. Toasts sit in one popover="manual" region at the
// top right (no light dismiss); info closes itself after a while unless hovered or focused, errors stay until closed;
// they never take focus.
import { useEffect, useReducer, useRef } from 'react';
import { X } from 'lucide-react';
import type { AppToast, ToastTarget } from './appEvents';
import { categoryOn, onAppToast, setToastOpener, watchAppEvents } from './appToasts';
import { activitySentence } from '../../../shared/dispatch/agent-activity.ts';
import { alertsOn } from '../dispatch/lib/notify';
import { alertRoute, MODAL_SELECTOR, nextToasts, type ActivityEvent, type ToastAction, type ToastQueue } from './activity';
import { onNewActivity } from './store';
import './activity.css';

const SHOW_MS = 6_000;
/** At most this many on screen at once; the rest wait their turn (none is dropped). */
const MAX_TOASTS = 3;
const MODAL_CHECK_MS = 400;
/** A modal dialog is open: the page behind it is inert, so a toast could be neither read nor closed. */
const modalOpen = () => !!document.querySelector(MODAL_SELECTOR);

type Toast = { id: string; text: string; kind: ActivityEvent['kind'] | 'info'; color?: string; persist?: boolean; target?: ToastTarget };
let seq = 0;
const fromApp = (t: AppToast): Toast => ({
  id: `app-${++seq}`,
  text: t.text,
  kind: t.tone === 'error' ? 'error' : 'info',
  ...(t.persist ? { persist: true } : {}),
  ...(t.target ? { target: t.target } : {}),
});
const reduce = (q: ToastQueue<Toast>, a: ToastAction<Toast>) => nextToasts(q, a, MAX_TOASTS);
const EMPTY: ToastQueue<Toast> = { shown: [], waiting: [] };

/** Screen readers hear the toast's text (ariaNotify where there is one, else the polite live region). */
function announce(text: string, region: HTMLElement | null) {
  const doc = document as Document & { ariaNotify?: (s: string) => void };
  if (typeof doc.ariaNotify === 'function') doc.ariaNotify(text);
  else if (region) {
    // Emptied first and filled a frame later, so the same sentence twice in a row is read again.
    region.textContent = '';
    requestAnimationFrame(() => (region.textContent = text));
  }
}

/** onOpen: a document's path; onSession: a session id (the 열기 link of session toasts). */
export function ActivityAlerts({ onOpen, onSession }: { onOpen: (path: string) => void; onSession: (id: string) => void }) {
  // Toasts that came while a modal dialog was open, or while MAX_TOASTS were on screen, wait in q.waiting.
  const [q, dispatch] = useReducer(reduce, EMPTY);
  const toasts = q.shown;
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const held = useRef(false);
  const open = useRef(onOpen);
  open.current = onOpen;
  const openSession = useRef(onSession);
  openSession.current = onSession;
  const go = (target: ToastTarget) => ('file' in target ? open.current(target.file) : openSession.current(target.session));

  const close = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    dispatch({ type: 'close', id, blocked: modalOpen() });
  };
  const later = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => (held.current ? later(id) : close(id)), SHOW_MS),
    );
  };

  // A toast that just came on screen starts its timer and is announced (once).
  useEffect(() => {
    for (const t of toasts) {
      if (timers.current.has(t.id)) continue;
      // An error stays until it is closed (an empty entry marks it as announced).
      if (t.persist) timers.current.set(t.id, undefined as unknown as ReturnType<typeof setTimeout>);
      else later(t.id);
      // Only the visible text, plus a note when the toast has an action (persistent-toast-notifications).
      announce(t.target ? `${t.text}. 열기 버튼이 있어요` : t.text, live.current);
    }
  }, [toasts]);

  // While toasts wait, look now and then for the modal dialog to close (a Radix sheet gives no event the page can
  // hear). Unchanged queue when there is nothing to do, so this does not re-render.
  const hasWaiting = q.waiting.length > 0;
  useEffect(() => {
    if (!hasWaiting) return;
    const t = setInterval(() => dispatch({ type: 'fill', blocked: modalOpen() }), MODAL_CHECK_MS);
    return () => clearInterval(t);
  }, [hasWaiting]);

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
        if (route !== 'toast' || !categoryOn('agents')) return;
        const toast: Toast = { id: e.id, text, kind: e.kind, ...(e.color ? { color: e.color } : {}), ...(e.kind === 'error' ? { persist: true } : {}), target: { file: e.file } };
        // Not behind a modal dialog, where it could be neither read nor closed: it waits until the dialog closes.
        dispatch({ type: 'add', toast, blocked: modalOpen() });
      }),
    [],
  );
  useEffect(() => {
    watchAppEvents();
    setToastOpener((t) => t.target && go(t.target));
    return onAppToast((t) => dispatch({ type: 'add', toast: fromApp(t), blocked: modalOpen() }));
  }, []);
  useEffect(
    () => () => timers.current.forEach(clearTimeout),
    [],
  );

  // The region is in the top layer only while it has toasts.
  useEffect(() => {
    const el = box.current;
    if (!el?.showPopover) return;
    const shown = el.matches(':popover-open');
    if (toasts.length && !shown) el.showPopover();
    else if (!toasts.length && shown) el.hidePopover();
    // A hidden region gets no mouseleave or blur: closing the last toast under the pointer must not keep the next
    // ones open for good.
    if (!toasts.length) held.current = false;
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
        aria-label="알림"
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
          {/* Newest on top, next to the screen's top edge. */}
          {[...toasts].reverse().map((t) => (
            <li key={t.id} className="activity-toast" data-activity-toast={t.id} data-kind={t.kind}>
              <span className="activity-dot" aria-hidden style={t.color && /^#[0-9a-f]{6}$/i.test(t.color) ? { background: t.color } : undefined} />
              <span className="activity-text">{t.text}</span>
              {t.target ? (
                <button
                  type="button"
                  className="activity-open"
                  onClick={() => {
                    go(t.target!);
                    close(t.id);
                  }}
                >
                  열기
                </button>
              ) : (
                <span />
              )}
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
