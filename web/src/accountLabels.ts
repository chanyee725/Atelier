// Account labels (#747): a short name the user gives each provider connection in 설정 > 모델 연결 ("Max", "팀 계정"),
// shown next to the provider and model wherever a session is named. Kept in the user's defaults
// (~/.dispatch/drawing.json via /api/user-defaults), never in documents. A label only: the form refuses anything that
// looks like an email, and nothing here reads an account, email or id from a CLI.
import { useEffect, useState } from 'react';
import { api } from './api';
import { accountKey, checkAccountLabel as checkShared, defaultAccountLabel } from '../../shared/dispatch/accounts.ts';

export { ACCOUNT_LABEL_MAX } from '../../shared/dispatch/accounts.ts';
export const ACCOUNT_LABELS_CHANGED = 'drawing:account-labels-changed';

export type AccountLabels = Readonly<Record<string, string>>;

/** Trimmed label ('' = no label), or the server's own error sentence (the same check runs there). */
export function checkAccountLabel(raw: string): { value: string; error?: string } {
  const r = checkShared(raw);
  return r.ok ? { value: r.value ?? '' } : { value: raw.trim(), error: r.error };
}

/** "Claude · Max": the provider name, then the label when there is one. */
export const accountText = (providerName: string, label: string | null | undefined) => (label ? `${providerName} · ${label}` : providerName);

/**
 * The label to show beside a provider's name: the session's snapshot, else the saved label. null when there is none or
 * it is only the provider's default name (that name is already in the tag).
 */
export function shownAccount(provider: string, snapshot: string | null | undefined, labels: AccountLabels): string | null {
  const k = accountKey(provider);
  const v = snapshot ?? (k ? labels[k] : undefined) ?? null;
  return v && v !== defaultAccountLabel(provider) ? v : null;
}

let cache: AccountLabels | null = null;
let inflight: Promise<AccountLabels> | null = null;

function load(force = false): Promise<AccountLabels> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = api
    .userDefaults()
    .then((s) => (cache = { ...(s.values.accountLabels ?? {}) }))
    .catch(() => (cache = cache ?? {}))
    .finally(() => (inflight = null));
  return inflight;
}

/** After a save: keep the server's answer and tell every open view. */
export function setAccountLabelsCache(labels: AccountLabels | undefined) {
  cache = { ...(labels ?? {}) };
  window.dispatchEvent(new Event(ACCOUNT_LABELS_CHANGED));
}

/** The saved labels by provider id; {} until loaded or when the defaults file can't be read. */
export function useAccountLabels(): AccountLabels {
  const [labels, setLabels] = useState<AccountLabels>(() => cache ?? {});
  useEffect(() => {
    let alive = true;
    void load().then((l) => alive && setLabels(l));
    const on = () => cache && setLabels(cache);
    window.addEventListener(ACCOUNT_LABELS_CHANGED, on);
    return () => {
      alive = false;
      window.removeEventListener(ACCOUNT_LABELS_CHANGED, on);
    };
  }, []);
  return labels;
}
