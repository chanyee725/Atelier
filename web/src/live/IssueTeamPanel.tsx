// Team panel of an in-progress issue (#925): opens at the right of the dashboard in the live panel's own frame
// (agent-live in live.css) and shows who is on the issue and where it stands. 머리 (number, title, stage, host links),
// 팀 (관리자, 팀원: model, role, state, what they do now; a row opens that session's live panel), 진행 (branch → PR,
// review verdict, merged PRs), 비용 (team total, per model). Metadata only; it reads the dashboard's feeds, no request
// of its own. Hidden while a session's live panel is open and back when that closes (issueStore.ts). #942: a path line
// in the head, the row that opened a live panel keeps a ring, and working rows use the dashboard's `.session-track`.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ExternalLink, GitBranch, GitPullRequest, MessageCircle, X } from 'lucide-react';
import type { Session } from '../../../shared/dispatch/types.ts';
import type { BoardTask } from '../dispatch/types.ts';
import { ModelTag } from '../dispatch/parts';
import { fmtK, fmtUsd, stateOf } from '../dispatch/lib/format.ts';
import { fmtDuration } from '../home/issueTotals.ts';
import { ACTIVE_STAGE, issueEta, type ActiveIssue } from '../home/activeIssues';
import { ISSUE_STATE, type IssueRow } from '../home/issueBoard';
import type { Pr } from '../home/projectFeeds';
import { issueTitles, taskSummary } from '../home/taskSummary';
import { FOCUS_RING } from '../lib/focus';
import { cn } from '../lib/utils';
import { liveStateLabel, liveStateTone } from './format';
import { flowOf, teamCost, teamOf, verdict } from './issueTeam';
import { closeIssueTeam } from './issueStore';
import { askAboutIssue } from '../chat/lib/askIssue';
import { PanelTrail } from './PanelTrail';
import { TRAIL, teamTrail } from './origin';
import { trackProps, trackTone } from '../home/trackTone';
import { openAgentLive, useAgentLiveTarget } from './store';
import './live.css';

const DOT = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-destructive', idle: 'bg-idle' } as const;
const VERDICT_DOT = { clear: 'bg-ok', 'must-fix': 'bg-destructive', waiting: 'bg-warn', none: 'bg-idle' } as const;

type Props = { issue: ActiveIssue; row: IssueRow; tasks: readonly BoardTask[]; answerOf: (branch: string) => Pr | null; now: number; closing?: boolean };

