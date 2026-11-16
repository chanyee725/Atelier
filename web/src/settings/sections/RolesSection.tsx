// 설정 > 역할별 모델 (#624): each role's default model, picked from the connected providers' models (grouped by
// provider, with the provider's mark, #621) and saved with one 저장 button (POST /api/settings team.roleModels; only
// changed roles are sent, never another section's edits). Roles, models and saved overrides come from the session
// stream store the 설정 modal holds open; values saved elsewhere follow into roles the user has not changed. A role on
// a model that is no longer listed or whose provider is not connected says so. With Dispatch off it shows read-only
// with the reason (#620).
import { useId, useMemo, useState, type FormEvent } from 'react';
import { api, useDispatch } from '../../dispatch/store';
import { cn } from '../../lib/utils';
import { ProviderIcon } from '../../ProviderIcon';
import { useModels } from '../../SidebarModels';
import { useDirtyMark, useSettingsLoad } from '../context';
import { LoadNote, OffNote } from '../DispatchOff';
import { PRIMARY_BTN } from '../LimitsForm';
import { SectionFrame } from '../SectionFrame';
import { modelGroups, resyncRoleModels, roleChoice, roleModelsPatch, sameModels, savedRoleModels } from './modelsSection';

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export default function RolesSection() {
  const { load, retry } = useSettingsLoad();
  const offId = useId();
  const { providers } = useModels();
  const roles = useDispatch((s) => s.roles);
  const list = useDispatch((s) => s.models);
  const team = useDispatch((s) => s.settings.team);
  const fromServer = useMemo(() => savedRoleModels(team as unknown as Record<string, unknown>, roles), [team, roles]);
  // What was last loaded or saved; only changes against it are sent.
  const [saved, setSaved] = useState<Record<string, string>>(fromServer);
  const [shown, setShown] = useState<Record<string, string>>(fromServer);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  // Saved values changed elsewhere (another tab, the server's settings or snapshot event): follow them where the user
  // has not picked another model. Adjusted during render, as React suggests for state derived from changing props.
  const [seen, setSeen] = useState(fromServer);
  if (!sameModels(seen, fromServer)) {
    setSeen(fromServer);
    setShown((s) => resyncRoleModels(saved, fromServer, s));
    setSaved(fromServer);
  }
  const groups = useMemo(() => modelGroups(list, providers), [list, providers]);
  const off = load.kind === 'off';
  const ready = load.kind === 'ok';
  // In every load state: a dropped or reconnecting stream keeps the picks on screen (#644).
  useDirtyMark('roles', roleModelsPatch(saved, shown) !== null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const patch = roleModelsPatch(saved, shown);
    if (!patch) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    try {
      await api('POST', '/api/settings', { team: { roleModels: patch } });
      const now = { ...saved, ...patch };
      setSaved(now);
      setShown((s) => resyncRoleModels(saved, now, s));
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionFrame title="역할별 모델" hint="역할마다 새 세션이 쓸 기본 모델이에요. 연결한 모델이면 어느 것이든 고를 수 있고, 새로 여는 세션부터 적용돼요." testId="settings-section-roles">
      <LoadNote load={load} onRetry={retry} />
      {off && <OffNote id={offId} status={load.status} />}
      <form noValidate onSubmit={(e) => void submit(e)} aria-label="역할별 모델" data-testid="settings-role-models" className="flex flex-col gap-3">
        <fieldset disabled={!ready} aria-describedby={off ? offId : undefined} className="flex flex-col gap-3 disabled:opacity-60">
          <legend className="sr-only">역할별 기본 모델</legend>
          {ready && roles.length === 0 && <p className="text-xs text-muted-foreground">역할이 없어요.</p>}
          {off && <p className="text-xs text-muted-foreground">실행 기능이 켜지면 역할이 보여요.</p>}
          {roles.map((r) => {
            const value = shown[r.id] ?? r.model;
            const choice = roleChoice(value, list, providers);
            const selectId = `settings-role-model-${r.id}`;
            const warnId = `${selectId}-warn`;
            return (
              <div key={r.id} data-role={r.id} className="flex flex-col gap-1">
                <label htmlFor={selectId} className="text-sm">
                  {r.name}
                </label>
                <div className="flex items-center gap-2">
                  <span aria-hidden className="grid size-4 shrink-0 place-items-center text-muted-foreground">
                    <ProviderIcon provider={choice.provider} className="size-4" />
                  </span>
                  <select
                    id={selectId}
                    name={`roleModels.${r.id}`}
                    value={value}
                    aria-invalid={choice.warn && ready ? true : undefined}
                    aria-describedby={choice.warn && ready ? warnId : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setShown((s) => ({ ...s, [r.id]: v }));
                      setNote({ text: '' });
                    }}
                    className={cn('h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-sm aria-invalid:border-warn max-md:h-11', FOCUS)}
                  >
                    {!list.some((m) => m.id === value) && <option value={value}>{value}</option>}
                    {/* An unconnected provider's models stay visible but cannot be picked, with the reason in the group label (#676). */}
                    {groups.map((g) => (
                      <optgroup key={g.provider} label={g.off ? `${g.name} · ${g.off}` : g.name} disabled={!!g.off}>
                        {g.models.length === 0 && <option disabled value="">{g.off ? '연결하면 모델이 보여요' : '모델이 없어요'}</option>}
                        {g.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {choice.warn && ready && (
                  <span id={warnId} data-testid="settings-role-model-warn" className="text-xs text-muted-foreground">
                    {choice.warn}
                  </span>
                )}
              </div>
            );
          })}
        </fieldset>
        {ready && roles.length > 0 && (
          <div className="flex items-center justify-end gap-3">
            <p role="status" className={cn('mr-auto min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
              {note.text}
            </p>
            <button type="submit" disabled={saving} className={PRIMARY_BTN}>
              저장
            </button>
          </div>
        )}
      </form>
    </SectionFrame>
  );
}
