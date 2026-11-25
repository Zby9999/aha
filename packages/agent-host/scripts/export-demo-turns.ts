/**
 * Exports the agent turns of a curated recording for the shared demo fixture in contracts (#24).
 * Pure file processing.
 *
 *   node packages/agent-host/scripts/export-demo-turns.ts <recorded dir> <out json>
 *
 * Splits the recorded agent-host Timeline at each user message and keeps the entries other modules read. Streaming
 * deltas are left out (the stub agent host streams agent_message text itself), and tool output longer than
 * OUTPUT_LIMIT characters is cut, so the fixture stays readable.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NewTimelineEntry, TimelineEntry } from "@aha/contracts";

const OUTPUT_LIMIT = 2000;
const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("usage: export-demo-turns.ts <recorded dir> <out json>");

const cut = (text: string) => (text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…(cut)` : text);
const live = JSON.parse(readFileSync(join(dir, "demo.timeline.json"), "utf8")) as TimelineEntry[];
const turns: NewTimelineEntry[][] = [];
for (const { id: _id, sessionId: _s, seq: _seq, at: _at, version: _v, ...entry } of live) {
  if (entry.kind === "agent_message_delta") continue;
  if (entry.kind === "user_message") turns.push([]);
  if (entry.kind === "tool_result") entry.output = cut(entry.output);
  if (entry.kind === "error") entry.message = cut(entry.message);
  turns.at(-1)?.push(entry as NewTimelineEntry);
}
writeFileSync(out, JSON.stringify(turns, null, 1) + "\n");
console.error(`${turns.length} turns, ${turns.flat().length} entries → ${out}`);
