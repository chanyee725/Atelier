// Model connection state for the sidebar row and the 모델 연결 dialog (E525, #570), ported from Dispatch's
// ConnectDialog/Sidebar/ProviderLimits (Claude path only). Pure, so node --test can check it.
// Server contract: docs/design/model-connection-contract.md. Status only: no account, email or token reaches here.
import type { LimitWindow, ProviderLimits, ProviderState } from './api';
import { modelStatus, percent, fiveHourWindow, limitReached, type ModelTone } from './projectNav.ts';

export const MODEL_NAME = 'Claude · Fable 5.2';

/** What the provider is doing, in the order Dispatch checks it. installed null = not checked yet (shows 연결). */
export type ConnectKey = 'off' | 'missing' | 'busy' | 'connected' | 'idle';

export function connectKey(p: ProviderState | undefined, enabled: boolean): ConnectKey {
  if (!enabled) return 'off';
  if (!p) return 'idle';
  if (p.installed === false) return 'missing';
  if (p.busy) return 'busy';
  if (p.connected) return 'connected';
  return 'idle';
}

export type RowTone = ModelTone | 'bad';

/** The sidebar row: short text next to the name and the dot tone. Connected shows 5-hour usage like before. */
export function rowStatus(p: ProviderState | undefined, enabled: boolean, limits: ProviderLimits): { key: ConnectKey; text: string; tone: RowTone } {
  const key = connectKey(p, enabled);
  if (key === 'missing') return { key, text: '설치 안 됨', tone: 'bad' };
  if (key === 'busy') return { key, text: '로그인 중', tone: 'warn' };
  if (key === 'connected') {
    const s = modelStatus({ id: 'claude', name: MODEL_NAME, installed: true, connected: true, pct: percent(fiveHourWindow(limits)?.used), reached: limitReached(true, limits) }, true);
    return { key, text: s.text, tone: s.tone };
  }
  return { key, text: '연결 안 됨', tone: 'off' };
}

/** Dialog state label (Dispatch StateLabel). */
export const STATE_TEXT: Record<ConnectKey, string> = { off: '연결 안 됨', missing: '설치 안 됨', busy: '로그인 중', connected: '연결됨', idle: '연결 안 됨' };

/** The dialog's one action button for a state. null: nothing to press (pipelines off on this server). */
export type Action = 'connect' | 'cancel' | 'disconnect' | 'recheck';
export function actionFor(key: ConnectKey): Action | null {
  if (key === 'off') return null;
  if (key === 'missing') return 'recheck';
  if (key === 'busy') return 'cancel';
  if (key === 'connected') return 'disconnect';
  return 'connect';
}
export const ACTION_TEXT: Record<Action, string> = { connect: '연결', cancel: '취소', disconnect: '해제', recheck: '다시 확인' };

/** Second line under the name: CLI version and how it is logged in. Never an account name. */
export function metaLine(p: ProviderState | undefined): string {
  if (!p || p.installed == null) return 'Claude Code CLI로 로그인해요';
  if (p.installed === false) return 'Claude Code 필요';
  return [p.cli, p.cliLoggedIn ? p.method ?? '로그인됨' : 'CLI 로그인 안 됨'].filter(Boolean).join(' · ');
}

/** The CLI's sign-in page while a login runs; only https links are shown. */
export const loginUrl = (p: ProviderState | undefined) => (p?.busy && typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null);

/** Message after a request finished (shown in the dialog's status line, where Dispatch shows a toast). */
export function doneText(action: Action, res: { connected?: boolean } | null): string | null {
  if (action === 'connect') return res?.connected ? 'Claude를 연결했어요.' : null;
  if (action === 'cancel') return '로그인을 취소했어요.';
  if (action === 'disconnect') return '연결을 해제했어요. CLI 로그인은 남아요.';
  return null;
}

export type LimitRow = { label: string; pct: number | null; reset: number | null };
/** Usage rows for the dialog: the account windows, then Fable's own weekly window (Dispatch ProviderLimits). */
export function limitRows(limits: ProviderLimits): { claude: LimitRow[]; fable: LimitRow[] | null } {
  const row = (w: LimitWindow, prefix = ''): LimitRow => ({ label: prefix + w.label, pct: percent(w.used), reset: w.reset ?? null });
  return {
    claude: (limits.claude?.windows ?? []).map((w) => row(w)),
    fable: limits.fable ? limits.fable.windows.map((w) => row(w, 'Fable ')) : null,
  };
}
