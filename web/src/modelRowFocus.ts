// Focus following for the sidebar model row (E509, #544, #550). The row swaps its action button (연결하기 / 취소 / ⋯).
// When the button the user just used is removed while it still had focus, focus moves to the button that replaced it.
// Tracking ends as soon as the user leaves the row and its ⋯ menu, so a later outside change (another tab, an expired
// session) never pulls focus back into the sidebar. Pure logic, so it can be tested without a DOM.

/** Anything with contains(): the row's list element, the ⋯ menu content. */
export interface Area {
  contains(node: Node | null): boolean;
}

/**
 * Does this event mean the user left the row and its menu?
 * focusout: only when focus moves to a known element outside. A null relatedTarget is focus falling to <body>, which is
 * also what happens when the used button is removed, so it does not end tracking.
 * pointerdown: any press outside (an empty, non-focusable spot leaves focus on <body> and sends no useful focusout).
 */
export function leftRow(kind: 'focusout' | 'pointerdown', target: EventTarget | null, areas: readonly (Area | null | undefined)[]): boolean {
  if (!target) return kind === 'pointerdown';
  const node = target as Node;
  return !areas.some((a) => a?.contains(node));
}

export interface SwapStep<T> {
  /** Element to focus now, if any. */
  focus: T | null;
  /** Element to keep tracking. */
  track: T | null;
}

/**
 * After the row re-renders: where does focus go and what do we track next?
 * - nothing tracked, or the tracked button is still in the page: no change.
 * - focus is on something else (not <body>): follow it if it is inside the row (Radix hands focus back to ⋯), else stop.
 * - focus fell to <body>: move it to the row's current action button and track that one.
 */
export function afterSwap<T extends { isConnected: boolean }>(
  tracked: T | null,
  active: T | null,
  body: unknown,
  row: Area | null,
  nextButton: () => T | null,
): SwapStep<T> {
  if (!tracked || tracked.isConnected) return { focus: null, track: tracked };
  if (active && active !== body) return { focus: null, track: row?.contains(active as unknown as Node) ? active : null };
  const next = nextButton();
  return { focus: next, track: next };
}
