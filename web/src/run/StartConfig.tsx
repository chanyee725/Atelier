// The team the 시작하기 confirm proposes (#972): one row per step, prefilled by startConfig.ts, each row's model,
// effort, permission and head count changeable. The footer says how many sessions start and how full the 5-hour limit is.
// It reports the choices as `overrides` for POST /api/pipeline/start; the plan file is not touched.
import { useEffect, useMemo, useState } from 'react';
import { NativeSelect } from '../components/ui/native-select';
import { providerGroups } from '../dispatch/lib/create.ts';
import { permLabel, providerName } from '../dispatch/lib/format.ts';
import { ProviderIcon } from '../ProviderIcon';
import type { Plan } from '../../../shared/dispatch/plan.ts';
import type { StepOverrides } from '../../../shared/dispatch/plan-overrides.ts';
import { MAX_PLAN_N } from '../../../shared/dispatch/plan.ts';
import type { PipelineStatus } from './planStripModel.ts';
import { readCatalog } from './StepModels';
import type { ModelCatalog } from './stepModels.ts';
import { claudeSessions, fitEffort, fitRowPerm, permChoices, sessionCount, startRows, toOverrides, type StartRow } from './startConfig.ts';

export type StartChoice = { overrides: StepOverrides; sessions: number };

const COUNTS = Array.from({ length: MAX_PLAN_N }, (_, i) => i + 1);

export function StartConfig({ plan, labels, limits, onChange }: { plan: Plan; labels: ReadonlyMap<string, string>; limits: PipelineStatus['limits']; onChange: (c: StartChoice | null) => void }) {
  const [cat, setCat] = useState<ModelCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [rows, setRows] = useState<StartRow[]>([]);

  useEffect(() => {
    let live = true;
    readCatalog().then(
      (c) => {
        if (!live) return;
        setCat(c);
        setFailed(!c);
        if (c) setRows(startRows(plan, c, labels));
      },
      () => live && setFailed(true),
    );
    return () => { live = false; };
    // The rows belong to the plan revision the dialog shows; a new revision (plan changed) re-reads them.
  }, [plan, labels]);

  const choice = useMemo(() => (cat ? { overrides: toOverrides(plan, rows, cat), sessions: sessionCount(rows) } : null), [cat, plan, rows]);
  useEffect(() => onChange(choice), [choice, onChange]);

  if (failed) return <p className="text-muted-foreground">추천 구성을 불러오지 못했어요. 계획에 적힌 대로 시작해요.</p>;
  if (!cat) return <p className="text-muted-foreground">추천 구성을 만드는 중…</p>;

  const set = (id: string, patch: (r: StartRow) => Partial<StartRow>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...patch(r) } : r)));
  const five = typeof limits?.five === 'number' ? Math.round(limits.five) : null;
  const claude = claudeSessions(rows, cat);

  return (
    <div className="flex flex-col gap-2" data-testid="start-config">
      <ul className="flex flex-col gap-1.5" aria-label="단계별 구성">
        {rows.map((r) => {
          const model = cat.models.find((m) => m.id === r.model);
          return (
            <li key={r.id} className="start-row" data-testid="start-row" data-step={r.id}>
              <span className="start-row-name">
                <span className="truncate font-medium">{r.title}</span>
                <span className="text-muted-foreground">
                  {r.roleName}{r.risky && r.role === 'review' ? ' · 위험한 단계' : ''} · 약 {r.minutes}분
                </span>
              </span>
              <NativeSelect
                aria-label={`${r.title} 모델`}
                className="w-full"
                value={r.model}
                start={<ProviderIcon provider={model?.provider} className="size-3.5" />}
                onChange={(e) => set(r.id, (x) => ({ model: e.target.value, effort: fitEffort(x.effort, e.target.value, cat), perm: fitRowPerm(x.perm, e.target.value, cat) }))}
              >
                {!model && <option value={r.model}>{r.model || '모델 없음'}</option>}
                {providerGroups(cat.models).map((p) => {
                  const on = !!cat.providers[p]?.connected;
                  return (
                    <optgroup key={p} label={`${cat.providers[p]?.name ?? providerName(p)}${on ? '' : ' · 연결 필요'}`}>
                      {cat.models.filter((m) => m.provider === p).map((m) => (
                        <option key={m.id} value={m.id} disabled={!on}>{m.label}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </NativeSelect>
              <NativeSelect aria-label={`${r.title} 강도`} className="w-full" value={r.effort} onChange={(e) => set(r.id, () => ({ effort: e.target.value }))}>
                <option value="">기본 강도</option>
                {(model?.efforts ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
              </NativeSelect>
              <NativeSelect aria-label={`${r.title} 권한`} className="w-full" value={r.perm} onChange={(e) => set(r.id, () => ({ perm: e.target.value }))}>
                {permChoices(r.model, cat).map((p) => <option key={p} value={p}>{permLabel(p)}</option>)}
              </NativeSelect>
              <NativeSelect aria-label={`${r.title} 인원`} className="w-full" value={String(r.n)} onChange={(e) => set(r.id, () => ({ n: Number(e.target.value) }))}>
                {COUNTS.map((c) => <option key={c} value={c}>{c}명</option>)}
              </NativeSelect>
            </li>
          );
        })}
        {rows.length === 0 && <li className="text-muted-foreground">단계가 없어요.</li>}
      </ul>
      <div className="start-total" data-testid="start-total">
        <span>
          세션 <strong className="tabular-nums">{sessionCount(rows)}</strong>개
        </span>
        {five !== null && claude > 0 ? (
          <span className="start-meter">
            <span>Claude 5시간 한도 <span className="tabular-nums">{five}%</span> 사용 중</span>
            <span className="start-meter-bar" role="meter" aria-label="5시간 한도 사용률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, five)}>
              <span style={{ width: `${Math.min(100, five)}%` }} data-high={five >= 80 || undefined} />
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{claude > 0 ? '한도 사용률을 아직 몰라요' : 'Claude를 쓰지 않아요'}</span>
        )}
      </div>
    </div>
  );
}
