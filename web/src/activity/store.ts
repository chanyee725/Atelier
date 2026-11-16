// The page's activity log (E537, #654): GET /api/activity once, then SSE `activity` (one new event) and
// `activity-read` (a read mark from any page); a reconnect loads it again. New events go to the listeners
// (toasts and browser notifications) only after the first load, so history never pops up. Memory only.
import { useSyncExternalStore } from 'react';
import { parseActivityLog } from '../../../shared/dispatch/agent-activity.ts';
import { events } from '../lib/events';
import { addEvent, markRead, type ActivityEvent, type ActivityLog } from './activity';

let log: ActivityLog = { events: [], readAt: 0 };
let loaded = false;
let started = false;
const subs = new Set<() => void>();
const fresh = new Set<(e: ActivityEvent) => void>();
const set = (next: ActivityLog) => {
  if (next === log) return;
  log = next;
  for (const f of subs) f();
};

function load() {
  void fetch('/api/activity')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      const got = parseActivityLog(d);
      // Keep events that came over the stream while the request ran.
      let next: ActivityLog = { events: got.events, readAt: Math.max(got.readAt, log.readAt) };
      for (const e of log.events) next = addEvent(next, e);
      loaded = true;
      set(next);
    })
    .catch(() => {});
}

function start() {
  if (started) return;
  started = true;
  events.subscribeJson<unknown>('activity', (e) => {
    const next = addEvent(log, e);
    if (next === log) return;
    set(next);
    if (loaded) for (const f of fresh) f(e as ActivityEvent);
  });
  events.subscribeJson<{ readAt?: unknown }>('activity-read', (e) => set(markRead(log, e?.readAt)));
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) first = false;
    else load();
  });
  load();
}

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => subs.delete(f);
};
const read = () => log;

export const useActivityLog = () => useSyncExternalStore(subscribe, read, read);

/** fn(event) for each event that comes in after the first load. */
export function onNewActivity(fn: (e: ActivityEvent) => void) {
  start();
  fresh.add(fn);
  return () => void fresh.delete(fn);
}

/** Everything up to the newest event counts as read, on every page. */
export function readAll() {
  const at = log.events.at(-1)?.at ?? 0;
  if (at <= log.readAt) return;
  set(markRead(log, at));
  void fetch('/api/activity/read', {
    method: 'POST',
    headers: { 'x-drawing': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ at }),
  }).catch(() => {});
}
