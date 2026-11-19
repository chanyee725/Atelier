// 승인 in the 플랜 tab (#729): which approval state the open plan is in, from GET /api/pipeline. Pure (no React or
// DOM), so it runs under `node --test`. One approval (시작하기) per plan stays the rule: a revision after a run was
// started (계획 다시 열기, then the lead's write_plan) is approved again with the same 시작하기, for its revision.
import type { PipelineStatus } from './planStripModel.ts';

export type ApprovalKind = 'waiting' | 'revised' | 'approved' | 'unknown';

export interface PlanApproval {
  kind: ApprovalKind;
  /** The chip: 승인 대기, 개정 대기, 승인됨, 확인 못 함. */
  label: string;
  /** One line under the chip, 해요체. */
  text: string;
  /** The revision 시작하기 would approve (waiting, revised) or the one approved (approved); null when unknown. */
  revision: number | null;
  /** The revision started before, for a revised plan. */
  previous: number | null;
  /** When it was approved (approved only). */
  at: number | null;
  /** 시작하기 is offered (it may still be blocked). */
  canStart: boolean;
  /** Why 시작하기 is blocked; empty when it is not. */
  blockers: string[];
}

const RUN_TEXT: Record<'running' | 'paused' | 'done', string> = {
  running: '승인한 계획으로 실행 중이에요.',
  paused: '승인한 계획이 멈춰 있어요.',
  done: '승인한 계획이 끝났어요.',
};

/**
 * The approval state, or null when there is nothing to approve (no plan, or the status is not read yet).
 * `unread` means the status could not be read at all: 시작하기 shows but stays blocked (#788).
 */
export function planApproval(status: Pick<PipelineStatus, 'state' | 'revision' | 'approvedRevision' | 'approvedAt' | 'lastApprovedRevision' | 'blockers'> | null, unread = false): PlanApproval | null {
  if (!status) {
    if (!unread) return null;
    return { kind: 'unknown', label: '확인 못 함', text: '시작할 수 있는지 확인하지 못했어요.', revision: null, previous: null, at: null, canStart: true, blockers: ['상태를 읽지 못했어요'] };
  }
  const { state } = status;
  if (state === 'running' || state === 'paused' || state === 'done') {
    return { kind: 'approved', label: '승인됨', text: RUN_TEXT[state], revision: status.approvedRevision, previous: null, at: status.approvedAt, canStart: false, blockers: [] };
  }
  if (state !== 'plan') return null;
  const blockers = status.blockers;
  const previous = status.lastApprovedRevision ?? null;
  if (previous !== null) {
    return {
      kind: 'revised',
      label: '개정 대기',
      text: `rev ${previous} 실행 뒤 계획이 바뀌었어요. 바뀐 계획을 확인하고 다시 시작해 주세요.`,
      revision: status.revision,
      previous,
      at: null,
      canStart: true,
      blockers,
    };
  }
  return { kind: 'waiting', label: '승인 대기', text: '계획을 검토하고 시작해 주세요.', revision: status.revision, previous: null, at: null, canStart: true, blockers };
}
