// Pipeline helpers shared by index.js and its sections (#1000).

/** A file name from a plan title: letters (any script), digits, `-` and `_`; spaces become `-`. */
export function planFileName(title) {
  const stem = String(title ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
  return stem || 'plan';
}
