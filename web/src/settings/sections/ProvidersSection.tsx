// 설정 > 모델 연결 (#624): one row per provider (Claude, OpenAI Codex, Gemini; PROVIDERS in modelConnect.ts) with its
// mark (#621), state, CLI line and one action that follows the state (연결 → 취소 → 해제, 다시 확인 when the CLI is
// missing), inline in the 설정 modal (the sidebar model rows open it here). Codex can
// log in with an API key: the key lives only in the input until submit, is cleared before the request and goes once
// to the server, which hands it to `codex login --with-api-key`; it is never stored or logged here. Provider state
// comes from the shared model-connection subscription (useModels, #616/#625). With Dispatch off the rows show
// read-only with the reason (#620). Status only: no account, email, token or key is kept.
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { cn } from '../../lib/utils';
import {
  ACTION_TEXT,
  PROVIDERS,
  STATE_TEXT,
  actionFor,
  cliLogoutShown,
  cliLogoutText,
  connectKey,
  connectedText,
  doneText,
  keyDoneText,
  keyLoginShown,
  loginUrl,
  metaLine,
  objParticle,
  rowStatus,
  type Action,
  type ProviderMeta,
} from '../../modelConnect';
import { ProviderIcon } from '../../ProviderIcon';
import { useModels, type Models } from '../../SidebarModels';
import { MODELS_CHANGED, useDirtyMark, useSettingsLoad } from '../context';
import { OffNote } from '../DispatchOff';
import { SectionFrame } from '../SectionFrame';
import { oneAtATime } from '../model';
import '../../connect.css';

const STATE_DOT = { off: 'bg-muted-foreground/50', missing: 'bg-destructive', busy: '', connected: 'bg-ok', idle: 'bg-muted-foreground/50' } as const;
const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const ACTION_BTN = cn(
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-[120ms] motion-reduce:transition-none max-md:h-11 aria-disabled:cursor-default aria-disabled:opacity-60',
  FOCUS,
);

export default function ProvidersSection() {
  const models = useModels();
  const { load } = useSettingsLoad();
  const offId = useId();
  const off = load.kind === 'off';
  return (
    <SectionFrame title="모델 연결" hint="로그인은 각 CLI가 처리해요. 해제해도 CLI 로그인은 남아요." testId="settings-section-providers">
      {off && <OffNote id={offId} status={load.status} />}
      {!models.status ? (
        <p role="status" className="text-sm text-muted-foreground">
          불러오는 중이에요…
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {PROVIDERS.map((meta) => (
            <ProviderRow key={meta.id} meta={meta} models={models} describedBy={off ? offId : undefined} />
          ))}
        </ul>
      )}
    </SectionFrame>
  );
}

