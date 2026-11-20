// Closes board tasks whose work already landed (#930). Leads often merge and forget `set_task done`, so open
// tasks sat in 확인 필요 as "지연" for days. The server checks open plan-to-merge tasks on a timer and moves one to
// done only with evidence, kept in `mergeCheck.evidence` (metadata only: commit, PR or issue number):
//   (a) the task's commit is on the integration branch (verifyMerged),
//   (b) a merged PR is tied to the task: its number is a `#N` in the title, it closes or its branch names such an
//       issue, or its head branch is the task's commit (a branch name),
//   (c) an issue the task names (`#N` in the title, or the issue its commit branch names) is closed.
// Without evidence the task stays open and `autoCheck.reason` says why.
import { issueNumber, issueOfBranch } from "./ledger.js";

/** Stages the timer looks at; done and blocked are left alone. */
export const AUTO_CLOSE_STAGES = new Set(["plan", "impl", "review", "test", "merge"]);

const HASH = /(?:^|[^\w&])#(\d{1,7})\b/g;

/** Issue or PR numbers a task names: `#N` in its title, and the issue its commit (a branch name) names. */
export function taskRefs(t) {
  const out = new Set();
  for (const m of String(t?.title || "").matchAll(HASH)) {
    const n = issueNumber(Number(m[1]));
    if (n) out.add(n);
  }
  const own = issueOfBranch(t?.commit);
  if (own) out.add(own);
  return [...out];
}

/**
 * Evidence that a task's work landed, checked a → b → c (cheapest first):
 * `{ ok: true, via: "commit"|"pr"|"issue", evidence, commit?, base? }` or `{ ok: false, reason }`.
 * - `verify(commit)`: verifyMerged's answer;
 * - `prs`: issues.js parsePrs list (`{ pr: { number, state, branch? }, issues }`), or null when gh could not answer;
 * - `issueState(n)`: "open" | "closed" | null (unknown).
 */
export async function closeEvidence(t, { verify, prs, issueState }) {
  const refs = taskRefs(t);
  const why = [];
  if (t.commit) {
    const check = await verify(t.commit);
    if (check?.ok) return { ok: true, via: "commit", commit: check.commit, base: check.base, evidence: `커밋 ${String(check.commit).slice(0, 7)}이 ${check.base}에 있어요` };
    why.push(check?.reason || "커밋 병합을 확인하지 못했어요");
  }
  if (!refs.length && !t.commit) return { ok: false, reason: "커밋과 이슈 번호가 없어 자동으로 닫지 못했어요" };
  if (Array.isArray(prs)) {
    const hit = prs.find(p => p.pr.state === "merged" && (
      refs.includes(p.pr.number) || refs.some(n => p.issues?.has?.(n)) || (t.commit && p.pr.branch === t.commit)));
    if (hit) return { ok: true, via: "pr", pr: hit.pr.number, evidence: `PR #${hit.pr.number}이 병합됐어요` };
  } else if (refs.length || t.commit) why.push("PR 정보를 읽지 못했어요");
  for (const n of refs) {
    if ((await issueState(n)) === "closed") return { ok: true, via: "issue", issue: n, evidence: `이슈 #${n}이 닫혔어요` };
  }
  if (refs.length) why.push(`#${refs.join(", #")}에 병합된 PR이나 닫힌 이슈가 없어요`);
  return { ok: false, reason: `병합 근거가 없어 열어 뒀어요: ${why.join(" · ")}`.slice(0, 200) };
}
