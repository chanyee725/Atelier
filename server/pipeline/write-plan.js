// Pipeline section (write): write_plan: the lead writes or revises its draft plan file.
// Moved out of index.js as is (#1000); `c` is the context setup builds.
import { StoreError } from '../workspace/store.js';
import { FILE_EXT } from '../workspace/model.js';
import { effectiveRoles } from '../dispatch/settings.js';
import { topFolder } from '../dispatch/session-folder.js';
import { resolvePlanRoles } from './plan-roles.js';
import { inferPlanFolder, isFolderName, PLAN_FILE_STEM, topFolders } from './plan-folder.js';
import { buildPlanFile, writePlanProblem, PLAN_BLOCK_ID } from '../../shared/dispatch/plan-write.ts';
import { planFileName } from './shared.js';

export function createWritePlan(c) {
  const { ctx, ws, dispatch, drafts, entries, save, changed, leadEntries, readOrNull } = c;
  const start = (...a) => c.start(...a);

  // ---- write_plan ----
  // <area>/<feature>/계획.dpx.json, or 계획-2… when that name is taken. An empty dir is the top level.
  async function freePath(dir) {
    for (let i = 1; i < 100; i++) {
      const p = `${dir ? `${dir}/` : ''}${PLAN_FILE_STEM}${i === 1 ? '' : `-${i}`}${FILE_EXT}`;
      if (!(await readOrNull(p))) return p;
    }
    throw new StoreError(409, '같은 이름의 계획이 너무 많아요');
  }

  async function writePlan(body) {
    const d = dispatch();
    if (!d) throw new StoreError(409, 'Dispatch가 꺼져 있어요');
    const lead = typeof body.lead === 'string' ? d.hub.get(body.lead) : null;
    if (!lead || !lead.canSpawn) throw new StoreError(400, '관리자 세션만 계획을 쓸 수 있어요');
    // Step roles must be ones the team has; common aliases (implementer, reviewer, …) map to their ids (#788).
    const roleIds = effectiveRoles(d.hub.roles, d.store).map((r) => r.id);
    const resolved = resolvePlanRoles(body.steps, roleIds);
    if (resolved.error) throw new StoreError(400, resolved.error);
    const input = { title: body.title, goal: body.goal, steps: resolved.steps, risks: body.risks, asks: body.asks };
    const problem = writePlanProblem(input);
    if (problem) throw new StoreError(400, problem);
    const all = entries();
    let path;
    if (typeof body.path === 'string' && body.path.trim()) path = ws.runs.fileRel(body.path.trim().endsWith(FILE_EXT) ? body.path.trim() : body.path.trim() + FILE_EXT);
    else {
      // Without a path, a lead revises its own draft.
      const own = leadEntries(lead.id, 'plan')[0];
      path = own ? own[0] : null;
    }
    // A new plan the lead names no path for goes to <area>/<feature>/계획.dpx.json (#782). The area is the one
    // write_plan names (`area`, or the older `folder`), else the lead's, else the one top-level folder every file the
    // steps name sits in; it may be new (the lead picks areas from the project's structure). The feature defaults to
    // the title. Names that are not one plain path segment are refused even when a path is given.
    const named = (key, label) => {
      const v = body[key];
      if (v == null || v === '') return null;
      const name = typeof v === 'string' ? v.trim().normalize('NFC') : '';
      if (!isFolderName(name)) throw new StoreError(400, `${label} 이름은 폴더 하나여야 해요(/, .., 숨김 이름 안 돼요): ${String(v).slice(0, 80)}`);
      return name;
    };
    const area = named('area', '영역') ?? named('folder', '영역');
    const feature = named('feature', '기능');
    const folders = await topFolders(ws.root);
    const leadFolder = area ?? (lead.folder && isFolderName(lead.folder) ? lead.folder : null) ?? inferPlanFolder(input.steps, folders);
    const existing = path ? all[path] : null;
    if (existing?.state === 'paused') throw new StoreError(409, '멈춘 계획이에요. 사용자가 계획 다시 열기를 누르면 고칠 수 있어요');
    if (existing?.state === 'running') throw new StoreError(409, '실행 중인 계획은 바꿀 수 없어요. 바뀐 점은 note_step으로 남겨 주세요');
    if (existing?.state === 'done') throw new StoreError(409, '완료된 계획이에요. 사용자가 복제해서 새 계획을 누르면 그 파일을 고칠 수 있어요');
    if (existing && existing.lead !== lead.id) throw new StoreError(409, '다른 관리자가 쓴 계획이에요');
    const current = path ? await readOrNull(path) : null;
    if (current && !existing && current.plan) throw new StoreError(409, '사람이 쓴 계획 파일이에요. path 없이 새로 써 주세요');
    let revision;
    let built;
    if (current) {
      const prevId = current.plan?.block ?? PLAN_BLOCK_ID;
      const prev = (current.blocks ?? []).find((b) => b.id === prevId) ?? null;
      built = buildPlanFile(input, prev);
      const blocks = prev ? current.blocks.map((b) => (b.id === prev.id ? built.block : b)) : [...(current.blocks ?? []), built.block];
      const r = await ws.writeFile(path, { revision: current.revision, title: built.title, document: built.document, canvas: current.canvas, blocks, plan: built.plan });
      revision = r.revision;
    } else {
      built = buildPlanFile(input, null);
      if (!path) {
        if (!leadFolder) {
          const have = folders.length ? ` 지금 영역: ${folders.slice(0, 20).join(', ')}` : '';
          throw new StoreError(400, `area(영역)를 정해 주세요. 프로젝트 구조를 보고 고르고, 있는 영역은 다시 써요.${have}`);
        }
        path = await freePath(`${leadFolder}/${feature ?? planFileName(built.title)}`);
      }
      const r = await ws.createFile(path, { title: built.title, document: built.document, blocks: [built.block], plan: built.plan });
      path = r.path;
      revision = r.revision;
    }
    // The lead works for the project its plan lives in.
    const planFolder = topFolder(path);
    if (planFolder && planFolder !== lead.folder) d.hub.touch(lead, { folder: planFolder });
    all[path] = { lead: lead.id, state: 'plan', waitingSince: Date.now(), draftRevision: revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {}, ...(existing?.carry && { carry: existing.carry }), ...(existing?.lastApprovedRevision != null && { lastApprovedRevision: existing.lastApprovedRevision }) };
    drafts.set(path, built.plan);
    save();
    await ws.labelVersion(path, 'draft');
    ctx.hub.broadcast('workspace', { kind: 'change', path, revision });
    changed(path);
    const out = { path, revision, state: 'plan' };
    if (body.autostart === true && built.plan.steps.length === 1) {
      const started = await start({ path, revision }, { auto: true });
      return { ...out, state: 'running', runId: started.runId };
    }
    return out;
  }

  Object.assign(c, { freePath, writePlan });
}
