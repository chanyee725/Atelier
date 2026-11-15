/**
 * Whether a session can still run. The server (hub.js) refuses to start or resume anything but
 * Claude and exposes no flag for it, so this mirrors that one rule here: change both together.
 */
export function canRun(s: { provider: string }): boolean {
  return s.provider === 'claude';
}

export const READ_ONLY_NOTICE = '이 세션은 더 이상 이어서 실행할 수 없어요. 대화만 볼 수 있어요.';
