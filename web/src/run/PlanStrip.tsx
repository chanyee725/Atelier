// The plan gate under the top bar (E20, docs/design/dispatch-integration/3-ux-flow.md §3): while a pipeline file
// is a 계획, it says what would start and holds the one 시작하기 button; the confirm shows sessions, limits,
// what the person changed and unanswered asks. Running files are E22's strip, so this one hides then.
// In the 플랜 tab (#729, `inTab`) the same strip, dialog and 시작하기 sit at the top of the tab instead, with the
// approval state as a chip (승인 대기, 개정 대기 for a revision after a run, 승인됨 once started).
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';
import { PLAN_CHANGED_NOTICE, confirmSnapshot, isPlanChanged, limitLine, startError, unansweredAsks, type PipelineStatus, type PlanSnapshot } from './planStripModel';
import { openPlanConfirm, requestStart } from './planOpen';
import { events } from '../lib/events';
import { StepModels } from './StepModels';
import { onPlanConfirmRequest, samePlan, takePlanConfirm } from './planConfirmRequest';
import { planApproval, type PlanApproval } from './planApprovalModel';
import { StatusDot } from '../home/dash';
import { whenLabel } from '../lib/when';

const CHIP_TONE = { waiting: 'warn', revised: 'warn', approved: 'ok', unknown: 'idle' } as const;

/** The approval state in the 플랜 tab: a quiet dot and word, then the revision it is about. */
function ApprovalChip({ a }: { a: PlanApproval }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium" data-testid="plan-approval" data-kind={a.kind}>
      <StatusDot tone={CHIP_TONE[a.kind]}>{a.label}</StatusDot>
      {a.revision !== null && <span className="font-normal text-muted-foreground tabular-nums">rev {a.revision}</span>}
    </span>
  );
}

async function readStatus(path: string): Promise<PipelineStatus | null> {
  const res = await fetch(`/api/pipeline?path=${encodeURIComponent(path)}`);
  if (!res.ok) return null;
  return (await res.json()) as PipelineStatus;
}

