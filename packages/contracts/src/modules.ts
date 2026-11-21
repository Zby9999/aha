import type { CardAnswer, CardSpec, CatalogComponent } from "./cards.ts";
import type {
  Citation,
  Concept,
  ConceptId,
  ConceptSummary,
  MasteryLevel,
  Evidence,
  Impasse,
  LearnerContext,
  LessonStep,
  ProjectSnapshot,
} from "./learning.ts";
import type { NewTimelineEntry, Timeline, TimelineEntry } from "./timeline.ts";

/**
 * Module interfaces. Each module implements its interface in its own package and receives
 * the others only through these types, wired by the backend (ADR-0002).
 */

// ---------------------------------------------------------------- 1 Agent Host

export type AgentHostErrorCode = "pi_missing" | "not_logged_in" | "start_failed" | "crashed";

/** Thrown (or reported) by the agent host with a message a novice can act on. */
export class AgentHostError extends Error {
  constructor(
    readonly code: AgentHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentHostError";
  }
}

export interface AgentSessionOptions {
  /** Absolute path of the user's project folder; Pi runs there. */
  projectDir: string;
  /** The agent host appends agent events here (user_message, agent_message, tool_call, ...). */
  timeline: Timeline;
}

/**
 * A running agent. If Pi exits or crashes, the agent host appends an `error` entry (origin "agent")
 * and a `session_end` entry with reason "agent_exit"; it never throws into the app.
 */
export interface AgentSession {
  /** Appends a user_message entry and sends it to the agent. Resolves once the agent accepted it, not when it finishes. */
  sendUserMessage(text: string): Promise<void>;
  /** Learner context the bridge extension adds to each following Pi request; null sends requests unchanged. */
  setLearnerContext(context: LearnerContext | null): void;
  /** Stops the agent. Safe to call twice. */
  stop(): Promise<void>;
}

export interface AgentHost {
  startSession(options: AgentSessionOptions): Promise<AgentSession>;
}

// ------------------------------------------------- Restricted Pi session (2.6)

/**
 * Tools a background agent may be given. Shell is deliberately not in the list:
 * a restricted session never has shell access.
 */
export const BACKGROUND_TOOLS = ["read", "grep", "find", "ls", "edit", "write"] as const;
export type BackgroundTool = (typeof BACKGROUND_TOOLS)[number];

