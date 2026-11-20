// Bottom card of the dashboard's right column (#819): one card, two tabs in its header (the Radix tabs of ui/tabs.tsx,
// sized down for a card header). PR과 머지: the open issues' PRs. 사용량: tokens and cost per provider and model over
// the last 7 days from the run records (GET /api/usage, account-wide, numbers only). It fills the column to the bottom
// and its list scrolls inside.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { fmtK, fmtUsd } from '../dispatch/lib/format.ts';
import { providerMeta } from '../modelConnect';
import { ProviderIcon } from '../ProviderIcon';
import { cn } from '../lib/utils';
import { Card, EmptyState } from './dash';
import { pollWhileVisible } from './model';
import { usageByProvider, type ProviderUse } from './usageRows';
import { BoardTabLink, PrsList, prCount } from './WorkCards';
import type { IssuesAnswer } from './issueBoard';
import type { Feed, PrAnswer } from './projectFeeds';
import type { UsageDay } from '../../../shared/dispatch/types.ts';

type Tab = 'prs' | 'usage';
const USAGE_POLL_MS = 60_000;

const LIST = 'h-6 bg-muted p-0.5';
const TRIGGER = 'h-5 px-2 text-xs';

type Props = {
  issues: Feed<IssuesAnswer>;
  prs: Feed<ReadonlyMap<string, PrAnswer>>;
  onBoard: (folder: string, tab?: 'usage') => void;
  /** Share of the filled column (<Card fill>). */
  fill?: number;
};

export function WorkTabsCard({ issues, prs, onBoard, fill = 1 }: Props) {
  const [tab, setTab] = useState<Tab>('prs');
  const count = prCount(issues, prs);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as Tab)}
      data-card-tabs
      className="min-w-0 gap-0 @min-[880px]:min-h-30 @min-[880px]:[flex:var(--card-fill)_1_0%]"
      style={{ '--card-fill': fill } as React.CSSProperties}
    >
      <Card
        id="work-tabs"
        title={tab === 'prs' ? 'PR과 머지' : '사용량'}
        flush
        fill={1}
        lead={
          <TabsList aria-label="PR과 머지, 사용량" className={LIST}>
            <TabsTrigger value="prs" className={TRIGGER}>
              PR과 머지
              {count > 0 && <span className="font-normal text-muted-foreground tabular-nums">{count}</span>}
            </TabsTrigger>
            <TabsTrigger value="usage" className={TRIGGER}>사용량</TabsTrigger>
          </TabsList>
        }
        actions={tab === 'usage' ? <BoardTabLink tab="usage" label="자세히" onBoard={onBoard} /> : undefined}
      >
        <TabsContent value="prs" className="flex-none">
          <PrsList issues={issues} prs={prs} />
        </TabsContent>
        <TabsContent value="usage" className="flex-none">
          <UsageList />
        </TabsContent>
      </Card>
    </Tabs>
  );
}

type Known = { id: string; label?: string; provider?: string };

/** Daily usage (polled while the page is visible) and the model list for names and providers. */
function useRunUsage(): UsageDay[] | 'failed' | null {
  const [days, setDays] = useState<UsageDay[] | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api.usage().then((d) => live && setDays(d), () => live && setDays((s) => (Array.isArray(s) ? s : 'failed')));
    load();
    const stop = pollWhileVisible(load, USAGE_POLL_MS);
    return () => {
      live = false;
      stop();
    };
  }, []);
  return days;
}

function useKnownModels(): Known[] {
  const [models, setModels] = useState<Known[]>([]);
  useEffect(() => {
    let live = true;
    api.dispatchState().then((s) => live && setModels(Array.isArray(s.models) ? s.models : []), () => {});
    return () => {
      live = false;
    };
  }, []);
  return models;
}

const GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-x-3 px-4';
const NO_COST = '이 모델은 비용을 알려 주지 않아요';

/** 사용량 tab: one group per provider (its total on the group row), its models under it. */
function UsageList() {
  const days = useRunUsage();
  const known = useKnownModels();
  const groups = useMemo(() => (Array.isArray(days) ? usageByProvider(days, known) : []), [days, known]);
  if (days === null) return <EmptyState>불러오는 중이에요</EmptyState>;
  if (days === 'failed') return <EmptyState>사용량을 불러오지 못했어요.</EmptyState>;
  if (!groups.length) return <EmptyState>최근 7일 동안 기록된 사용량이 없어요.</EmptyState>;
  return (
    <div data-usage-list className="text-xs">
      <p className={cn(GRID, 'm-0 h-8 border-t text-muted-foreground')}>
        <span>최근 7일 · 계정 전체</span>
        <span className="text-right">토큰</span>
        <span className="text-right">비용</span>
      </p>
      <ul aria-label="제공사별 사용량" className="m-0 list-none p-0 *:border-t">
        {groups.map((g) => (
          <ProviderGroup key={g.provider} group={g} />
        ))}
      </ul>
    </div>
  );
}

const cost = (n: number, tokens: number) => (n > 0 || !tokens ? fmtUsd(n) : '—');

function ProviderGroup({ group: g }: { group: ProviderUse }) {
  const name = providerMeta(g.provider)?.name ?? '기타';
  return (
    <li data-usage-provider={g.provider}>
      <div className={cn(GRID, 'h-9 font-medium')}>
        <span className="flex min-w-0 items-center gap-2">
          <ProviderIcon provider={g.provider} className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
        </span>
        <span className="text-right tabular-nums">{fmtK(g.tokens)}</span>
        <span className="text-right tabular-nums" title={g.cost > 0 ? undefined : NO_COST}>{cost(g.cost, g.tokens)}</span>
      </div>
      <ul aria-label={`${name} 모델별`} className="m-0 list-none p-0 pb-1.5">
        {g.models.map((m) => (
          <li key={m.id} data-usage-model={m.id} className={cn(GRID, 'h-7 text-muted-foreground')}>
            <span className="truncate pl-5.5" title={m.label}>{m.label}</span>
            <span className="text-right tabular-nums" title={`입력 ${fmtK(m.input)}, 출력 ${fmtK(m.output)}`}>{fmtK(m.tokens)}</span>
            <span className="text-right tabular-nums" title={m.cost > 0 ? undefined : NO_COST}>{cost(m.cost, m.tokens)}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
