// PR/CI tracking switch for the run screen (E30c). Project mode opens only /dispatch, so the editor's settings
// dialog is out of reach there; this uses the same /api/workspace/pr-tracking route and the same wording.
import { useId } from 'react';
import { Switch } from '../components/ui/switch';
import { usePrTracking, useStatusLine } from './usePrTracking';

export function PrTrackingToggle() {
  // The switch itself shows success, so the line stays empty then; it carries the cause, "아직 읽을 수 없어요." and errors.
  const { note, status } = useStatusLine();
  const { pr, toggle, broken } = usePrTracking(status, '');
  const errId = useId();
  const hintId = useId();
  const line = [broken, note].filter(Boolean).join(' ');

  // The switch's name stays 'PR·CI 추적', taken from the wrapping label's visible text (no aria-label, so it is read once); the hint and the error reach screen readers as its description.
  // The wrapper shrinks and the error wraps within a capped width, so it never pushes the header nav off screen.
  const hint = pr === 'unsupported' ? '이 서버에선 바꿀 수 없어요' : broken ? '고친 뒤 눌러서 다시 확인해요' : null;
  const describedBy = [hint && hintId, line && errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 max-w-72 shrink flex-col">
      <label title="이 워크스페이스에서 gh로 PR과 CI 상태를 확인해요." className="flex h-7 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
        <Switch
          checked={pr === true}
          disabled={pr === null || pr === 'unsupported'}
          aria-describedby={describedBy}
          onCheckedChange={toggle}
        />
        PR·CI 추적
      </label>
      {/* hidden, not sr-only: aria-describedby still reads it, and browse mode does not read it a second time (#431). */}
      <span id={hintId} hidden>{hint}</span>
      <p id={errId} aria-live="polite" className="text-xs break-words text-destructive">
        {line}
      </p>
    </div>
  );
}
