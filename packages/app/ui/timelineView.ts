import { activeLesson, type Mode, type TimelineEntry } from "@aha/contracts";
/** A tool call's state as the Trace line shows it. */
export type ToolState = "running" | "completed" | "error";

/** What the chat shows: Timeline entries folded into messages that may still be streaming, and tool calls with their results. */
export type ViewItem =
  | { type: "agent_message"; key: string; text: string; streaming: boolean }
  | { type: "tool"; key: string; toolName: string; args: Record<string, unknown>; state: ToolState; output?: string }
  | { type: "entry"; key: string; entry: TimelineEntry };

const HIDDEN = new Set<TimelineEntry["kind"]>(["session_start", "session_end", "lesson_start", "lesson_card", "answer_assessment", "explanation_flagged", "mode_change"]);

export function toViewItems(entries: readonly TimelineEntry[]): ViewItem[] {
  const items: ViewItem[] = [];
  const messages = new Map<string, Extract<ViewItem, { type: "agent_message" }>>();
  const tools = new Map<string, Extract<ViewItem, { type: "tool" }>>();

  for (const entry of entries) {
    switch (entry.kind) {
      case "agent_message_delta": {
        const message = messages.get(entry.messageId);
        if (message) message.text += entry.delta;
        else {
          const item = { type: "agent_message" as const, key: entry.id, text: entry.delta, streaming: true };
          messages.set(entry.messageId, item);
          items.push(item);
        }
        break;
      }
      case "agent_message": {
        const message = messages.get(entry.messageId);
        if (message) Object.assign(message, { text: entry.text, streaming: false });
        else items.push({ type: "agent_message", key: entry.id, text: entry.text, streaming: false });
        break;
      }
      case "tool_call": {
        const item = { type: "tool" as const, key: entry.id, toolName: entry.toolName, args: entry.args, state: "running" as ToolState };
        tools.set(entry.toolCallId, item);
        items.push(item);
        break;
      }
      case "tool_result": {
        const tool = tools.get(entry.toolCallId);
        if (tool) Object.assign(tool, { state: entry.isError ? "error" : "completed", output: entry.output });
        break;
      }
      default:
        if (!HIDDEN.has(entry.kind)) items.push({ type: "entry", key: entry.id, entry });
    }
  }
  return items;
}

/** What the session's Mode allows on screen. The backend enforces the same rules; this keeps the buttons honest. */
export interface SessionView {
  mode: Mode;
  lessonReady: boolean;
  /** The running Lesson's Impasse title, in learning mode. */
  lessonTitle?: string;
  /** Why, Ask why and the Offer buttons work only in work mode, so a second Lesson can never start. */
  canStartLesson: boolean;
  /** True when an entry's card or buttons can no longer be used: already answered, or not part of the running Lesson. */
  isDone(entry: TimelineEntry): boolean;
}

export function sessionView(entries: readonly TimelineEntry[]): SessionView {
  const modeChange = entries.findLast((entry) => entry.kind === "mode_change");
  const mode = modeChange?.mode ?? "work";
  const lesson = activeLesson(entries);
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const impasse = entries.find((e) => e.kind === "impasse" && e.impasse.id === lesson?.impasseId);
  const canStartLesson = mode === "work";
  return {
    mode,
    lessonReady: Boolean(lesson?.lessonId),
    ...(impasse?.kind === "impasse" ? { lessonTitle: impasse.impasse.text ?? impasse.impasse.title } : {}),
    canStartLesson,
    isDone(entry) {
      if (entry.kind === "offer") return responded.has(entry.impasseId) || !canStartLesson;
      if (entry.kind === "lesson_card") {
        return answered.has(entry.id) || entry.lessonId !== lesson?.lessonId || entry.seq <= (modeChange?.seq ?? -1);
      }
      return false;
    },
  };
}
