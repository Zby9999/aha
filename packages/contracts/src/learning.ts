/** Learning-moment and learner-model vocabulary from GLOSSARY.md. */

/** Stable id of a Concept, e.g. "auth-session-persistence". Lowercase kebab-case. */
export type ConceptId = string;

/** The five ordered Mastery Levels, lowest first. */
export const MASTERY_LEVELS = [
  "not_encountered",
  "seen_explanation",
  "correct_with_hints",
  "explains_independently",
  "catches_agent_mistakes",
] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

/** What started an Impasse: the Why button, a "teach me this" request, or detection of a repeated gap. */
export type ImpasseTrigger = "why" | "teach_me" | "detected";

export interface Impasse {
  id: string;
  trigger: ImpasseTrigger;
  /** Short human-readable title, e.g. "Why the profile disappears after refresh". */
  title: string;
  /** Concepts the Impasse is about, when known. */
  conceptIds: ConceptId[];
  /** Timeline entries that caused it: the change behind a Why, or the repeated errors. */
  sourceEntryIds: string[];
  /** The user's own words, for teach_me. */
  text?: string;
}

export const LESSON_STEPS = ["probe", "explain", "articulate"] as const;
export type LessonStep = (typeof LESSON_STEPS)[number];
/** Steps whose card the user answers. */
export type AnsweredStep = Exclude<LessonStep, "explain">;

export type OfferResponse = "accept" | "decline" | "let_agent_continue";

/**
 * Behavioural evidence types. Self-report is never Evidence, and declining an Offer is never Evidence.
 */
export type EvidenceType =
  | "probe_result"
  | "articulation"
  | "fix_judgement"
  | "caught_agent_mistake"
  | "independent_fix"
  | "repeated_gap";

export type EvidenceOutcome = "positive" | "negative";
export type EvidenceStrength = "weak" | "moderate" | "strong";

export interface Evidence {
  id: string;
  conceptId: ConceptId;
  type: EvidenceType;
  /** Positive: shows understanding. Negative: shows a gap. */
  outcome: EvidenceOutcome;
  strength: EvidenceStrength;
  sessionId: string;
  /** Timeline entries the Evidence was observed in. */
  entryIds: string[];
  /** ISO 8601 time it was observed. */
  at: string;
  /** One sentence describing what the user did. */
  note: string;
}

export interface Concept {
  id: ConceptId;
  name: string;
  mastery: MasteryLevel;
  evidence: Evidence[];
  /** Project-relative paths of files where the Concept shows up. */
  relatedFiles: string[];
  /** True when the user edited this Concept; Dreaming must not overwrite their edits. */
  userEdited: boolean;
}

export type ConceptSummary = Pick<Concept, "id" | "name" | "mastery">;

/** The slice of the Learner Model chosen by the read gate for the current Impasse. */
export interface LearnerContext {
  concepts: Concept[];
}

/** A cited location in the user's project. */
export interface Citation {
  /** Project-relative path, e.g. "src/auth.js". */
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface ProjectSnapshot {
  /** Absolute path of the user's project folder. */
  projectDir: string;
  /** Project-relative paths of every file in the project (excluding dependencies). */
  files: string[];
}
