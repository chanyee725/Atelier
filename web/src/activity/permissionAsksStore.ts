// Open permission prompts of sessions for the 승인 대기 card and the sidebar count (#836): GET /api/state once, again
// on every SSE `session` or `removed` event (a burst loads once) and on a reconnect. Shared by both, so one request.
import { useSyncExternalStore } from 'react';
import { events } from '../lib/events';
import type { Session } from '../../../shared/dispatch/types.ts';
import { permissionAsks, type PermissionAsk } from './approvals.ts';

let asks: PermissionAsk[] = [];
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const subs = new Set<() => void>();

const same = (a: PermissionAsk[], b: PermissionAsk[]) => a.length === b.length && a.every((x, i) => x.requestId === b[i].requestId && x.session === b[i].session);

function load() {
  const mine = ++seq;
  void fetch('/api/state')
    .then((r) => (r.ok ? (r.json() as Promise<{ sessions?: Session[] }>) : null))
    .then((d) => {
      if (d === null || mine !== seq) return;
      const next = permissionAsks(Array.isArray(d.sessions) ? d.sessions : []);
      if (same(asks, next)) return;
      asks = next;
      subs.forEach((f) => f());
    })
    .catch(() => {});
}

/** Reload now-ish, e.g. right after answering one. */
export const reloadPermissionAsks = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 150);
};

function start() {
  if (started) return;
  started = true;
  events.subscribe('session', reloadPermissionAsks);
  events.subscribe('removed', reloadPermissionAsks);
  let first = true;
  events.onConnection((online) => {
    if (!online) return;
    if (first) first = false;
    else reloadPermissionAsks();
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
