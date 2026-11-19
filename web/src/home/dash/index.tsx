// Shared dashboard primitives for the home dashboard (#685) and the project dashboard (#686).
// Quiet panels on the app's own tokens: hairline border, no shadow, one radius step below the app's.
// API is additive-only: other screens import these, so props are never renamed or removed.
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Two halves side by side (5:5 by default) that stack below 880px of *container* width, so the split
 * follows the main pane, not the window (the sidebar takes part of the window).
 * It grows to the bottom of its flex parent and the last card of each column takes the spare height, so a short
 * dashboard has no empty band below the cards (#699); a long one scrolls with the page as before.
 */
export function DashGrid({ children, className, ratio = '1fr 1fr' }: { children: ReactNode; className?: string; ratio?: string }) {
  return (
    <div className="@container flex grow flex-col">
      <div className={cn('dash-grid flex grow flex-col gap-4 p-4 *:last:grow @min-[880px]:grid @min-[880px]:[grid-template-columns:var(--dash-cols)]', className)} style={{ '--dash-cols': ratio } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/** A column of cards inside one half. */
export function DashColumn({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-4 *:last:grow', className)} role={label ? 'region' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

type CardProps = {
  /** Heading text; also names the region for screen readers. */
  title: ReactNode;
  /** Small number after the title (e.g. how many rows). */
  count?: number;
  /** Right side of the header: buttons or links. */
  actions?: ReactNode;
  /** One line under the title in muted text. */
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Body without padding, for row lists that run edge to edge. */
  flush?: boolean;
  /** data-card attribute, for tests and screenshots. */
  id?: string;
  /**
   * Share of a <DashColumn>'s height (flex-grow from a zero basis), e.g. 5, 3 and 2 for a 5:3:2 split (#720).
   * The card never gets shorter than its content, so a full card pushes the split instead of clipping rows.
   */
  grow?: number;
};

/** A titled panel. The header is part of the card; rows inside use <CardRow>. */
export function Card({ title, count, actions, hint, children, className, flush, id, grow }: CardProps) {
  const headId = useId();
  const share = grow === undefined ? undefined : { flex: `${grow} 1 0%`, minBlockSize: 'fit-content' };
  return (
    <section aria-labelledby={headId} data-card={id} style={share} className={cn('min-w-0 overflow-hidden rounded-lg border bg-card text-card-foreground', className)}>
      <CardHeader id={headId} title={title} count={count} actions={actions} hint={hint} />
      <div className={flush ? undefined : 'px-4 py-3'}>{children}</div>
    </section>
  );
}

export function CardHeader({ id, title, count, actions, hint }: { id?: string; title: ReactNode; count?: number; actions?: ReactNode; hint?: ReactNode }) {
  return (
    <header className="flex min-h-[39px] items-center gap-2 border-b px-4 py-1.5">
      <div className="min-w-0">
        <h2 id={id} className="m-0 flex items-baseline gap-2 text-[13px] font-semibold">
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {hint && <p className="m-0 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** A list of rows in a flush card. */
export function CardList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none divide-y p-0">
      {children}
    </ul>
  );
}

/**
 * Items as a grid of n rows × 3 columns in a flush card (#720). The columns follow the card's own width (a container
 * query), not the window: 3 from 26rem, 2 from 18rem, 1 below that (a phone-width card).
 */
export function CardGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="@container">
      <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-2 p-2 @min-[18rem]:grid-cols-2 @min-[26rem]:grid-cols-3">
        {children}
      </ul>
    </div>
  );
}

/**
 * One cell of a <CardGrid>: icon and main line on top, then the muted second line, then the meta line. Same props as
 * <CardRow>; `onClick` or `href` makes the whole tile the target.
 * `footer` (#747) sits under the target inside the same frame, outside the link or button, so it can hold its own
 * controls (e.g. a <details>).
 */
export function CardTile({ icon, title, sub, meta, onClick, href, className, data, footer }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; onClick?: () => void; href?: string; className?: string; data?: string; footer?: ReactNode }) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {icon && <span aria-hidden className="grid size-4 shrink-0 place-items-center text-muted-foreground [&_svg]:size-3.5">{icon}</span>}
        <span className="min-w-0 truncate text-sm">{title}</span>
      </span>
      {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      {meta && <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">{meta}</span>}
    </>
  );
  // With a footer the frame (border) moves to the cell and the target fills its top part.
  const cls = cn('grid w-full min-w-0 content-start gap-1 rounded-md px-3 py-2 text-left', footer ? 'grow' : 'h-full border');
  const hit = 'hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';
  const target = href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cn(cls, hit, 'text-inherit no-underline')}>{body}</a>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, hit)}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
  return (
    <li data-row={data} className={cn('min-w-0', footer && 'flex flex-col rounded-md border', className)}>
      {target}
      {footer}
    </li>
  );
}

/**
 * One row: leading icon, a main line and a muted second line, trailing meta. Pass `onClick` (a button) or `href`
 * (a link) to make the whole row the target.
 */
export function CardRow({ icon, title, sub, meta, onClick, href, className, data }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; onClick?: () => void; href?: string; className?: string; data?: string }) {
  const body = (
    <>
      {icon && <span aria-hidden className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {meta && <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">{meta}</span>}
    </>
  );
  const cls = 'flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left';
  const hit = 'hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none';
  return (
    <li data-row={data} className={className}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={cn(cls, hit, 'text-inherit no-underline')}>{body}</a>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(cls, hit)}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** A number with a label under it; `tone` colours a dot before the number. */
export function Stat({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xl leading-7 font-semibold tabular-nums">
        {tone && <span aria-hidden className={cn('size-1.5 rounded-full', TONE[tone])} />}
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** A row of <Stat>s. */
export function StatRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-4">
      {children}
    </div>
  );
}

export const TONE = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', idle: 'bg-idle' } as const;

/** Small coloured status dot with text; the text is what screen readers get. */
export function StatusDot({ tone, children, pulse }: { tone: keyof typeof TONE; children?: ReactNode; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE[tone], pulse && 'motion-safe:animate-pulse')} />
      {children}
    </span>
  );
}

/** What a card shows when it has nothing: one plain sentence and, optionally, the action that fills it. */
export function EmptyState({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 px-4 py-5 text-sm text-muted-foreground', className)}>
      <p className="m-0">{children}</p>
      {action}
    </div>
  );
}
