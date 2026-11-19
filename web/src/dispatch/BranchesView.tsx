// Live branch view (#792): every session branch with its owner sessions, issue, commits ahead/behind the integration
// branch, last commit, PR phase and uncommitted-work flag. BranchesPage is the 세션 보드 › 브랜치 tab; BranchesWidget
// is the compact list a dashboard can place (it loads its own data). Merged branches fade. Read-only, metadata only.
import { useId, useMemo } from 'react';
import { ArrowRight, GitBranch } from 'lucide-react';
import { cn } from '../lib/utils';
import { roleColor } from '../run/overlayModel';
import { initials } from '../home/issueBoard';
import { boardHash } from '../projectNav';
import { ago, TONE_TEXT } from './lib/format.ts';
import { aheadBehindText, PR_PHASE, prOffText, shownRows, type BranchRow, type BranchSession } from './lib/liveBranches.ts';
import { useScoped } from './scope';
import { useNow } from './AttentionStrip';
import { useLiveBranches } from './useLiveBranches';

function Owners({ sessions }: { sessions: BranchSession[] }) {
  if (!sessions.length) return <span className="text-muted-foreground">—</span>;
  const names = sessions.map((s) => `${s.name} (${s.roleName}${s.open ? '' : ', 끝남'})`).join(', ');
  return (
    <span className="inline-flex items-center" title={names}>
      <span className="sr-only">{names}</span>
      {sessions.slice(0, 3).map((s) => (
        <span
          key={s.id}
          aria-hidden
          className={cn('-ml-1 grid size-5 place-items-center rounded-full text-[9px] font-semibold text-background ring-2 ring-background first:ml-0', !s.open && 'opacity-60')}
          style={{ background: roleColor(s.role) }}
        >
          {initials(s.name)}
        </span>
      ))}
      {sessions.length > 3 && <span aria-hidden className="ml-1 text-[11px] text-muted-foreground tabular-nums">+{sessions.length - 3}</span>}
    </span>
  );
}

function AheadBehind({ row, base }: { row: BranchRow; base: string | null }) {
  return (
    <span className="tabular-nums whitespace-nowrap" title={aheadBehindText(row, base)}>
      <span className="sr-only">{aheadBehindText(row, base)}</span>
      <span aria-hidden className={row.ahead ? 'text-foreground' : 'text-muted-foreground'}>↑{row.ahead}</span>{' '}
      <span aria-hidden className={row.behind ? 'text-warn' : 'text-muted-foreground'}>↓{row.behind}</span>
    </span>
  );
}

function PrChip({ pr }: { pr: BranchRow['pr'] }) {
  if (!pr) return <span className="text-muted-foreground">—</span>;
  const p = PR_PHASE[pr.phase];
  const body = (
    <>
      <span className="tabular-nums">#{pr.number}</span> <span className={pr.phase === 'merged' ? 'text-merged' : TONE_TEXT[p.tone]}>{p.label}</span>
    </>
  );
  return pr.url ? (
    <a href={pr.url} target="_blank" rel="noreferrer" className="whitespace-nowrap rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {body}
    </a>
  ) : (
    <span className="whitespace-nowrap">{body}</span>
  );
}

