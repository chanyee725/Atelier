// The agent live view panel (E559, #728; docs/design/agent-live-view.md §1-3): a non-modal <dialog popover="manual">
// on the right edge (a bottom sheet under 720px). The page stays usable behind it. One panel at a time; opening another
// agent swaps the content. Closes with ✕, Esc while focus is inside, or the same trigger again; focus then goes back
// to the trigger (store.ts). Hidden while a SessionSheet (modal) is open and shown again when it closes.
// Shows metadata only (tool labels, short targets, shown paths, numbers), never the session folder or transcript text;
// the one exception is the redacted question a waiting session asks (`ask`, #886).
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, Pencil, X } from 'lucide-react';
import type { AgentLive, LiveAction, LiveFile } from '../../../shared/dispatch/live.ts';
import type { Session, SessionState } from '../../../shared/dispatch/types.ts';
import { connect } from '../dispatch/store.ts';
import { fmtK, fmtUsd, stateOf, totalTok, ago } from '../dispatch/lib/format.ts';
import { useAgents } from '../home/useAgents';
import type { AgentPresence } from '../home/agents';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { clock, hhmm, middle, span, ticking, waitNote } from './format';
import { LiveSummaryView, useNow, type SummaryData } from './AgentLiveSummary';
import { closeAgentLive, useAgentLiveTarget, useSheetOpen } from './store';
import { useAgentLive } from './useAgentLive';
import './live.css';

const SessionSheet = lazy(() => import('../dispatch/SessionSheet').then((m) => ({ default: m.SessionSheet })));

/** Mounted once in App.tsx. */
export function AgentLiveHost({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const sid = useAgentLiveTarget();
  const sheetOpen = useSheetOpen();
  const [chat, setChat] = useState<string | null>(null);
  // SessionSheet reads the Dispatch store; keep it fed only while the sheet is open.
  useEffect(() => (chat ? connect() : undefined), [chat]);
  return (
    <>
      {sid && <AgentLivePanel key="live" sid={sid} hidden={sheetOpen} onOpenFile={onOpenFile} onChat={() => setChat(sid)} />}
      {chat && (
        <Suspense fallback={null}>
          <SessionSheet id={chat} onClose={() => setChat(null)} />
        </Suspense>
      )}
    </>
  );
}

function AgentLivePanel({ sid, hidden, onOpenFile, onChat }: { sid: string; hidden: boolean; onOpenFile: (path: string) => void; onChat: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const { live, session, error, loading, online, reload } = useAgentLive(sid);
  const { agents } = useAgents();
  const presence = Array.isArray(agents) ? (agents.find((a) => a.sid === sid) ?? null) : null;
  const outside = sid.startsWith('outside:');
  const state: SessionState | null = session ? stateOf(session) : ((presence?.state as SessionState | null) ?? null);
  const now = useNow(!!state && ticking(state));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const open = el.matches(':popover-open');
    if (hidden && open) el.hidePopover();
    else if (!hidden && !open) el.showPopover();
  }, [hidden]);

  // Focus the first control when the panel opens or switches to another agent (not on every data change).
  useEffect(() => {
    if (!hidden) closeBtn.current?.focus({ preventScroll: true });
  }, [sid, hidden]);

  const name = session?.name ?? presence?.name ?? '';
  const d: SummaryData = {
    sid,
    name: name || '에이전트',
    color: session?.color ?? presence?.color,
    role: session?.roleName ?? presence?.roleName ?? (outside ? '외부 API' : undefined),
    provider: session?.provider ?? presence?.provider,
    modelLabel: session?.modelLabel ?? presence?.modelLabel ?? undefined,
    state,
    stateSince: session?.stateSince ?? null,
    current: live?.current ?? null,
    step: presence?.step,
  };

  return (
    <dialog
      ref={ref}
      popover="manual"
      aria-label={`${name || '에이전트'} 작업 진행상황`}
      className="agent-live"
      data-agent-live={sid}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          closeAgentLive();
        }
      }}
    >
      <header className="agent-live-head">
        <LiveSummaryView d={d} now={now} titleId={titleId} />
        <button ref={closeBtn} type="button" aria-label="닫기" onClick={closeAgentLive} className={cn('agent-live-icon', FOCUS_RING)}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      {!online && <p className="agent-live-offline">연결이 끊겼어요. 다시 연결하는 중…</p>}
      {/* Reloading after a reconnect failed while older data is still shown: say it is old, offer a retry. */}
      {online && error === 'failed' && live && (
        <p className="agent-live-offline agent-live-stale" role="status" data-live-stale>
          <span>최신 내용을 불러오지 못했어요. 이전 내용이에요.</span>
          <button type="button" onClick={reload} className={cn('agent-live-link', FOCUS_RING)}>다시 시도</button>
        </p>
      )}
      <div className="agent-live-body">
        {error === 'missing' ? (
          <Gone />
        ) : outside ? (
          <OutsideBody presence={presence} onOpenFile={onOpenFile} now={now} />
        ) : error === 'failed' && !live ? (
          <section>
            <p className="agent-live-error">진행상황을 불러오지 못했어요</p>
            <button type="button" onClick={reload} className={cn('agent-live-btn', FOCUS_RING)}>다시 시도</button>
          </section>
        ) : (
          <Body live={live} session={session} loading={loading && !live} step={presence?.step} now={now} onOpenFile={onOpenFile} state={state} onChat={onChat} />
        )}
      </div>
      {!outside && error !== 'missing' && (
        <footer className="agent-live-foot">
          <button type="button" onClick={onChat} className={cn('agent-live-btn', FOCUS_RING)}>대화 보기</button>
        </footer>
      )}
    </dialog>
  );
}

