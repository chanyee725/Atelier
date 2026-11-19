// Rows of the dashboard's 사용량 tab (#819): tokens and cost per provider and model from the run records' daily usage
// (GET /api/usage, the same numbers as the 세션 보드's 사용량 screen). Numbers only. Pure, so node --test checks it.
import type { UsageDay } from '../../../shared/dispatch/types.ts';

export type ModelUse = { id: string; label: string; input: number; output: number; tokens: number; cost: number };
export type ProviderUse = { provider: string; tokens: number; cost: number; models: ModelUse[] };
type Known = { id: string; label?: string; provider?: string };

/** Provider of a model id when the server's model list no longer has it (an older run): by its name. */
export function providerByName(id: string): string {
  const m = id.toLowerCase();
  if (m.startsWith('gemini')) return 'gemini';
  if (/^(claude|opus|sonnet|haiku|fable)/.test(m)) return 'claude';
  if (/^(gpt|codex|o\d)/.test(m)) return 'openai';
  return 'other';
}

const ORDER = ['claude', 'openai', 'gemini'];

/**
 * The last `days` days (default 7) summed per model, grouped by provider: Claude, Codex, Gemini, then anything else,
 * each with its models by cost then tokens. Tokens are input (new and cached) plus output. Models with no tokens and no
 * cost are left out. Gemini reports no cost, so its cost stays 0 (shown as unknown).
 */
export function usageByProvider(list: readonly UsageDay[], known: readonly Known[] = [], days = 7): ProviderUse[] {
  const byId = new Map(known.map((m) => [m.id, m]));
  const sums = new Map<string, ModelUse>();
  for (const d of list.slice(-days)) {
    for (const [id, u] of Object.entries(d.models ?? {})) {
      const t = sums.get(id) ?? { id, label: byId.get(id)?.label || id, input: 0, output: 0, tokens: 0, cost: 0 };
      t.input += (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
      t.output += u.output || 0;
      t.tokens = t.input + t.output;
      t.cost += u.cost || 0;
      sums.set(id, t);
    }
  }
  const groups = new Map<string, ProviderUse>();
  for (const m of sums.values()) {
    if (!m.tokens && !m.cost) continue;
    const provider = byId.get(m.id)?.provider || providerByName(m.id);
    const g = groups.get(provider) ?? { provider, tokens: 0, cost: 0, models: [] };
    g.tokens += m.tokens;
    g.cost += m.cost;
    g.models.push(m);
    groups.set(provider, g);
  }
  const rank = (p: string) => (ORDER.includes(p) ? ORDER.indexOf(p) : ORDER.length);
  return [...groups.values()]
    .map((g) => ({ ...g, models: g.models.sort((a, b) => b.cost - a.cost || b.tokens - a.tokens) }))
    .sort((a, b) => rank(a.provider) - rank(b.provider) || b.cost - a.cost);
}
