// Settings helpers: model connection polling for the sidebar rows (E57, E509), the usage-limit and session-length
// guards, the 설정 page's team fields and the per-provider usage view (#587). Kept free of React so node --test can
// check them. Status only: no account, email or token ever reaches here.
/** Polling stops after this long even if the server still says a login runs. */
export const LOGIN_POLL_LIMIT_MS = 10 * 60_000;
export const LOGIN_POLL_EVERY_MS = 2000;
export const LOGIN_POLL_TIMEOUT_NOTE = '로그인을 너무 오래 기다렸어요. 취소하고 다시 해 주세요.';

type Clock = { now: () => number; setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (t: unknown) => void };
const realClock: Clock = { now: () => Date.now(), setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t as number) };

/**
 * Checks back every LOGIN_POLL_EVERY_MS while a CLI login runs and gives up after LOGIN_POLL_LIMIT_MS (calling
 * `onGiveUp` once). Returns a stop function. Each call starts a fresh window, so a new login restarts it.
 */
export function pollLogins(load: () => void, onGiveUp: () => void, clock: Clock = realClock): () => void {
  const started = clock.now();
  const t = clock.setInterval(() => {
    if (clock.now() - started > LOGIN_POLL_LIMIT_MS) {
      clock.clearInterval(t);
      onGiveUp();
      return;
    }
    load();
  }, LOGIN_POLL_EVERY_MS);
  return () => clock.clearInterval(t);
}

export const LOGIN_ENDED_NOTE = '로그인이 끝났지만 연결되지 않았어요. 다시 해 주세요.';

/**
 * Wraps an async action so a second call while the first runs is dropped (double clicks before the button
 * turns disabled). Returns false for a dropped call.
 */
export function oneAtATime<A extends unknown[]>(fn: (...a: A) => Promise<unknown>): (...a: A) => Promise<boolean> {
  let running = false;
  return async (...a: A) => {
    if (running) return false;
    running = true;
    try {
      await fn(...a);
    } finally {
      running = false;
    }
    return true;
  };
}

/**
 * Starts a provider login and, if the dialog closed while the request was in flight (the server first
 * refreshes every CLI's status, which can take seconds), cancels the login the server started meanwhile so
 * no CLI login is left running unseen (#228 review). Returns the login response.
 */
export async function loginUnlessClosed<R extends { connected: boolean }>(
  id: string,
  login: (id: string) => Promise<R>,
  cancel: (id: string) => Promise<unknown>,
  isClosed: () => boolean,
): Promise<R> {
  const res = await login(id);
  if (!res.connected && isClosed()) await cancel(id).catch(() => {});
  return res;
}

// Usage-limit and session-length guards (E509c), edited in the 설정 modal and page. Defaults mirror the server's.
// The usage guard reads Claude's account windows only (Fable models have their own weekly window there); as in
// standalone Dispatch, Codex and Gemini sessions are never held by it (#587). The session-length guard covers every
// provider.
export type GuardField = { id: 'five' | 'seven' | 'fable' | 'handoffMTokens' | 'ctxHandoff'; label: string; unit: string; min: number; max: number; def: number; hint: string };
export type GuardGroup = { title: string; hint: string; /** The provider whose windows the group guards; none = every provider. */ provider?: string; fields: GuardField[] };
export const GUARD_FIELDS: GuardGroup[] = [
  {
    title: 'Claude 사용량 한도',
    hint: 'Claude 사용량이 이만큼 차면 새 Claude 작업을 멈춰요. Codex·Gemini는 막지 않아요.',
    provider: 'claude',
    fields: [
      { id: 'five', label: '5시간 한도', unit: '%', min: 1, max: 100, def: 90, hint: '' },
      { id: 'seven', label: '주간 한도', unit: '%', min: 1, max: 100, def: 85, hint: '' },
      { id: 'fable', label: 'Fable 주간 한도', unit: '%', min: 1, max: 100, def: 85, hint: '' },
    ],
  },
  {
    title: '세션 길이',
    hint: '세션이 너무 길어지면 새 세션으로 넘겨요.',
    fields: [
      { id: 'handoffMTokens', label: '토큰 한도', unit: '백만', min: 2, max: 500, def: 15, hint: '' },
      { id: 'ctxHandoff', label: '컨텍스트 한도', unit: '%', min: 30, max: 95, def: 70, hint: '' },
    ],
  },
];

/** The value a field shows, from saved settings (guards are stored as 0..1 fractions; fable falls back to weekly). */
export function guardValue(id: GuardField['id'], s: { guard: { five: number; seven: number; fable?: number }; team: { ctxHandoff?: number; handoffMTokens?: number } }): number {
  const f = GUARD_FIELDS.flatMap((g) => g.fields).find((x) => x.id === id)!;
  if (id === 'five' || id === 'seven') return Math.round(s.guard[id] * 100);
  if (id === 'fable') return Math.round((s.guard.fable ?? s.guard.seven) * 100);
  return s.team[id] || f.def;
}

