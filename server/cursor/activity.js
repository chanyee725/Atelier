// Agent activity log (E537, issue #654): start / progress / finish / error events of the agent sessions working on
// the workspace's documents, for the app's activity feed, toasts and browser notifications. Shape and copy:
// shared/dispatch/agent-activity.ts; the rules: ./activity-log.js.
//   GET  /api/activity             -> { events, readAt }
//   POST /api/activity/read { at } -> { readAt }   (SSE `activity-read` { readAt } to every page)
//   SSE  `activity`                -> one new event
// Metadata only (who, which file and section, when, what kind), never a transcript or tool text. Kept in
// <workspace>/.drawing/activity.json, the newest ACTIVITY_MAX events, written atomically a moment after a change.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACTIVITY_MAX, parseActivityLog } from '../../shared/dispatch/agent-activity.ts';
import { createActivityLog } from './activity-log.js';

export const ACTIVITY_FILE = ['.drawing', 'activity.json'];
const WRITE_DELAY_MS = 500;
const BODY_MAX = 1024;

const readBody = (req) =>
  new Promise((ok, fail) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (d) => {
      s += d;
      if (s.length > BODY_MAX) {
        req.destroy();
        fail(new Error('body too large'));
      }
    });
    req.on('end', () => ok(s));
    req.on('error', fail);
  });

export async function setup(ctx, { now = Date.now, writeDelayMs = WRITE_DELAY_MS } = {}) {
  const dir = ctx.workspaceDir ? join(ctx.workspaceDir, ACTIVITY_FILE[0]) : null;
  const path = dir ? join(dir, ACTIVITY_FILE[1]) : null;
  let log = { events: [], readAt: 0 };
  if (path) {
    try {
      log = parseActivityLog(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      // No log yet, or a damaged one: start empty (it is only history).
    }
  }

  let timer = null;
  let writing = Promise.resolve();
  const flush = () => {
    timer = null;
    if (!path) return writing;
    const text = JSON.stringify({ version: 1, ...log });
    writing = writing
      .then(async () => {
        await mkdir(dir, { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        await writeFile(tmp, text);
        await rename(tmp, path);
      })
      .catch(() => {});
    return writing;
  };
  const save = () => {
    if (!timer) timer = setTimeout(flush, writeDelayMs);
  };

  // Titles are read from the file as each event is made; events go out in order (one chain).
  const store = ctx.modules.workspace?.store;
  const titleOf = async (rel) => {
    try {
      const f = await store?.readFile(rel);
      return typeof f?.title === 'string' && f.title.trim() ? f.title.trim().slice(0, 80) : null;
    } catch {
      return null;
    }
  };
  let seq = 0;
  let chain = Promise.resolve();
  const emit = (e) => {
    // One failing event (a throwing broadcast) must not reject the chain, or every later event would be lost.
    chain = chain
      .then(async () => {
        const title = await titleOf(e.file);
        const ev = { id: `${e.at}-${++seq}`, ...e, ...(title ? { title } : {}) };
        log.events.push(ev);
        if (log.events.length > ACTIVITY_MAX) log.events.splice(0, log.events.length - ACTIVITY_MAX);
        save();
        ctx.hub.broadcast('activity', ev);
      })
      .catch(() => {});
    return chain;
  };

  const cursor = ctx.modules.cursor;
  const hub = cursor?.onHeld ? ctx.modules.dispatch?.hub ?? null : null;
  const activity = createActivityLog({ emit, session: (sid) => hub?.get?.(sid) ?? null, now });
  const offHeld = cursor?.onHeld ? cursor.onHeld((e) => activity.held(e)) : () => {};
  const onSession = (s) => activity.sessionUpdate(s);
  hub?.on('session', onSession);

  return {
    /** For tests: resolves once every event so far is in the log. */
    settled: () => chain,
    routes: [
      {
        method: 'GET',
        path: '/api/activity',
        handler(_req, res) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(log));
        },
      },
      {
        method: 'POST',
        path: '/api/activity/read',
        async handler(req, res) {
          let at;
          try {
            at = JSON.parse((await readBody(req)) || '{}')?.at;
          } catch {
            at = undefined;
          }
          const t = now();
          if (typeof at !== 'number' || !Number.isFinite(at)) at = t;
          const readAt = Math.max(log.readAt, Math.min(at, t));
          if (readAt !== log.readAt) {
            log.readAt = readAt;
            save();
            ctx.hub.broadcast('activity-read', { readAt });
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ readAt }));
        },
      },
    ],
    async close() {
      offHeld();
      hub?.off('session', onSession);
      await chain;
      if (timer) {
        clearTimeout(timer);
        await flush();
      }
    },
  };
}
