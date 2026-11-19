/**
 * Step roles in a plan the lead writes (#788). Common English role names map to the role ids
 * (implementer → impl, …); any other unknown role is refused with the valid list, so the lead fixes the
 * plan at once instead of the user meeting a plan that cannot start.
 */
export const ROLE_ALIASES = Object.freeze({
  implementer: 'impl',
  implement: 'impl',
  developer: 'impl',
  reviewer: 'review',
  tester: 'test',
  designer: 'design',
  doc: 'docs',
  documenter: 'docs',
  writer: 'docs',
});

/**
 * Steps with each role resolved to a known role id. Returns `{ steps }`, or `{ error }` naming the first
 * unknown role and the valid ids. Steps that are not objects or have no string role are left for the plan's
 * own validation.
 */
export function resolvePlanRoles(steps, roleIds) {
  if (!Array.isArray(steps)) return { steps };
  const known = new Set(roleIds);
  const out = [];
  for (const [i, s] of steps.entries()) {
    if (!s || typeof s !== 'object' || typeof s.role !== 'string' || !s.role.trim()) {
      out.push(s);
      continue;
    }
    const raw = s.role.trim();
    const key = raw.toLowerCase();
    const id = known.has(raw) ? raw : known.has(key) ? key : known.has(ROLE_ALIASES[key]) ? ROLE_ALIASES[key] : null;
    if (!id) {
      const name = typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`;
      return { error: `단계 ${name}의 역할 "${raw.slice(0, 40)}"을 몰라요. 쓸 수 있는 역할: ${roleIds.join(', ')}` };
    }
    out.push(id === s.role ? s : { ...s, role: id });
  }
  return { steps: out };
}
