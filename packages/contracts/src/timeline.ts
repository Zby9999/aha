import type { CardAnswer, CardSpec } from "./cards.ts";
import type { AnsweredStep, ConceptId, Impasse, LessonStep, Mode, OfferResponse } from "./learning.ts";
import type { ModuleName } from "./module-name.ts";

/**
 * The Timeline: the single, agent-independent record of a session.
 * It is the only runtime data shared by all modules (ADR-0002).
 */

export const TIMELINE_VERSION = 1 as const;

/** Payload of each Timeline entry kind. Adding a kind or field is a contracts change. */
export interface TimelinePayloads {
  session_start: { projectDir: string };
  /** Written by the app, or by the agent host with reason "agent_exit" when Pi exits or crashes (after an `error` entry). */
  session_end: { reason: "user" | "idle" | "agent_exit" };

  // Agent events, written by the agent host.
  user_message: { text: string };
  /** A chunk of an agent reply while it streams, for live display. The complete text follows as agent_message with the same messageId. */
  agent_message_delta: { messageId: string; delta: string };
  agent_message: { messageId: string; text: string };
  tool_call: { toolCallId: string; toolName: string; args: Record<string, unknown> };
  tool_result: { toolCallId: string; toolName: string; output: string; isError: boolean };
  /** A change to a project file. `path` is project-relative. */
  file_edit: { path: string; change: "create" | "modify" | "delete"; toolCallId?: string; diff?: string };
  /** An error from the agent, a tool, or the running project (e.g. a browser console error in the preview). */
  error: { origin: "agent" | "tool" | "project"; message: string; path?: string; toolCallId?: string };
  /** An agent event with no mapping yet. Kept, never dropped. */
  unknown_agent_event: { agentEventType: string; raw: unknown };

  // Learning, written by the app, decisions and teaching.
  impasse: { impasse: Impasse };
  /**
   * The session's Mode changed; written by the app, which owns the Mode. "learning" is written when a Lesson is
   * requested for the Impasse (accepting its Offer, Why or Ask why), before teaching starts it. "work" is written when
   * that Lesson ends, completed or abandoned (Back to work). The Mode before the first entry is "work".
   */
  mode_change: { mode: Mode; impasseId: string };
  offer: { impasseId: string; card: CardSpec };
  offer_response: { impasseId: string; response: OfferResponse };
  lesson_start: { lessonId: string; impasseId: string };
  lesson_card: { lessonId: string; step: LessonStep; card: CardSpec };
  card_answer: { lessonId: string; cardEntryId: string; step: AnsweredStep; answer: CardAnswer };
  /**
   * Teaching's judgement of a Probe or Articulation answer. It is behavioural Evidence by construction:
   * the backend records one Evidence per Concept for it without asking the write gate whether it is relevant.
   */
  answer_assessment: {
    lessonId: string;
    answerEntryId: string;
    step: AnsweredStep;
    conceptIds: ConceptId[];
    result: "correct" | "partial" | "incorrect";
  };
  /** A composer message sent in learning mode: a follow-up question inside the Lesson. It never reaches the agent. */
  lesson_question: { lessonId: string; text: string };
  /**
   * Teaching failed to take the Lesson on after the user answered a card. The answer stays recorded; the user can
   * retry (`retry_answer`) or go back to work. Written by the app.
   */
  lesson_error: { lessonId: string; cardEntryId: string; message: string };
  explanation_flagged: { lessonId: string; cardEntryId: string; reason?: string };
  lesson_end: { lessonId: string; outcome: "completed" | "abandoned" };
}

export type TimelineKind = keyof TimelinePayloads;

export interface TimelineEntryBase {
  /** Unique within the session. */
  id: string;
  sessionId: string;
  /** Position in the Timeline, starting at 0, with no gaps. */
  seq: number;
  /** ISO 8601 time the entry was appended. */
  at: string;
  version: typeof TIMELINE_VERSION;
  /** Module that wrote the entry. */
  source: ModuleName;
}

export type TimelineEntryOf<K extends TimelineKind> = TimelineEntryBase & { kind: K } & TimelinePayloads[K];

export type TimelineEntry = { [K in TimelineKind]: TimelineEntryOf<K> }[TimelineKind];

