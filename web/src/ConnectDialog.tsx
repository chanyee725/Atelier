// 모델 연결 dialog (E525, #570), ported from Dispatch's ConnectDialog/ProviderRow and ProviderLimits, Claude only:
// no other providers, no model picker, no API-key field (sessions use the user's own `claude` CLI login).
// Flow as in Dispatch: 연결 → the server connects at once if the CLI is logged in, else starts `claude auth login`
// (로그인 중, a link to the CLI's sign-in page, 취소); 해제 disconnects from Drawing only. Closing the dialog leaves a
// running login alone; the sidebar row keeps showing 로그인 중. Native modal <dialog>, same look as the 설정 modal.
import { ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { until } from './dispatch/lib/format';
import { cn } from './lib/utils';
import { WARN_PERCENT } from './projectNav';
import { ACTION_TEXT, MODEL_NAME, STATE_TEXT, actionFor, connectKey, doneText, limitRows, loginUrl, metaLine, type Action, type LimitRow } from './modelConnect';
import { MODELS_CHANGED } from './settings/context';
import { oneAtATime } from './settings/model';
import type { Models } from './SidebarModels';
import './connect.css';

const STATE_DOT = { off: 'bg-muted-foreground/50', missing: 'bg-destructive', busy: '', connected: 'bg-ok', idle: 'bg-muted-foreground/50' } as const;

export function ConnectDialog({ models, onClose }: { models: Models; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const { status, claude: p, limits } = models;
  const enabled = !!status?.enabled;
  const key = connectKey(p, enabled);
  const action = actionFor(key);
  const url = loginUrl(p);
  const [pending, setPending] = useState<Action | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);

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
    if (wasBusy.current && key === 'connected') setNote({ text: 'Claude를 연결했어요.' });
    wasBusy.current = key === 'busy';
  }, [key]);

  // One request at a time: a double click before the state changes is dropped.
  const run = useMemo(
    () =>
      oneAtATime(async (what: Action) => {
        setPending(what);
        setNote(null);
        try {
          const res =
            what === 'connect' ? await api.providerLogin('claude')
            : what === 'cancel' ? (await api.providerCancel('claude'), null)
            : what === 'disconnect' ? (await api.providerLogout('claude'), null)
            : (await api.providerRefresh(), null);
          const text = doneText(what, res);
          if (text) setNote({ text });
        } catch (e) {
          setNote({ text: e instanceof Error ? e.message : '요청이 실패했어요.', bad: true });
        } finally {
          setPending(null);
          window.dispatchEvent(new Event(MODELS_CHANGED));
        }
      }),
    [],
  );

  const error = p?.error && key !== 'busy' && key !== 'connected' ? p.error : null;
  const rows = limitRows(limits);
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
              로그인은 Claude CLI가 처리해요. 해제해도 CLI 로그인은 남아요.
            </p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className={cn(btn, 'ml-auto font-normal text-muted-foreground hover:bg-accent hover:text-foreground')}>
            닫기
          </button>
        </header>

        <section aria-label={MODEL_NAME} className="flex flex-col gap-2 rounded-lg border px-3 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-sm font-semibold text-background">
              C
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-sm font-semibold">{MODEL_NAME}</span>
                <span data-testid="connect-state" className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', key === 'connected' ? 'text-foreground' : key === 'missing' ? 'text-destructive' : 'text-muted-foreground')}>
                  {key === 'busy' ? <Loader2 aria-hidden className="connect-spin size-3" /> : <span aria-hidden className={cn('size-1.5 rounded-full', STATE_DOT[key])} />}
                  {STATE_TEXT[key]}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground" title={metaLine(p)}>
                {enabled ? metaLine(p) : (status?.message ?? '이 서버에선 모델을 연결할 수 없어요.')}
              </p>
            </div>
            {action && (
              // One button whose label follows the state (연결 → 취소 → 해제), so focus stays on it across the swap.
              <button
                type="button"
                data-testid="connect-action"
                aria-disabled={pending ? true : undefined}
                title={action === 'connect' ? (p?.cliLoggedIn ? '이미 로그인된 CLI 계정을 그대로 써요' : 'Claude 계정으로 로그인') : undefined}
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
          {key === 'missing' && <p className="ml-11 text-xs text-muted-foreground">Claude Code를 설치한 뒤 다시 확인해 주세요.</p>}
        </section>

        {key === 'connected' && (
          <section aria-labelledby={`${titleId}-usage`} className="flex flex-col gap-2">
            <h3 id={`${titleId}-usage`} className="text-xs font-medium text-muted-foreground">
              사용량
            </h3>
            {rows.claude.some((r) => r.pct != null) ? <Bars rows={rows.claude} /> : <p className="text-xs text-muted-foreground">Claude 세션을 한 번 실행하면 표시돼요.</p>}
            {rows.fable?.length ? <Bars rows={rows.fable} /> : <p className="text-xs text-muted-foreground">Fable 주간 한도는 Fable 세션을 한 번 실행하면 표시돼요.</p>}
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
