import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { NewTimelineEntry, Timeline } from "@aha/contracts";
import type { PiRecord } from "./rpc-connection.ts";

export const LOGIN_HINT = "Run `pi auth login <provider>` in a terminal (or `/login` inside pi), then start Aha again.";

/**
 * Pi events whose content reaches the Timeline through other events, so they add no entry of their own:
 * run and turn boundaries, partial tool output (the full output follows in tool_execution_end), and the queue of
 * messages the user already sent (each is on the Timeline as a user_message). An aborted `agent_settled` is kept.
 */
const STRUCTURAL = new Set(["agent_start", "agent_end", "turn_start", "turn_end", "tool_execution_update", "queue_update"]);

/** Pi tools that change one file, named by their `path` argument. */
const FILE_TOOLS = new Set(["write", "edit"]);
/** A `write` target born this recently counts as created by it (see isNew). */
const NEW_FILE_WINDOW_MS = 3000;
const AUTH_FAILURE = /\b401\b|unauthori[sz]ed|authenticat|invalid.*api key|api key.*invalid/i;
/** Separates text blocks in one reply, in both the streamed deltas and the final text. */
const BLOCK_SEPARATOR = "\n\n";

type Message = { role?: string; content?: unknown; stopReason?: string; errorMessage?: string };
type ContentBlock = { type?: string; text?: string };
/** A Timeline entry without its `source`, which is always the agent host here. */
type Entry = NewTimelineEntry extends infer E ? (E extends NewTimelineEntry ? Omit<E, "source"> : never) : never;

/**
 * Turns Pi's RPC records (`pi --mode rpc` stdout: session events and extension UI requests) into Timeline entries.
 * Every record either maps to an entry, is structural (see STRUCTURAL), or is kept as `unknown_agent_event`.
 * Only Pi's own `write` and `edit` tools produce `file_edit`; files a shell command changes are not detected.
 */