export function IssueTeamPanel({ issue, row, tasks, answerOf, now, closing = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const liveSid = useAgentLiveTarget();
  const hidden = !!liveSid;
  const team = teamOf(issue);
  const cost = teamCost(team, now);
  const v = verdict(row.prs, answerOf);
  const flow = flowOf(row.branches, row.prs);
  const eta = issueEta(issue.etaAt, now);
  const stage = ACTIVE_STAGE[issue.stage];
  const titleOf = issueTitles([{ number: issue.number, title: issue.title }]);
  const prUrl = row.prs.find((p) => p.state === 'open' && p.url)?.url ?? row.prs.find((p) => p.url)?.url;

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

  return (
    <dialog
      ref={ref}
      popover="manual"
      aria-label={`이슈 #${issue.number} 팀 모니터링`}
      className="agent-live"
      data-issue-team={issue.number}
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
          <PanelTrail steps={TRAIL.issues} current={`#${issue.number}`} onBack={closeIssueTeam} />
          <h2 className="m-0 flex min-w-0 items-baseline gap-2 text-[13px] font-normal">
            <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">#{issue.number}</span>
            <span className="min-w-0 truncate text-sm font-semibold" title={issue.title}>{issue.title || '제목 없음'}</span>
          </h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span data-team-stage={issue.stage} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-foreground/6 px-2.5 text-muted-foreground">
              <span aria-hidden className={cn('size-1.5 rounded-full', stage.dot)} />
              {stage.label}
            </span>
            {issue.url && <HostLink href={issue.url} label="GitHub에서 열기" />}
            {prUrl && <HostLink href={prUrl} label="PR 열기" />}
            {/* #954: talk about this issue in the chat dock, with the team's lead when it has one. */}
            <button
              type="button"
              data-issue-chat={issue.number}
              onClick={() => askAboutIssue({ number: issue.number, title: issue.title, state: ISSUE_STATE[row.state].label, url: issue.url }, { ask: false, partner: issue.leads[0]?.id ?? null })}
              className={cn('inline-flex h-6 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground', FOCUS_RING)}
            >
              <MessageCircle aria-hidden className="size-3" />
              채팅으로 가기
            </button>
          </div>
        </div>
        <button ref={closeBtn} type="button" aria-label="닫기" onClick={closeIssueTeam} className={cn('agent-live-icon', FOCUS_RING)}>
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="agent-live-body">
        <section aria-labelledby="it-team">
          <h3 id="it-team">팀 <span className="agent-live-count">{team.length}</span></h3>
          {team.length ? (
            <ul className="m-0 grid list-none gap-1 p-0" data-team-rows>
              {team.map((s) => (
                <TeamRow key={s.id} s={s} issue={issue.number} selected={liveSid === s.id} text={taskSummary(s, titleOf, tasks)?.text ?? null} />
              ))}
            </ul>
          ) : (
            <p className="agent-live-muted">지금 일하는 세션이 없어요</p>
          )}
        </section>
        <section aria-labelledby="it-flow">
          <h3 id="it-flow">진행</h3>
          {flow.length > 0 && (
            <ul className="m-0 grid list-none gap-1.5 p-0" data-team-flow>
              {flow.map((f) => (
                <li key={f.branch || `pr${f.pr?.number}`} className="flex min-w-0 items-center gap-1.5 text-xs">
                  {f.branch && (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono" title={f.branch}>
                      <GitBranch aria-hidden className="size-3 shrink-0" />
                      <span className="truncate">{f.branch}</span>
                    </span>
                  )}
                  <span aria-hidden className="text-muted-foreground">→</span>
                  {f.pr ? (
                    <a href={f.pr.url} target="_blank" rel="noreferrer" className={cn('inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground/6 px-1.5 py-0.5 text-inherit no-underline hover:underline', FOCUS_RING)}>
                      <GitPullRequest aria-hidden className="size-3" />#{f.pr.number}
                      <span className="text-muted-foreground">{f.pr.state === 'merged' ? '머지됨' : '열림'}</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground">PR 전</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 flex items-center gap-1.5 text-xs" data-team-verdict={v.key}>
            <span aria-hidden className={cn('size-2 rounded-full', VERDICT_DOT[v.key])} />
            리뷰 <span className="text-foreground">{v.label}</span>
          </p>
          {issue.progress && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div role="progressbar" aria-label={`PR ${issue.progress.total}개 중 ${issue.progress.merged}개 머지`} aria-valuemin={0} aria-valuemax={issue.progress.total} aria-valuenow={issue.progress.merged} className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/8">
                <div className="h-full rounded-full bg-merged" style={{ width: `${(issue.progress.merged / issue.progress.total) * 100}%` }} />
              </div>
              <span className="shrink-0 tabular-nums">PR {issue.progress.total}개 중 {issue.progress.merged}개 머지</span>
            </div>
          )}
          {eta && <p className={cn('m-0 text-xs tabular-nums', eta.late ? 'text-warn' : 'text-muted-foreground')} data-team-eta>{eta.text}</p>}
        </section>
        <section aria-labelledby="it-cost">
          <h3 id="it-cost">비용</h3>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums" data-team-cost>
            <span>{fmtDuration(cost.ms)}</span>
            <span>{fmtK(cost.tokens)} 토큰</span>
            <span className="text-foreground">{fmtUsd(cost.cost)}</span>
          </p>
          {cost.byModel.length > 0 && (
            <ul className="m-0 grid list-none gap-1 p-0 text-xs" data-team-models>
              {cost.byModel.map((m) => (
                <li key={`${m.provider}/${m.model}`} className="flex min-w-0 items-center gap-2">
                  <ModelTag provider={m.provider} label={m.modelLabel} />
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">세션 {m.sessions} · {fmtK(m.tokens)} · {fmtUsd(m.cost)}</span>
                </li>
              ))}
            </ul>
          )}
          {cost.shared > 0 && <p className="agent-live-muted m-0 text-xs">관리자 세션은 다른 이슈도 맡아서 합계에서 빼요</p>}
        </section>
      </div>
    </dialog>
  );
}

function HostLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn('inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-muted-foreground no-underline hover:bg-accent hover:text-foreground', FOCUS_RING)}>
      {label}
      <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

function TeamRow({ s, issue, selected, text }: { s: Session; issue: number; selected: boolean; text: string | null }) {
  const state = stateOf(s);
  const tone = liveStateTone(state);
  const working = state === 'working';
  const bar = trackTone(s.activity?.label, working ? 'working' : state === 'waiting' ? 'waiting' : null);
  const track = bar ? trackProps(bar) : null;
  return (
    <li data-team-row={s.id}>
      <button
        type="button"
        data-origin
        aria-current={selected || undefined}
        onClick={(e) => openAgentLive(s.id, { trigger: e.currentTarget, from: 'sheet', trail: teamTrail(issue) })}
        className={cn('grid w-full min-w-0 gap-1 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-inherit hover:bg-accent', FOCUS_RING)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tone], working && 'motion-safe:animate-pulse')} />
          <span className="min-w-0 truncate text-sm font-medium">{s.name}</span>
          <span className="shrink-0 rounded-full bg-foreground/6 px-2 text-xs leading-5 text-muted-foreground">{s.roleName}</span>
          <ModelTag provider={s.provider} label={s.modelLabel} className="ml-auto" />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-4 text-xs text-muted-foreground">
          <span className="shrink-0 text-foreground">{liveStateLabel(state, false)}</span>
          {text && <span className="truncate" title={text}>{text}</span>}
        </span>
        {/* The same working track as the dashboard cards (#942): one CSS, one tone mapping. */}
        {track && <span aria-hidden {...track} className={cn(track.className, 'ml-4')} />}
      </button>
    </li>
  );
}
