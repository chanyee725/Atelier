// One section of the 설정 modal (#624): a heading the section is named by, an optional hint, then the body.
import { useId, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export function SectionFrame({ title, hint, children, className, testId }: { title: string; hint?: string; children: ReactNode; className?: string; testId?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className={cn('flex min-w-0 flex-col gap-4', className)}>
      <header className="flex flex-col gap-1">
        <h3 id={id} className="text-[15px] font-semibold">
          {title}
        </h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** A placeholder for a section another change fills in. */
export function SectionPending({ title }: { title: string }) {
  return (
    <SectionFrame title={title}>
      <p className="text-sm text-muted-foreground">준비 중이에요.</p>
    </SectionFrame>
  );
}
