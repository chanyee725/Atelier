// 모델 연결 + 역할별 모델, one section of the unified 설정 modal (#624). Used without props: the modal drops it in.
// 모델 연결: one row per provider (Claude, OpenAI Codex, Gemini; PROVIDERS in modelConnect.ts) with its mark (#621),
// state, CLI line and one action that follows the state (연결 → 취소 → 해제, 다시 확인 when the CLI is missing), as in
// the 모델 연결 dialog (ConnectDialog.tsx) but inline, so no dialog opens over the modal. Codex can log in with an API
// key: the key lives only in the input until submit, is cleared before the request, and goes once to the server, which
// hands it to `codex login --with-api-key`; it is never stored or logged here. State comes from the shared
// model-connection subscription (useModels, #616/#625).
// 역할별 모델: each role's default model, picked from the connected providers' models and saved with one 저장 button
// (POST /api/settings team.roleModels; only changed roles are sent). Roles, models and saved overrides come from
// GET /api/state and follow the server's `snapshot` and `settings` events. With Dispatch off both parts show
// read-only with the reason (#620). Status only: no account, email, token or key is kept.
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api as dispatchApi } from '../../dispatch/store';
import { api } from '../../api';
import { events } from '../../lib/events';
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
import { MODELS_CHANGED } from '../context';
import { OffNote } from '../DispatchOff';
import { BTN, PRIMARY_BTN } from '../LimitsForm';
import { oneAtATime } from '../model';
import { modelGroups, resyncRoleModels, roleChoice, roleModelsPatch, sameModels, savedRoleModels, type ModelOption, type RoleLike } from './modelsSection';
import '../../connect.css';

const STATE_DOT = { off: 'bg-muted-foreground/50', missing: 'bg-destructive', busy: '', connected: 'bg-ok', idle: 'bg-muted-foreground/50' } as const;
const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const ACTION_BTN = cn(
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-[120ms] motion-reduce:transition-none max-md:h-11 aria-disabled:cursor-default aria-disabled:opacity-60',
  FOCUS,
);

export default function ModelsSection() {
  const models = useModels();
  return (
    <div data-testid="settings-models" className="flex flex-col gap-6">
      <ProvidersPart models={models} />
      <RolesPart models={models} />
    </div>
  );
}

/** One row per provider. Loading until /api/dispatch answered; off shows the reason and no actions. */
function ProvidersPart({ models }: { models: Models }) {
  const titleId = useId();
  const offId = useId();
  const { status } = models;
  const off = !!status && !status.enabled;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id={titleId} className="text-sm font-semibold">
          모델 연결
        </h3>
        <p className="text-xs text-muted-foreground">로그인은 각 CLI가 처리해요. 해제해도 CLI 로그인은 남아요.</p>
      </header>
      {!status && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {off && <OffNote id={offId} status={status} />}
      {status && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {PROVIDERS.map((meta) => (
            <ProviderRow key={meta.id} meta={meta} models={models} describedBy={off ? offId : undefined} />
          ))}
        </ul>
      )}
    </section>
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
            onClick={() => setKeyOpen(true)}
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

type RoleData = { roles: RoleLike[]; models: ModelOption[]; team: Record<string, unknown> | undefined };
type StateAnswer = { roles?: RoleLike[]; models?: ModelOption[]; settings?: { team?: Record<string, unknown> } };

/** Roles, models and saved team settings from GET /api/state, following the server's events. null while loading. */
function useRoleData(enabled: boolean): { data: RoleData | null; failed: boolean; retry: () => void } {
  const [data, setData] = useState<RoleData | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      dispatchApi<StateAnswer>('GET', '/api/state').then(
        (s) => alive && (setData({ roles: s.roles ?? [], models: s.models ?? [], team: s.settings?.team }), setFailed(false)),
        () => alive && setFailed(true),
      );
    void load();
    let first = true;
    const offs = [
      events.subscribeJson<StateAnswer>('snapshot', (s) => s && setData((d) => ({ roles: s.roles ?? d?.roles ?? [], models: s.models ?? d?.models ?? [], team: s.settings?.team ?? d?.team }))),
      events.subscribeJson<{ team?: Record<string, unknown> }>('settings', (s) => s?.team && setData((d) => (d ? { ...d, team: s.team } : d))),
      // After a dropped connection the events in between are lost: read the state again.
      events.onConnection((up) => {
        if (up && !first) void load();
        if (up) first = false;
      }),
    ];
    // A connect or disconnect changes the model list.
    const onChanged = () => void load();
    window.addEventListener(MODELS_CHANGED, onChanged);
    return () => {
      alive = false;
      offs.forEach((off) => off());
      window.removeEventListener(MODELS_CHANGED, onChanged);
    };
  }, [enabled, tick]);
  return { data, failed, retry: () => setTick((t) => t + 1) };
}

