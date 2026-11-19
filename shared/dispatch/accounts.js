// Account labels and per-issue account summaries (issue #747). Shared by the server (validation, the PR summary
// line) and the web app (the same checks before saving, the same line on cards).
//
// An "account" is only a label the user picks for a provider connection in 모델 연결 (e.g. `Claude · Max`,
// `Codex · 팀 계정`). Never an email, a user name or an account id: values that look like one are refused.

/** Label keys, one per provider connection: the hub's provider ids. */
export const ACCOUNT_KEYS = ['claude', 'openai', 'gemini'];
export const ACCOUNT_LABEL_MAX = 40;

const PROVIDER_NAME = { claude: 'Claude', openai: 'Codex', gemini: 'Gemini' };

/** The label key for a provider id (`claude`, `openai`, `gemini`; `codex` is taken as `openai`), or null. */
export function accountKey(provider) {
  if (provider === 'codex') return 'openai';
  return ACCOUNT_KEYS.includes(provider) ? provider : null;
}

/** The label used when the user set none: the provider's name only (the plan is not known without credentials). */
export function defaultAccountLabel(provider) {
  return PROVIDER_NAME[accountKey(provider)] ?? null;
}

// Refused shapes: anything with `@` (emails, handles), control characters, long digit runs (numeric account or
// org ids), long hex runs and UUIDs (account ids, keys), and key-like prefixes.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const DIGITS = /\d{6,}/;
const HEX = /[0-9a-f]{16,}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KEYLIKE = /\b(sk|pk|org|acct|user|uid)[-_][A-Za-z0-9]{6,}/i;

/**
 * Checks one label. Returns `{ ok: true, value }` with the trimmed value (empty → null, meaning "clear"),
 * or `{ ok: false, error }` with a short Korean message for the UI.
 */
export function checkAccountLabel(v) {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: '계정 이름은 글자로 넣어 주세요' };
  const value = v.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: true, value: null };
  if ([...value].length > ACCOUNT_LABEL_MAX) return { ok: false, error: `계정 이름은 ${ACCOUNT_LABEL_MAX}자까지예요` };
  if (value.includes('@') || value.includes('＠')) return { ok: false, error: '계정 이름에 이메일은 넣을 수 없어요' };
  if (CONTROL.test(value)) return { ok: false, error: '계정 이름에 쓸 수 없는 글자가 있어요' };
  if (DIGITS.test(value) || HEX.test(value) || UUID.test(value) || KEYLIKE.test(value)) {
    return { ok: false, error: '계정 id나 키처럼 보이는 값은 넣을 수 없어요' };
  }
  return { ok: true, value };
}

/** The valid labels of a stored object (anything else dropped), keyed by ACCOUNT_KEYS. */
export function cleanAccountLabels(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of ACCOUNT_KEYS) {
    const r = checkAccountLabel(raw[k]);
    if (r.ok && r.value) out[k] = r.value;
  }
  return out;
}

/** The label for a provider: the user's, else the default. */
export function accountLabelOf(labels, provider) {
  const k = accountKey(provider);
  return (k && labels?.[k]) || defaultAccountLabel(provider);
}

const ROLE_ORDER = ['lead', 'impl', 'review', 'test', 'design', 'docs'];

/**
 * One line for a PR comment: `roles: lead Claude Sonnet 5.5 (Claude · Max), impl Codex GPT-5 (Codex · 팀 계정)`.
 * Sessions with the same role, model and account are listed once (`impl ×2 …`). Leads first, then by role order.
 */
export function accountsSummary(sessions) {
  const groups = new Map();
  for (const s of sessions || []) {
    const provider = defaultAccountLabel(s.provider) ?? '';
    const model = s.modelLabel || s.model || '';
    // A model label may already carry the provider name ("Gemini 3.8 Flash"); don't repeat it.
    const name = model.toLowerCase().startsWith(provider.toLowerCase()) ? model : `${provider} ${model}`.trim();
    const account = s.accountLabel || defaultAccountLabel(s.provider);
    const role = s.role || '?';
    const key = `${role}\0${name}\0${account}`;
    const g = groups.get(key) || { role, name, account, n: 0 };
    g.n += 1;
    groups.set(key, g);
  }
  const rank = (r) => (ROLE_ORDER.includes(r) ? ROLE_ORDER.indexOf(r) : ROLE_ORDER.length);
  const parts = [...groups.values()]
    .sort((a, b) => rank(a.role) - rank(b.role))
    .map((g) => `${g.role}${g.n > 1 ? ` ×${g.n}` : ''} ${g.name}${g.account ? ` (${g.account})` : ''}`);
  return parts.length ? `roles: ${parts.join(', ')}` : 'roles: -';
}
