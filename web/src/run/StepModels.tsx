// 단계 모델 (#587): under the plan strip, one row per pipeline step with a model picker. 역할 기본 runs the role's
// default model; other models are grouped by provider (<optgroup>), a provider that is not connected is disabled.
// A change saves the file first, then PATCHes the plan step (stepModels.ts).
import { useEffect, useState } from 'react';
import { NativeSelect } from '../components/ui/native-select';
import type { FileSession } from '../fileSession';
import { useSession } from '../useSession';
import { providerGroups } from '../dispatch/lib/create.ts';
import { providerName } from '../dispatch/lib/format.ts';
import { ProviderIcon } from '../ProviderIcon';
import { patchStepModel, stepModelRows, type ModelCatalog } from './stepModels';

async function readCatalog(): Promise<ModelCatalog | null> {
  const res = await fetch('/api/state');
  if (!res.ok) return null;
  const s = (await res.json()) as Partial<ModelCatalog>;
  return { models: s.models ?? [], roles: s.roles ?? [], perms: s.perms ?? [], providers: s.providers ?? {} };
}

export function StepModels({ id, session, path }: { id: string; session: FileSession; path: string }) {
  const plan = useSession(session, (s) => s.file?.plan ?? null);
  const [cat, setCat] = useState<ModelCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readCatalog().then(
      (c) => { if (live) { setCat(c); setFailed(!c); } },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, []);

  if (!plan) return null;
  const rows = cat ? stepModelRows(plan, cat) : [];
  const label = (mid: string | null) => (mid ? (cat?.models.find((m) => m.id === mid)?.label ?? mid) : '없음');

  const pick = async (stepId: string, model: string) => {
    if (!cat || busy) return;
    setBusy(stepId);
    setError(null);
    try {
      setError(await patchStepModel(session, path, stepId, model, cat));
    } catch (e) {
      setError(e instanceof Error ? e.message : '모델을 바꾸지 못했어요');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id={id} aria-label="단계 모델" data-testid="step-models" className="border-b bg-muted/40 px-4 py-2 text-sm">
      {failed ? (
        <p className="text-muted-foreground">모델 목록을 불러오지 못했어요.</p>
      ) : !cat ? (
        <p className="text-muted-foreground">불러오는 중…</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center gap-2" data-testid="step-model-row">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.id}</span>
                {r.roleName && <span className="text-muted-foreground"> · {r.roleName}</span>}
              </span>
              <NativeSelect
                aria-label={`${r.id} 모델`}
                className="h-7 w-56 max-w-[50vw] text-xs"
                value={r.model}
                start={<ProviderIcon provider={cat.models.find((m) => m.id === (r.model || r.effective))?.provider} className="size-3.5" />}
                disabled={busy !== null}
                onChange={(e) => void pick(r.id, e.target.value)}
              >
                <option value="">역할 기본{r.model ? '' : ` (${label(r.effective)})`}</option>
                {r.model && !cat.models.some((m) => m.id === r.model) && <option value={r.model}>{r.model}</option>}
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
            </li>
          ))}
          {rows.length === 0 && <li className="text-muted-foreground">단계가 없어요.</li>}
        </ul>
      )}
      {error && <p role="alert" className="mt-1.5 text-destructive">{error}</p>}
    </section>
  );
}
