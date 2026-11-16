// Model connection state for the sidebar rows and the 모델 연결 dialog (E525, #570), ported from Dispatch's
// ConnectDialog/Sidebar/ProviderLimits. Everything is keyed by a provider id: PROVIDERS lists the rows the sidebar
// shows, and state, requests and copy are looked up by that id. Only Claude is listed for now; #587 adds Codex and
// Gemini by adding entries here. Pure, so node --test can check it.
// Server contract: docs/design/model-connection-contract.md. Status only: no account, email or token reaches here.
import type { LimitWindow, ProviderLimits, ProviderState } from './api';
import { modelStatus, percent, fiveHourWindow, limitReached, type ModelTone } from './projectNav.ts';

/** What the UI needs to know about one provider. `id` is the server's provider id (/api/providers/<id>/...). */
export type ProviderMeta = {
  id: string;
  /** Row and dialog title. */
  name: string;
  /** Short name in messages (Claude를 연결했어요). */
  short: string;
  /** The CLI it logs in through, e.g. Claude Code. */
  cliName: string;
  /** One letter for the dialog's badge. */
  mark: string;
  /** Usage windows from /api/limits (only Claude reports them so far). */
  usage: boolean;
};

export const PROVIDERS: readonly ProviderMeta[] = [{ id: 'claude', name: 'Claude · Fable 5.2', short: 'Claude', cliName: 'Claude Code', mark: 'C', usage: true }];
export const providerMeta = (id: string) => PROVIDERS.find((m) => m.id === id);
/** Korean object particle for a name (Claude를, ...): 을 after a final consonant in Hangul, else 를. */
export const objParticle = (name: string) => {
  const c = name.charCodeAt(name.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '을' : '를';
};

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
export function rowStatus(meta: ProviderMeta, p: ProviderState | undefined, enabled: boolean, limits: ProviderLimits): { key: ConnectKey; text: string; tone: RowTone } {
  const key = connectKey(p, enabled);
  if (key === 'missing') return { key, text: '설치 안 됨', tone: 'bad' };
  if (key === 'busy') return { key, text: '로그인 중', tone: 'warn' };
  if (key === 'connected') {
    const lim = meta.usage ? limits : {};
    const s = modelStatus({ id: meta.id, name: meta.name, installed: true, connected: true, pct: percent(fiveHourWindow(lim)?.used), reached: limitReached(true, lim) }, true);
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
export function metaLine(meta: ProviderMeta, p: ProviderState | undefined): string {
  if (!p || p.installed == null) return `${meta.cliName} CLI로 로그인해요`;
  if (p.installed === false) return `${meta.cliName} 필요`;
  return [p.cli, p.cliLoggedIn ? p.method ?? '로그인됨' : 'CLI 로그인 안 됨'].filter(Boolean).join(' · ');
}

/** The CLI's sign-in page while a login runs; only https links are shown. */
export const loginUrl = (p: ProviderState | undefined) => (p?.busy && typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null);

/** Message after a request finished (shown in the dialog's status line, where Dispatch shows a toast). */
export const connectedText = (meta: ProviderMeta) => `${meta.short}${objParticle(meta.short)} 연결했어요.`;
export function doneText(meta: ProviderMeta, action: Action, res: { connected?: boolean } | null): string | null {
  if (action === 'connect') return res?.connected ? connectedText(meta) : null;
  if (action === 'cancel') return '로그인을 취소했어요.';
  if (action === 'disconnect') return '연결을 해제했어요. CLI 로그인은 남아요.';
  return null;
}

export type LimitRow = { label: string; pct: number | null; reset: number | null };
/** Usage rows for the dialog: the account windows, then Fable's own weekly window (Dispatch ProviderLimits).
 *  Null for a provider that reports no usage yet. */
export function limitRows(meta: ProviderMeta, limits: ProviderLimits): { claude: LimitRow[]; fable: LimitRow[] | null } | null {
  if (!meta.usage) return null;
  const row = (w: LimitWindow, prefix = ''): LimitRow => ({ label: prefix + w.label, pct: percent(w.used), reset: w.reset ?? null });
  return {
    claude: (limits.claude?.windows ?? []).map((w) => row(w)),
    fable: limits.fable ? limits.fable.windows.map((w) => row(w, 'Fable ')) : null,
  };
}
