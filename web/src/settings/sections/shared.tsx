// Shared parts of the team-backed sections of the 설정 modal (#624): 관리자와 팀, 작업 폴더, 멈춤 감지 and the load
// state 사용 한도 also uses. Each section edits and saves only its own team fields (SECTION_FIELDS), sending only the
// changed ones through POST /api/settings `team`; the server checks every range again. Saved values that change
// elsewhere follow in fields not edited (#615). With Dispatch off the fields show read-only with the reason (#620).
// Numbers and switches only: no account, email or token is read here.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { connect, setState, useDispatch, api } from '../../dispatch/store';
import { cn } from '../../lib/utils';
import { OffNote, useDispatchStatus } from '../DispatchOff';
import { BTN, PRIMARY_BTN } from '../LimitsForm';
import { resyncTeamForm, savedAfterSave, settingsLoad, teamForm, teamNumberErrors, teamValues, type SettingsLoad, type TeamFormState, type TeamNumberId, type TeamToggleId, type TeamValues } from '../model';
import { resetSection, sectionFields, sectionSave, type TeamSectionId } from './sectionForm';

/**
 * Whether the session settings are in, off or failed. Holds the session stream open while the section shows (the
 * stream is shared, so this costs nothing when the modal already holds it); `retry` opens it again after a failure.
 */
export function useSectionLoad(): { load: SettingsLoad; retry: () => void } {
  const status = useDispatchStatus();
  const ready = useDispatch((s) => s.ready);
  const unavailable = useDispatch((s) => s.unavailable);
  const [attempt, setAttempt] = useState(0);
  const enabled = status?.enabled === true;
  useEffect(() => (enabled ? connect() : undefined), [enabled, attempt]);
  return {
    load: settingsLoad(status, ready, unavailable),
    retry: () => {
      setState({ unavailable: false });
      setAttempt((a) => a + 1);
    },
  };
}

/** Loading or failed (with a retry). Off has its own line (OffNote). */
export function SectionLoadNote({ load, onRetry }: { load: SettingsLoad; onRetry: () => void }) {
  if (load.kind === 'loading') return <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>;
  if (load.kind !== 'failed') return null;
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      설정을 불러오지 못했어요.
      <button type="button" onClick={onRetry} className={cn(BTN, 'border')}>
        다시 불러오기
      </button>
    </p>
  );
}

/** A section's frame: heading, hint and body, named by its heading. */
export function SectionFrame({ title, hint, testId, children }: { title: string; hint?: string; testId: string; children: (titleId: string) => ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} data-testid={testId} className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id={titleId} className="text-[15px] font-semibold">
          {title}
        </h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children(titleId)}
    </section>
  );
}

/**
 * One team-backed section as a form: its number fields and switches with their own 저장. Only this section's fields
 * are validated and sent, so another section's unsaved edits never go with it.
 */
