// App event toasts (E540, #671): the one place app events go through. notifyApp(event) drops it when its category is
// off (설정 > 일반 > 알림, this browser only) or it repeats within DEDUPE_MS, then hands the toast to ActivityAlerts
// (page in view) or to a browser notification (page hidden and notifications on). watchAppEvents() turns the server's
// SSE `session`, `providers`, `settings` and `run` events into app events for the whole app. Metadata only.
import { useSyncExternalStore } from 'react';
import { alertsOn } from '../dispatch/lib/notify';
import { events } from '../lib/events';
import {
  createDedupe,
  parseOff,
  providerEvents,
  runEvents,
  sessionEvents,
  toastOf,
  type AppEvent,
  type AppToast,
  type ToastCategory,
} from './appEvents';

const KEY = 'drawing:toast-off';
const listeners = new Set<(t: AppToast) => void>();
const prefSubs = new Set<() => void>();
const dedupe = createDedupe();

let off: Set<ToastCategory> | null = null;
const readOff = () => (off ??= parseOff(typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)));

export const categoryOn = (c: ToastCategory) => !readOff().has(c);

export function setCategoryOn(c: ToastCategory, on: boolean) {
  const next = new Set(readOff());
  if (on) next.delete(c);
  else next.add(c);
  off = next;
  localStorage.setItem(KEY, JSON.stringify([...next]));
  prefSubs.forEach((f) => f());
}

/** The off set, for the settings switches. */
export const useToastOff = () =>
  useSyncExternalStore(
    (f) => {
      prefSubs.add(f);
      return () => prefSubs.delete(f);
    },
    readOff,
    readOff,
  );

/** fn(toast) for each app toast to show on the page. */
export function onAppToast(fn: (t: AppToast) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Where a browser notification's click goes (set by ActivityAlerts). */
let openTarget: (t: AppToast) => void = () => {};
export const setToastOpener = (fn: (t: AppToast) => void) => void (openTarget = fn);

export function notifyApp(e: AppEvent) {
  const t = toastOf(e);
  if (!t || !categoryOn(t.category) || !dedupe(t.key, Date.now())) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    if (!alertsOn()) return;
    try {
      const n = new Notification('Atelier', { body: t.text, tag: `app:${t.key}` });
      n.onclick = () => {
        window.focus();
        openTarget(t);
        n.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker.
    }
    return;
  }
  for (const f of listeners) f(t);
}

type SessionMsg = Parameters<typeof sessionEvents>[1];
type ProviderMsg = Parameters<typeof providerEvents>[1];

let watching = false;

/** Listens to the server's events for the whole app (once). The first state of each thing is only remembered. */
export function watchAppEvents() {
  if (watching) return;
  watching = true;
  const sessions = new Map<string, SessionMsg>();
  let providers: ProviderMsg | null = null;
  const runs = new Map<string, string>();
  // Runs that started before this moment were already going when the page opened: no 시작했어요 for them.
  const openedAt = Date.now();
  const prs = new Map<string, string>();
  const emit = (list: AppEvent[]) => list.forEach(notifyApp);

  // What is already there when the page opens (or reconnects) never pops up.
  const baseline = () =>
    void fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sessions?: SessionMsg[]; providers?: ProviderMsg } | null) => {
        for (const s of d?.sessions ?? []) if (s && typeof s.id === 'string') sessions.set(s.id, s);
        if (d?.providers && typeof d.providers === 'object') providers = d.providers;
      })
      .catch(() => {});

  events.subscribeJson<SessionMsg>('session', (s) => {
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string') return;
    emit(sessionEvents(sessions.get(s.id), s, Date.now()));
    sessions.set(s.id, s);
  });
  events.subscribeJson<{ sessions?: SessionMsg[]; providers?: ProviderMsg }>('snapshot', (d) => {
    for (const s of d?.sessions ?? []) if (s && typeof s.id === 'string' && !sessions.has(s.id)) sessions.set(s.id, s);
    if (d?.providers && !providers) providers = d.providers;
  });
  events.subscribeJson<ProviderMsg>('providers', (p) => {
    if (!p || typeof p !== 'object') return;
    if (providers) emit(providerEvents(providers, p));
    providers = p;
  });
  // Every POST /api/settings is announced to every page; the switch that sent it also says 저장했어요 in place.
  events.subscribe('settings', () => notifyApp({ type: 'settings-saved' }));
  events.subscribeJson<Parameters<typeof runEvents>[2]>('run', (e) => {
    if (!e || typeof e.file !== 'string' || typeof e.runId !== 'string') return;
    emit(runEvents(runs, prs, e, openedAt));
  });
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) first = false;
    else baseline();
  });
  baseline();
}