export function createPiEventMapper({ projectDir, timeline }: { projectDir: string; timeline: Timeline }) {
  const root = resolve(projectDir);
  let messages = 0;
  let reply: { id: string; textBlocks: number } | undefined;
  /** A failed model request's error, held back until we know whether Pi retries it. */
  let heldError: string | undefined;
  /** Whether the latest failed model request was refused for its credentials, kept across retries. */
  let authFailed = false;
  const pendingEdits = new Map<string, { path: string; change: "create" | "modify" }>();

  const append = (entry: Entry) => void timeline.append({ ...entry, source: "agent-host" } as NewTimelineEntry);
  const keep = (record: PiRecord) => append({ kind: "unknown_agent_event", agentEventType: String(record.type), raw: record });
  const agentError = (message: string) => append({ kind: "error", origin: "agent", message });
  const currentReply = () => (reply ??= { id: `pi-msg-${++messages}`, textBlocks: 0 });

  /** Project-relative path as Pi's tools resolve it (leading `@` stripped, `~` expanded), or undefined outside the project. */
  const projectPath = (path: unknown) => {
    if (typeof path !== "string" || path === "") return undefined;
    const cleaned = path.replace(/^@/, "").replace(/^~(?=$|[\\/])/, homedir());
    const rel = relative(root, resolve(root, cleaned));
    const outside = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    return outside ? undefined : rel.split(sep).join("/");
  };

  return function map(record: PiRecord): void {
    // Pi announces a retry right after the failed attempt's message_end; anything else means no retry follows.
    if (heldError !== undefined && record.type !== "auto_retry_start" && record.type !== "auto_retry_end") {
      agentError(heldError);
      heldError = undefined;
    }
    if (STRUCTURAL.has(record.type)) return;
    switch (record.type) {
      case "message_start":
        if ((record.message as Message | undefined)?.role === "assistant") {
          reply = undefined;
          currentReply();
        }
        return;
      case "message_update": {
        const update = record.assistantMessageEvent as { type?: string; delta?: unknown } | undefined;
        if (update?.type === "text_start") {
          const current = currentReply();
          if (current.textBlocks++ > 0) append({ kind: "agent_message_delta", messageId: current.id, delta: BLOCK_SEPARATOR });
        }
        // Thinking and tool-call argument streams are not shown.
        if (update?.type === "text_delta" && typeof update.delta === "string") {
          append({ kind: "agent_message_delta", messageId: currentReply().id, delta: update.delta });
        }
        return;
      }
      case "message_end": {
        const message = record.message as Message | undefined;
        if (message?.role !== "assistant") return; // user, tool-result and system messages arrive through other events
        const messageId = currentReply().id;
        reply = undefined;
        const text = textOf(message.content, BLOCK_SEPARATOR);
        if (text) append({ kind: "agent_message", messageId, text });
        if (message.stopReason === "error") {
          const detail = message.errorMessage ?? "unknown error";
          authFailed = AUTH_FAILURE.test(detail);
          const hint = authFailed ? ` Pi's login may have expired or its key is invalid. ${LOGIN_HINT}` : "";
          heldError = `The model request failed: ${detail}${hint}`;
        }
        return;
      }
      case "tool_execution_start": {
        const { toolCallId, toolName } = record;
        if (typeof toolCallId !== "string" || typeof toolName !== "string") return keep(record);
        const args = (record.args && typeof record.args === "object" ? record.args : {}) as Record<string, unknown>;
        append({ kind: "tool_call", toolCallId, toolName, args });
        const path = FILE_TOOLS.has(toolName) ? projectPath(args.path) : undefined;
        if (path) pendingEdits.set(toolCallId, { path, change: toolName === "write" && isNew(resolve(root, path)) ? "create" : "modify" });
        return;
      }
      case "tool_execution_end": {
        const { toolCallId, toolName } = record;
        if (typeof toolCallId !== "string" || typeof toolName !== "string") return keep(record);
        const result = record.result as { content?: unknown; details?: { patch?: unknown } } | undefined;
        const output = textOf(result?.content, "\n");
        const isError = record.isError === true;
        append({ kind: "tool_result", toolCallId, toolName, output, isError });
        const edit = pendingEdits.get(toolCallId);
        pendingEdits.delete(toolCallId);
        if (isError) {
          append({ kind: "error", origin: "tool", message: output || `${toolName} failed`, toolCallId, ...(edit ? { path: edit.path } : {}) });
        } else if (edit) {
          const diff = typeof result?.details?.patch === "string" ? result.details.patch : undefined;
          append({ kind: "file_edit", ...edit, toolCallId, ...(diff ? { diff } : {}) });
        }
        return;
      }
      case "auto_retry_start":
        heldError = undefined; // Pi retries; only the final outcome counts.
        return keep(record);
      case "auto_retry_end":
        if (record.success === false) {
          const hint = authFailed ? ` ${LOGIN_HINT}` : "";
          heldError = undefined;
          return agentError(`The model request failed after retrying: ${String(record.finalError ?? "unknown error")}${hint}`);
        }
        heldError = undefined;
        return keep(record);
      case "agent_settled":
        if (record.aborted === true) keep(record);
        return;
      case "compaction_end":
        if (typeof record.errorMessage === "string") return agentError(`Pi could not compact the conversation: ${record.errorMessage}`);
        return keep(record);
      case "extension_error":
        return agentError(`A Pi extension failed (${String(record.event)}): ${String(record.error)}`);
      default:
        return keep(record);
    }
  };
}

/**
 * Whether a `write` creates the file. Pi's records are read asynchronously, so by the time `tool_execution_start` is
 * handled the tool may already have written the file: a file born in the last few seconds counts as new too.
 */
function isNew(absolutePath: string): boolean {
  try {
    const { birthtimeMs } = statSync(absolutePath);
    return birthtimeMs > 0 && Date.now() - birthtimeMs < NEW_FILE_WINDOW_MS;
  } catch {
    return true;
  }
}

function textOf(content: unknown, separator: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(separator);
}
