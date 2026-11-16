// Pure helpers for the live agent list (E528, issue #592): who is working in which project and which file each one
// holds. No I/O, so it runs under `node --test`. Memory only: nothing here is stored.

/** Longest outside-writer label, in characters. */
export const LABEL_MAX = 32;
/** Hub session statuses that count as working right now. */
export const LIVE_STATUSES = new Set(['running', 'starting', 'waiting']);

/**
 * The `x-drawing-session` header of an outside API writer, cleaned for a cursor label: control and format characters
 * (bidi overrides, zero-width) and HTML-ish characters dropped, whitespace collapsed, capped at LABEL_MAX characters.
 * Null when nothing usable is left (or the header is missing, repeated or not text).
 */
export function cleanSessionLabel(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = [...s].slice(0, LABEL_MAX).join('').trim();
  return out || null;
}

/**
 * The `x-drawing-session` header when it carries a session id (the `DRAWING_SESSION` value a session started by this
 * Drawing gets, #656): the lowercased id, else null. A session id is never shown as a label.
 */
export function sessionIdOf(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;
}

/** Project (top-level folder) of a workspace-relative path; null for a loose file in the root. */
export function projectOf(rel) {
  if (typeof rel !== 'string') return null;
  const i = rel.indexOf('/');
  return i > 0 ? rel.slice(0, i) : null;
}

const stepField = (t) => (typeof t === 'string' && t.trim() ? { step: t.trim().slice(0, 80) } : {});

/**
 * The agent list (see shared/dispatch/agent-presence.ts), newest activity first.
 * - sessions: hub sessions (stored objects); only live ones are listed
 * - held: Map sid -> { file, at } (the file each session edited last)
 * - outside: Map label -> { file, at } (named outside writers, already pruned by age)
 * - project: optional filter (top folder); a session counts for its own folder and for the folder of the file it holds
 * - activity: Map sid -> tool activity label of its current turn (from the hub's `session` events; memory only)
 * - stepOf: session -> title of the pipeline step it works on, or null
 */
export function buildAgents({ sessions = [], held = new Map(), outside = new Map(), project = null, activity = new Map(), stepOf = () => null } = {}) {
  const out = [];
  for (const s of sessions) {
    if (!s?.id || !LIVE_STATUSES.has(s.status)) continue;
    const h = held.get(s.id);
    const file = h?.file ?? null;
    out.push({
      sid: s.id,
      name: typeof s.name === 'string' ? s.name : '',
      role: typeof s.role === 'string' ? s.role : '',
      ...(typeof s.roleName === 'string' && { roleName: s.roleName }),
      ...(typeof s.color === 'string' && { color: s.color }),
      model: typeof s.model === 'string' ? s.model : null,
      ...(typeof s.modelLabel === 'string' && { modelLabel: s.modelLabel }),
      ...(typeof s.provider === 'string' && s.provider && { provider: s.provider }),
      ...(typeof activity.get(s.id) === 'string' && { activity: activity.get(s.id) }),
      ...stepField(stepOf(s)),
      status: s.status,
      state: typeof s.state === 'string' ? s.state : null,
      project: (typeof s.folder === 'string' && s.folder) || projectOf(file),
      file,
      at: h?.at ?? s.updatedAt ?? null,
    });
  }
  for (const [label, h] of outside) {
    out.push({
      sid: `outside:${label}`, name: label, role: '', model: null, status: 'running', state: 'working',
      project: projectOf(h.file), file: h.file, at: h.at, outside: true,
    });
  }
  const mine = project == null ? out : out.filter((a) => a.project === project || projectOf(a.file) === project);
  return mine.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}
