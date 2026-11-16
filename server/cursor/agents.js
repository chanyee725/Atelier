// Live agent list (E528, issue #592): the agent sessions working in the workspace right now, with the file each one
// holds, for the project view. Memory only: nothing about it is written to disk.
//   GET /api/workspace/agents[?project=<top folder>] -> { agents } (shape: shared/dispatch/agent-presence.ts)
//   SSE `agents` -> { agents } for the whole workspace, once on connect and again on every change.
// Sessions and their state come from the Dispatch hub; the held file from the cursor module's attribution
// (server/cursor/index.js). Outside API writers that name themselves (`x-drawing-session`) are listed for
// OUTSIDE_TTL_MS after their last write.
import { buildAgents } from './presence.js';

export const OUTSIDE_TTL_MS = 2 * 60_000;
const MAX_OUTSIDE = 20;
const PRUNE_MS = 15_000;

export async function setup(ctx, { now = Date.now } = {}) {
  // Without the cursor module (no agent sessions: Dispatch off outside a git project) the list is always empty.
  const cursor = ctx.modules.cursor;
  const hub = cursor?.onHeld ? ctx.modules.dispatch?.hub ?? null : null;
  const held = new Map(); // session id -> { file, at }
  const outside = new Map(); // label -> { file, at }, insertion order = age
  const activity = new Map(); // session id -> tool activity label of its current turn (from `session` events)
  let last = '';

  const sessions = () => {
    const all = hub?.sessions ?? [];
    return Array.isArray(all) ? all : Object.values(all);
  };
  const prune = () => {
    const t = now();
    for (const [k, v] of outside) if (t - v.at > OUTSIDE_TTL_MS) outside.delete(k);
  };
  const list = (project = null) => {
    prune();
    return buildAgents({ sessions: sessions(), held, outside, project, activity });
  };
  // Sent only when the list really changed, so a session's other updates (tokens, cost) do not repeat it.
  const update = () => {
    const agents = list();
    const json = JSON.stringify(agents);
    if (json === last) return;
    last = json;
    ctx.hub.broadcast('agents', { agents });
  };

  const offHeld = (cursor?.onHeld ?? (() => () => {}))((e) => {
    if (!e?.sid) return;
    if (e.outside) {
      outside.delete(e.name);
      outside.set(e.name, { file: e.file, at: e.at });
      if (outside.size > MAX_OUTSIDE) outside.delete(outside.keys().next().value);
    } else if (e.gone) {
      held.delete(e.sid);
    } else {
      held.set(e.sid, { file: e.file, at: e.at });
    }
    update();
  });
  // The hub's public session carries `activity` ({ label, since } while a turn runs a tool, else null); the stored
  // session does not, so the label is kept here.
  const onSession = (s) => {
    if (s?.id) {
      const label = typeof s.activity?.label === 'string' && s.activity.label ? s.activity.label : null;
      if (label) activity.set(s.id, label);
      else activity.delete(s.id);
    }
    update();
  };
  const onRemoved = ({ id } = {}) => {
    held.delete(id);
    activity.delete(id);
    update();
  };
  hub?.on('session', onSession);
  hub?.on('removed', onRemoved);
  ctx.hub.onAttach?.((sendTo) => sendTo('agents', { agents: list() }));
  const timer = setInterval(() => { if (outside.size) update(); }, PRUNE_MS);
  timer.unref?.();

  return {
    list,
    routes: [
      {
        method: 'GET',
        path: '/api/workspace/agents',
        handler(_req, res, _ctx, _m, url) {
          const project = url.searchParams.get('project') || null;
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ agents: list(project) }));
        },
      },
    ],
    close() {
      clearInterval(timer);
      offHeld();
      hub?.off('session', onSession);
      hub?.off('removed', onRemoved);
    },
  };
}
