// PR/CI tracking switch for the run screen (E30c). Project mode opens only /dispatch, so the editor's settings
// dialog is out of reach there; this uses the same /api/workspace/pr-tracking route and the same wording.
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '../api';
import { Switch } from '../components/ui/switch';

type State = boolean | null | 'unsupported' | { broken: string };

export function PrTrackingToggle() {
  const [pr, setPr] = useState<State>(null);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const broken = typeof pr === 'object' && pr !== null;
  useEffect(() => {
    let alive = true;
    api.prTracking().then(
      r => alive && setPr(r.on),
      e => alive && setPr(e instanceof ApiError && e.status === 409 ? { broken: e.message } : 'unsupported'),
    );
    return () => { alive = false; };
  }, []);

  // An unreadable settings file shows its cause and keeps the switch enabled; pressing it re-reads the file.
  const toggle = async (on: boolean) => {
    setError(null);
    try {
      setPr(broken ? (await api.prTracking()).on : (await api.setPrTracking(on)).on);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPr({ broken: e.message });
      else setError(e instanceof Error ? e.message : '저장하지 못했어요.');
    }
  };

  return (
    <div className="flex min-w-0 flex-col">
      <label title="이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요." className="flex h-7 shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={pr === true}
          disabled={pr === null || pr === 'unsupported'}
          aria-describedby={broken || error ? errId : undefined}
          onCheckedChange={on => void toggle(on)}
        />
        PR·CI 추적
        <span className="sr-only">{pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : broken ? '고친 뒤 눌러서 다시 확인해요' : pr ? '켜짐' : '꺼짐'}</span>
      </label>
      <p id={errId} aria-live="polite" className="text-xs text-destructive">
        {broken ? pr.broken : error}
      </p>
    </div>
  );
}
