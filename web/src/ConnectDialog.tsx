// 모델 연결 dialog (E525, #570; every provider #587), ported from Dispatch's ConnectDialog/ProviderRow and
// ProviderLimits, for one provider (`meta`, keyed by provider id; requests go to /api/providers/<id>/...).
// Flow as in Dispatch: 연결 → the server connects at once if the CLI is logged in, else starts the CLI's browser login
// (로그인 중, a link to the CLI's sign-in page, 취소); 해제 disconnects from Drawing only; CLI 로그아웃 also logs the
// CLI out (`cli: true`). Codex can log in with an API key instead: the key goes to the server once, which hands it to
// `codex login --with-api-key`; the field is cleared before the request and the key is never stored or logged here.
// Closing the dialog leaves a running login alone; the sidebar row keeps showing 로그인 중. Native modal <dialog>.
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { until } from './dispatch/lib/format';
import { cn } from './lib/utils';
import { WARN_PERCENT } from './projectNav';
import { ACTION_TEXT, STATE_TEXT, actionFor, cliLogoutShown, cliLogoutText, connectKey, connectedText, objParticle, doneText, keyDoneText, keyLoginShown, limitRows, loginUrl, metaLine, type Action, type LimitRow, type ProviderMeta, SUB_BUCKETS } from './modelConnect';
import { ProviderIcon } from './ProviderIcon';
import { MODELS_CHANGED } from './settings/context';
import { oneAtATime } from './settings/model';
import type { Models } from './SidebarModels';
import './connect.css';

const STATE_DOT = { off: 'bg-muted-foreground/50', missing: 'bg-destructive', busy: '', connected: 'bg-ok', idle: 'bg-muted-foreground/50' } as const;