/** A settings patch for the given field values (percent fields become fractions; `fable: null` follows weekly again). */
export function guardPatch(values: Partial<Record<GuardField['id'], number | null>>) {
  const guard: Record<string, number | null> = {};
  const team: Record<string, number> = {};
  for (const [k, v] of Object.entries(values) as [GuardField['id'], number | null][]) {
    if (k === 'fable' && v === null) guard.fable = null;
    else if (v === null) continue;
    else if (k === 'five' || k === 'seven' || k === 'fable') guard[k] = v / 100;
    else team[k] = v;
  }
  return { ...(Object.keys(guard).length ? { guard } : {}), ...(Object.keys(team).length ? { team } : {}) };
}

/** A whole number in [min, max]; null otherwise. */
export function wholeIn(input: string, min: number, max: number): number | null {
  const n = Number(input.trim());
  if (!input.trim() || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export type GuardValues = Record<GuardField['id'], number>;
/** What the modal last loaded or saved: the shown values and whether Fable follows the weekly value (no own value). */
export type GuardSaved = { values: GuardValues; fableFollows: boolean };

/** True when settings have no own Fable value, so it follows the weekly one. */
export const fableFollows = (s: { guard: { fable?: number | null } }) => s.guard.fable == null;

/**
 * The values to send: only fields that differ from what was saved, so an untouched Fable value is never pinned (#552).
 * `follows` is whether Fable should follow the weekly value after this save: it is sent as `fable: null` when the
 * saved state had its own value, and left out otherwise. A Fable value the user typed while it followed is sent even
 * when it equals the value shown, since that pins it on purpose.
 */
export function changedValues(saved: GuardSaved, next: GuardValues, follows: boolean): Partial<Record<GuardField['id'], number | null>> {
  const out: Partial<Record<GuardField['id'], number | null>> = {};
  for (const id of Object.keys(next) as GuardField['id'][]) {
    if (id === 'fable') continue;
    if (next[id] !== saved.values[id]) out[id] = next[id];
  }
  if (follows) {
    if (!saved.fableFollows) out.fable = null;
  } else if (saved.fableFollows || next.fable !== saved.values.fable) out.fable = next.fable;
  return out;
}

/**
 * Reads the modal's field texts into values to save. An empty Fable field means "follow the weekly value" (#563):
 * it takes the weekly value and `follows` becomes true, instead of a range error. Any other bad field gives the
 * message to show.
 */
export function readGuardTexts(texts: Record<GuardField['id'], string>, follows: boolean): { values: GuardValues; follows: boolean } | { error: string } {
  const fields = GUARD_FIELDS.flatMap((g) => g.fields);
  const values = {} as GuardValues;
  const fableEmpty = !texts.fable.trim();
  for (const f of fields) {
    if (f.id === 'fable' && fableEmpty) continue;
    const v = wholeIn(texts[f.id], f.min, f.max);
    if (v === null) return { error: `${f.label}: ${f.min}~${f.max} 사이 숫자를 넣어 주세요` };
    values[f.id] = v;
  }
  if (fableEmpty) values.fable = values.seven;
  return { values, follows: follows || fableEmpty };
}

/**
 * Stops Esc at `target` (window, capture) while `isOpen()` is true, so a listener further down (the narrow sidebar
 * Sheet listens on document) does not also close (#552). Returns the cleanup that removes the listener (#563).
 */
export function stopEscWhileOpen(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, isOpen: () => boolean): () => void {
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && isOpen()) e.stopPropagation();
  };
  target.addEventListener('keydown', onKey, { capture: true });
  return () => target.removeEventListener('keydown', onKey, { capture: true });
}

