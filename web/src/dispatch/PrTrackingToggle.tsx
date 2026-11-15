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
  const hintId = useId();
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

  // The switch's name stays 'PR·CI 추적'; the hint and the error reach screen readers as its description.
  // The wrapper shrinks and the error wraps within a capped width, so it never pushes the header nav off screen.
  const hint = pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : broken ? '고친 뒤 눌러서 다시 확인해요' : null;
  const describedBy = [hint && hintId, (broken || error) && errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 max-w-72 shrink flex-col">
      <label title="이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요." className="flex h-7 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
        <Switch
          checked={pr === true}
          disabled={pr === null || pr === 'unsupported'}
          aria-label="PR·CI 추적"
          aria-describedby={describedBy}
          onCheckedChange={on => void toggle(on)}
        />
        PR·CI 추적
        <span id={hintId} className="sr-only">{hint}</span>
      </label>
      <p id={errId} aria-live="polite" className="text-xs break-words text-destructive">
        {broken ? pr.broken : error}
      </p>
    </div>
  );
}