/** What a module hands to `Timeline.append`: the Timeline assigns id, sessionId, seq, at and version. */
export type NewTimelineEntry = {
  [K in TimelineKind]: { kind: K; source: ModuleName } & TimelinePayloads[K];
}[TimelineKind];

export type TimelineListener = (entry: TimelineEntry) => void;

export interface Timeline {
  readonly sessionId: string;
  /** A copy of every entry so far, in seq order. */
  entries(): readonly TimelineEntry[];
  append(entry: NewTimelineEntry): TimelineEntry;
  /** Called for each entry appended after subscribing. Returns an unsubscribe function. */
  subscribe(listener: TimelineListener): () => void;
}

export function isKind<K extends TimelineKind>(entry: TimelineEntry, kind: K): entry is Extract<TimelineEntry, { kind: K }> {
  return entry.kind === kind;
}

/**
 * The card whose answer teaching failed to take on and that can be retried: the latest `lesson_error` of the running
 * Lesson with nothing from teaching after it for that answer. Null when there is nothing to retry.
 */
export function pendingLessonError(entries: readonly TimelineEntry[]): TimelineEntryOf<"lesson_error"> | null {
  const lesson = activeLesson(entries);
  const error = entries.findLast((e): e is TimelineEntryOf<"lesson_error"> => e.kind === "lesson_error");
  if (!lesson?.startSeq || !error || error.lessonId !== lesson.lessonId || error.seq < lesson.startSeq) return null;
  const movedOn = entries.some((e) => e.seq > error.seq && e.source === "teaching" && "lessonId" in e && e.lessonId === error.lessonId);
  return movedOn ? null : error;
}

/** The session's current Mode: the last `mode_change`, or "work" before any. */
export function currentMode(entries: readonly TimelineEntry[]): Mode {
  return entries.findLast((e) => e.kind === "mode_change")?.mode ?? "work";
}

/**
 * The Lesson that learning mode is running, or null in work mode. `lessonId` and `startSeq` (the seq of its
 * `lesson_start`) are missing in the short time between entering learning mode and teaching writing `lesson_start`.
 * A card belongs to the running Lesson only if it has the same `lessonId` and a seq after `startSeq`.
 */
export function activeLesson(entries: readonly TimelineEntry[]): { impasseId: string; lessonId?: string; startSeq?: number } | null {
  const change = entries.findLast((e): e is TimelineEntryOf<"mode_change"> => e.kind === "mode_change");
  if (change?.mode !== "learning") return null;
  const start = entries.findLast((e): e is TimelineEntryOf<"lesson_start"> => e.kind === "lesson_start" && e.seq > change.seq && e.impasseId === change.impasseId);
  return start ? { impasseId: change.impasseId, lessonId: start.lessonId, startSeq: start.seq } : { impasseId: change.impasseId };
}

export interface CreateTimelineOptions {
  sessionId: string;
  /** Entries to start from, e.g. a replayed fixture. Must be in seq order starting at 0. */
  initial?: readonly TimelineEntry[];
  /** Clock for `at`; defaults to the current time. */
  now?: () => Date;
}

/** In-memory Timeline. Listeners run synchronously, in subscription order, after the entry is stored. */
export function createTimeline({ sessionId, initial = [], now = () => new Date() }: CreateTimelineOptions): Timeline {
  const entries: TimelineEntry[] = [];
  const listeners = new Set<TimelineListener>();
  initial.forEach((entry, i) => {
    if (entry.seq !== i) throw new Error(`Initial Timeline entry ${entry.id} has seq ${entry.seq}, expected ${i}`);
    if (entry.sessionId !== sessionId) throw new Error(`Initial Timeline entry ${entry.id} belongs to session ${entry.sessionId}, not ${sessionId}`);
    entries.push(entry);
  });
  return {
    sessionId,
    entries: () => [...entries],
    append(newEntry) {
      const seq = entries.length;
      const entry = {
        ...newEntry,
        id: `${sessionId}:${seq}`,
        sessionId,
        seq,
        at: now().toISOString(),
        version: TIMELINE_VERSION,
      } as TimelineEntry;
      entries.push(entry);
      for (const listener of [...listeners]) listener(entry);
      return entry;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