function ProviderRow({ meta, models, describedBy }: { meta: ProviderMeta; models: Models; describedBy?: string }) {
  const { status, limits } = models;
  const p = models.providers[meta.id];
  const enabled = !!status?.enabled;
  const key = connectKey(p, enabled);
  const action = actionFor(key);
  const url = loginUrl(p);
  const keyId = useId();
  const [pending, setPending] = useState<Action | 'key' | 'cliLogout' | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  // Only whether the key field has text (#638), never the key itself.
  const [keyTyped, setKeyTyped] = useState(false);
  useDirtyMark(`provider-key-${meta.id}`, keyOpen && keyTyped);

  // A login that finishes while the section is open says so, like a request that connects at once.
  const wasBusy = useRef(key === 'busy');
  useEffect(() => {
    if (wasBusy.current && key === 'connected') setNote({ text: connectedText(meta) });
    wasBusy.current = key === 'busy';
  }, [key, meta]);

  // One request at a time: a double click before the state changes is dropped.
  const run = useMemo(
    () =>
      oneAtATime(async (what: Action | 'key' | 'cliLogout', secret?: string) => {
        setPending(what);
        setNote(null);
        try {
          if (what === 'key') {
            const res = await api.providerKey(meta.id, secret ?? '');
            setNote({ text: keyDoneText(meta, res), bad: !res?.connected });
            if (res?.connected) setKeyOpen(false);
            return;
          }
          if (what === 'cliLogout') {
            await api.providerCliLogout(meta.id);
            setNote({ text: cliLogoutText(meta) });
            return;
          }
          const res =
            what === 'connect' ? await api.providerLogin(meta.id)
            : what === 'cancel' ? (await api.providerCancel(meta.id), null)
            : what === 'disconnect' ? (await api.providerLogout(meta.id), null)
            : (await api.providerRefresh(), null);
          const text = doneText(meta, what, res);
          if (text) setNote({ text });
        } catch (e) {
          setNote({ text: e instanceof Error ? e.message : '요청이 실패했어요.', bad: true });
        } finally {
          setPending(null);
          window.dispatchEvent(new Event(MODELS_CHANGED));
        }
      }),
    [meta],
  );

  // The key lives only in the form's input until submit: read it, clear the field, send it once. No state, no storage.
  const submitKey = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('key') as HTMLInputElement | null;
    const k = input?.value.trim() ?? '';
    if (input) input.value = '';
    setKeyTyped(false);
    if (!k || pending) return;
    void run('key', k);
  };

  const row = rowStatus(meta, p, enabled, limits);
  const error = p?.error && key !== 'busy' && key !== 'connected' ? p.error : null;
  const line = enabled ? metaLine(meta, p) : null;
  return (
    <li data-testid="settings-provider" data-provider={meta.id} data-state-key={key} className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md border text-foreground">
          <ProviderIcon provider={meta.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm font-semibold">{meta.name}</span>
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', key === 'connected' ? 'text-foreground' : key === 'missing' ? 'text-destructive' : 'text-muted-foreground')}>
              {key === 'busy' ? <Loader2 aria-hidden className="connect-spin size-3" /> : <span aria-hidden className={cn('size-1.5 rounded-full', STATE_DOT[key])} />}
              {/* Connected: the 5-hour usage like the sidebar row; otherwise the state word. */}
              {key === 'connected' ? `${STATE_TEXT[key]} · ${row.text}` : STATE_TEXT[key]}
            </span>
          </div>
          {line && (
            <p className="truncate text-xs text-muted-foreground" title={line}>
              {line}
            </p>
          )}
        </div>
        {action && (
          // One button whose label follows the state (연결 → 취소 → 해제), so focus stays on it across the swap.
          <button
            type="button"
            data-testid="settings-provider-action"
            aria-disabled={pending ? true : undefined}
            aria-label={`${meta.name} ${ACTION_TEXT[action]}`}
            aria-describedby={describedBy}
            title={action === 'connect' ? (p?.cliLoggedIn ? '이미 로그인된 CLI 계정을 그대로 써요' : `${meta.short} 계정으로 로그인`) : undefined}
            onClick={() => !pending && void run(action)}
            className={cn(
              ACTION_BTN,
              action === 'connect' ? 'bg-primary text-primary-foreground [&:not([aria-disabled])]:hover:bg-primary/90' : 'border text-muted-foreground [&:not([aria-disabled])]:hover:bg-accent [&:not([aria-disabled])]:hover:text-foreground',
            )}
          >
            {pending && pending !== 'key' && pending !== 'cliLogout' && <Loader2 aria-hidden className="connect-spin size-3.5" />}
            {ACTION_TEXT[action]}
          </button>
        )}
      </div>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className={cn('ml-11 inline-flex w-fit items-center gap-1 rounded-sm text-xs text-foreground underline-offset-4 hover:underline', FOCUS)}>
          브라우저가 안 열렸다면 로그인 페이지 열기
          <ExternalLink aria-hidden className="size-3" />
        </a>
      )}
      {key === 'busy' && !url && <p className="ml-11 text-xs text-muted-foreground">브라우저에서 로그인을 마쳐 주세요.</p>}
      {error && <p className="ml-11 text-xs text-destructive">{error}</p>}
      {key === 'missing' && (
        <p className="ml-11 text-xs text-muted-foreground">
          {meta.cliName}
          {objParticle(meta.cliName)} 설치한 뒤 다시 확인해 주세요.
        </p>
      )}
      {keyLoginShown(meta, p, enabled) &&
        (keyOpen ? (
          <form data-testid="settings-provider-key-form" className="ml-11 flex flex-col gap-1" onSubmit={submitKey}>
            <label htmlFor={keyId} className="text-xs text-muted-foreground">
              {meta.keyLabel ?? 'API 키'}
            </label>
            <div className="flex gap-2">
              {/* No autofill and nothing for the browser to remember: the key goes to the CLI only (project privacy rule). */}
              <input
                id={keyId}
                name="key"
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                onInput={(e) => setKeyTyped(e.currentTarget.value !== '')}
                className={cn('h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm max-md:h-11', FOCUS)}
              />
              <button type="submit" aria-disabled={pending ? true : undefined} className={cn(ACTION_BTN, 'bg-primary text-primary-foreground [&:not([aria-disabled])]:hover:bg-primary/90')}>
                {pending === 'key' && <Loader2 aria-hidden className="connect-spin size-3.5" />}키로 연결
              </button>
            </div>
            <p className="text-xs text-muted-foreground">키는 {meta.cliName}에만 넘기고 Drawing에는 남기지 않아요.</p>
          </form>
        ) : (
          <button
            type="button"
            data-testid="settings-provider-key-open"
            onClick={() => (setKeyTyped(false), setKeyOpen(true))}
            className={cn('ml-11 inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground', FOCUS)}
          >
            <KeyRound aria-hidden className="size-3" />
            API 키로 연결
          </button>
        ))}
      {cliLogoutShown(p, enabled) && (
        <button
          type="button"
          aria-disabled={pending ? true : undefined}
          title={`${meta.cliName}의 로그인도 이 컴퓨터에서 끝내요`}
          onClick={() => !pending && void run('cliLogout')}
          className={cn('ml-11 inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground aria-disabled:opacity-60', FOCUS)}
        >
          {pending === 'cliLogout' && <Loader2 aria-hidden className="connect-spin size-3" />}
          CLI에서도 로그아웃
        </button>
      )}
      {/* Always rendered, so its text changes are announced. */}
      <p role="status" className={cn('ml-11 text-xs', note?.bad ? 'text-destructive' : 'text-muted-foreground')}>
        {note?.text}
      </p>
    </li>
  );
}