export interface BackgroundRunRequest {
  /** Working folder for tools. */
  cwd: string;
  /** Explicit allow-list; nothing else is available. */
  tools: readonly BackgroundTool[];
  /** When `edit` or `write` is allowed, writes are limited to these folders (absolute, or relative to cwd). Defaults to cwd. */
  writableDirs?: readonly string[];
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface BackgroundRunResult {
  /** The agent's final text answer. */
  text: string;
  /** Project-relative or absolute paths the agent wrote. */
  filesWritten: string[];
}

export type BackgroundAgentErrorCode = "not_logged_in" | "tool_not_allowed" | "aborted" | "failed";

export class BackgroundAgentError extends Error {
  constructor(
    readonly code: BackgroundAgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackgroundAgentError";
  }
}

/** Runs restricted Pi sessions with the user's `pi login` credentials. Used by Dreaming and lesson content. */
export interface BackgroundAgent {
  run(request: BackgroundRunRequest): Promise<BackgroundRunResult>;
}

// ----------------------------------------------------------- 3 Decision Layer

/**
 * Every question returns `null` for "no decision" (timeout, error, nothing to say) so the user is never blocked.
 * Callers treat null as the safe default: no Impasse, no Evidence, no Concepts.
 */
export interface DecisionService {
  /** Is the user at an Impasse from a repeated gap? Applies the threshold and the post-decline cooldown. */
  detectImpasse(input: { timeline: readonly TimelineEntry[] }): Promise<ImpasseDetection | null>;
  /** Which of these new entries become Evidence. Prefers existing Concepts over new ones. */
  gateEvidence(input: EvidenceGateInput): Promise<EvidenceDecision[] | null>;
  /** Which stored Concepts are relevant to the Impasse. */
  selectConcepts(input: { impasse: Impasse; concepts: readonly ConceptSummary[] }): Promise<ConceptId[] | null>;
  /** Which catalog component fits this Lesson step. Always returns a component (falls back to a default). */
  chooseComponent(input: ComponentChoiceInput): Promise<CatalogComponent>;
  /** Does the explanation cite the user's project files or the agent's latest change? */
  checkGrounding(input: GroundingInput): Promise<GroundingResult | null>;
}

export interface ImpasseDetection {
  /** Impasse to record on the Timeline, trigger "detected". */
  impasse: Impasse;
  reason: string;
}

export interface EvidenceGateInput {
  timeline: readonly TimelineEntry[];
  /** Entries not yet gated. */
  newEntries: readonly TimelineEntry[];
  concepts: readonly ConceptSummary[];
}

/** An Evidence the gate lets through; the backend adds id, sessionId and time before appending it. */
export interface EvidenceDecision extends Pick<Evidence, "conceptId" | "type" | "outcome" | "strength" | "entryIds" | "note"> {
  /** Set only when no existing Concept fits; then `conceptId` is its id. */
  newConcept?: { id: ConceptId; name: string };
}

export interface ComponentChoiceInput {
  impasse: Impasse;
  step: LessonStep;
  learner: LearnerContext;
}

export interface GroundingInput {
  explanation: CardSpec;
  citations: readonly Citation[];
  project: ProjectSnapshot;
  /** The agent's latest change, when the Lesson is about it. */
  latestChange?: TimelineEntry;
}

export interface GroundingResult {
  grounded: boolean;
  /** Citations whose file does not exist in the project. */
  missingFiles: string[];
  reason: string;
}

// ------------------------------------------------------------ 4 Learner Model

export interface LearnerModelFile {
  /** Path relative to the learner model folder, e.g. "index.md" or "concepts/auth-session-persistence.md". */
  path: string;
  markdown: string;
}

export interface DreamingReport {
  /** Path (relative to the learner model folder) of the change log entry this run wrote. */
  changeLogPath: string;
  merged: { from: ConceptId[]; into: ConceptId }[];
  masteryChanges: { conceptId: ConceptId; from: MasteryLevel; to: MasteryLevel }[];
  /** Concepts left untouched because the user edited them. */
  skippedUserEdits: ConceptId[];
}

/**
 * The per-user, per-project Learner Model, stored as Markdown in the project folder.
 * A store for a project without a model starts from the seed Concepts.
 */
export interface LearnerModelStore {
  /** Appends to the session log only; never rewrites Concept files. Called only via the evidence write gate. */
  appendEvidence(evidence: Evidence): Promise<void>;
  listConcepts(): Promise<ConceptSummary[]>;
  /** Full Concepts (Mastery Level, Evidence, related files) for the given ids; unknown ids are skipped. */
  readConcepts(ids: readonly ConceptId[]): Promise<Concept[]>;
  /** Learner model panel: every file of the model. */
  readFiles(): Promise<LearnerModelFile[]>;
  /** Learner model panel: a user edit. User edits take precedence over Dreaming. */
  writeFile(file: LearnerModelFile): Promise<void>;
  /** Consolidates the model; the only writer of Concept files besides the user. */
  dream(trigger: "session_end" | "idle"): Promise<DreamingReport>;
}

export interface LearnerModelOptions {
  projectDir: string;
  background: BackgroundAgent;
}

export type LearnerModelFactory = (options: LearnerModelOptions) => LearnerModelStore;

// --------------------------------------------------------- 5 Teaching & GenUI

export interface LessonInput {
  impasse: Impasse;
  learner: LearnerContext;
  project: ProjectSnapshot;
  timeline: readonly TimelineEntry[];
}

/**
 * Drives each Lesson as a state machine: Probe → Explain → Articulate → back to work.
 * Methods return the entries to append (lesson_card, answer_assessment, lesson_end, ...);
 * the backend appends them, so Teaching never writes the Timeline itself.
 */
export interface Teaching {
  /** The Offer card for a detected Impasse, or null when the Mastery Level says not to interrupt. */
  offer(input: { impasse: Impasse; learner: LearnerContext }): Promise<CardSpec | null>;
  startLesson(input: LessonInput): Promise<NewTimelineEntry[]>;
  answer(input: { lessonId: string; cardEntryId: string; answer: CardAnswer; timeline: readonly TimelineEntry[] }): Promise<NewTimelineEntry[]>;
  /** Back to work without Evidence. */
  abandon(lessonId: string): Promise<NewTimelineEntry[]>;
}

export interface TeachingOptions {
  decisions: Pick<DecisionService, "chooseComponent" | "checkGrounding">;
  background: BackgroundAgent;
}

export type TeachingFactory = (options: TeachingOptions) => Teaching;


// ------------------------------------------------------------ Wiring

/** Everything the backend needs to run a session. Each field can be a stub or a real implementation. */
export interface AhaModules {
  agentHost: AgentHost;
  decisions: DecisionService;
  learnerModel: LearnerModelFactory;
  teaching: TeachingFactory;
  background: BackgroundAgent;
}
