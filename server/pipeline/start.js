// Pipeline section (시작하기): the person approves a plan revision and the run starts.
// Moved out of index.js as is (#1000); `c` is the context setup builds.
import { StoreError } from '../workspace/store.js';
import { topFolder } from '../dispatch/session-folder.js';
import { DRAFT_FOLDER, draftFeatureFolder } from './plan-folder.js';
import { planChanges } from '../../shared/dispatch/plan-write.ts';
import { applyStepOverrides } from '../../shared/dispatch/plan-overrides.ts';

export function createStart(c) {
  const { ws, recorder, dispatch, drafts, entries, save, changed, readOrNull, check } = c;
  const carryOf = (...a) => c.carryOf(...a);

  /** A session that is finished for good: only `done` (an `error` one can be messaged back to running). */
  const isFinished = (s) => s.status === 'done';
  /** Plan entries a 시작하기 is working on: a second one meanwhile is refused (the move below takes a while). */
  const starting = new Set();

  /**
   * A draft in 기획/<feature>/ moves to <area>/<feature>/ when its run starts (#1045), with its diagrams and
   * sub-documents. A feature folder of that name already in the area: <feature>-2, -3, …. The store's move event
   * carries the plan's entry, its draft, run records, history and sessions along (index.js). Returns the move done,
   * or why the plan stayed in 기획 ({ from, to } | { stayed }).
   */
  async function moveToArea(path, entry) {
    const from = draftFeatureFolder(path);
    if (!from) return null;
    const area = typeof entry.area === 'string' && entry.area && entry.area !== DRAFT_FOLDER ? entry.area : null;
    if (!area) return { stayed: '영역을 정할 수 없어 기획 폴더에 그대로 뒀다' };
    const name = from.slice(DRAFT_FOLDER.length + 1);
    for (let i = 1; i < 20; i++) {
      try {
        const r = await ws.move(from, `${area}/${name}${i === 1 ? '' : `-${i}`}`, 'folder');
        return { from, to: r.path };
      } catch (err) {
        if (err instanceof StoreError && err.status === 409 && /already exists/.test(err.message)) continue;
        return { stayed: `${area}로 옮기지 못해 기획 폴더에 그대로 뒀다(${String(err?.message ?? err).slice(0, 80)})` };
      }
    }
    return { stayed: `${area}에 같은 이름 폴더가 너무 많아 기획 폴더에 그대로 뒀다` };
  }

  async function start(body, opts = {}) {
    const key = typeof body?.path === 'string' ? entries()?.[ws.runs.fileRel(body.path)] : null;
    if (key && starting.has(key)) throw new StoreError(409, '이미 시작하는 중이에요');
    if (key) starting.add(key);
    try {
      return await startNow(body, opts);
    } finally {
      if (key) starting.delete(key);
    }
  }

  // ---- 시작하기 ----
  async function startNow(body, { auto = false } = {}) {
    const d = dispatch();
    if (!d) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    if (typeof body.path !== 'string') throw new StoreError(400, 'path is required');
    let path = ws.runs.fileRel(body.path);
    if (!Number.isInteger(body.revision)) throw new StoreError(400, 'revision is required');
    const entry = entries()[path];
    if (entry?.state === 'running') throw new StoreError(409, '이미 실행 중이에요');
    if (entry?.state === 'paused') throw new StoreError(409, '멈춘 계획이에요. 이어서 하기나 계획 다시 열기를 눌러 주세요');
    if (entry?.state === 'done') throw new StoreError(409, '완료된 계획이에요. 다시 돌리려면 복제해서 새 계획을 눌러 주세요');
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    if (file.revision !== body.revision) throw new StoreError(409, '계획이 바뀌었어요. 다시 확인해 주세요', { revision: file.revision });
    // The person's choices in the start confirm (#972) apply to this run only; the file keeps the plan they approved.
    const applied = applyStepOverrides(file.plan, body.overrides);
    if ('error' in applied) throw new StoreError(400, applied.error);
    const effective = applied.plan;
    const { blockers } = await check(path, { ...file, plan: effective }, entry);
    if (blockers.length) throw new StoreError(409, blockers[0], { blockers });
    const changes = planChanges(drafts.get(path), file.plan);
    const chosen = planChanges(file.plan, effective);
    const carry = await carryOf(path, entry);
    // The draft joins its area before the run record is made, so the record starts at the new path.
    const draftPath = path;
    const moved = await moveToArea(path, entry);
    if (moved?.to) path = `${moved.to}${draftPath.slice(moved.from.length)}`;
    const record = await recorder.startRun({ file: path, plan: effective, revision: file.revision, carry });
    const carried = Object.keys(record.steps).filter((id) => record.steps[id].carried);
    const prevCarry = entry.carry;
    const prevApproved = entry.lastApprovedRevision;
    delete entry.carry;
    Object.assign(entry, { state: 'running', overrides: chosen.length ? body.overrides : undefined, lastApprovedRevision: file.revision, approvedRevision: file.revision, approvedAt: Date.now(), runId: record.id, steps: Object.keys(record.steps), links: {} });
    // The lead and its live team (or members without a folder) now work for the project the approved plan
    // lives in (E505c). Descendants of the lead count, not only direct children. Only `done` sessions are finished
    // and keep their folder; an `error` session can be messaged back to running, so it moves with the team.
    // A moved session carries its whole past cost to the new folder (cost is not split).
    const planFolder = topFolder(path);
    if (planFolder) {
      const sessions = d.hub.sessions;
      const team = new Set([entry.lead]);
      for (let grew = true; grew;) {
        grew = false;
        for (const s of sessions) if (!team.has(s.id) && team.has(s.parent)) { team.add(s.id); grew = true; }
      }
      for (const s of sessions) {
        if (!team.has(s.id)) continue;
        const mine = s.id === entry.lead || !isFinished(s) || s.folder == null;
        if (mine && s.folder !== planFolder) d.hub.touch(s, { folder: planFolder });
      }
    }
    save();
    const lines = [
      `[계획 승인 · rev ${file.revision}] ${path}`,
      ...(moved?.to ? [`계획 폴더를 ${moved.from}에서 ${moved.to}로 옮겼다. 이제 이 경로를 쓴다.`] : moved?.stayed ? [`계획 폴더: ${moved.stayed}.`] : []),
      auto ? '단계 하나짜리 계획이라 바로 시작했다.' : '사용자가 이 계획으로 시작하기를 눌렀다.',
      changes.length ? `바뀐 점(네 초안 이후 사용자가 고친 것):\n${changes.map((c) => `- ${c}`).join('\n')}` : '바뀐 점: 없음',
      ...(chosen.length ? [`시작 창에서 사용자가 이번 실행만 바꾼 구성(계획 파일은 그대로, 이 구성으로 팀원을 만든다):\n${chosen.map((c) => `- ${c}`).join('\n')}`] : []),
      ...(carried.length ? [`지난 실행에서 끝난 단계(다시 하지 마라): ${carried.join(', ')}`] : []),
      `승인된 리비전을 따른다. 단계마다 create_sessions로 팀원을 만들고(단계에 mode가 있으면 create_sessions에도 같은 mode를 넣는다), set_task에 step(${record && Object.keys(record.steps).join(', ')})과 owner(세션 이름)를 넣는다. 단계에 남길 한 줄은 note_step으로 남긴다.`,
    ];
    try {
      d.hub.send(entry.lead, lines.join('\n'));
    } catch (err) {
      // The lead never heard of it: the run did not really start.
      Object.assign(entry, { state: 'plan', approvedRevision: null, approvedAt: null, runId: null, steps: [], lastApprovedRevision: prevApproved, ...(prevCarry && { carry: prevCarry }) });
      if (prevApproved == null) delete entry.lastApprovedRevision;
      save();
      await recorder.endRun(record.id, 'stopped').catch(() => {});
      // The plan goes back to 기획 as it was (its entry and records follow the move back).
      if (moved?.to) await ws.move(moved.to, moved.from, 'folder').catch((e) => console.error('pipeline move back:', e?.code ?? e?.name));
      throw new StoreError(409, err.message);
    }
    await ws.labelVersion(path, 'approved');
    changed(path);
    return { path, state: 'running', runId: record.id, revision: file.revision, changes, overrides: chosen };
  }

  Object.assign(c, { start });
}
