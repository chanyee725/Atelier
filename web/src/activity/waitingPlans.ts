// The page's list of plans that wait for 시작하기 (E579, #786): GET /api/pipeline/waiting once, again on every SSE
// `pipeline` event (write_plan, start, reopen, a trashed plan), on file deletes and moves, and on a reconnect. A plan
// that starts waiting after the first load raises one toast; what was already waiting when the page opened does not.
import { useSyncExternalStore } from 'react';
import { events } from '../lib/events';
import { notifyApp } from './appToasts';
import { newlyWaiting, parseWaiting, planTitle, planWaitingText, type WaitingPlan } from './plans';

let plans: WaitingPlan[] = [];
let loaded = false;
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const subs = new Set<() => void>();

function load() {
  const mine = ++seq;
  void fetch('/api/pipeline/waiting')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      // An older answer that comes back late must not undo a newer one.
      if (d === null || mine !== seq) return;
      const next = parseWaiting(d);
      if (loaded) {
        for (const p of newlyWaiting(new Set(plans.map((x) => x.path)), next)) {
          notifyApp({ type: 'plan-waiting', file: p.path, text: `${planWaitingText(p)}: ${planTitle(p)}` });
        }
      }
      loaded = true;
      plans = next;
      subs.forEach((f) => f());
    })
    .catch(() => {});
}

/** Several events in a row (a folder move, a burst of saves) load once. */
const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 150);
};

function start() {
  if (started) return;
  started = true;
  events.subscribe('pipeline', soon);
  events.subscribeJson<{ kind?: string }>('workspace', (e) => {
    if (e?.kind === 'delete' || e?.kind === 'tree') soon();
  });
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) first = false;
    else soon();
  });
  load();
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => void subs.delete(f);
};
const snapshot = () => plans;

/** Plans waiting for 시작하기, newest first. */
export const useWaitingPlans = () => useSyncExternalStore(subscribe, snapshot, snapshot);