const Dirty = ({ dirty }: { dirty: boolean | null }) =>
  dirty ? (
    <span className="whitespace-nowrap text-warn" title="커밋하지 않은 변경이 있어요">● 변경 있음</span>
  ) : dirty === false ? (
    <span className="text-muted-foreground">깨끗함</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const LastCommit = ({ row, now }: { row: BranchRow; now: number }) => (
  <span className="flex min-w-0 items-baseline gap-2">
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{row.lastAt ? ago(row.lastAt, now) : '—'}</span>
    <span className="truncate" title={row.subject}>{row.subject}</span>
  </span>
);

const CELL = 'px-3 py-2 align-middle @max-[720px]/branches:flex @max-[720px]/branches:gap-2 @max-[720px]/branches:px-0 @max-[720px]/branches:py-0.5 @max-[720px]/branches:before:shrink-0 @max-[720px]/branches:before:text-muted-foreground @max-[720px]/branches:before:content-[attr(data-label)]';
const HEAD = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground';

/** 세션 보드 › 브랜치: one row per session branch of the board's project scope, updating live. */
export function BranchesPage() {
  const data = useLiveBranches();
  const { sessions, scope } = useScoped();
  const now = useNow();
  const caption = useId();
  const ids = useMemo(() => (scope === undefined ? null : new Set(sessions.map((s) => s.id))), [sessions, scope]);
  const rows = useMemo(() => (data && data !== 'failed' ? shownRows(data.rows, ids ? (s) => ids.has(s.id) : null) : []), [data, ids]);

  if (data === null) return <p role="status" className="m-0 px-6 py-6 text-sm text-muted-foreground max-md:px-4">브랜치를 불러오는 중이에요.</p>;
  if (data === 'failed') return <p role="alert" className="m-0 px-6 py-6 text-sm text-destructive max-md:px-4">브랜치를 불러오지 못했어요. 잠시 뒤 다시 시도해요.</p>;
  const off = prOffText(data.pr);
  return (
    <section data-branches-page className="@container/branches flex min-w-0 flex-col gap-3 px-6 py-5 max-md:px-4">
      {off && <p className="m-0 text-xs text-muted-foreground">{off}</p>}
      {!rows.length ? (
        <p className="m-0 text-sm text-muted-foreground">세션 브랜치가 아직 없어요. worktree로 세션을 만들면 여기에 떠요.</p>
      ) : (
        <div tabIndex={0} role="region" aria-labelledby={caption} className="max-w-full overflow-auto rounded-lg border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <table className="w-full border-separate border-spacing-0 text-sm @max-[720px]/branches:block">
            <caption id={caption} className="sr-only">
              세션 브랜치, {data.base ?? '기준 브랜치'} 기준
            </caption>
            <thead className="sticky top-0 z-10 bg-background @max-[720px]/branches:hidden">
              <tr className="[&>th]:border-b">
                <th scope="col" className={HEAD}>브랜치</th>
                <th scope="col" className={HEAD}>세션</th>
                <th scope="col" className={HEAD}>{data.base ?? '기준'} 대비</th>
                <th scope="col" className={HEAD}>최근 커밋</th>
                <th scope="col" className={HEAD}>PR</th>
                <th scope="col" className={HEAD}>작업 폴더</th>
              </tr>
            </thead>
            <tbody className="@max-[720px]/branches:block">
              {rows.map((r) => (
                <tr
                  key={r.branch}
                  data-branch-row
                  data-merged={r.merged || undefined}
                  className={cn('[&>*]:border-b last:[&>*]:border-b-0 @max-[720px]/branches:block @max-[720px]/branches:border-b @max-[720px]/branches:px-3 @max-[720px]/branches:py-2 @max-[720px]/branches:[&>*]:border-b-0 @max-[720px]/branches:[&>th]:block', r.merged && 'opacity-50')}
                >
                  <th scope="row" className="px-3 py-2 text-left font-normal @max-[720px]/branches:px-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-[13px]" title={r.branch}>{r.branch}</span>
                      {r.issue != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{r.issue}</span>}
                      {r.merged && <span className="shrink-0 text-xs text-muted-foreground">병합됨</span>}
                    </span>
                  </th>
                  <td data-label="세션 " className={CELL}><Owners sessions={r.sessions} /></td>
                  <td data-label="앞/뒤 " className={CELL}><AheadBehind row={r} base={data.base} /></td>
                  <td data-label="커밋 " className={cn(CELL, 'max-w-[28rem] @max-[720px]/branches:max-w-none')}><LastCommit row={r} now={now} /></td>
                  <td data-label="PR " className={CELL}><PrChip pr={r.pr} /></td>
                  <td data-label="작업 폴더 " className={CELL}><Dirty dirty={r.dirty} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Compact branch list for a dashboard: the `limit` liveliest session branches of `folder` ('' or omitted = every
 * session of this server), with a link to the 세션 보드 › 브랜치 tab. Loads and refreshes its own data.
 */
export function BranchesWidget({ folder = '', limit = 5, className }: { folder?: string; limit?: number; className?: string }) {
  const data = useLiveBranches();
  const now = useNow();
  const all = useMemo(() => (data && data !== 'failed' ? shownRows(data.rows, folder ? (s) => s.folder === folder : null) : []), [data, folder]);
  const rows = all.slice(0, limit);
  const title = useId();
  return (
    <section data-branches-widget aria-labelledby={title} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 id={title} className="m-0 text-sm font-medium">브랜치</h2>
        <a
          href={boardHash({ tab: 'branches', folder: folder || undefined })}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          전체 보기 <ArrowRight aria-hidden className="size-3" />
        </a>
      </header>
      {data === null ? (
        <p role="status" className="m-0 text-xs text-muted-foreground">불러오는 중이에요.</p>
      ) : data === 'failed' ? (
        <p role="alert" className="m-0 text-xs text-destructive">브랜치를 불러오지 못했어요.</p>
      ) : !rows.length ? (
        <p className="m-0 text-xs text-muted-foreground">세션 브랜치가 없어요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((r) => (
            <li key={r.branch} data-branch-row data-merged={r.merged || undefined} className={cn('flex min-w-0 items-center gap-2 border-b py-1.5 text-sm last:border-b-0', r.merged && 'opacity-50')}>
              <Owners sessions={r.sessions} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]" title={r.branch}>{r.branch}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.lastAt ? ago(r.lastAt, now) : '—'} · {r.subject}
                </span>
              </span>
              {r.dirty && <span className="shrink-0 text-xs text-warn" title="커밋하지 않은 변경이 있어요">●<span className="sr-only">커밋하지 않은 변경 있음</span></span>}
              <span className="shrink-0 text-xs"><AheadBehind row={r} base={data.base} /></span>
              <span className="shrink-0 text-xs"><PrChip pr={r.pr} /></span>
            </li>
          ))}
        </ul>
      )}
      {data && data !== 'failed' && all.length > limit && <p className="m-0 text-xs text-muted-foreground tabular-nums">외 {all.length - limit}개</p>}
    </section>
  );
}
