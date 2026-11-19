// 설정 > 모델 연결: the account label of one provider row (#747). A short name the user picks ("Max", "팀 계정") that
// the session board and the project dashboard show as "Claude · Max". Saved to the user's defaults through
// /api/user-defaults; empty clears it. Validated on submit and on blur, cleared while typing (forms guide).
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { ACCOUNT_LABEL_MAX, accountText, checkAccountLabel, setAccountLabelsCache, useAccountLabels } from '../../accountLabels';
import { cn } from '../../lib/utils';
import type { ProviderMeta } from '../../modelConnect';
import { useDirtyMark } from '../context';

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function AccountLabelField({ meta }: { meta: ProviderMeta }) {
  const saved = useAccountLabels()[meta.id] ?? '';
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const uid = useId();
  const ids = { input: `${uid}-in`, hint: `${uid}-hint`, err: `${uid}-err` };

  // The saved label arrives after the first render (and changes when another row saves): follow it while untouched.
  const [base, setBase] = useState(saved);
  useEffect(() => {
    if (saved !== base) {
      if (value === base) setValue(saved);
      setBase(saved);
    }
  }, [saved, base, value]);

  const dirty = value.trim() !== saved;
  const checked = checkAccountLabel(value);
  // The hint echoes only a label it would accept.
  const preview = checked.error ? '' : checked.value;
  useDirtyMark(`account-label-${meta.id}`, dirty);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const { value: v, error: bad } = checkAccountLabel(value);
    if (bad) {
      setError(bad);
      e.currentTarget.querySelector('input')?.focus();
      return;
    }
    if (v === saved) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    setNote(null);
    try {
      const s = await api.setUserDefaults({ accountLabels: { [meta.id]: v || null } });
      if (s.error) throw new Error('설정 파일을 읽지 못해서 저장하지 않았어요.');
      setAccountLabelsCache(s.values.accountLabels);
      setValue(v);
      setNote({ text: v ? `${accountText(meta.short, v)}로 보여요.` : '라벨을 지웠어요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form data-testid="settings-provider-account" className="ml-11 flex flex-col gap-1" onSubmit={submit} noValidate>
      <label htmlFor={ids.input} className="text-xs text-muted-foreground">
        계정 라벨
      </label>
      <div className="flex gap-2">
        <input
          id={ids.input}
          name="accountLabel"
          type="text"
          value={value}
          maxLength={ACCOUNT_LABEL_MAX}
          placeholder="예: Max, 팀 계정"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids.err} ${ids.hint}` : ids.hint}
          onChange={(e) => {
            setValue(e.currentTarget.value);
            setError(null);
            setNote(null);
          }}
          onBlur={() => dirty && setError(checkAccountLabel(value).error ?? null)}
          className={cn('h-8 w-full max-w-60 min-w-0 rounded-md border bg-transparent px-2 text-sm aria-invalid:border-destructive max-md:h-11', FOCUS)}
        />
        <button
          type="submit"
          aria-disabled={saving || !dirty ? true : undefined}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground transition-colors duration-[120ms] motion-reduce:transition-none max-md:h-11 aria-disabled:cursor-default aria-disabled:opacity-60 [&:not([aria-disabled])]:hover:bg-accent [&:not([aria-disabled])]:hover:text-foreground',
            FOCUS,
          )}
        >
          {saving && <Loader2 aria-hidden className="connect-spin size-3.5" />}
          저장
        </button>
      </div>
      {error && (
        <p id={ids.err} className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p id={ids.hint} className="text-xs text-muted-foreground">
        {preview ? `세션 보드와 PR 카드에 ${accountText(meta.short, preview)}처럼 보여요.` : `세션 보드와 PR 카드에서 ${meta.short} 옆에 보여요.`}
      </p>
      <p role="status" className={cn('text-xs empty:hidden', note?.bad ? 'text-destructive' : 'text-muted-foreground')}>
        {note?.text}
      </p>
    </form>
  );
}