export function PlanStrip({ session, inTab = false }: { session: FileSession; inTab?: boolean }) {
  const path = useSession(session, (s) => (s.file ? s.path : null));
  const revision = useSession(session, (s) => s.file?.revision ?? null);
  const hasPlan = useSession(session, (s) => !!s.file?.plan);
  const document = useSession(session, (s) => s.file?.document);
  const [modelsOpen, setModelsOpen] = useState(false);
  const modelsId = useId();
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  // The status could not be read: the strip still shows, says so and keeps 시작하기 blocked (#788).
  const [unread, setUnread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The plan the dialog shows; 시작하기 sends this revision, never a later one.
  const [shown, setShown] = useState<PlanSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const noticeId = useId();
  const blockersId = useId();

  const refresh = useCallback(async () => {
    if (!path || !hasPlan) {
      setUnread(false);
      return setStatus(null);
    }
    const st = await readStatus(path).catch(() => null);
    // A different file may be open by the time the answer comes back.
    if (session.getState().path !== path) return;
    setStatus(st);
    setUnread(!st);
  }, [path, hasPlan, session]);

  // The file's own saves change blockers and changes; so does the server's `pipeline` event (start, write_plan).
  useEffect(() => {
    setError(null);
    void refresh();
  }, [refresh, revision]);
  useEffect(() => {
    if (!path || !hasPlan) return;
    return events.subscribeJson<{ path?: string }>('pipeline', (e) => {
      if (e.path === path) void refresh();
    });
  }, [path, hasPlan, refresh]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  // 시작하기 in the 알림함 (#786) opens this file and asks for the same confirm; it waits until the plan is loaded.
  const openRef = useRef<() => void>(() => {});
  const [asked, setAsked] = useState(0);
  useEffect(() => onPlanConfirmRequest(() => setAsked((n) => n + 1)), []);
  useEffect(() => {
    // A status left over from the file open before is not this plan's.
    if (!path || !status || !samePlan(status.path, path) || busy || confirming) return;
    // Already started (or no longer a plan): the request is used up without a confirm (#803).
    if (status.state !== 'plan') return void takePlanConfirm(path);
    if (takePlanConfirm(path) && status.blockers.length === 0) openRef.current();
  }, [path, status, asked, busy, confirming]);

  const approval = path && hasPlan ? planApproval(status, unread) : null;
  if (path && hasPlan && unread && !status) {
    if (inTab && approval)
      return (
        <div role="status" className="plan-bar" data-testid="plan-strip">
          <div className="plan-bar-text">
            <div className="plan-bar-head"><ApprovalChip a={approval} /></div>
            <span className="plan-bar-meta">시작할 수 있는지 확인하지 못했어요.</span>
          </div>
          <Button size="sm" variant="ghost" className="px-2 text-sm" onClick={() => void refresh()}>
            다시 확인
          </Button>
          <Button size="sm" aria-disabled className="px-3 text-sm aria-disabled:hover:bg-primary">
            시작하기
          </Button>
        </div>
      );
    return (
      <Alert role="status" className="bg-muted" data-testid="plan-strip">
        {inTab && approval ? <ApprovalChip a={approval} /> : <span aria-hidden="true">◐</span>}
        <span className="mr-auto">계획이에요. 시작할 수 있는지 확인하지 못했어요.</span>
        <Button size="sm" variant="ghost" className="px-2 text-sm" onClick={() => void refresh()}>
          다시 확인
        </Button>
        <Button size="sm" aria-disabled className="px-3 text-sm aria-disabled:hover:bg-primary">
          시작하기
        </Button>
      </Alert>
    );
  }
  // Started: the tab still says it was approved, and which revision; the strip above hides (E22's strip shows).
  if (inTab && path && approval?.kind === 'approved') {
    return (
      <div role="status" className="plan-bar" data-testid="plan-strip">
        <div className="plan-bar-text">
          <div className="plan-bar-head">
            <ApprovalChip a={approval} />
            <span className="font-normal">{approval.text}</span>
          </div>
          {approval.at !== null && (
            <time className="plan-bar-meta" dateTime={new Date(approval.at).toISOString()} title={new Date(approval.at).toLocaleString('ko-KR')}>
              {whenLabel(approval.at)} 시작했어요
            </time>
          )}
        </div>
      </div>
    );
  }
  if (!path || !status || status.state !== 'plan') return null;
  const blocked = status.blockers.length > 0;
  const asks = unansweredAsks(document);
  const view = shown ?? status;
  const viewLimits = limitLine(view.limits);

  // Unsaved edits belong to the plan the person approves, so save first, then show what the server holds.
  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await openPlanConfirm(session, path, readStatus);
      if (r.kind === 'refuse') return setError(r.message);
      if (r.kind === 'gone') return void refresh();
      const st = r.status;
      setStatus(st);
      setShown(confirmSnapshot(st));
      setNotice(null);
      setConfirming(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '시작하지 못했어요');
    } finally {
      setBusy(false);
    }
  };

  openRef.current = () => void open();

  const start = async () => {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      const { res, body } = await requestStart(path, shown);
      if (!res.ok) {
        if (isPlanChanged(res.status, body)) {
          // Stay in the dialog with the new plan, so the person confirms what will really run.
          const st = await readStatus(path).catch(() => null);
          if (st && st.state === 'plan') {
            setStatus(st);
            setShown(confirmSnapshot(st));
            setNotice(PLAN_CHANGED_NOTICE);
            return;
          }
        }
        setError(startError(res.status, body));
        setConfirming(false);
        void refresh();
        return;
      }
      setConfirming(false);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '시작하지 못했어요');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const message = (
    <>
        {error && <span className="text-destructive">{error} </span>}
        {/* Every blocker in words, also after an error, so a blocked 시작하기 never goes unexplained (#788). */}
        {blocked ? (
          <>
            계획이에요. 지금은 시작할 수 없어요: <span data-testid="plan-blockers">{status.blockers.join(' · ')}</span>
          </>
        ) : (
          !error && <>{(approval?.kind === 'revised' || inTab) ? approval?.text : '계획이에요. 고칠 곳을 고친 뒤 시작해 주세요.'}</>
        )}
    </>
  );
  const buttons = (
    <>
      <Button size="sm" variant="ghost" aria-expanded={modelsOpen} aria-controls={modelsId} className="px-2 text-sm" onClick={() => setModelsOpen((v) => !v)}>
        단계 모델
      </Button>
      {/* An aria-disabled button gets no pointer events (and stays focusable, so the description is reachable by Tab), so the tooltip with every blocker sits on the wrapper. */}
      <span title={blocked ? status.blockers.join('\n') : undefined} data-testid="start-wrap" className="inline-flex">
        <Button
          size="sm"
          disabled={busy}
          aria-disabled={blocked || undefined}
          aria-describedby={blocked ? blockersId : undefined}
          className={inTab ? 'h-9 px-4 text-sm aria-disabled:hover:bg-primary' : 'px-3 text-sm aria-disabled:hover:bg-primary'}
          onClick={() => {
            if (blocked) return;
            void open();
          }}
        >
          시작하기
        </Button>
      </span>
    </>
  );

  return (
    <>
    {inTab && approval ? (
      <div role="status" className="plan-bar" data-testid="plan-strip">
        <div className="plan-bar-text">
          <div className="plan-bar-head">
            <ApprovalChip a={approval} />
            <span className="font-normal">{message}</span>
          </div>
          <span className="plan-bar-meta">
            세션 {status.sessions}개{limitLine(status.limits) ? ` · ${limitLine(status.limits)}` : ''} · 한 번 시작하면 머지까지 이어서 해요
          </span>
        </div>
        {buttons}
      </div>
    ) : (
    <Alert role="status" className="bg-muted" data-testid="plan-strip">
      <span aria-hidden="true">◐</span>
      <span className="mr-auto">{message}</span>
      <span className="text-muted-foreground">예상 {status.sessions}세션</span>
      {buttons}
    </Alert>
    )}
    {/* Outside the live region: picking a model must not re-read the strip. */}
    {modelsOpen && <StepModels id={modelsId} session={session} path={path} />}
    {/* Outside the live region too, so the open dialog and its role="alert" are not nested live regions. */}
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => setConfirming(false)}
      className="m-auto w-[min(28rem,calc(100%-2rem))] overscroll-contain rounded-lg border bg-background p-0 text-sm text-foreground shadow-md backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/40"
    >
      <h2 id={titleId} className="overlay-head border-b text-sm font-semibold">
        이 계획으로 시작할까요?
      </h2>
      <div className="flex flex-col gap-1.5 px-(--overlay-x) py-(--overlay-y)">
        <p>
          세션 {view.sessions}개{viewLimits ? ` · ${viewLimits}` : ''}
        </p>
        <p>바뀐 점: {view.changes.length ? view.changes.join(', ') : '없어요'}</p>
        {/* Space is reserved (visibility, not display) so the buttons do not move under the pointer. */}
        <p id={noticeId} role="alert" className="text-destructive" style={{ visibility: notice ? 'visible' : 'hidden' }}>
          {notice ?? PLAN_CHANGED_NOTICE}
        </p>
        {asks > 0 && <p className="text-destructive">물어볼 것 {asks}개에 답이 없어요. 그래도 시작할까요?</p>}
      </div>
      <form method="dialog" className="overlay-foot flex items-center justify-end gap-2 border-t">
        <Button type="submit" value="cancel" variant="outline" size="sm" className="bg-transparent px-3 text-sm">
          취소
        </Button>
        <Button
          size="sm"
          disabled={busy}
          aria-describedby={notice ? noticeId : undefined}
          className="px-3 text-sm aria-disabled:hover:bg-primary"
          onClick={() => void start()}
        >
          시작하기
        </Button>
      </form>
    </dialog>
    {/* Outside the live region, so a status refresh does not read the whole list again. */}
    {blocked && <span id={blockersId} className="sr-only">{status.blockers.join(', ')}</span>}
    </>
  );
}
