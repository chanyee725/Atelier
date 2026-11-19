// Open permission prompts of sessions for the 승인 대기 card and the sidebar count (#836): GET /api/state once (and on
// a reconnect), then each SSE `session` event replaces that session's prompts from its own `pending` and `removed`
// drops them (withSession), so a working session never costs a full snapshot. Shared by both, so one request.
import { useSyncExternalStore } from 'react';
import { events } from '../lib/events';
import type { Session } from '../../../shared/dispatch/types.ts';
import { permissionAsks, withSession, type PermissionAsk } from './approvals.ts';

let asks: readonly PermissionAsk[] = [];
let started = false;
let seq = 0;
/** Sessions an event updated while a full load was in flight: those keep the newer, event-made prompts. */
let touched = new Set<string>();
const subs = new Set<() => void>();

function set(next: readonly PermissionAsk[]) {
  if (next === asks) return;
  asks = next;
  subs.forEach((f) => f());
}

function load() {
  const mine = ++seq;
  touched = new Set();
  void fetch('/api/state')
    .then((r) => (r.ok ? (r.json() as Promise<{ sessions?: Session[] }>) : null))
    .then((d) => {
      if (d === null || mine !== seq) return;
      // A session an event updated meanwhile is newer than this snapshot; every other one comes from it.
      const fresh = permissionAsks(Array.isArray(d.sessions) ? d.sessions : []).filter((a) => !touched.has(a.sessionId));
      const kept = asks.filter((a) => touched.has(a.sessionId));
      set([...fresh, ...kept].sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity)));
    })
    .catch(() => {});
}

/** Read the whole list again, e.g. after an answer failed (the prompt may be gone). */
export const reloadPermissionAsks = () => load();

function start() {
  if (started) return;
  started = true;
  events.subscribeJson<Session>('session', (s) => {
    if (!s?.id) return;
    touched.add(s.id);
    set(withSession(asks, s));
  });
  events.subscribeJson<{ id?: string }>('removed', (e) => {
    if (!e?.id) return;
    touched.add(e.id);
    set(withSession(asks, { id: e.id }, true));
  });
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
  return () => void subs.delete(f);
};
const snapshot = () => asks;

/** Open permission prompts, oldest first. */
export const usePermissionAsks = () => useSyncExternalStore(subscribe, snapshot, snapshot);