export function TeamFieldsForm({ section, title, hint, testId }: { section: TeamSectionId; title: string; hint?: string; testId: string }) {
  const { load, retry } = useSectionLoad();
  const team = useDispatch((s) => s.settings.team);
  const roles = useDispatch((s) => s.roles);
  const fromStore = useMemo(() => teamValues(team as unknown as Record<string, unknown>, roles), [team, roles]);
  const [saved, setSaved] = useState<TeamValues>(fromStore);
  const [form, setForm] = useState<TeamFormState>(() => teamForm(fromStore));
  const [errors, setErrors] = useState<Partial<Record<TeamNumberId, string>>>({});
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const offId = useId();
  // Saved values changed elsewhere: follow them in fields not edited, keep the edits (#615). Adjusted during render.
  const [seen, setSeen] = useState(fromStore);
  if (seen !== fromStore) {
    setSeen(fromStore);
    setForm((f) => resyncTeamForm(saved, fromStore, f));
    setSaved(fromStore);
  }

  const off = load.kind === 'off';
  const shown = load.kind === 'ok' || off;
  const { numbers, toggles } = sectionFields(section);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (load.kind !== 'ok') return;
    const r = sectionSave(saved, form, section);
    setErrors(r.kind === 'invalid' ? r.errors : {});
    if (r.kind === 'invalid') {
      // Focus the first bad field so its message is read out with it.
      formRef.current?.querySelector<HTMLInputElement>(`[name="${r.first}"]`)?.focus();
      return setNote({ text: r.message, bad: true });
    }
    if (r.kind === 'unchanged') return setNote({ text: '바뀐 게 없어요.' });
    const { patch, next } = r;
    setSaving(true);
    try {
      const res = await api<{ team?: Record<string, unknown> }>('POST', '/api/settings', { team: patch });
      const now = savedAfterSave(res?.team, next);
      setSaved(now);
      setForm((f) => resyncTeamForm(next, now, f));
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  const setNumber = (id: TeamNumberId, v: string) => {
    setForm((s) => ({ ...s, texts: { ...s.texts, [id]: v } }));
    // Clear the field's message as soon as it is fixed; new ones only show on 저장.
    if (errors[id] && !teamNumberErrors({ [id]: v })[id]) setErrors((x) => ({ ...x, [id]: undefined }));
    setNote({ text: '' });
  };
  const setToggle = (id: TeamToggleId, v: boolean) => {
    setForm((s) => ({ ...s, toggles: { ...s.toggles, [id]: v } }));
    setNote({ text: '' });
  };
  const resetAll = () => {
    setForm((s) => resetSection(s, section));
    setErrors({});
    setNote({ text: '' });
  };

  return (
    <SectionFrame title={title} hint={hint} testId={testId}>
      {(titleId) => (
        <>
          <SectionLoadNote load={load} onRetry={retry} />
          {off && <OffNote id={offId} status={load.status} />}
          {shown && (
            <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} aria-labelledby={titleId} className="flex flex-col gap-4">
              <fieldset disabled={off} aria-describedby={off ? offId : undefined} className="flex min-w-0 flex-col gap-3 disabled:opacity-60">
                {numbers.map((f) => {
                  const id = `${section}-${f.id}`;
                  const err = errors[f.id];
                  return (
                    <div key={f.id} className="flex flex-col gap-1">
                      <label htmlFor={id} className="text-xs text-muted-foreground">
                        {f.label} ({f.unit}) · 기본값 {f.def}
                      </label>
                      <input
                        id={id}
                        name={f.id}
                        type="number"
                        inputMode={f.decimal ? 'decimal' : 'numeric'}
                        step={f.decimal ? 0.1 : 1}
                        min={f.decimal ? 0 : f.min}
                        max={f.max}
                        required
                        // Set only after 저장 (the form is noValidate), so nothing is announced before the user acts.
                        aria-invalid={err ? true : false}
                        aria-describedby={err ? `${id}-hint ${id}-error` : `${id}-hint`}
                        value={form.texts[f.id]}
                        onChange={(e) => setNumber(f.id, e.target.value)}
                        className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm tabular-nums aria-invalid:border-destructive max-md:h-11"
                      />
                      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
                        {f.hint} {f.decimal ? `0 또는 ${f.min}~${f.max}` : `${f.min}~${f.max}`} 사이
                      </span>
                      {err && (
                        <span id={`${id}-error`} className="text-xs text-destructive">
                          {err}
                        </span>
                      )}
                    </div>
                  );
                })}
                {toggles.map((f) => {
                  const id = `${section}-${f.id}`;
                  return (
                    <div key={f.id} className="flex items-start gap-2">
                      <input
                        id={id}
                        name={f.id}
                        type="checkbox"
                        {...({ switch: '' } as object)}
                        aria-describedby={`${id}-hint`}
                        checked={form.toggles[f.id]}
                        onChange={(e) => setToggle(f.id, e.target.checked)}
                        className="mt-0.5 size-4 shrink-0 accent-primary max-md:size-5"
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <label htmlFor={id} className="text-sm">
                          {f.label}
                        </label>
                        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
                          {f.hint} 기본값 {f.def ? '켜짐' : '꺼짐'}.
                        </span>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
              {!off && (
                <>
                  <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
                    {note.text}
                  </p>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={resetAll} className={cn(BTN, 'border')}>
                      기본값으로
                    </button>
                    <button type="submit" disabled={saving} className={PRIMARY_BTN}>
                      저장
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </>
      )}
    </SectionFrame>
  );
}
