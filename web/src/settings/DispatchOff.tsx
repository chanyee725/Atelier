// Settings with Dispatch off (#620): the 설정 modal and page still render. What does not need sessions (the theme)
// works; session sections (team, role models, usage, limits) show read-only, each with one line saying why and what
// to do (offReason). Status only: GET /api/dispatch carries a reason code and a message, nothing else.
import { useEffect, useId, useState } from 'react';
import { api, type DispatchStatus } from '../api';
import { cn } from '../lib/utils';
import { useTheme } from '../theme';
import { ThemeSwitch } from '../ThemeSwitch';
import { offReason } from './model';

/** GET /api/dispatch once; null while loading. A failed request reads as off with no reason. */
export function useDispatchStatus(): DispatchStatus | null {
  const [status, setStatus] = useState<DispatchStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api.dispatch().then(
      (s) => alive && setStatus(s),
      () => alive && setStatus({ enabled: false }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

/** The one-line reason under a disabled session section. `id` lets the section point aria-describedby at it. */
export function OffNote({ id, status, className }: { id?: string; status: DispatchStatus | null; className?: string }) {
  return (
    <p id={id} data-testid="settings-off-note" className={cn('rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground', className)}>
      {status ? offReason(status) : '불러오는 중이에요…'}
    </p>
  );
}

/** 화면 테마: the same four choices as the sidebar switch, named by its visible heading. Works with Dispatch off. */
export function ThemeField({ headingClass = 'text-sm font-medium' }: { headingClass?: string }) {
  const [, , pref, setPref, system] = useTheme();
  const id = useId();
  return (
    <div data-testid="settings-theme" className="flex flex-col gap-2">
      <h3 id={id} className={headingClass}>
        화면 테마
      </h3>
      <ThemeSwitch pref={pref} onPref={setPref} system={system} labelledBy={id} className="mx-0 mb-0 max-w-64" />
    </div>
  );
}
