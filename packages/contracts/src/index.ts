/**
 * Shared contracts for Aha: the only package every module depends on (ADR-0002).
 * Types, module interfaces and fixtures are added in sub-ticket 2.2.
 */
export const MODULE_NAMES = [
  "agent-host",
  "app",
  "decisions",
  "learner-model",
  "teaching",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];
