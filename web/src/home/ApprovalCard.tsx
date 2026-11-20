// 승인 대기 (#836): what waits for a person, on top of the 대시보드 so a waiting plan cannot stall a team unseen. Plans
// waiting for 시작하기 (opens the plan with its own confirm dialog, so the person sees the plan they approve) and open
// permission prompts of sessions (the command or input to run, then allow or deny). A plan whose lead session is gone
// shows why and offers 정리 instead.
// Hidden when nothing waits. Built on the dashboard's <Card>; the one accent is the warn dot in the header.
import { useState } from 'react';
import { ShieldAlert, Workflow } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';
import { api } from '../dispatch/store';
import { useNow } from '../dispatch/AttentionStrip';
import { elapsed } from '../../../shared/dispatch/attention.ts';
import { planAction, shortDetail, type PermissionAsk } from '../activity/approvals.ts';
import { planTitle, planWaitingText, type WaitingPlan } from '../activity/plans.ts';
import { usePermissionAsks, reloadPermissionAsks } from '../activity/permissionAsksStore';
import { useWaitingPlans } from '../activity/waitingPlans';
import { requestPlanConfirm } from '../run/planConfirmRequest';
import { toastRequest } from '../activity/actionToast';
import { Card, StatusDot } from './dash';

/** "8분째 기다려요", "방금 왔어요"; null when unknown. */
const waited = (since: number | null, now: number) => {
  const e = elapsed(since, now);
  return e == null ? null : e ? `${e}째 기다려요` : '방금 왔어요';
};

type Busy = { key: string } | null;

function Row({ icon, title, sub, note, bad, detail, children }: { icon: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; note?: string | null; bad?: boolean; detail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 basis-56">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        {detail}
        {note && <span role={bad ? 'alert' : undefined} className={cn('block text-xs', bad ? 'text-destructive' : 'text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]')}>{note}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span>
    </li>
  );
}

function PlanRow({ plan, now, onOpen, busy, run }: { plan: WaitingPlan; now: number; onOpen: (path: string) => void; busy: Busy; run: (key: string, job: () => Promise<string | null>) => void }) {
  const [error, setError] = useState<string | null>(null);
  const action = planAction(plan);
  const key = `plan:${plan.path}`;
  const time = waited(plan.since, now);
  const go = (job: () => Promise<string | null>) => run(key, async () => {
    const err = await job();
    setError(err);
    return err;
  });
  // The plan's strip opens its confirm dialog (steps, sessions, the revision seen) once the document is loaded.
  const start = () => {
    requestPlanConfirm(plan.path);
    onOpen(plan.path);
  };
  const dismiss = () => go(() => api('POST', '/api/pipeline/dismiss', { path: plan.path }).then(() => null, (e: Error) => e.message));
  return (
    <Row
      icon={<Workflow />}
      title={
        <button type="button" className="max-w-full truncate rounded-sm text-left hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" onClick={() => onOpen(plan.path)}>
          {planTitle(plan)}
        </button>
      }
      sub={[planWaitingText(plan), time].filter(Boolean).join(' · ')}
      note={error ?? (plan.blockers.length ? plan.blockers.join(' · ') : null)}
      bad={!!error}
    >
      {action === 'start' && <Button size="sm" onClick={start}>시작하기</Button>}
      {action === 'dismiss' && <Button size="sm" variant="outline" disabled={!!busy} onClick={dismiss}>정리</Button>}
      {action === null && <Button size="sm" variant="outline" onClick={() => onOpen(plan.path)}>열기</Button>}
    </Row>
  );
}

function AskRow({ ask, now, busy, run }: { ask: PermissionAsk; now: number; busy: Busy; run: (key: string, job: () => Promise<string | null>) => void }) {
  const [error, setError] = useState<string | null>(null);
  const answer = (behavior: 'allow' | 'deny') =>
    run(`ask:${ask.requestId}`, async () => {
      const sent = api('POST', `/api/sessions/${encodeURIComponent(ask.sessionId)}/permission`, { requestId: ask.requestId, behavior });
      // The failure shows in the row (note), so the toast only says it went through.
      const err = await toastRequest(sent, { loading: '답을 보내는 중이에요', success: behavior === 'allow' ? '허용했어요' : '거절했어요', error: null }).then(() => null, (e: Error) => e.message);
      setError(err);
      // A success comes back as the session's SSE event; a failure may mean the prompt is gone, so read them again.
      if (err) reloadPermissionAsks();
      return err;
    });
  const time = waited(ask.since, now);
  return (
    <Row icon={<ShieldAlert />} title={`${ask.tool} 실행을 허용할까요?`} sub={[`${ask.session} 세션`, ask.description, time].filter(Boolean).join(' · ')} note={error} bad={!!error} detail={ask.detail && <AskDetail text={ask.detail} />}>
      <Button size="sm" disabled={!!busy} onClick={() => answer('allow')}>허용</Button>
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={() => answer('deny')}>거절</Button>
    </Row>
  );
}

/** What runs once allowed: one short line, the whole text a click away. */
function AskDetail({ text }: { text: string }) {
  const short = shortDetail(text);
  const code = 'font-mono text-xs';
  if (short === text) return <code className={cn(code, 'mt-1 block truncate rounded-md bg-muted px-1.5 py-0.5')} data-ask-detail>{text}</code>;
  return (
    <details className="mt-1" data-ask-detail>
      <summary className={cn(code, 'block cursor-pointer list-none truncate rounded-md bg-muted px-1.5 py-0.5 [&::-webkit-details-marker]:hidden')} title="눌러서 전체 보기">{short}</summary>
      <pre className={cn(code, 'mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap break-all')}>{text}</pre>
    </details>
  );
}

export function ApprovalCard({ onOpen }: { onOpen: (path: string) => void }) {
  const plans = useWaitingPlans();
  const asks = usePermissionAsks();
  const now = useNow();
  const [busy, setBusy] = useState<Busy>(null);
  const total = plans.length + asks.length;
  if (total === 0) return null;
  const run = (key: string, job: () => Promise<string | null>) => {
    if (busy) return;
    setBusy({ key });
    void job().finally(() => setBusy(null));
  };
  return (
    <div className="shrink-0 px-4 pt-4" data-approvals>
      <Card id="approvals" title={<StatusDot tone="warn">승인 대기</StatusDot>} count={total} hint="사람이 확인해야 다음으로 넘어가요" flush>
        <ul aria-label="승인 대기 목록" aria-live="polite" className="m-0 list-none divide-y p-0">
          {plans.map((p) => <PlanRow key={p.path} plan={p} now={now} onOpen={onOpen} busy={busy} run={run} />)}
          {asks.map((a) => <AskRow key={a.requestId} ask={a} now={now} busy={busy} run={run} />)}
        </ul>
      </Card>
    </div>
  );
}
