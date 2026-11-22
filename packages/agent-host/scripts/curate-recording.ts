/**
 * Turns a raw recording from record-demo.ts into committed fixtures (#24). Pure file processing: no Pi, no network.
 *
 *   node packages/agent-host/scripts/curate-recording.ts <recorded dir>
 *
 * The raw stream holds the recorder's whole Pi setup: its system prompt, its own extensions' state and the model's
 * thinking. The committed fixtures keep only what the agent host reads, so they stay small and hold nothing personal:
 * - drops system messages, thinking, run/turn summaries, tool-result messages, partial tool output, tool-call
 *   argument streams, terminal UI state and extension session entries;
 * - strips `usage` from streaming records and thinking blocks from final messages;
 * - scrubs temp-folder and socket paths.
 * Writes <dir>/demo.rpc.jsonl (curated in place) and <dir>/demo.timeline.json (the live Timeline, minus the entries
 * of dropped records), so a replay of the curated stream must give exactly the curated Timeline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: curate-recording.ts <recorded dir>");

type Rec = { type: string; [k: string]: unknown };
const DROP = new Set(["agent_end", "turn_end", "tool_execution_update", "entry_appended"]);
const TUI_STATE = new Set(["setStatus", "setWidget", "setTitle", "set_editor_text"]);
const DROPPED_UPDATES = new Set(["thinking_start", "thinking_delta", "thinking_end", "toolcall_start", "toolcall_delta", "toolcall_end", "start"]);

function keep(r: Rec): boolean {
  if (DROP.has(r.type)) return false;
  if (r.type === "extension_ui_request") return !TUI_STATE.has(String(r.method));
  if (r.type === "message_start" || r.type === "message_end") return (r.message as { role?: string })?.role === "assistant";
  if (r.type === "message_update") return !DROPPED_UPDATES.has(String((r.assistantMessageEvent as { type?: string })?.type));
  return true;
}

function slim(r: Rec): Rec {
  if (r.type === "message_update") {
    const { usage: _usage, ...rest } = r;
    return rest as Rec;
  }
  if (r.type === "message_start" || r.type === "message_end") {
    const message = r.message as { content?: { type?: string }[]; usage?: unknown };
    const { usage: _usage, ...rest } = message;
    return { ...r, message: { ...rest, content: (message.content ?? []).filter((b) => b?.type !== "thinking") } };
  }
  return r;
}

const scrub = (text: string) =>
  text
    .replace(/\/private\.(?=[/"\\\s]|$)/g, ".") // the project folder through macOS's /private symlink
    .replace(/\/(?:private\/)?var\/folders\/[^"\\\s]*?\/T\//g, "<tmp>/")
    .replace(/\/(?:private\/)?tmp\/[a-z]+-\d+/g, "<tmp>/agent-browser");

const rawPath = join(dir, "demo.rpc.jsonl");
const records = readFileSync(rawPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Rec);
const curated = records.filter(keep).map(slim);
writeFileSync(rawPath, curated.map((r) => scrub(JSON.stringify(r))).join("\n") + "\n");

type Entry = { kind: string; agentEventType?: string; raw?: Rec };
const timelinePath = join(dir, "demo.timeline.json");
const entries = JSON.parse(readFileSync(timelinePath, "utf8")) as Entry[];
// Only unknown_agent_event entries come from dropped records (extension session entries); keep everything else.
const kept = entries.filter((e) => e.kind !== "unknown_agent_event" || (e.raw && keep(e.raw)));
writeFileSync(timelinePath, scrub(JSON.stringify(kept, null, 1)) + "\n");
console.error(`${records.length} → ${curated.length} records; ${entries.length} → ${kept.length} Timeline entries`);
