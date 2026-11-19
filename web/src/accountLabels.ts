// Account labels (#747): a short name the user gives each provider connection in 설정 > 모델 연결 ("Max", "팀 계정"),
// shown next to the provider and model wherever a session is named. Kept in the user's defaults
// (~/.dispatch/drawing.json via /api/user-defaults), never in documents. A label only: the form refuses anything that
// looks like an email, and nothing here reads an account, email or id from a CLI.
import { useEffect, useState } from 'react';
import { api } from './api';

export const ACCOUNT_LABEL_MAX = 40;
export const ACCOUNT_LABELS_CHANGED = 'drawing:account-labels-changed';

export type AccountLabels = Readonly<Record<string, string>>;

/** Trimmed label, or an error sentence for the form (해요체). Empty means "no label". */
export function checkAccountLabel(raw: string): { value: string; error?: string } {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.includes('@')) return { value, error: '@ 없이 짧은 이름으로 적어 주세요.' };
  if (value.length > ACCOUNT_LABEL_MAX) return { value, error: `${ACCOUNT_LABEL_MAX}자까지 적을 수 있어요.` };
  return { value };
}

/** "Claude · Max": the provider name, then the label when there is one. */
export const accountText = (providerName: string, label: string | null | undefined) => (label ? `${providerName} · ${label}` : providerName);

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