export function ConnectDialog({ meta, models, onClose }: { meta: ProviderMeta; models: Models; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const { status, limits } = models;
  const p = models.providers[meta.id];
  const id = meta.id;
  const enabled = !!status?.enabled;
  const key = connectKey(p, enabled);
  const action = actionFor(key);
  const url = loginUrl(p);
  const [pending, setPending] = useState<Action | 'key' | 'cliLogout' | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const keyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // Below 768px the sidebar is a Radix Sheet that listens for Esc on document (capture); stop the key at window so
    // one Esc closes only this dialog (same as the 설정 modal, #552). The dialog's own close request still runs.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // A login that finishes while the dialog is open says so, like the request that connects at once.
  const wasBusy = useRef(key === 'busy');
  useEffect(() => {
    if (wasBusy.current && key === 'connected') setNote({ text: connectedText(meta) });
    wasBusy.current = key === 'busy';
  }, [key, meta]);

  // One request at a time: a double click before the state changes is dropped.
  const run = useMemo(
    () =>
      oneAtATime(async (what: Action | 'key' | 'cliLogout', secret?: string) => {
        setPending(what);
        setNote(null);
        try {
          if (what === 'key') {
            const res = await api.providerKey(id, secret ?? '');
            setNote({ text: keyDoneText(meta, res), bad: !res?.connected });
            if (res?.connected) setKeyOpen(false);
            return;
          }
          if (what === 'cliLogout') {
            await api.providerCliLogout(id);
            setNote({ text: cliLogoutText(meta) });
            return;
          }
          const res =
            what === 'connect' ? await api.providerLogin(id)
            : what === 'cancel' ? (await api.providerCancel(id), null)
            : what === 'disconnect' ? (await api.providerLogout(id), null)
            : (await api.providerRefresh(), null);
          const text = doneText(meta, what, res);
          if (text) setNote({ text });
        } catch (e) {
          setNote({ text: e instanceof Error ? e.message : '요청이 실패했어요.', bad: true });
        } finally {
          setPending(null);
          window.dispatchEvent(new Event(MODELS_CHANGED));
        }
      }),
    [id, meta],
  );

  const error = p?.error && key !== 'busy' && key !== 'connected' ? p.error : null;
  const rows = limitRows(meta, limits);
  const showKey = keyLoginShown(meta, p, enabled);
  const showCliLogout = cliLogoutShown(p, enabled);
  // The key lives only in the form's input until submit: read it, clear the field, send it once. No state, no storage.
  const submitKey = (form: HTMLFormElement) => {
    const input = form.elements.namedItem('key') as HTMLInputElement | null;
    const k = input?.value.trim() ?? '';
    if (input) input.value = '';
    if (!k || pending) return;
    void run('key', k);
  };
  // Hover only on enabled buttons, ~120ms, none under prefers-reduced-motion (#559).
  const btn = 'inline-flex shrink-0 whitespace-nowrap h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-[120ms] motion-reduce:transition-none max-md:h-11 aria-disabled:opacity-60 aria-disabled:cursor-default';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid="connect-dialog"
      onClose={onClose}
      className="connect-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-1rem))] max-w-none overflow-y-auto rounded-lg border bg-background p-0 text-foreground shadow-md"
    >
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-start gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id={titleId} className="text-sm font-semibold">
              모델 연결
            </h2>
            <p id={descId} className="text-xs text-muted-foreground">
              로그인은 {meta.short} CLI가 처리해요. 해제해도 CLI 로그인은 남아요.
            </p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className={cn(btn, 'ml-auto font-normal text-muted-foreground hover:bg-accent hover:text-foreground')}>
            닫기
          </button>
        </header>

        <section aria-label={meta.name} className="flex flex-col gap-2 rounded-lg border px-3 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border text-foreground">
              <ProviderIcon provider={meta.id} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-sm font-semibold">{meta.name}</span>
                <span data-testid="connect-state" className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', key === 'connected' ? 'text-foreground' : key === 'missing' ? 'text-destructive' : 'text-muted-foreground')}>
                  {key === 'busy' ? <Loader2 aria-hidden className="connect-spin size-3" /> : <span aria-hidden className={cn('size-1.5 rounded-full', STATE_DOT[key])} />}
                  {STATE_TEXT[key]}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground" title={metaLine(meta, p)}>
                {enabled ? metaLine(meta, p) : (status?.message ?? '이 서버에선 모델을 연결할 수 없어요.')}
              </p>
            </div>
            {action && (
              // One button whose label follows the state (연결 → 취소 → 해제), so focus stays on it across the swap.
              <button
                type="button"
                data-testid="connect-action"
                aria-disabled={pending ? true : undefined}
                title={action === 'connect' ? (p?.cliLoggedIn ? '이미 로그인된 CLI 계정을 그대로 써요' : `${meta.short} 계정으로 로그인`) : undefined}
                onClick={() => !pending && void run(action)}
                className={cn(
                  btn,
                  'shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  action === 'connect' ? 'bg-primary text-primary-foreground [&:not([aria-disabled])]:hover:bg-primary/90' : 'text-muted-foreground [&:not([aria-disabled])]:hover:bg-accent [&:not([aria-disabled])]:hover:text-foreground',
                )}
              >
                {pending && <Loader2 aria-hidden className="connect-spin size-3.5" />}
                {ACTION_TEXT[action]}
              </button>
            )}
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="ml-11 inline-flex w-fit items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline">
              브라우저가 안 열렸다면 로그인 페이지 열기
              <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
          {key === 'busy' && !url && <p className="ml-11 text-xs text-muted-foreground">브라우저에서 로그인을 마쳐 주세요.</p>}
          {error && <p className="ml-11 text-xs text-destructive">{error}</p>}
          {key === 'missing' && <p className="ml-11 text-xs text-muted-foreground">{meta.cliName}{objParticle(meta.cliName)} 설치한 뒤 다시 확인해 주세요.</p>}
          {showKey &&
            (keyOpen ? (
              <form
                data-testid="connect-key-form"
                className="ml-11 flex flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitKey(e.currentTarget);
                }}
              >
                <label htmlFor={keyId} className="text-xs text-muted-foreground">
                  {meta.keyLabel ?? 'API 키'}
                </label>
                <div className="flex gap-2">
                  {/* No name for the browser to remember and no autofill: the key goes to the CLI only. */}
                  <input
                    id={keyId}
                    name="key"
                    type="password"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                    data-testid="connect-key"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:h-11"
                  />
                  <button type="submit" aria-disabled={pending ? true : undefined} className={cn(btn, 'bg-primary text-primary-foreground [&:not([aria-disabled])]:hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none')}>
                    {pending === 'key' && <Loader2 aria-hidden className="connect-spin size-3.5" />}키로 연결
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">키는 {meta.cliName}에만 넘기고 Drawing에는 남기지 않아요.</p>
              </form>
            ) : (
              <button
                type="button"
                data-testid="connect-key-open"
                onClick={() => setKeyOpen(true)}
                className="ml-11 inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <KeyRound aria-hidden className="size-3" />
                API 키로 연결
              </button>
            ))}
          {showCliLogout && (
            <button
              type="button"
              data-testid="connect-cli-logout"
              aria-disabled={pending ? true : undefined}
              title={`${meta.cliName}의 로그인도 이 컴퓨터에서 끝내요`}
              onClick={() => !pending && void run('cliLogout')}
              className="ml-11 inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-disabled:opacity-60"
            >
              {pending === 'cliLogout' && <Loader2 aria-hidden className="connect-spin size-3" />}
              CLI에서도 로그아웃
            </button>
          )}
        </section>

        {key === 'connected' && rows && (
          <section aria-labelledby={`${titleId}-usage`} className="flex flex-col gap-2">
            <h3 id={`${titleId}-usage`} className="text-xs font-medium text-muted-foreground">
              사용량
            </h3>
            {rows.main.some((r) => r.pct != null) ? (
              <Bars rows={rows.main} />
            ) : rows.reached ? (
              <p className="text-xs text-foreground">한도에 도달했어요{until(rows.reset) === '—' ? '.' : ` · 초기화까지 ${until(rows.reset)}`}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{meta.windowless ? `${meta.short}는 사용량을 알려 주지 않아요. 한도에 걸리면 여기에 표시돼요.` : `${meta.short} 세션을 한 번 실행하면 표시돼요.`}</p>
            )}
            {SUB_BUCKETS[meta.id]?.includes('fable') && (rows.fable?.length ? <Bars rows={rows.fable} /> : <p className="text-xs text-muted-foreground">Fable 주간 한도는 Fable 세션을 한 번 실행하면 표시돼요.</p>)}
          </section>
        )}

        {/* Always rendered, so its text changes are announced. */}
        <p role="status" data-testid="connect-note" className={cn('min-h-4 text-xs', note?.bad ? 'text-destructive' : 'text-muted-foreground')}>
          {note?.text}
        </p>
      </div>
    </dialog>
  );
}

function Bars({ rows }: { rows: LimitRow[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const reset = until(r.reset);
        return (
          <li key={r.label} className="grid grid-cols-[5.5rem_1fr_2.5rem_6.5rem] items-center gap-3 text-xs max-md:grid-cols-[5rem_1fr_2.5rem]">
            <span className="truncate text-muted-foreground">{r.label}</span>
            <progress className={cn('connect-meter', (r.pct ?? 0) > WARN_PERCENT && 'is-warn')} max={100} value={r.pct ?? 0} aria-label={`${r.label} 사용량`} />
            <span className="text-right tabular-nums">{r.pct == null ? '—' : `${r.pct}%`}</span>
            <span className="truncate text-muted-foreground tabular-nums max-md:col-start-2 max-md:col-span-2">{reset === '—' ? '' : `초기화까지 ${reset}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
