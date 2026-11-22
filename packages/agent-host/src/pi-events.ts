import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Timeline } from "@aha/contracts";
import type { PiRecord } from "./rpc-connection.ts";

export const LOGIN_HINT = "Run `pi auth login <provider>` in a terminal (or `/login` inside pi), then start Aha again.";

/**
 * Pi events whose content reaches the Timeline through other events, so they add no entry of their own:
 * run and turn boundaries, the user's own message (the agent host appends it when sending), partial tool output,
 * and queue state.
 */
const STRUCTURAL = new Set([
  "agent_start",
  "agent_end",
  "agent_settled",
  "turn_start",
  "turn_end",
  "tool_execution_update",
  "queue_update",
]);

/** Pi tools that change one file, named by their `path` argument. */
const FILE_TOOLS = new Set(["write", "edit"]);
const AUTH_FAILURE = /\b401\b|unauthori[sz]ed|authenticat|invalid.*api key|api key.*invalid/i;

type Message = { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
type ContentBlock = { type?: string; text?: string };

/**
 * Turns Pi's RPC records (`pi --mode rpc` stdout: session events and extension UI requests) into Timeline entries.
 * Every record either maps to an entry, is structural (see STRUCTURAL), or is kept as `unknown_agent_event`.
 */
export function createPiEventMapper({ projectDir, timeline }: { projectDir: string; timeline: Timeline }) {
  const root = resolve(projectDir);
  let messages = 0;
  let currentMessageId: string | undefined;
  const pendingEdits = new Map<string, { path: string; change: "create" | "modify" }>();
  const append: Timeline["append"] = (entry) => timeline.append(entry);
  const keep = (record: PiRecord) =>
    append({ kind: "unknown_agent_event", source: "agent-host", agentEventType: String(record.type), raw: record });

  /** Project-relative path, or undefined when the path is outside the project. */
  const projectPath = (path: unknown) => {
    if (typeof path !== "string" || path === "") return undefined;
    const rel = relative(root, resolve(root, path));
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? undefined : rel.split("\\").join("/");
  };

  return function map(record: PiRecord): void {
    if (STRUCTURAL.has(record.type)) return;
    switch (record.type) {
      case "message_start": {
        const message = record.message as Message | undefined;
        if (message?.role === "assistant") currentMessageId = `pi-msg-${++messages}`;
        return;
      }
      case "message_update": {
        const update = record.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
        if (update?.type !== "text_delta" || typeof update.delta !== "string") return; // thinking and tool-call argument streams
        currentMessageId ??= `pi-msg-${++messages}`;
        append({ kind: "agent_message_delta", source: "agent-host", messageId: currentMessageId, delta: update.delta });
        return;
      }
      case "message_end": {
        const message = record.message as Message | undefined;
        if (message?.role !== "assistant") return; // user, tool-result and system messages arrive through other events
        const messageId = currentMessageId ?? `pi-msg-${++messages}`;
        currentMessageId = undefined;
        const text = textOf(message.content);
        if (text) append({ kind: "agent_message", source: "agent-host", messageId, text });
        if (message.stopReason === "error") {
          const detail = message.errorMessage ?? "unknown error";
          const hint = AUTH_FAILURE.test(detail) ? ` Pi's login may have expired or its key is invalid. ${LOGIN_HINT}` : "";
          append({ kind: "error", source: "agent-host", origin: "agent", message: `The model request failed: ${detail}${hint}` });
        }
        return;
      }
      case "tool_execution_start": {
        const toolCallId = String(record.toolCallId);
        const toolName = String(record.toolName);
        const args = (record.args && typeof record.args === "object" ? record.args : {}) as Record<string, unknown>;
        append({ kind: "tool_call", source: "agent-host", toolCallId, toolName, args });
        const path = FILE_TOOLS.has(toolName) ? projectPath(args.path) : undefined;
        if (path) pendingEdits.set(toolCallId, { path, change: toolName === "write" && !existsSync(resolve(root, path)) ? "create" : "modify" });
        return;
      }
      case "tool_execution_end": {
        const toolCallId = String(record.toolCallId);
        const toolName = String(record.toolName);
        const result = record.result as { content?: unknown; details?: { patch?: unknown } } | undefined;
        const output = textOf(result?.content);
        const isError = record.isError === true;
        append({ kind: "tool_result", source: "agent-host", toolCallId, toolName, output, isError });
        const edit = pendingEdits.get(toolCallId);
        pendingEdits.delete(toolCallId);
        if (isError) {
          append({ kind: "error", source: "agent-host", origin: "tool", message: output || `${toolName} failed`, toolCallId, ...(edit ? { path: edit.path } : {}) });
        } else if (edit) {
          const diff = typeof result?.details?.patch === "string" ? result.details.patch : undefined;
          append({ kind: "file_edit", source: "agent-host", ...edit, toolCallId, ...(diff ? { diff } : {}) });
        }
        return;
      }
      case "auto_retry_end":
        if (record.success === false) {
          append({ kind: "error", source: "agent-host", origin: "agent", message: `The model request failed after retrying: ${String(record.finalError ?? "unknown error")}` });
        } else keep(record);
        return;
      case "extension_error":
        append({ kind: "error", source: "agent-host", origin: "agent", message: `A Pi extension failed (${String(record.event)}): ${String(record.error)}` });
        return;
      default:
        keep(record);
    }
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n");
}
