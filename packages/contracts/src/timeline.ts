import type { CardAnswer, CardSpec } from "./cards.ts";
import type { ModuleName } from "./modules.ts";
import type { Impasse, LessonStep } from "./learning.ts";

/**
 * The Timeline: the single, agent-independent record of a session.
 * It is the only runtime data shared by all modules (ADR-0002).
 */

export const TIMELINE_VERSION = 1 as const;

/** Payload of each Timeline entry kind. Adding a kind or field is a contracts change. */
export interface TimelinePayloads {
  session_start: { projectDir: string };
  session_end: { reason: "user" | "idle" | "agent_exit" };

  // Agent events, written by the agent host.
  user_message: { text: string };
  agent_message: { text: string };
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
  offer: { impasseId: string; card: CardSpec };
  offer_response: { impasseId: string; response: "accept" | "decline" | "let_agent_continue" };
  lesson_start: { lessonId: string; impasseId: string };
  lesson_card: { lessonId: string; step: LessonStep; card: CardSpec };
  card_answer: { lessonId: string; cardEntryId: string; step: LessonStep; answer: CardAnswer };
  /** Teaching's judgement of a Probe or Articulation answer; the evidence write gate reads it. */
  answer_assessment: {
    lessonId: string;
    answerEntryId: string;
    step: "probe" | "articulate";
    result: "correct" | "partial" | "incorrect";
  };
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
  /** Every entry so far, in seq order. */
  entries(): readonly TimelineEntry[];
  append(entry: NewTimelineEntry): TimelineEntry;
  /** Called for each entry appended after subscribing. Returns an unsubscribe function. */
  subscribe(listener: TimelineListener): () => void;
}

export function isKind<K extends TimelineKind>(entry: TimelineEntry, kind: K): entry is Extract<TimelineEntry, { kind: K }> {
  return entry.kind === kind;
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
    entries.push(entry);
  });
  return {
    sessionId,
    entries: () => entries,
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
