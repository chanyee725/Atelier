// Start panel of an issue nobody works on yet (#954): opens at the right of the dashboard in the team panel's frame
// (agent-live in live.css). 머리: number, title, GitHub에서 열기 (the only way to GitHub), close. Body: the first lines
// of the issue (GET /api/issues/:n/summary), the team (관리자 + 구현 1 + 리뷰 1, models to pick), which lead takes it
// (a live one, or a new one by default), and 시작하기 — the screen's one standout. Pressing it is the approval: an
// existing lead gets the work as a message, a new lead is created with the team rules (the file team.sh uses). The
// lead then makes the teammates without a plan, and the dashboard swaps this panel for the team panel on its own.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { Model, Session } from '../../../shared/dispatch/types.ts';
import { api } from '../dispatch/store';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { issuesBlankReason, type IssueRow } from '../home/issueBoard';
import { DEFAULT_IMPL_MODEL, DEFAULT_REVIEW_MODEL, NEW_LEAD, issueTask, liveLeads, newLeadBody } from '../home/issueStart';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { closeIssueTeam } from './issueStore';
import { PanelTrail } from './PanelTrail';
import { TRAIL } from './origin';
import { useAgentLiveTarget } from './store';
import './live.css';

type Summary = { ok: true; summary: string[] } | { ok: false; reason: string } | null;
type Sent = { state: 'idle' } | { state: 'busy' } | { state: 'done'; text: string } | { state: 'error'; text: string };
type Props = { row: IssueRow; sessions: readonly Session[]; folder?: string | null; closing?: boolean };

