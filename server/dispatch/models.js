// The app's agent features run one model: Fable 5.2 through the Claude CLI
// (docs/design/fable-only-projects.md). Reading the list starts no process.
export const FABLE_ID = "claude-fable-5-2";
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const FABLE = { id: FABLE_ID, label: "Fable 5.2", provider: "claude", efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: 200000 };

export function staticModels() {
  return [{ ...FABLE }];
}

export async function loadModels() {
  return staticModels();
}
