// Pipeline section (finish): 완료 · 복제해서 새 계획 (E28): a run whose steps the board closed ends done; a done plan is duplicated.
// Moved out of index.js as is (#1000); `c` is the context setup builds.
import { StoreError } from '../workspace/store.js';
import { effectiveRoles } from '../dispatch/settings.js';
import { nodeLabels, summaryNodes, withSummary, withoutSummary } from '../../shared/dispatch/run-summary.ts';

export function createFinish(c) {
  const { ctx, ws, recorder, dispatch, drafts, entries, save, changed, leadEntries, readOrNull } = c;
  const openSteps = (...a) => c.openSteps(...a);
  const closedTasks = (...a) => c.closedTasks(...a);
  const quietly = (...a) => c.quietly(...a);
  const freePath = (...a) => c.freePath(...a);

  // ---- 완료 · 복제해서 새 계획 (E28) ----

  /** Steps the board has not closed and the run did not carry over from a stopped run. */
  async function unclosed(path, e) {
    const open = openSteps(e);
    if (!open.length) return open;
    const record = await recorder.read(path, e.runId).catch(() => null);
    return open.filter((id) => !record?.steps?.[id]?.carried);
  }

  /** How the board closed each step: merged at a checked commit, else abandoned (closed without a commit). */
  function resultsOf(e) {
    const out = {};
    for (const t of closedTasks(e)) {
      if (!e.steps?.includes(t.step)) continue;
      if (t.mergeCheck?.ok === true && t.mergeCheck.commit) out[t.step] = { commit: t.mergeCheck.commit, ...(t.mergeCheck.base && { base: t.mergeCheck.base }) };
      else if (!t.commit && !out[t.step]) out[t.step] = { abandoned: true };
    }
    return out;
  }

  /** Running -> done: the run record ends, the summary block goes into the document once, the version is labelled. */
  async function finish(path, e) {
    const d = dispatch();
    const results = resultsOf(e);
    Object.assign(e, { state: 'done', doneAt: Date.now() });
    save();
    const record = e.runId ? await quietly(recorder.endRun(e.runId, 'done', { results })) : null;
    if (record) {
      try {
        const file = await readOrNull(path);
        const roles = d ? effectiveRoles(d.hub.roles, d.store) : [];
        const code = file?.blocks?.find((b) => b.id === record.plan?.snapshot?.block)?.code;
        const nodes = summaryNodes(record, { labels: nodeLabels(code), roleName: (r) => roles.find((x) => x.id === r)?.name ?? r });
        const r = await ws.editDocument(path, (doc) => withSummary(doc, nodes));
        ctx.hub.broadcast('workspace', { kind: 'change', path, revision: r.revision });
        await ws.labelVersion(path, 'done');
      } catch (err) {
        // The file went away or cannot be written: the run record still says done.
        console.error('pipeline summary:', err?.code ?? err?.name);
      }
    }
    changed(path);
  }

  /** Running plans whose steps the board has all closed end as done. */
  const finishing = new Set();
  async function finishClosed() {
    for (const [path, e] of Object.entries(entries() ?? {})) {
      if (e.state !== 'running' || !e.steps?.length || finishing.has(path)) continue;
      finishing.add(path);
      try {
        if ((await unclosed(path, e)).length === 0 && e.state === 'running') await finish(path, e);
      } catch (err) {
        console.error('pipeline finish:', err?.message);
      } finally {
        finishing.delete(path);
      }
    }
  }

  /**
   * 복제해서 새 계획: a new draft next to `path` (same area and feature folder, 계획-2… there, #782) with the same
   * plan, diagram and notes, without the summary block.
   * The lead that wrote the original owns the copy when it is still there and has no other plan going.
   */
  async function duplicate(body) {
    if (typeof body?.path !== 'string') throw new StoreError(400, 'path is required');
    const path = ws.runs.fileRel(body.path);
    const file = await readOrNull(path);
    if (!file) throw new StoreError(404, 'not found');
    if (!file.plan) throw new StoreError(400, '계획이 있는 파일이 아니에요');
    const title = `${file.title || '계획'} 복사`;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const to = await freePath(dir);
    const r = await ws.createFile(to, { title, document: withoutSummary(file.document), canvas: file.canvas, blocks: file.blocks, plan: file.plan });
    const all = entries();
    const lead = all?.[path]?.lead;
    const d = dispatch();
    const alive = lead && d?.hub.get(lead) && d.hub.get(lead).status !== 'done';
    if (all && alive && !leadEntries(lead, ['plan', 'running', 'paused']).length) {
      all[r.path] = { lead, state: 'plan', draftRevision: r.revision, approvedRevision: null, approvedAt: null, runId: null, steps: [], links: {} };
      drafts.set(r.path, file.plan);
      save();
    }
    await ws.labelVersion(r.path, 'draft');
    ctx.hub.broadcast('workspace', { kind: 'create', path: r.path, revision: r.revision });
    changed(r.path);
    return { path: r.path, revision: r.revision, lead: all?.[r.path]?.lead ?? null };
  }

  Object.assign(c, { unclosed, resultsOf, finish, finishClosed, duplicate });
}