/** Each role's default model, saved together with one 저장 button. */
function RolesPart({ models }: { models: Models }) {
  const titleId = useId();
  const offId = useId();
  const { status, providers } = models;
  const enabled = !!status?.enabled;
  const { data, failed, retry } = useRoleData(enabled);
  const roles = data?.roles ?? [];
  const list = data?.models ?? [];
  const fromServer = useMemo(() => savedRoleModels(data?.team, roles), [data?.team, roles]);
  // What was last loaded or saved; only changes against it are sent.
  const [saved, setSaved] = useState<Record<string, string>>(fromServer);
  const [shown, setShown] = useState<Record<string, string>>(fromServer);
  const [note, setNote] = useState<{ text: string; bad?: boolean }>({ text: '' });
  const [saving, setSaving] = useState(false);
  // Saved values changed elsewhere: follow them where the user has not picked another model (adjusted during render).
  const [seen, setSeen] = useState(fromServer);
  if (!sameModels(seen, fromServer)) {
    setSeen(fromServer);
    setShown((s) => resyncRoleModels(saved, fromServer, s));
    setSaved(fromServer);
  }
  const groups = useMemo(() => modelGroups(list, providers), [list, providers]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const patch = roleModelsPatch(saved, shown);
    if (!patch) return setNote({ text: '바뀐 게 없어요.' });
    setSaving(true);
    try {
      await api.saveDispatchSettings({ team: { roleModels: patch } });
      const now = { ...saved, ...patch };
      setSaved(now);
      setShown((s) => resyncRoleModels(shown, now, s));
      setNote({ text: '저장했어요. 새로 여는 세션부터 적용돼요.' });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : '저장하지 못했어요.', bad: true });
    } finally {
      setSaving(false);
    }
  };

  const ro = !enabled;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id={titleId} className="text-sm font-semibold">
          역할별 모델
        </h3>
        <p className="text-xs text-muted-foreground">역할마다 새 세션이 쓸 기본 모델이에요. 연결한 모델에서 골라요.</p>
      </header>
      {status && !enabled && <OffNote id={offId} status={status} />}
      {enabled && failed && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          역할을 불러오지 못했어요.
          <button type="button" onClick={retry} className={cn(BTN, 'border')}>
            다시 불러오기
          </button>
        </p>
      )}
      {enabled && !failed && !data && <p className="text-sm text-muted-foreground">불러오는 중이에요…</p>}
      {(data || ro) && (
        <form noValidate onSubmit={(e) => void submit(e)} aria-labelledby={titleId} data-testid="settings-role-models" className="flex flex-col gap-3">
          <fieldset disabled={ro} aria-describedby={ro ? offId : undefined} className="flex flex-col gap-3 disabled:opacity-60">
            <legend className="sr-only">역할별 기본 모델</legend>
            {roles.length === 0 && <p className="text-xs text-muted-foreground">{ro ? '실행 기능이 켜지면 역할이 보여요.' : '역할이 없어요.'}</p>}
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
                      aria-invalid={choice.warn ? true : undefined}
                      aria-describedby={choice.warn ? warnId : undefined}
                      onChange={(e) => {
                        const v = e.target.value;
                        setShown((s) => ({ ...s, [r.id]: v }));
                        setNote({ text: '' });
                      }}
                      className={cn('h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-sm aria-invalid:border-warn max-md:h-11', FOCUS)}
                    >
                      {!list.some((m) => m.id === value) && <option value={value}>{value}</option>}
                      {groups.map((g) => (
                        <optgroup key={g.provider} label={g.name}>
                          {g.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  {choice.warn && (
                    <span id={warnId} className="text-xs text-muted-foreground">
                      {choice.warn}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
          {!ro && roles.length > 0 && (
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
      )}
    </section>
  );
}
