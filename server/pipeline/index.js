// Pipeline module (E20): the lead writes a plan into a workspace file (write_plan), the person checks it and
// presses 시작하기, and only then may the lead create teammates. See docs/design/dispatch-integration/3-ux-flow.md
// §2-3 and 4-operations-and-rules.md G2.
//
// Approval state lives in the Dispatch state file as metadata only:
//   store.data.pipelines[path] = { lead, state: 'plan' | 'running' | 'paused' | 'done', draftRevision,
//                                  approvedRevision, approvedAt, runId, steps, links, pause?, carry?, doneAt?,
//                                  lastApprovedRevision? }
// `steps` is the approved step ids and `links` maps a session id to its step. E27: `pause` is { by: 'limit' |
// 'stop', at, resetAt? } while paused; `carry` is { from: runId, steps: [ids], results? } after 계획 다시 열기, the steps the
// stopped run finished, so the next 시작하기 marks them done instead of running them again. The lead's draft plan (for the
// "바뀐 점" list) is kept in memory only, so after a restart the list is empty.
// E28: once the board closes every step the run ends `done`, the server writes the 완료 summary block into the
// document once, and the history labels the draft, approved and done versions. A done plan is a record: running it
// again means 복제해서 새 계획 (POST /api/pipeline/duplicate), a fresh draft without the summary.
import { StoreError } from '../workspace/store.js';
import { FILE_EXT } from '../workspace/model.js';
import { redact } from '../dispatch/redact.js';
import { mergeResult, pickResult } from '../runs/record.js';
import { effectiveRoles } from '../dispatch/settings.js';
import { topFolder } from '../dispatch/session-folder.js';
import { planFileName } from './shared.js';
import { createNote } from './note.js';
import { createFinish } from './finish.js';
import { createPause } from './pause.js';
import { createStart } from './start.js';
import { createWritePlan } from './write-plan.js';
import { resolvePlanRoles } from './plan-roles.js';
import { inferPlanFolder, isFolderName, PLAN_FILE_STEM, topFolders } from './plan-folder.js';
import { buildPlanFile, planChanges, writePlanProblem, PLAN_BLOCK_ID } from '../../shared/dispatch/plan-write.ts';
import { resolvedStep } from '../../shared/dispatch/plan.ts';
import { applyStepOverrides } from '../../shared/dispatch/plan-overrides.ts';
import { planOrderIn } from '../../shared/dispatch/plan-diagram.ts';
import { nodeLabels, summaryNodes, withSummary, withoutSummary } from '../../shared/dispatch/run-summary.ts';

export { planFileName };

