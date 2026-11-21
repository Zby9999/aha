import type { TimelineEntry } from "@aha/contracts";
/** Matches `ToolState` of the AI Elements Tool component. */
export type ToolState = "running" | "completed" | "error";

/** What the chat shows: Timeline entries folded into messages that may still be streaming, and tool calls with their results. */
export type ViewItem =
  | { type: "agent_message"; key: string; text: string; streaming: boolean }
  | { type: "tool"; key: string; toolName: string; args: Record<string, unknown>; state: ToolState; output?: string }
  | { type: "entry"; key: string; entry: TimelineEntry };

const HIDDEN = new Set<TimelineEntry["kind"]>(["session_start", "session_end", "lesson_start", "answer_assessment", "explanation_flagged"]);

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