// 설정 page (#587, ported from standalone Dispatch's SettingsPage): the team settings Drawing's server acts on.
// Values are saved through POST /api/settings `team`; the server checks every range again.
export type TeamNumberId = 'rotateLead' | 'rotateOthers' | 'maxChildren';
export type TeamToggleId = 'shareDeps' | 'dropWorktrees' | 'replyStyle';
export const TEAM_NUMBERS: { id: TeamNumberId; label: string; unit: string; min: number; max: number; def: number; hint: string }[] = [
  { id: 'rotateLead', label: '관리자 대화 새로 시작', unit: '턴', min: 0, max: 100, def: 5, hint: '이 턴 수마다 대화를 요약해 새 세션으로 이어 가요. 0이면 이어 가지 않아요.' },
  { id: 'rotateOthers', label: '다른 역할 대화 새로 시작', unit: '턴', min: 0, max: 100, def: 10, hint: '구현자·리뷰어·테스터 등에 같은 규칙을 써요.' },
  { id: 'maxChildren', label: '관리자 한 명이 둘 수 있는 팀원', unit: '명', min: 1, max: 16, def: 8, hint: '동시에 열려 있는 팀원 수의 상한이에요.' },
];
export const TEAM_TOGGLES: { id: TeamToggleId; label: string; def: boolean; hint: string }[] = [
  { id: 'shareDeps', label: '새 작업 폴더에 node_modules 넣기', def: true, hint: '프로젝트의 node_modules를 하드링크로 넣어요. 디스크를 더 쓰지 않아요.' },
  { id: 'dropWorktrees', label: '세션을 지우면 작업 폴더도 지우기', def: true, hint: '커밋 안 한 변경이 없을 때만 지워요. 브랜치는 남아요.' },
  { id: 'replyStyle', label: '답변 스타일 지침 넣기', def: true, hint: '모든 세션의 지시에 읽기 쉬운 답변 규칙을 붙여요.' },
];

export type TeamValues = Record<TeamNumberId, number> & Record<TeamToggleId, boolean> & { roleModels: Record<string, string> };

/** The page's values from saved team settings and the roles (each role's model already includes the saved override). */
export function teamValues(team: Record<string, unknown> | undefined, roles: readonly { id: string; model: string }[]): TeamValues {
  const t = team ?? {};
  const out = { roleModels: Object.fromEntries(roles.map((r) => [r.id, r.model])) } as TeamValues;
  for (const f of TEAM_NUMBERS) out[f.id] = typeof t[f.id] === 'number' ? (t[f.id] as number) : f.def;
  for (const f of TEAM_TOGGLES) out[f.id] = typeof t[f.id] === 'boolean' ? (t[f.id] as boolean) : f.def;
  return out;
}

/** Only what changed, as a `team` patch; null when nothing did. Role models are sent per role. */
export function teamPatch(saved: TeamValues, next: TeamValues): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of TEAM_NUMBERS) if (next[f.id] !== saved[f.id]) out[f.id] = next[f.id];
  for (const f of TEAM_TOGGLES) if (next[f.id] !== saved[f.id]) out[f.id] = next[f.id];
  const rm: Record<string, string> = {};
  for (const [role, model] of Object.entries(next.roleModels)) if (model && model !== saved.roleModels[role]) rm[role] = model;
  if (Object.keys(rm).length) out.roleModels = rm;
  return Object.keys(out).length ? out : null;
}

/** Reads the number fields' texts; the first bad one gives the message to show. */
export function readTeamNumbers(texts: Record<TeamNumberId, string>): Record<TeamNumberId, number> | { error: string } {
  const out = {} as Record<TeamNumberId, number>;
  for (const f of TEAM_NUMBERS) {
    const v = wholeIn(texts[f.id], f.min, f.max);
    if (v === null) return { error: `${f.label}: ${f.min}~${f.max} 사이 숫자를 넣어 주세요` };
    out[f.id] = v;
  }
  return out;
}

// Per-provider usage (#587, ported from Dispatch's ProviderLimits): GET /api/limits answers one entry per provider
// id. Windows are read by that id, never assumed to be Claude's; a provider may add sub-buckets (Claude's Fable
// weekly window) that show in its own group.
export type UsageWindow = { label: string; used: number | null; reset?: number | null };
export type UsageEntry = { windows?: UsageWindow[]; plan?: string | null; reached?: boolean; reset?: number | null } | null | undefined;
export type UsageGroup = { id: string; name: string; windows: UsageWindow[]; plan: string | null; reached: boolean | null; reset: number | null };
const SUB_BUCKETS: Record<string, string[]> = { claude: ['fable'] };

/**
 * One group per connected provider, in the providers' order. `windows` empty means the CLI has not reported any
 * yet; `reached` is set for providers that only say whether a quota was hit (Gemini).
 */
export function usageGroups(limits: Record<string, UsageEntry>, providers: Record<string, { name?: string; connected?: boolean }>): UsageGroup[] {
  const out: UsageGroup[] = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!p?.connected) continue;
    const own = limits[id];
    const windows = [own, ...(SUB_BUCKETS[id] ?? []).map((k) => limits[k])].flatMap((e) => (Array.isArray(e?.windows) ? e.windows : []));
    out.push({
      id,
      name: p.name || id,
      windows,
      plan: typeof own?.plan === 'string' ? own.plan : null,
      reached: typeof own?.reached === 'boolean' ? own.reached : null,
      reset: typeof own?.reset === 'number' ? own.reset : null,
    });
  }
  return out;
}
