// Model connection helpers for the sidebar row (E57, E509), kept free of React so node --test can check them.
// Status only: no account, email or token ever reaches here.

// One model only (E505): Claude CLI running Fable 5.2. Older saved sessions may name other providers; they are not rows here.
export const PROVIDER_IDS = ['claude'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
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
  id: ProviderId,
  login: (id: ProviderId) => Promise<R>,
  cancel: (id: ProviderId) => Promise<unknown>,
  isClosed: () => boolean,
): Promise<R> {
  const res = await login(id);
  if (!res.connected && isClosed()) await cancel(id).catch(() => {});
  return res;
}

// Usage-limit and session-length guards (E509c), edited in the 설정 modal. Defaults mirror the server's.
export type GuardField = { id: 'five' | 'seven' | 'fable' | 'handoffMTokens' | 'ctxHandoff'; label: string; unit: string; min: number; max: number; def: number; hint: string };
export const GUARD_FIELDS: { title: string; hint: string; fields: GuardField[] }[] = [
  {
    title: '사용량 한도',
    hint: '사용량이 이만큼 차면 새 작업을 멈춰요.',
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
