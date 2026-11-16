// Measures the room the document's agent margin has (E532, #622), for DocMargin (side panel or sheet) and the
// Splitter (keeping the divider under the pointer). Both read the same numbers, so they agree on the layout: the
// collapsed side panel is read from the one place that says so, DocMargin's `data-side-rail` attribute.
import { RAIL_W, type MarginRoom } from './agentMargin.ts';

const PANEL_W = 304;

/**
 * The room around a `.doc-margin` element. While DocMargin marks it `data-side-rail` (the side panel is collapsed),
 * the panel counts as the rail. In the 둘 다 view the document pane is the closest `.split-doc` (its `--split` is the
 * share).
 */
export function measureRoom(host: HTMLElement): MarginRoom {
  const own = host.getBoundingClientRect().width;
  const panel = host.hasAttribute('data-side-rail') ? RAIL_W : parseFloat(getComputedStyle(host).getPropertyValue('--doc-margin-w')) || PANEL_W;
  const pane = host.closest<HTMLElement>('.split-doc');
  const split = pane?.parentElement;
  if (!pane || !split) return { box: own, share: null, chrome: 0, panel };
  const share = parseFloat(pane.style.getPropertyValue('--split')) / 100;
  return {
    box: split.getBoundingClientRect().width,
    share: Number.isFinite(share) ? share : 0.5,
    chrome: Math.max(0, pane.getBoundingClientRect().width - own),
    panel,
  };
}

/** The nearest ancestor that scrolls vertically (the margin's sticky panel is as tall as it at most). */
export function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return null;
}
