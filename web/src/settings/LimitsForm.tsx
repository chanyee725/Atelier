// Usage-limit and session-length guard form (E509c), shared by the 설정 modal and the 설정 page (#587). Values are
// saved through POST /api/settings; the server keeps them in range, and the guards cannot be switched off here
// (every field has a minimum above 0). Only changed fields are sent (#552). With Dispatch off the fields still show,
// read-only with their defaults and one line saying why (#620).
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { api, type DispatchSettings, type DispatchStatus } from '../api';
import { cn } from '../lib/utils';
import { GUARD_FIELDS, changedValues, fableFollows, guardPatch, guardValue, readGuardTexts, type GuardField, type GuardSaved, type GuardValues } from './model';
import { OffNote } from './DispatchOff';
import './limits.css';

const ALL = GUARD_FIELDS.flatMap((g) => g.fields);
type Texts = Record<GuardField['id'], string>;
const toTexts = (s: DispatchSettings): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(guardValue(f.id, s))])) as Texts;
const defaults = (): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(f.def)])) as Texts;
const toSaved = (s: DispatchSettings): GuardSaved => ({
  values: Object.fromEntries(ALL.map((f) => [f.id, guardValue(f.id, s)])) as GuardValues,
  fableFollows: fableFollows(s),
});

/** Hover only on enabled buttons, ~120ms, none under prefers-reduced-motion. */
export const BTN = 'h-8 rounded-md px-3 text-sm transition-colors duration-[120ms] motion-reduce:transition-none enabled:hover:bg-accent enabled:hover:text-foreground max-md:h-11';
export const PRIMARY_BTN = cn(BTN, 'bg-primary text-primary-foreground enabled:hover:bg-primary/90 enabled:hover:text-primary-foreground disabled:opacity-50');

type Load = { kind: 'loading' } | { kind: 'off'; status: DispatchStatus } | { kind: 'failed'; message: string } | { kind: 'ok' };

/**
 * The guard form. `header` goes first inside the form (the modal's title and close button, the page's heading);
 * `labelledBy` names the form. `autoFocus` puts focus on the first field once loaded (the modal).
 */
export function LimitsForm({ header, labelledBy, autoFocus = false, className }: { header?: ReactNode; labelledBy?: string; autoFocus?: boolean; className?: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [texts, setTexts] = useState<Texts>(defaults);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  // What was last loaded or saved, and whether Fable follows the weekly value; only changes are sent (#552).
  const [saved, setSaved] = useState<GuardSaved | null>(null);
  const [follows, setFollows] = useState(true);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.dispatch();
        if (!d.enabled) return alive && setLoad({ kind: 'off', status: d });
        const s = await api.dispatchState();
        if (!alive) return;
        if (!s.settings) return setLoad({ kind: 'failed', message: '설정을 불러오지 못했어요.' });
        setTexts(toTexts(s.settings));
        setSaved(toSaved(s.settings));
        setFollows(fableFollows(s.settings));
        setLoad({ kind: 'ok' });
      } catch {
        if (alive) setLoad({ kind: 'failed', message: '설정을 불러오지 못했어요.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // While Fable follows the weekly value its field mirrors 주간 한도; typing in it gives Fable its own value, and
  // clearing it makes it follow again (#563).
  const set = (id: GuardField['id'], v: string) => {
    setTexts((t) => ({ ...t, [id]: v, ...(id === 'seven' && follows && t.fable.trim() ? { fable: v } : {}) }));
    if (id === 'fable') setFollows(!v.trim());
    setNote({ text: '' });
  };
  const followWeekly = (t: Texts): Texts => ({ ...t, fable: t.seven });
  const resetAll = () => {
    setTexts(followWeekly(defaults()));
    setFollows(true);
    setNote({ text: '' });
  };
  const resetOne = (f: GuardField) => {
    if (f.id !== 'fable') return set(f.id, String(f.def));
    setTexts(followWeekly);
    setFollows(true);
    setNote({ text: '' });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!saved) return;
    const read = readGuardTexts(texts, follows);
    if ('error' in read) return setNote({ text: read.error, bad: true });
    setSaving(true);
    try {
      const next = await api.saveDispatchSettings(guardPatch(changedValues(saved, read.values, read.follows)));
      setTexts(toTexts(next));
      setSaved(toSaved(next));
      setFollows(fableFollows(next));
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  const offId = useId();
  const off = load.kind === 'off';
  return (
    <form onSubmit={(e) => void submit(e)} aria-labelledby={labelledBy} data-testid="limits-form" className={cn('limits-form flex flex-col gap-4', className)}>
      {header}
      {load.kind === 'loading' && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {load.kind === 'failed' && <p className="text-sm text-muted-foreground">{load.message}</p>}
      {off && <OffNote id={offId} status={load.status} />}
      {(load.kind === 'ok' || off) &&
        GUARD_FIELDS.map((g) => (
          <fieldset key={g.title} disabled={off} aria-describedby={off ? offId : undefined} className="flex flex-col gap-2 disabled:opacity-60">
            <legend className="text-sm font-medium">{g.title}</legend>
            <p className="text-xs text-muted-foreground">{g.hint}</p>
            <ul className="flex flex-col gap-2">
              {g.fields.map((f, i) => (
                <li key={f.id} className="flex flex-wrap items-end gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label htmlFor={`limit-${f.id}`} className="text-xs text-muted-foreground">
                      {f.label} ({f.unit}) · {f.id === 'fable' ? (follows ? '주간 한도를 따라요' : '기본값 주간 한도와 같음') : `기본값 ${f.def}`}
                    </label>
                    <input
                      id={`limit-${f.id}`}
                      name={f.id}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={f.min}
                      max={f.max}
                      required={f.id !== 'fable'}
                      autoFocus={autoFocus && !off && g === GUARD_FIELDS[0] && i === 0}
                      value={texts[f.id]}
                      onChange={(e) => set(f.id, e.target.value)}
                      className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm tabular-nums max-md:h-11"
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`${f.label} 기본값으로`}
                    disabled={f.id === 'fable' ? follows : texts[f.id] === String(f.def)}
                    onClick={() => resetOne(f)}
                    className={cn(BTN, 'text-muted-foreground disabled:opacity-50')}
                  >
                    기본값으로
                  </button>
                  <span className="basis-full text-xs text-muted-foreground">
                    {f.min}~{f.max} 사이
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      <p role="status" className={cn('min-h-4 text-xs', note.bad ? 'text-destructive' : 'text-muted-foreground')}>
        {note.text}
      </p>
      {load.kind === 'ok' && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetAll} className={cn(BTN, 'border')}>
            모두 기본값으로
          </button>
          <button type="submit" disabled={saving} className={PRIMARY_BTN}>
            저장
          </button>
        </div>
      )}
    </form>
  );
}
