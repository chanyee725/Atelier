// Which lead (관리자) a document belongs to (#1057), so the document's 관리자와 대화 button talks to it.
// Sources, strongest first: the lead the person assigned in the chat dock, the plan's lead (a pipeline file), the
// lead whose team last wrote the file (an `x-drawing-session` write, teammates count for their lead), then the lead
// whose team asked a question on it. Session ids and times only (metadata); kept in the Dispatch state file under
// `docLeads`, at most MAX_DOC_LEADS paths (the oldest go first).
export const MAX_DOC_LEADS = 500;
const ENDED = new Set(['done', 'error']);
const MAX_HOPS = 8;

const alive = (s) => !!s && !ENDED.has(s.status);
const isLead = (s) => s.role === 'lead' || s.canSpawn === true;

/**
 * The live lead for session `id`: the session itself when it is a lead, else its parent chain; a lead that was
 * swapped for a fresh one past the length guard (#969, `rotatedFrom`) continues as its successor. Null when none is live.
 */
export function leadOf(id, { get, sessions }) {
  let s = typeof id === 'string' ? get(id) : null;
  for (let hop = 0; s && hop < MAX_HOPS; hop++) {
    if (!alive(s)) {
      const next = sessions.find((x) => x.rotatedFrom?.id === s.id);
      if (!next) return null;
      s = next;
      continue;
    }
    if (isLead(s)) return s;
    s = s.parent ? get(s.parent) : null;
  }
  return null;
}

/** Records `leadId` for `path` (`by`: 'assign' | 'write'). A write never replaces an assignment to a live lead. Returns whether it changed. */
export function recordDocLead(data, path, leadId, by, at, hub) {
  const all = (data.docLeads ??= {});
  const cur = all[path];
  if (cur?.lead === leadId && (cur.by === by || by === 'write')) return false;
  if (by === 'write' && cur?.by === 'assign' && leadOf(cur.lead, hub)) return false;
  delete all[path];
  all[path] = { lead: leadId, by, at };
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length - MAX_DOC_LEADS; i++) delete all[keys[i]];
  return true;
}

/**
 * The document's lead: `{ lead: { id, name, modelLabel } | null, source }`, source one of 'assign' | 'plan' | 'write' |
 * 'question' | null. `discussions` is the file's stored questions (askedById), `planLead` the pipeline entry's lead.
 */
export function docLead({ path, docLeads, planLead, discussions }, hub) {
  const rec = docLeads?.[path];
  const tries = [];
  if (rec?.by === 'assign') tries.push([rec.lead, 'assign']);
  if (planLead) tries.push([planLead, 'plan']);
  if (rec?.by === 'write') tries.push([rec.lead, 'write']);
  const asked = Array.isArray(discussions?.items) ? discussions.items.filter((q) => typeof q?.askedById === 'string') : [];
  asked.sort((a, b) => (b.askedAt ?? 0) - (a.askedAt ?? 0));
  for (const q of asked) tries.push([q.askedById, 'question']);
  for (const [id, source] of tries) {
    const s = leadOf(id, hub);
    if (s) return { lead: { id: s.id, name: s.name, modelLabel: s.modelLabel ?? null }, source };
  }
  return { lead: null, source: null };
}
