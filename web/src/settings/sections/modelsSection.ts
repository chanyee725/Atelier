// Helpers for the 설정 modal's 모델 연결 + 역할별 모델 section (#624): the model list grouped by provider, what a role's
// chosen model needs to say (not listed, provider not connected), and the role-model patch and resync. React-free so
// node --test can check them. Status only: no account, email or token reaches here.
import { PROVIDERS } from '../../modelConnect.ts';

export type ModelOption = { id: string; label: string; provider: string };
type ProviderLike = { name?: string; connected?: boolean } | undefined;

/** Korean subject particle for a name (Codex가, ...): 이 after a final consonant in Hangul, else 가. */
export const subjParticle = (name: string) => {
  const c = name.charCodeAt(name.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '이' : '가';
};

/** A provider's display name: its own meta, else what the server says, else the id. */
export const providerName = (id: string, providers: Record<string, ProviderLike>) =>
  PROVIDERS.find((m) => m.id === id)?.name ?? (providers[id]?.name || id);

/**
 * Models grouped by provider, providers in PROVIDERS order (unknown ones after, in list order). Every known provider
 * gets a group, even with no models yet (Codex lists its models only once connected), so the picker can show it.
 * `off` is why a provider's models cannot be picked now (not connected), null when they can (#676).
 */
export function modelGroups(
  models: readonly ModelOption[],
  providers: Record<string, ProviderLike>,
): { provider: string; name: string; models: ModelOption[]; off: string | null }[] {
  const by = new Map<string, ModelOption[]>();
  for (const m of models) by.set(m.provider, [...(by.get(m.provider) ?? []), m]);
  const order = [...PROVIDERS.map((p) => p.id), ...[...by.keys()].filter((id) => !PROVIDERS.some((p) => p.id === id))];
  return order.map((provider) => ({
    provider,
    name: providerName(provider, providers),
    models: by.get(provider) ?? [],
    off: providers[provider]?.connected ? null : '연결 안 됨',
  }));
}

/**
 * What the role row says about its chosen model: its provider (for the icon) and a warning when the model is not in
 * the list any more or its provider is not connected (a session on it would be refused).
 */
export function roleChoice(model: string, models: readonly ModelOption[], providers: Record<string, ProviderLike>): { provider: string | null; warn: string | null } {
  const m = models.find((x) => x.id === model);
  if (!m) return { provider: null, warn: '목록에 없는 모델이에요. 다른 모델을 골라 주세요.' };
  if (!providers[m.provider]?.connected) {
    const name = providerName(m.provider, providers);
    return { provider: m.provider, warn: `${name}${subjParticle(name)} 연결되지 않았어요. 모델 연결에서 연결하거나 다른 모델을 골라 주세요.` };
  }
  return { provider: m.provider, warn: null };
}

/** Only the roles whose shown model differs from the saved one, as a `team.roleModels` patch; null when none. */
export function roleModelsPatch(saved: Record<string, string>, shown: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [role, model] of Object.entries(shown)) if (model && model !== saved[role]) out[role] = model;
  return Object.keys(out).length ? out : null;
}

/**
 * The shown role models after the saved ones change from `prev` to `next` (another tab, the server's settings or
 * snapshot event, a save's answer): a role still showing its `prev` model follows `next`; a role the user changed keeps
 * the change. New roles take their saved model; roles that are gone drop out.
 */
export function resyncRoleModels(prev: Record<string, string>, next: Record<string, string>, shown: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, model] of Object.entries(next)) {
    const s = shown[role];
    out[role] = s === undefined || s === prev[role] ? model : s;
  }
  return out;
}

/** Saved role models from team settings and the roles: the override first, else the role's own model (#616). */
export function savedRoleModels(team: Record<string, unknown> | undefined, roles: readonly { id: string; model: string }[]): Record<string, string> {
  const rm = team?.roleModels && typeof team.roleModels === 'object' ? (team.roleModels as Record<string, unknown>) : {};
  return Object.fromEntries(roles.map((r) => [r.id, typeof rm[r.id] === 'string' && rm[r.id] ? (rm[r.id] as string) : r.model]));
}

/** Shallow equality of two role-model maps (to skip a resync when nothing changed). */
export const sameModels = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};