export function IssueStartPanel({ row, sessions, folder, closing = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const n = row.number;
  const [summary, setSummary] = useState<Summary>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [impl, setImpl] = useState(DEFAULT_IMPL_MODEL);
  const [review, setReview] = useState(DEFAULT_REVIEW_MODEL);
  const [lead, setLead] = useState(NEW_LEAD);
  const [sent, setSent] = useState<Sent>({ state: 'idle' });
  const leads = liveLeads(sessions);
  // A lead that ended while picked falls back to a new one.
  const leadId = lead && leads.some((s) => s.id === lead) ? lead : NEW_LEAD;

  // One panel at a time: hidden while a session's live panel is open, like the team panel.
  const hidden = !!useAgentLiveTarget();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const open = el.matches(':popover-open');
    if (hidden && open) el.hidePopover();
    else if (!hidden && !open) el.showPopover();
  }, [hidden]);
  useEffect(() => {
    if (!hidden) closeBtn.current?.focus({ preventScroll: true });
  }, [hidden]);
  useEffect(() => {
    const ctl = new AbortController();
    setSummary(null);
    setSent({ state: 'idle' });
    api<Summary>('GET', `/api/issues/${n}/summary`, undefined, ctl.signal).then(setSummary, () => !ctl.signal.aborted && setSummary({ ok: false, reason: 'error' }));
    return () => ctl.abort();
  }, [n]);
  useEffect(() => {
    const ctl = new AbortController();
    api<{ models?: Model[]; providers?: Record<string, { connected?: boolean }> }>('GET', '/api/state', undefined, ctl.signal).then(
      (s) => setModels((s.models ?? []).filter((m) => s.providers?.[m.provider]?.connected !== false)),
      () => !ctl.signal.aborted && setModels([]),
    );
    return () => ctl.abort();
  }, []);

  const start = async () => {
    if (sent.state === 'busy' || sent.state === 'done') return;
    setSent({ state: 'busy' });
    const issue = { number: n, title: row.title };
    const team = { impl, review };
    try {
      if (leadId) {
        await api('POST', `/api/sessions/${encodeURIComponent(leadId)}/message`, { text: issueTask(issue, team) });
        const name = leads.find((s) => s.id === leadId)?.name ?? '관리자';
        setSent({ state: 'done', text: `${name}에게 보냈어요. 곧 팀원을 만들어요.` });
      } else {
        const { default: rules } = await import('../../../plugin/skills/atelier-team/reference/rules.md?raw');
        await api('POST', '/api/sessions', newLeadBody(issue, team, rules, folder));
        setSent({ state: 'done', text: '새 관리자를 만들었어요. 곧 팀원을 만들어요.' });
      }
    } catch (e) {
      setSent({ state: 'error', text: `시작하지 못했어요. ${(e as Error).message}` });
    }
  };

  const done = sent.state === 'done';
  const busy = sent.state === 'busy';
  return (
    <dialog
      ref={ref}
      popover="manual"
      aria-labelledby={`${uid}-title`}
      className="agent-live"
      data-issue-start={n}
      data-closing={closing || undefined}
      inert={closing || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          closeIssueTeam();
        }
      }}
    >
      <header className="agent-live-head">
        <div className="grid min-w-0 gap-1.5">
          <PanelTrail steps={TRAIL.openIssues} current={`#${n}`} onBack={closeIssueTeam} />
          <h2 id={`${uid}-title`} className="m-0 flex min-w-0 items-baseline gap-2 text-[13px] font-normal">
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{n}</span>
            <span className="min-w-0 truncate text-sm font-semibold" title={row.title}>{row.title || '제목 없음'}</span>
          </h2>
          {row.url && (
            <div className="flex">
              <a href={row.url} target="_blank" rel="noreferrer" data-issue-github className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground no-underline hover:bg-accent hover:text-foreground', FOCUS_RING)}>
                GitHub에서 열기
                <ExternalLink aria-hidden className="size-3" />
              </a>
            </div>
          )}
        </div>
        <button ref={closeBtn} type="button" aria-label="닫기" onClick={closeIssueTeam} className={cn('agent-live-icon', FOCUS_RING)}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <form
        className="agent-live-body flex flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <section aria-labelledby={`${uid}-sum`}>
          <h3 id={`${uid}-sum`}>요약</h3>
          {summary === null ? (
            <p className="agent-live-muted">이슈를 읽는 중이에요</p>
          ) : !summary.ok ? (
            <p className="agent-live-muted">{issuesBlankReason(summary.reason)}</p>
          ) : summary.summary.length ? (
            <div data-issue-summary className="grid gap-1 text-[13px] leading-relaxed text-foreground">
              {summary.summary.map((line, i) => (
                <p key={i} className="m-0">{line}</p>
              ))}
            </div>
          ) : (
            <p className="agent-live-muted">본문이 비어 있어요</p>
          )}
        </section>
        <section aria-labelledby={`${uid}-team`}>
          <h3 id={`${uid}-team`}>팀</h3>
          <p className="agent-live-muted">관리자 1, 구현 1, 리뷰 1로 시작해요</p>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
            <label htmlFor={`${uid}-impl`} className="text-muted-foreground">구현 모델</label>
            <ModelSelect id={`${uid}-impl`} value={impl} onChange={setImpl} models={models} disabled={done || busy} />
            <label htmlFor={`${uid}-review`} className="text-muted-foreground">리뷰 모델</label>
            <ModelSelect id={`${uid}-review`} value={review} onChange={setReview} models={models} disabled={done || busy} />
          </div>
        </section>
        <section aria-labelledby={`${uid}-lead`}>
          <h3 id={`${uid}-lead`}>관리자</h3>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 text-xs">
            <label htmlFor={`${uid}-lead-pick`} className="text-muted-foreground">맡길 관리자</label>
            <NativeSelect id={`${uid}-lead-pick`} value={leadId} onChange={(e) => setLead(e.target.value)} disabled={done || busy} className="w-full" data-issue-lead>
              <option value={NEW_LEAD}>새 관리자 만들기</option>
              {leads.map((s) => (
                <option key={s.id} value={s.id}>{`${s.name} · ${s.modelLabel}`}</option>
              ))}
            </NativeSelect>
          </div>
          <p className="agent-live-muted">계획 문서 없이 바로 팀원을 만들어요. 시작하기가 승인이에요.</p>
        </section>
        <div className="mt-auto grid gap-2 border-t px-4 py-3">
          <Button type="submit" disabled={done || busy} aria-describedby={`${uid}-status`} data-issue-start-button className="w-full">
            {busy ? '시작하는 중…' : done ? '시작했어요' : '시작하기'}
          </Button>
          <p id={`${uid}-status`} role="status" className={cn('m-0 min-h-4 text-xs', sent.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {sent.state === 'done' || sent.state === 'error' ? sent.text : ''}
          </p>
        </div>
      </form>
    </dialog>
  );
}

/** A model picker: the connected models, else (state not read yet or failed) the chosen id alone. */
function ModelSelect({ id, value, onChange, models, disabled }: { id: string; value: string; onChange: (v: string) => void; models: Model[] | null; disabled: boolean }) {
  const list = models?.length ? models : [];
  const has = list.some((m) => m.id === value);
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="w-full">
      {!has && <option value={value}>{value}</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>{m.label}</option>
      ))}
    </NativeSelect>
  );
}
