// 설정 page of /dispatch (#587, ported from standalone Dispatch's SettingsPage): team settings, each role's default
// model, per-provider usage and the usage-limit and session-length guards (the same form as the sidebar 설정 modal).
// Team values are saved through POST /api/settings `team`; the server checks every range again. Status and numbers
// only: no account, email or token is read here.
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Meter } from '../dispatch/parts';
import { pct, until } from '../dispatch/lib/format.ts';
import { api, useDispatch } from '../dispatch/store';
import { LimitsForm, BTN, PRIMARY_BTN } from './LimitsForm';
import { TEAM_NUMBERS, TEAM_TOGGLES, readTeamNumbers, teamPatch, teamValues, usageGroups, type TeamNumberId, type TeamToggleId, type TeamValues, type UsageEntry } from './model';

function Section({ title, hint, children, labelledBy }: { title: string; hint?: string; children: ReactNode; labelledBy?: string }) {
  const own = useId();
  const id = labelledBy ?? own;
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-col gap-1">
        <h2 id={id} className="text-[15px] font-semibold">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

type NumTexts = Record<TeamNumberId, string>;
const numTexts = (v: TeamValues): NumTexts => Object.fromEntries(TEAM_NUMBERS.map((f) => [f.id, String(v[f.id])])) as NumTexts;

/** Team numbers, switches and each role's default model, saved together with one 저장 button. */
function TeamForm() {
  const titleId = useId();
  const team = useDispatch((s) => s.settings.team);
  const roles = useDispatch((s) => s.roles);
  const models = useDispatch((s) => s.models);
  const providers = useDispatch((s) => s.providers);
  const fromStore = useMemo(() => teamValues(team as unknown as Record<string, unknown>, roles), [team, roles]);
  // What was last loaded or saved; only changes against it are sent.
  const [saved, setSaved] = useState<TeamValues>(fromStore);
  const [texts, setTexts] = useState<NumTexts>(() => numTexts(fromStore));
  const [toggles, setToggles] = useState<Record<TeamToggleId, boolean>>(() => Object.fromEntries(TEAM_TOGGLES.map((f) => [f.id, fromStore[f.id]])) as Record<TeamToggleId, boolean>);
  const [roleModels, setRoleModels] = useState<Record<string, string>>(fromStore.roleModels);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);

  const byProvider = useMemo(() => {
    const out = new Map<string, typeof models>();
    for (const m of models) out.set(m.provider, [...(out.get(m.provider) ?? []), m]);
    return [...out];
  }, [models]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nums = readTeamNumbers(texts);
    if ('error' in nums) return setNote({ text: nums.error, bad: true });
    const next: TeamValues = { ...nums, ...toggles, roleModels };
    const patch = teamPatch(saved, next);
    if (!patch) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    try {
      await api('POST', '/api/settings', { team: patch });
      setSaved(next);
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section title="팀" hint="새로 여는 세션부터 적용돼요." labelledBy={titleId}>
      <form onSubmit={(e) => void submit(e)} aria-labelledby={titleId} data-testid="team-form" className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">대화와 팀원</legend>
          {TEAM_NUMBERS.map((f) => (
            <div key={f.id} className="flex flex-col gap-1">
              <label htmlFor={`team-${f.id}`} className="text-xs text-muted-foreground">
                {f.label} ({f.unit}) · 기본값 {f.def}
              </label>
              <input
                id={`team-${f.id}`}
                name={f.id}
                type="number"
                inputMode="numeric"
                step={1}
                min={f.min}
                max={f.max}
                required
                aria-describedby={`team-${f.id}-hint`}
                value={texts[f.id]}
                onChange={(e) => {
                  setTexts((t) => ({ ...t, [f.id]: e.target.value }));
                  setNote({ text: '' });
                }}
                className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm tabular-nums max-md:h-11"
              />
              <span id={`team-${f.id}-hint`} className="text-xs text-muted-foreground">
                {f.hint} {f.min}~{f.max} 사이
              </span>
            </div>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">작업 폴더와 답변</legend>
          {TEAM_TOGGLES.map((f) => (
            <div key={f.id} className="flex items-start gap-2">
              <input
                id={`team-${f.id}`}
                name={f.id}
                type="checkbox"
                {...({ switch: '' } as object)}
                aria-describedby={`team-${f.id}-hint`}
                checked={toggles[f.id]}
                onChange={(e) => {
                  setToggles((t) => ({ ...t, [f.id]: e.target.checked }));
                  setNote({ text: '' });
                }}
                className="mt-0.5 size-4 shrink-0 accent-primary max-md:size-5"
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <label htmlFor={`team-${f.id}`} className="text-sm">
                  {f.label}
                </label>
                <span id={`team-${f.id}-hint`} className="text-xs text-muted-foreground">
                  {f.hint}
                </span>
              </div>
            </div>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">역할별 기본 모델</legend>
          {roles.length === 0 && <p className="text-xs text-muted-foreground">역할이 없어요.</p>}
          {roles.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label htmlFor={`role-model-${r.id}`} className="w-24 shrink-0 text-sm">
                {r.name}
              </label>
              <select
                id={`role-model-${r.id}`}
                name={`roleModels.${r.id}`}
                value={roleModels[r.id] ?? r.model}
                onChange={(e) => {
                  const v = e.target.value;
                  setRoleModels((m) => ({ ...m, [r.id]: v }));
                  setNote({ text: '' });
                }}
                className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 text-sm max-md:h-11"
              >
                {!models.some((m) => m.id === (roleModels[r.id] ?? r.model)) && <option value={roleModels[r.id] ?? r.model}>{roleModels[r.id] ?? r.model}</option>}
                {byProvider.map(([p, list]) => (
                  <optgroup key={p} label={providers[p]?.name || p}>
                    {list.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
        <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
          {note.text}
        </p>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className={PRIMARY_BTN}>
            저장
          </button>
        </div>
      </form>
    </Section>
  );
}

/** Each connected provider's usage windows (GET /api/limits), refreshed when the server pushes new limits. */
function UsageSection() {
  const providers = useDispatch((s) => s.providers);
  const pushed = useDispatch((s) => s.limits);
  const [limits, setLimits] = useState<Record<string, UsageEntry> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api<Record<string, UsageEntry>>('GET', '/api/limits').then(
      (l) => alive && (setLimits(l), setFailed(false)),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [pushed, providers, tick]);
  const groups = limits ? usageGroups(limits, providers) : [];
  return (
    <Section title="모델별 사용량" hint="연결한 모델마다 CLI가 알려 준 사용량이에요.">
      {failed && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          사용량을 불러오지 못했어요.
          <button type="button" onClick={() => setTick((t) => t + 1)} className={cn(BTN, 'border')}>
            다시 불러오기
          </button>
        </p>
      )}
      {!failed && !limits && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {limits && groups.length === 0 && <p className="text-sm text-muted-foreground">연결된 모델이 없어요.</p>}
      {groups.map((g) => (
        <div key={g.id} data-provider={g.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {g.name}
            {g.plan && <span className="ml-2 text-xs font-normal text-muted-foreground">{g.plan}</span>}
          </h3>
          {g.windows.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {g.windows.map((w) => (
                <li key={w.label} className="grid grid-cols-[88px_1fr_48px] items-center gap-3 text-sm">
                  <span>{w.label}</span>
                  <Meter value={w.used} label={`${g.name} ${w.label} ${pct(w.used)}`} />
                  <span className="text-right tabular-nums">{pct(w.used)}</span>
                  {w.reset ? <span className="col-start-2 col-end-4 -mt-2 text-xs text-muted-foreground">{until(w.reset)} 뒤 초기화</span> : null}
                </li>
              ))}
            </ul>
          ) : g.reached != null ? (
            <p className="text-sm text-muted-foreground">{g.reached ? `한도에 닿았어요.${g.reset ? ` ${until(g.reset)} 뒤 풀려요.` : ''}` : '한도에 닿지 않았어요.'}</p>
          ) : (
            <p className="text-sm text-muted-foreground">아직 사용량 정보가 없어요. 세션이 돌면 채워져요.</p>
          )}
        </div>
      ))}
    </Section>
  );
}

export function SettingsPage() {
  const limitsTitle = useId();
  return (
    <div data-testid="settings-page" className="mx-auto flex max-w-[720px] flex-col gap-4 p-6 max-md:p-4">
      <h1 className="text-lg font-semibold">설정</h1>
      <TeamForm />
      <UsageSection />
      <Section title="한도" labelledBy={limitsTitle}>
        <LimitsForm labelledBy={limitsTitle} />
      </Section>
    </div>
  );
}
