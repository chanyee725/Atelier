// 설정 row and modal (E509c): edit the usage-limit and session-length guards. A native modal <dialog> gives the inert
// page, focus containment, Esc and focus return to the 설정 row. Values are saved through POST /api/settings, as before E509;
// the server keeps them in range, and the guards cannot be switched off here (every field has a minimum above 0).
import { Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type DispatchSettings } from '../api';
import { SidebarMenuButton } from '../components/ui/sidebar';
import { cn } from '../lib/utils';
import { GUARD_FIELDS, guardPatch, guardValue, wholeIn, type GuardField } from './model';
import './limits.css';

const ALL = GUARD_FIELDS.flatMap((g) => g.fields);
type Texts = Record<GuardField['id'], string>;
const toTexts = (s: DispatchSettings): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(guardValue(f.id, s))])) as Texts;
const defaults = (): Texts => Object.fromEntries(ALL.map((f) => [f.id, String(f.def)])) as Texts;

export function SettingsEntry() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <SidebarMenuButton ref={trigger} data-testid="settings-trigger" aria-haspopup="dialog" title="한도 설정" onClick={() => setOpen(true)}>
        <Settings aria-hidden />
        <span className="truncate">설정</span>
      </SidebarMenuButton>
      {open && (
        <LimitsDialog
          onClose={() => {
            setOpen(false);
            // The browser returns focus to the opener on close; this covers the case where it landed on <body>.
            requestAnimationFrame(() => {
              if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
            });
          }}
        />
      )}
    </>
  );
}

type Load = { kind: 'loading' } | { kind: 'off'; message: string } | { kind: 'ok' };

function LimitsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [texts, setTexts] = useState<Texts>(defaults);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await api.dispatch();
        if (!d.enabled) return alive && setLoad({ kind: 'off', message: d.message ?? '이 서버에선 한도를 바꿀 수 없어요.' });
        const s = await api.dispatchState();
        if (!alive) return;
        if (!s.settings) return setLoad({ kind: 'off', message: '설정을 불러오지 못했어요.' });
        setTexts(toTexts(s.settings));
        setLoad({ kind: 'ok' });
      } catch {
        if (alive) setLoad({ kind: 'off', message: '설정을 불러오지 못했어요.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const set = (id: GuardField['id'], v: string) => {
    setTexts((t) => ({ ...t, [id]: v }));
    setNote({ text: '' });
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values: Partial<Record<GuardField['id'], number>> = {};
    for (const f of ALL) {
      const v = wholeIn(texts[f.id], f.min, f.max);
      if (v === null) return setNote({ text: `${f.label}: ${f.min}~${f.max} 사이 숫자를 넣어 주세요`, bad: true });
      values[f.id] = v;
    }
    setSaving(true);
    try {
      const next = await api.saveDispatchSettings(guardPatch(values));
      setTexts(toTexts(next));
      setNote({ text: '저장했어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  // Hover only on enabled buttons, ~120ms, none under prefers-reduced-motion.
  const btn = 'h-8 rounded-md px-3 text-sm transition-colors duration-[120ms] motion-reduce:transition-none enabled:hover:bg-accent enabled:hover:text-foreground max-md:h-11';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="settings-dialog"
      onClose={onClose}
      className="limits-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-1rem))] max-w-none overflow-y-auto rounded-lg border bg-background p-0 text-foreground shadow-md"
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-2">
          <h2 id={titleId} className="text-sm font-semibold">
            설정
          </h2>
          <button type="button" onClick={() => ref.current?.close()} className={cn(btn, 'ml-auto text-muted-foreground')}>
            닫기
          </button>
        </header>
        {load.kind === 'loading' && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
        {load.kind === 'off' && <p className="text-sm text-muted-foreground">{load.message}</p>}
        {load.kind === 'ok' &&
          GUARD_FIELDS.map((g) => (
            <fieldset key={g.title} className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{g.title}</legend>
              <p className="text-xs text-muted-foreground">{g.hint}</p>
              <ul className="flex flex-col gap-2">
                {g.fields.map((f, i) => (
                  <li key={f.id} className="flex flex-wrap items-end gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label htmlFor={`limit-${f.id}`} className="text-xs text-muted-foreground">
                        {f.label} ({f.unit}) · 기본값 {f.def}
                      </label>
                      <input
                        id={`limit-${f.id}`}
                        name={f.id}
                        type="number"
                        inputMode="numeric"
                        step={1}
                        min={f.min}
                        max={f.max}
                        required
                        autoFocus={g === GUARD_FIELDS[0] && i === 0}
                        value={texts[f.id]}
                        onChange={(e) => set(f.id, e.target.value)}
                        className="h-8 w-28 rounded-md border bg-transparent px-2 text-sm tabular-nums max-md:h-11"
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`${f.label} 기본값으로`}
                      disabled={texts[f.id] === String(f.def)}
                      onClick={() => set(f.id, String(f.def))}
                      className={cn(btn, 'text-muted-foreground disabled:opacity-50')}
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
            <button type="button" onClick={() => setTexts(defaults())} className={cn(btn, 'border')}>
              모두 기본값으로
            </button>
            <button type="submit" disabled={saving} className={cn(btn, 'bg-primary text-primary-foreground enabled:hover:bg-primary/90 enabled:hover:text-primary-foreground disabled:opacity-50')}>
              저장
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