const MAX_BODY = 1024 * 1024;
const PROVIDER_NAMES = { claude: 'Claude', openai: 'OpenAI Codex', gemini: 'Gemini' };

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StoreError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') ?? {};
  } catch {
    throw new StoreError(400, 'invalid JSON');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Session fields a run record keeps (record.js pickSession drops anything else). */
function sessionMeta(s) {
  const ctxPct = s.ctxWindow > 0 ? Math.round((100 * (s.ctx || 0)) / s.ctxWindow) : undefined;
  return {
    sid: s.id, name: s.name, role: s.role, provider: s.provider, model: s.model, effort: s.effort ?? undefined, branch: s.branch ?? undefined,
    accountLabel: s.accountLabel ?? undefined, issue: s.issue ?? undefined, startedAt: s.startedAt,
    endedAt: s.status === 'done' ? s.updatedAt : undefined,
    mode: s.mode ?? undefined, profileNote: s.profileNote ?? undefined,
    state: s.state, stateSince: s.stateSince, cost: s.cost ?? undefined, ctxPct, tokens: s.usage,
    ...(s.pr !== undefined && { pr: s.pr }),
  };
}

export async function setup(ctx) {
  const ws = ctx.modules.workspace?.store;
  const recorder = ctx.modules.runs?.recorder;
  if (!ws || !recorder) return {};
  const dispatch = () => (ctx.modules.dispatch?.status?.().enabled ? ctx.modules.dispatch : null);
  const drafts = new Map(); // path -> the plan as the lead last wrote it (memory only)

  const entries = () => {
    const d = dispatch();
    if (!d) return null;
    return (d.store.data.pipelines ||= {});
  };
  const save = () => dispatch()?.store.save();
  const changed = (path) => {
    const e = entries()?.[path];
    ctx.hub.broadcast('pipeline', { path, state: e?.state ?? null });
  };
  const leadEntries = (lead, state) =>
    Object.entries(entries() ?? {})
      .filter(([, e]) => e.lead === lead && (!state || (Array.isArray(state) ? state.includes(e.state) : e.state === state)))
      .sort((a, b) => (b[1].approvedAt ?? 0) - (a[1].approvedAt ?? 0));

  // ---- hub hooks ----
  const d0 = dispatch();
  if (d0) {
    const hub = d0.hub;
    hub.createGate = (parent) => {
      if (leadEntries(parent, 'plan').length) return '계획 승인 전이에요. 사용자가 시작하기를 누르면 [계획 승인] 메시지가 와요';
      if (leadEntries(parent, 'paused').length && !leadEntries(parent, 'running').length) return '계획이 멈춰 있어요. 이어서 하기를 기다려 주세요';
      return null;
    };
    hub.holdTeam = (lead) => leadEntries(lead, 'paused').some(([, e]) => e.pause?.by === 'stop');
    hub.ticketNote = (lead) =>
      leadEntries(lead, 'paused')
        .filter(([, e]) => e.pause?.by === 'limit')
        .map(([path, e]) => `[계획 이어서 하기 · rev ${e.approvedRevision}] ${path}\n끝나지 않은 단계: ${openSteps(e).join(', ') || '(없음)'}`)
        .join('\n');
    hub.taskStepCheck = (lead, step) => {
      const running = leadEntries(lead, 'running');
      if (!running.length) return '실행 중인 계획이 없어요';
      if (!running.some(([, e]) => e.steps?.includes(step))) return `승인된 계획에 단계 "${step.slice(0, 40)}"가 없어요`;
      return null;
    };
    // Session metadata goes to the run record of its lead's running plan, under the step its task names.
    // `skip` holds plans whose run record could not be read (missing, corrupt, another runId) during this pass.
    // `unreadable` remembers, per plan and run, a read that failed, so later events do not read it again.
    const unreadable = new Set();
    const follow = (s, skip = new Set()) => {
      if (!s?.parent) return;
      for (const [path, e] of leadEntries(s.parent, ['running', 'paused'])) {
        if (skip.has(path)) continue;
        const links = (e.links ||= {});
        let step = links[s.id];
        if (!step) {
          // A paused run a server restart dropped from memory: which steps it carried over is on disk. Read that
          // first and look again, so a link is never saved to a carried step meanwhile. Stop here rather than try
          // the next plan, or the session could end up linked to both. Look again with the session as it is then,
          // so an event that came in meanwhile is not rolled back. A session deleted during the read is skipped. If
          // the read fails, its carried steps stay unknown: look again without that plan, so the session can still
          // be linked to the lead's other plans.
          if (e.runId && recorder.isCarried(e.runId, '') === null) {
            if (unreadable.has(`${path}\0${e.runId}`)) continue;
            const runId = e.runId;
            void recorder.readCarried(path, runId).then((ok) => {
              if (!ok) unreadable.add(`${path}\0${runId}`);
              const now = hub.get(s.id);
              if (now) follow(hub.publicSession(now), ok ? skip : new Set([...skip, path]));
            });
            return;
          }
          // Only tasks of this run: open ones, or ones closed after its 시작하기. A task an earlier run closed (a step
          // 계획 다시 열기 carried over) must not pull the session that did it into this run, or new work it gets
          // lands on the carried step. The same goes for that old task reopened (same id, same step): a carried step
          // stays done, so it never takes a session.
          const since = e.approvedAt ?? 0;
          const task = hub.tasks.find(
            (t) =>
              t.lead === s.parent &&
              t.step &&
              t.owner === s.name &&
              e.steps?.includes(t.step) &&
              (t.stage !== 'done' || (t.stageAt ?? 0) >= since) &&
              !recorder.isCarried(e.runId, t.step),
          );
          if (!task) continue;
          step = links[s.id] = task.step;
          save();
        }
        try {
          recorder.updateSession(e.runId, step, sessionMeta(s));
        } catch {
          /* the run ended or the step is gone: nothing to record */
        }
        return;
      }
    };
    hub.on('session', (s) => follow(s));
    // A task that names a step and an owner links that owner's session (set_task often comes after create_sessions).
    hub.on('tasks', () => {
      for (const s of hub.sessions) if (s.parent && leadEntries(s.parent, ['running', 'paused']).length) follow(hub.publicSession(s));
      void finishClosed();
    });
    // The usage-limit guard pauses running plans and resumes the ones it paused once the window clears (G1).
    hub.on('limits', () => syncLimit());
    hub.on('tickets', () => syncLimit());
  }

  // File moves carry the approval state along (a folder move moves every file under it).
  const unsubscribe = ws.runs.onChange((e) => {
    // A trashed plan document pauses its run: nothing is left to approve or resume from, and it must not keep
    // blocking a folder switch. Restoring it shows 이어서 하기 again.
    if (e.kind === 'trash') {
      const entry = entries()?.[e.path];
      if (entry?.state === 'running') {
        pauseEntry(e.path, entry, 'stop').catch((err) => console.error('pipeline pause on trash:', err?.code ?? err?.name));
        interruptTeam(entry.lead);
      }
      // A trashed plan no longer waits for 시작하기: the 알림함 drops it (#786).
      if (entry?.state === 'plan') changed(e.path);
      return;
    }
    if (e.kind !== 'move') return;
    const all = entries();
    if (!all) return;
    let moved = false;
    for (const p of Object.keys(all)) {
      if (p !== e.from && !p.startsWith(e.from + '/')) continue;
      const to = e.to + p.slice(e.from.length);
      all[to] = all[p];
      delete all[p];
      if (drafts.has(p)) {
        drafts.set(to, drafts.get(p));
        drafts.delete(p);
      }
      moved = true;
    }
    if (moved) {
      save();
      changed(e.to);
    }
    // Sessions follow their project when its top folder is renamed or moved (#487). A top folder moved into
    // another folder belongs to that one's project now.
    const hub = dispatch()?.hub;
    for (const s of hub?.sessions ?? []) {
      if (typeof s.folder !== 'string' || (s.folder !== e.from && !s.folder.startsWith(e.from + '/'))) continue;
      const to = e.to + s.folder.slice(e.from.length);
      const folder = to.includes('/') ? topFolder(to) : to;
      if (folder !== s.folder) hub.touch(s, { folder });
    }
  });

  const readOrNull = (path) =>
    ws.readFile(path).catch((err) => {
      if (err instanceof StoreError && err.status === 404) return null;
      if (err?.code === 'ENOENT') return null;
      throw err;
    });

  /** Why this file cannot start now (empty when it can), and what it would start. */
  async function check(path, file, entry) {
    const blockers = [];
    const d = dispatch();
    const plan = file?.plan ?? null;
    const steps = plan?.steps ?? [];
    let sessions = 0;
    let usesClaude = false;
    if (!d) blockers.push('Dispatch가 꺼져 있어요');
    if (!plan || steps.length === 0) blockers.push('단계가 없어요');
    if (!entry) blockers.push('관리자가 쓴 계획이 아니에요');
    else if (d && !d.hub.get(entry.lead)) blockers.push('계획을 쓴 관리자 세션이 없어요');
    if (plan && steps.length) {
      const roles = d ? effectiveRoles(d.hub.roles, d.store) : [];
      const missing = new Set();
      for (const raw of steps) {
        const s = resolvedStep(plan, raw);
        sessions += s.n ?? 1;
        if (!s.role) {
          blockers.push(`단계 ${s.id}에 역할이 없어요`);
          continue;
        }
        if (!d) continue;
        const role = roles.find((r) => r.id === s.role);
        if (!role) {
          blockers.push(`단계 ${s.id}의 역할 "${s.role.slice(0, 40)}"을 몰라요`);
          continue;
        }
        // A step with a mode and no model runs on the mode's profile (#748), resolved now the way create_sessions
        // will: it already falls back to a connected provider, so only "nothing usable" blocks.
        if (!s.model && s.mode && d.modeProfiles) {
          const p = await d.modeProfiles.resolve(s.mode, s.role, { perm: s.perm });
          if (!p) blockers.push(`단계 ${s.id}의 ${s.mode} 모드에 쓸 수 있는 모델이 없어요`);
          else if (p.provider === 'claude') usesClaude = true;
          continue;
        }
        const modelId = s.model || role.model;
        const model = d.models.find((m) => m.id === modelId);
        if (!model) blockers.push(`단계 ${s.id}의 모델 "${String(modelId).slice(0, 60)}"을 몰라요`);
        else if (!d.hub.isConnected(model.provider)) missing.add(model.provider);
        else if (model.provider === 'claude') usesClaude = true;
      }
      for (const p of missing) blockers.push(`${PROVIDER_NAMES[p] ?? p}가 연결되지 않았어요`);
      const order = planOrderIn(plan, file.blocks ?? []);
      if (!order.ok) blockers.push(order.cycle ? `단계가 서로를 기다려요: ${order.cycle.join(' > ')}` : '단계 순서를 알 수 없어요');
      const guard = d && usesClaude ? d.hub.guardCheck(sessions) : null;
      if (guard) blockers.push(guard);
    }
    return { blockers, sessions };
  }

  async function status(path) {
    path = ws.runs.fileRel(path);
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    const entry = entries()?.[path] ?? null;
    const state = entry?.state ?? (file.plan ? 'plan' : null);
    const { blockers, sessions } =
      state === 'running' || state === 'done' ? { blockers: [], sessions: 0 } : state === 'paused' ? { blockers: resumeBlockers(entry), sessions: 0 } : await check(path, file, entry);
    const l = dispatch()?.hub.currentLimits() ?? null;
    return {
      path,
      revision: file.revision,
      state,
      lead: entry?.lead ?? null,
      draftRevision: entry?.draftRevision ?? null,
      approvedRevision: entry?.approvedRevision ?? null,
      approvedAt: entry?.approvedAt ?? null,
      // The revision the person last started (#729): kept through 계획 다시 열기 and the lead's revisions, so a plan
      // that waits again reads as a revision to approve anew (rev N), not a first approval.
      lastApprovedRevision: entry?.lastApprovedRevision ?? null,
      runId: entry?.runId ?? null,
      pause: state === 'paused' ? (entry.pause ?? null) : null,
      doneAt: state === 'done' ? (entry.doneAt ?? null) : null,
      blockers,
      changes: state === 'plan' && entry ? planChanges(drafts.get(path), file.plan) : [],
      sessions,
      limits: l ? { five: l.five ?? null, seven: l.seven ?? null, fiveReset: l.fiveReset ?? null, sevenReset: l.sevenReset ?? null } : null,
    };
  }

  // Each section file adds its functions to `c`; sections call each other through `c` at call time (#1000).
  const c = { ctx, ws, recorder, dispatch, drafts, entries, save, changed, leadEntries, readOrNull, check, status };

  createWritePlan(c);

  createStart(c);

  createPause(c);

  createFinish(c);

  createNote(c);

  const { note, unclosed, resultsOf, finish, finishClosed, duplicate, closedTasks, openSteps, resumeBlockers, quietly, pauseEntry, interruptTeam, stop, resumeEntry, resume, dismiss, reopen, carryOf, syncLimit, limitTimer, start, freePath, writePlan } = c;

  const route = (method, path, fn) => ({
    method,
    path,
    async handler(req, res, _ctx, _m, url) {
      try {
        const body = method === 'GET' ? null : await readJson(req);
        send(res, 200, await fn(body, url.searchParams));
      } catch (err) {
        if (!(err instanceof StoreError)) throw err;
        send(res, err.status, { error: err.message, ...(err.revision !== undefined && { revision: err.revision }), ...(err.blockers && { blockers: err.blockers }) });
      }
    },
  });

  /**
   * Plans that wait for 시작하기 (#786): written by a lead, not reopened by the person, document still there.
   * Metadata only: path, title, the lead's session name and since when, plus what the dashboard's 승인 대기 card
   * (#836) needs to start it there: the revision 시작하기 approves, the blockers and whether the lead is gone.
   */
  async function waiting() {
    const d = dispatch();
    const out = [];
    for (const [path, e] of Object.entries(entries() ?? {})) {
      if (e?.state !== 'plan' || e.reopened) continue;
      const file = await readOrNull(path).catch(() => null);
      if (!file) continue;
      const lead = d?.hub.get(e.lead) ?? null;
      const { blockers } = await check(path, file, e).catch(() => ({ blockers: ['상태를 확인하지 못했어요'] }));
      out.push({
        path,
        title: typeof file.title === 'string' ? file.title : null,
        lead: lead?.name ?? null,
        since: e.waitingSince ?? null,
        revision: file.revision,
        blockers,
        leadGone: Boolean(d && !lead),
      });
    }
    out.sort((a, b) => (b.since ?? 0) - (a.since ?? 0) || a.path.localeCompare(b.path));
    return { plans: out };
  }

  return {
    status,
    waiting,
    writePlan,
    start,
    note,
    stop,
    resume,
    reopen,
    dismiss,
    duplicate,
    finishClosed,
    syncLimit,
    close: () => {
      clearInterval(limitTimer);
      unsubscribe();
    },
    routes: [
      route('GET', '/api/pipeline', (_b, q) => {
        const p = q.get('path');
        if (typeof p !== 'string') throw new StoreError(400, 'path is required');
        return status(p);
      }),
      route('GET', '/api/pipeline/waiting', () => waiting()),
      route('POST', '/api/pipeline/plan', (b) => writePlan(b)),
      route('POST', '/api/pipeline/start', (b) => start(b)),
      route('POST', '/api/pipeline/note', (b) => note(b)),
      route('POST', '/api/pipeline/stop', (b) => stop(b)),
      route('POST', '/api/pipeline/resume', (b) => resume(b)),
      route('POST', '/api/pipeline/reopen', (b) => reopen(b)),
      route('POST', '/api/pipeline/dismiss', (b) => dismiss(b)),
      route('POST', '/api/pipeline/duplicate', (b) => duplicate(b)),
    ],
  };
}
