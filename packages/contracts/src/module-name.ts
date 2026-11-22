export const MODULE_NAMES = ["agent-host", "app", "decisions", "learner-model", "teaching"] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];