function Gone() {
  return (
    <section>
      <p className="agent-live-muted">이 에이전트를 찾을 수 없어요</p>
      <button type="button" onClick={closeAgentLive} className={cn('agent-live-btn', FOCUS_RING)}>닫기</button>
    </section>
  );
}

function Skeleton() {
  return (
    <ul className="agent-live-skeleton" aria-hidden>
      <li /><li /><li />
    </ul>
  );
}

function Body({ live, session, loading, step, now, state, onOpenFile, onChat }: {
  live: AgentLive | null; session: Session | null; loading: boolean; step?: string; now: number; state: SessionState | null;
  onOpenFile: (path: string) => void; onChat: () => void;
}) {
  if (loading) return <section><Skeleton /></section>;
  const cur = live?.current ?? null;
  const ctx = session && session.ctxWindow > 0 ? Math.min(1, session.ctx / session.ctxWindow) : null;
  return (
    <>
      {state === 'waiting' && (
        <section className="agent-live-ask">
          <p className="line-clamp-3 min-w-0 break-words" title={waitNote(session)}>{waitNote(session)}</p>
          <button type="button" onClick={onChat} className={cn('agent-live-btn', FOCUS_RING)}>대화 보기</button>
        </section>
      )}
      <section>
        <dl className="agent-live-now">
          {step && (
            <div>
              <dt>단계</dt>
              <dd className="truncate" title={step}>{step}</dd>
            </div>
          )}
          <div>
            <dt>지금</dt>
            {cur ? (
              <dd className="agent-live-row">
                <span className="shrink-0">{cur.label}</span>
                <span className="agent-live-target" title={cur.target}>{middle(cur.target)}</span>
                <span className="agent-live-time">{clock(now - cur.at)}</span>
              </dd>
            ) : (
              <dd className="agent-live-muted">도구 실행 없음</dd>
            )}
          </div>
        </dl>
      </section>
      {session && (
        <section>
          <dl className="agent-live-stats">
            <div><dt>경과</dt><dd>{span(now - session.startedAt)}</dd></div>
            <div><dt>토큰</dt><dd>{fmtK(totalTok(session.usage))}</dd></div>
            {session.cost != null && <div><dt>비용</dt><dd>{fmtUsd(session.cost)}</dd></div>}
          </dl>
          {ctx != null && (
            <div className="agent-live-ctx">
              <span>컨텍스트</span>
              <meter min={0} max={1} low={0.75} high={0.9} optimum={0} value={ctx} aria-label="컨텍스트 사용량" />
              <span className="tabular-nums">{Math.round(ctx * 100)}%</span>
            </div>
          )}
        </section>
      )}
      <section>
        <h3>최근 행동</h3>
        {live?.recent.length ? (
          <ol className="agent-live-list">
            {live.recent.map((a) => <ActionRow key={a.id} a={a} />)}
          </ol>
        ) : (
          <p className="agent-live-muted">아직 행동이 없어요</p>
        )}
      </section>
      <Files files={live?.files ?? []} now={now} onOpenFile={onOpenFile} />
    </>
  );
}

function ActionRow({ a }: { a: LiveAction }) {
  return (
    <li className="agent-live-row" data-live-action={a.id}>
      <span className="agent-live-at">{hhmm(a.at)}</span>
      <span className="shrink-0">{a.label}</span>
      <span className="agent-live-target" title={a.target}>{middle(a.target, 36)}</span>
      <span className="agent-live-ok">
        {a.ok === true ? (
          <><Check aria-hidden className="size-3.5 text-ok" /><span className="sr-only">성공</span></>
        ) : a.ok === false ? (
          <><X aria-hidden className="size-3.5 text-destructive" /><span className="sr-only">실패</span></>
        ) : (
          <span className="sr-only">실행 중</span>
        )}
      </span>
    </li>
  );
}

function Files({ files, now, onOpenFile }: { files: LiveFile[]; now: number; onOpenFile: (path: string) => void }) {
  return (
    <section>
      <h3>건드린 파일{files.length ? ` (${files.length})` : ''}</h3>
      {files.length ? (
        <ul className="agent-live-list">
          {files.map((f) => (
            <li key={f.path} className="agent-live-row agent-live-file" data-live-file={f.path}>
              {f.edited ? <Pencil aria-hidden className="size-3.5 shrink-0" /> : <Eye aria-hidden className="size-3.5 shrink-0" />}
              <span className="sr-only">{f.edited ? '수정함' : '읽음'}</span>
              {f.doc ? (
                <button type="button" className={cn('agent-live-link', FOCUS_RING)} title={`${f.path} 열기`} onClick={() => onOpenFile(f.path)}>
                  {middle(f.path)}
                  <FileText aria-hidden className="size-3.5 shrink-0" />
                </button>
              ) : (
                <span className="agent-live-target" title={f.path}>{middle(f.path)}</span>
              )}
              <span className="agent-live-time">{ago(f.at, now)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-live-muted">건드린 파일이 없어요</p>
      )}
    </section>
  );
}

/** Outside API writers: presence only. */
function OutsideBody({ presence, now, onOpenFile }: { presence: AgentPresence | null; now: number; onOpenFile: (path: string) => void }) {
  const files: LiveFile[] = presence?.file ? [{ path: presence.file, edited: true, at: presence.at ?? now, doc: presence.file.endsWith('.dpx.json') }] : [];
  return (
    <>
      <section>
        <p className="agent-live-muted">외부 에이전트라 자세한 진행상황이 없어요</p>
      </section>
      <Files files={files} now={now} onOpenFile={onOpenFile} />
    </>
  );
}
