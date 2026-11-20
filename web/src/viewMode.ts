// Which panes the document screen shows (design doc 6 §6). Pure, so it is tested without a browser.

/** 문서 only, 둘 다 side by side, 캔버스 only, or a pipeline file's 플랜 (its step diagram, #729) or 실행 (its runs). */
export type View = 'doc' | 'both' | 'canvas' | 'plan' | 'run';

/** Views only a pipeline file (one with a plan) has. */
export const isPipelineView = (v: View): boolean => v === 'plan' || v === 'run';

/** The view shown for the stored one: narrow screens fit one pane, so 'both' shows the document. */
export const shownView = (stored: View, narrow: boolean): View => (narrow && stored === 'both' ? 'doc' : stored);

/** The view after asking to show something on the canvas: next to the document, or instead of it on a narrow screen. */
export const toCanvas = (stored: View, narrow: boolean): View => (narrow ? 'canvas' : stored === 'doc' || isPipelineView(stored) ? 'both' : stored);

/** The header's view switch, in order. */
const VIEWS: { id: View; label: string }[] = [
  { id: 'doc', label: '문서' },
  { id: 'both', label: '둘 다' },
  { id: 'canvas', label: '캔버스' },
  { id: 'plan', label: '플랜' },
  { id: 'run', label: '실행' },
];

/** The choices the view switch offers: narrow screens (390px) have no 둘 다, only pipeline files have 플랜 and 실행. */
export const switchViews = (narrow: boolean, canRun: boolean): { id: View; label: string }[] =>
  VIEWS.filter((v) => !(narrow && v.id === 'both') && (canRun || !isPipelineView(v.id)));
