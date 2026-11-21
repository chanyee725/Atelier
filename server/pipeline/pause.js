// Pipeline section (pause): 멈추기 · 이어서 하기 · 계획 다시 열기 (E27), and the usage-limit guard that pauses and resumes runs.
// Moved out of index.js as is (#1000); `c` is the context setup builds.
import { StoreError } from '../workspace/store.js';
import { mergeResult, pickResult } from '../runs/record.js';

export function createPause(c) {
  const { ws, recorder, dispatch, drafts, entries, save, changed, readOrNull, status } = c;
  const resultsOf = (...a) => c.resultsOf(...a);

  // ---- 멈추기 · 이어서 하기 · 계획 다시 열기 (E27) ----

  /**
   * Board tasks this run closed: the lead's step tasks that went done after this run's 시작하기. A duplicated plan
   * keeps the lead and step ids, so tasks an earlier run closed must not count for it.
   */
  function closedTasks(e) {
    const since = e.approvedAt ?? 0;
    return (dispatch()?.hub.tasks ?? []).filter((t) => t.lead === e.lead && t.step && t.stage === 'done' && (t.stageAt ?? 0) >= since);
  }

  /** Steps of a running or paused plan the board has not closed yet, in plan order. */
  function openSteps(e) {
    const done = new Set(closedTasks(e).map((t) => t.step));
    return (e.steps ?? []).filter((id) => !done.has(id));
  }

  const clock = (t) => {
    const d = new Date(t);
    return `${d.getHours()}시 ${String(d.getMinutes()).padStart(2, '0')}분`;
  };

  /** Why a paused plan cannot continue now (empty when it can). */
  function resumeBlockers(e) {
    const d = dispatch();
    if (!d) return ['Dispatch가 꺼져 있어요'];
    if (!d.hub.get(e.lead) || d.hub.get(e.lead).status === 'done') return ['계획을 쓴 관리자 세션이 없어요'];
    const hit = d.hub.limitHit();
    if (hit) return [`한도에 걸려 있어요 (${hit.reason}).${hit.resetAt ? ` ${clock(hit.resetAt)}에 초기화돼요` : ''}`];
    return [];
  }

  const entryAt = (body) => {
    if (!dispatch()) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body?.path !== 'string') throw new StoreError(400, 'path is required');
    const path = ws.runs.fileRel(body.path);
    const e = entries()[path];
    if (!e) throw new StoreError(404, '관리자가 쓴 계획이 아니에요');
    return [path, e];
  };

  // The run record may be gone (deleted, or a restart lost a run that never wrote): the plan state still changes.
  const quietly = (p) => p.catch((err) => {
    if (!(err instanceof StoreError)) console.error('pipeline run record:', err?.code ?? err?.name);
    return null;
  });

  /** Running -> paused. `by`: 'stop' (멈추기) or 'limit' (usage-limit guard, which interrupts sessions itself). */
  async function pauseEntry(path, e, by, resetAt = null) {
    e.state = 'paused';
    e.pause = { by, at: Date.now(), ...(Number.isFinite(resetAt) && resetAt > 0 && { resetAt }) };
    save();
    changed(path);
    if (e.runId) await quietly(recorder.pauseRun(e.runId, { by, resetAt, file: path }));
  }

  /** The lead and its teammates that are mid-turn, interrupted through their CLI's own control (no shell). */
  function interruptTeam(lead) {
    const d = dispatch();
    if (!d) return;
    const team = d.hub.sessions.filter((s) => s.id === lead || s.parent === lead);
    for (const s of team) if (['running', 'starting', 'waiting'].includes(s.status)) d.hub.interrupt(s.id);
  }

  async function stop(body) {
    const [path, e] = entryAt(body);
    if (e.state !== 'running') throw new StoreError(409, e.state === 'paused' ? '이미 멈췄어요' : '실행 중인 계획이 아니에요');
    // Paused first, so the reports the interrupted teammates hand over are held until 이어서 하기.
    await pauseEntry(path, e, 'stop');
    interruptTeam(e.lead);
    // The document may be in the trash: the entry still stops, the answer then has no file fields.
    if (!(await readOrNull(path))) return { path, state: e.state, lead: e.lead ?? null, runId: e.runId ?? null, pause: e.pause ?? null };
    return status(path);
  }

  /** Paused -> running, and tell the lead which steps are left. */
  async function resumeEntry(path, e, { auto = false } = {}) {
    const d = dispatch();
    const pause = e.pause ?? { by: 'stop', at: 0 };
    const mine = (t) => t.lead === e.lead;
    // A limit ticket of this lead already says what to do; its resume message carries this plan's steps through
    // hub.ticketNote, which reads paused entries, so it goes out before the state flips.
    const open = pause.by === 'limit' ? d.hub.tickets.find((t) => mine(t) && t.status === 'open') : null;
    const ticketTold = open ? d.hub.resumeTicket(open.id) : pause.by === 'limit' && d.hub.tickets.some((t) => mine(t) && t.status === 'resumed' && t.updatedAt >= pause.at);
    e.state = 'running';
    delete e.pause;
    save();
    if (e.runId) await quietly(recorder.resumeRun(path, e.runId));
    if (!ticketTold) {
      const why = pause.by === 'limit' ? '한도가 초기화돼서' : '사용자가 이어서 하기를 눌러서';
      const text = [
        `[계획 이어서 하기 · rev ${e.approvedRevision}] ${path}`,
        `${why} 멈췄던 계획을 이어서 진행한다. 브랜치·git log로 상태를 다시 확인하라.`,
        `끝나지 않은 단계: ${openSteps(e).join(', ') || '(없음)'}`,
        '멈춘 팀원 세션에는 지시를 보내면 이어진다. 팀원이 정리됐으면 필요한 만큼 다시 만들어라.',
      ].join('\n');
      try {
        d.hub.send(e.lead, text);
      } catch (err) {
        if (!auto) {
          await pauseEntry(path, e, pause.by, pause.resetAt);
          throw new StoreError(409, err.message);
        }
      }
    }
    // Reports held while stopped go out now (the watchdog would also deliver them).
    for (const s of d.hub.sessions) if (s.parent === e.lead) d.hub.deliverReport(s);
    changed(path);
  }

  async function resume(body) {
    const [path, e] = entryAt(body);
    if (e.state !== 'paused') throw new StoreError(409, '멈춘 계획이 아니에요');
    const blockers = resumeBlockers(e);
    if (blockers.length) throw new StoreError(409, blockers[0], { blockers });
    await resumeEntry(path, e);
    return status(path);
  }

  /**
   * 정리 on the dashboard (#836): a waiting plan whose lead session is gone can never start as it is, so the person
   * takes it off the 승인 대기 list. The document stays; only the waiting flag goes, as after a reopen.
   */
  async function dismiss(body) {
    const [path, e] = entryAt(body);
    if (e.state !== 'plan') throw new StoreError(409, '시작을 기다리는 계획이 아니에요');
    if (dispatch()?.hub.get(e.lead)) throw new StoreError(409, '관리자 세션이 아직 있어요');
    e.reopened = true;
    save();
    changed(path);
    return { path, dismissed: true };
  }

  /** Paused -> plan: the run ends (stopped) and the steps the board closed carry over to the next 시작하기. */
  async function reopen(body) {
    const [path, e] = entryAt(body);
    if (e.state === 'running') throw new StoreError(409, '실행 중이에요. 먼저 멈추기를 눌러 주세요');
    if (e.state !== 'paused') throw new StoreError(409, '멈춘 계획이 아니에요');
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    const d = dispatch();
    const runId = e.runId;
    // Steps this run carried over from an earlier stopped run stay done, with how they closed then.
    const record = runId
      ? await recorder.read(path, runId).catch((err) => {
          // Metadata only: without the record the steps it carried over count as open again.
          console.error('pipeline reopen record:', err?.code ?? err?.name);
          return null;
        })
      : null;
    const carried = Object.keys(record?.steps ?? {}).filter((id) => record.steps[id].carried && e.steps?.includes(id));
    const open = openSteps(e);
    const done = (e.steps ?? []).filter((id) => !open.includes(id) || carried.includes(id));
    // How the board closed them, kept now: the next run only counts tasks closed after its own 시작하기.
    const results = {};
    for (const id of carried) {
      const r = pickResult(record.steps[id].result);
      if (r) results[id] = r;
    }
    for (const [id, r] of Object.entries(resultsOf(e))) {
      const next = mergeResult(results[id], pickResult(r));
      if (next) results[id] = next;
    }
    if (runId) await quietly(recorder.endPaused(path, runId, 'stopped'));
    // Reopened by the person, so it does not ask them again in the 알림함 until the lead writes it anew (#786).
    Object.assign(e, { state: 'plan', reopened: true, draftRevision: file.revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {} });
    delete e.pause;
    if (runId && done.length) e.carry = { from: runId, steps: done, results };
    else delete e.carry;
    drafts.set(path, file.plan);
    save();
    changed(path);
    const text = [
      `[계획 다시 열림] ${path}`,
      '사용자가 계획을 다시 열었다. 시작하기를 다시 누를 때까지 팀원을 새로 만들거나 새 일을 시키지 마라. 고칠 게 있으면 write_plan(path 그대로)으로 고친다.',
      `이미 끝난 단계: ${done.join(', ') || '(없음)'}`,
    ].join('\n');
    try {
      d.hub.send(e.lead, text);
    } catch {
      /* the lead hears it with the next [계획 승인] */
    }
    return status(path);
  }

  /** What the next run takes over from the run 계획 다시 열기 stopped. */
  async function carryOf(path, e) {
    if (!e?.carry?.from || !e.carry.steps?.length) return null;
    const old = await recorder.read(path, e.carry.from).catch(() => null);
    if (!old) return null;
    const steps = {};
    for (const id of e.carry.steps) {
      if (!old.steps?.[id]) continue;
      const result = e.carry.results?.[id];
      steps[id] = result ? { ...old.steps[id], result } : old.steps[id];
    }
    return { from: e.carry.from, steps };
  }

  /** The limit guard pauses running plans; once no window is over its threshold, the plans it paused go on. */
  let syncing = false;
  async function syncLimit() {
    const d = dispatch();
    if (!d || syncing) return;
    syncing = true;
    try {
      const hit = d.hub.limitHit();
      for (const [path, e] of Object.entries(entries() ?? {})) {
        if (hit && e.state === 'running') await pauseEntry(path, e, 'limit', hit.resetAt);
        else if (!hit && e.state === 'paused' && e.pause?.by === 'limit' && d.hub.get(e.lead) && d.hub.get(e.lead).status !== 'done') {
          await resumeEntry(path, e, { auto: true });
        }
      }
    } catch (err) {
      console.error('pipeline limit sync:', err?.message);
    } finally {
      syncing = false;
    }
  }
  // A window can reset without any new event (time passes): look again now and then.
  const limitTimer = setInterval(() => void syncLimit(), 30_000);
  limitTimer.unref?.();

  Object.assign(c, { closedTasks, openSteps, resumeBlockers, quietly, pauseEntry, interruptTeam, stop, resumeEntry, resume, dismiss, reopen, carryOf, syncLimit, limitTimer });
}
