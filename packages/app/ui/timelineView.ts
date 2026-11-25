import { activeLesson, isKind, offerCardSchema, pendingLessonError, type Mode, type TimelineEntry, type TimelineEntryOf } from "@aha/contracts";
/** A tool call's state as the Trace line shows it. */
export type ToolState = "running" | "completed" | "error";
type ToolItem = { type: "tool"; key: string; toolName: string; args: Record<string, unknown>; state: ToolState; output?: string };

/** What the chat shows: Timeline entries folded into messages that may still be streaming, and tool calls with their results. */
export type ViewItem =
  | { type: "agent_message"; key: string; text: string; streaming: boolean }
  | ToolItem
  | { type: "entry"; key: string; entry: TimelineEntry };

export type ConversationItem =
  | ViewItem
  | { type: "agent_turn"; key: string; parts: ViewItem[]; pending: boolean };

const HIDDEN = new Set<TimelineEntry["kind"]>(["session_start", "session_end", "lesson_start", "lesson_card", "answer_assessment", "explanation_flagged", "mode_change", "lesson_answer_recovered"]);

export function toViewItems(entries: readonly TimelineEntry[]): ViewItem[] {
  const items: ViewItem[] = [];
  const messages = new Map<string, Extract<ViewItem, { type: "agent_message" }>>();
  const tools = new Map<string, Extract<ViewItem, { type: "tool" }>>();

  for (const entry of entries) {
    switch (entry.kind) {
      case "impasse":
        // Only an actual Offer surfaces an automatically detected Impasse in the conversation.
        if (entry.impasse.trigger !== "detected") {
          items.push({ type: "entry", key: entry.id, entry });
        }
        break;
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

/** Keep agent text, tool actions and the resulting edits in their Timeline order within a reply. */
export function conversationItems(entries: readonly TimelineEntry[], showPending: boolean): ConversationItem[] {
  const items = toViewItems(entries);
  const request = showPending && entries.findLast((entry) => entry.kind === "user_message" && entry.source === "agent-host");
  const pendingId = request && !entries.some((entry) => entry.seq > request.seq &&
    (entry.kind === "session_end" || (entry.kind === "unknown_agent_event" && entry.agentEventType === "agent_settled")))
    ? request.id : undefined;
  const grouped: ConversationItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    grouped.push(item);
    if (item.type !== "entry" || item.entry.kind !== "user_message" || item.entry.source !== "agent-host") continue;

    const parts: ViewItem[] = [];
    let next = items[index + 1];
    while (next && (next.type !== "entry" || (next.entry.source === "agent-host" &&
      (next.entry.kind === "file_edit" || (next.entry.kind === "error" && next.entry.origin === "tool"))))) {
      parts.push(next);
      index++;
      next = items[index + 1];
    }

    const pending = !next && item.key === pendingId && !parts.some((part) => part.type === "agent_message");
    if (parts.length || pending) {
      grouped.push({ type: "agent_turn", key: item.key + ":reply", parts, pending });
    }
  }
  return grouped;
}

/** What the session's Mode allows on screen. The backend enforces the same rules; this keeps the buttons honest. */
export interface SessionView {
  mode: Mode;
  modeChange?: TimelineEntryOf<"mode_change">;
  defaultTab: "explain" | "preview";
  lessonReady: boolean;
  /** The running Lesson's display title, in learning mode. */
  lessonTitle?: string;
  /** Why, Ask why and the Offer buttons work only in work mode, so a second Lesson can never start. */
  canStartLesson: boolean;
  /** True when an entry's card or buttons can no longer be used: already answered, or not part of the running Lesson. */
  isDone(entry: TimelineEntry): boolean;
  /** True for the one `lesson_error` whose answer can be retried now. */
  canRetry(entry: TimelineEntry): boolean;
}

export function sessionView(entries: readonly TimelineEntry[]): SessionView {
  const modeChange = entries.findLast((entry) => isKind(entry, "mode_change"));
  const mode = modeChange?.mode ?? "work";
  const lesson = activeLesson(entries);
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const impasse = entries.find((e) => e.kind === "impasse" && e.impasse.id === lesson?.impasseId);
  const offer = entries.findLast((e) => e.kind === "offer" && e.impasseId === lesson?.impasseId);
  const offerRoot = offer?.kind === "offer" ? offer.card.elements[offer.card.root] : undefined;
  const offerProps = offerRoot?.type === "OfferCard" ? offerCardSchema.safeParse(offerRoot.props) : undefined;
  const impasseTitle = impasse?.kind === "impasse" ? impasse.impasse.text ?? impasse.impasse.title : undefined;
  const lessonTitle = offerProps?.success ? offerProps.data.title : impasseTitle;
  const canStartLesson = mode === "work";
  const retryable = pendingLessonError(entries);
  return {
    mode,
    ...(modeChange && { modeChange }),
    defaultTab: mode === "learning" || completedOnExplanation(entries, modeChange) ? "explain" : "preview",
    lessonReady: Boolean(lesson?.lessonId),
    ...(lessonTitle === undefined ? {} : { lessonTitle }),
    canStartLesson,
    isDone(entry) {
      if (entry.kind === "offer") return responded.has(entry.impasseId) || !canStartLesson;
      if (entry.kind === "lesson_card") {
        return answered.has(entry.id) || entry.lessonId !== lesson?.lessonId || entry.seq < (lesson.startSeq ?? Infinity);
      }
      return false;
    },
    canRetry: (entry) => entry.id === retryable?.id,
  };
}

function completedOnExplanation(entries: readonly TimelineEntry[], modeChange?: TimelineEntryOf<"mode_change">): boolean {
  if (!modeChange) return false;
  const beforeWork = entries.slice(0, modeChange.seq);
  const lesson = activeLesson(beforeWork);
  const startSeq = lesson?.startSeq;
  if (startSeq === undefined || lesson?.impasseId !== modeChange.impasseId) return false;

  const end = beforeWork.findLast((entry): entry is TimelineEntryOf<"lesson_end"> =>
    entry.kind === "lesson_end" && entry.lessonId === lesson.lessonId && entry.seq > startSeq,
  );
  if (end?.outcome !== "completed") return false;

  const cards = beforeWork.filter((entry): entry is TimelineEntryOf<"lesson_card"> =>
    entry.kind === "lesson_card" && entry.lessonId === lesson.lessonId && entry.seq > startSeq && entry.seq < end.seq,
  );
  return cards.at(-1)?.step === "explain" && cards.every((card) => card.step !== "articulate");
}
