/**
 * Records the demo scenario with the user's real Pi through the agent host, for fixtures (#24).
 * COSTS MODEL CREDITS and needs `pi auth login`. Never run in tests or CI.
 *
 *   node packages/agent-host/scripts/record-demo.ts [--model ollama-cloud/deepseek-v4.1-flash] [--out <dir>]
 *
 * Runs Pi on a fresh temp copy of examples/portfolio (the repo copy is never edited), with --no-session so nothing
 * is saved in the user's Pi history, sends the demo's user messages one at a time, and waits for Pi to settle after
 * each. Writes, scrubbed of the temp folder and home paths:
 *   <out>/demo.rpc.jsonl       every raw Pi RPC record (input for the agent host's contract tests)
 *   <out>/demo.timeline.json   the agent-host Timeline entries it produced (input for the fixture splice)
 */
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createTimeline } from "@aha/contracts";
import { createPiAgentHost } from "../src/index.ts";

/** The user's messages from the demo script in docs/example-project.md. */
const MESSAGES = [
  "I added a login to my portfolio, but every time I refresh the page I'm logged out. Can you fix it?",
  "Refresh works now, but when I log out and log back in, my projects are gone. Can you fix that too?",
  "Can the server create the token at login, and keep each user's projects by username instead of by token?",
];
const TURN_TIMEOUT_MS = 5 * 60_000;

const { values } = parseArgs({ options: { model: { type: "string" }, out: { type: "string" } } });
const repo = resolve(import.meta.dirname, "../../..");
const out = resolve(values.out ?? join(repo, "packages/agent-host/test/fixtures/recorded"));

const project = join(mkdtempSync(join(tmpdir(), "aha-record-")), "portfolio");
cpSync(join(repo, "examples/portfolio"), project, { recursive: true, filter: (src) => !src.includes("node_modules") });

const records: unknown[] = [];
let settled: (() => void) | undefined;
const timeline = createTimeline({ sessionId: "recorded-demo" });
const host = createPiAgentHost({
  args: ["--no-session", ...(values.model ? ["--model", values.model] : [])],
  onRecord: (record) => {
    records.push(record);
    if (record.type === "agent_settled") settled?.();
  },
});

const session = await host.startSession({ projectDir: project, timeline });
try {
  for (const [i, message] of MESSAGES.entries()) {
    console.error(`turn ${i + 1}/${MESSAGES.length}: ${message}`);
    const done = new Promise<void>((resolveTurn, reject) => {
      settled = resolveTurn;
      setTimeout(() => reject(new Error(`turn ${i + 1} did not settle in ${TURN_TIMEOUT_MS / 1000} s`)), TURN_TIMEOUT_MS).unref();
    });
    await session.sendUserMessage(message);
    await done;
  }
} finally {
  await session.stop();
  save();
}

function save() {
  const scrub = (text: string) =>
    text
      .replaceAll(project, ".")
      .replaceAll(resolve(project, ".."), "..")
      .replaceAll(homedir(), "~")
      .replaceAll(userInfo().username, "user");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "demo.rpc.jsonl"), records.map((r) => scrub(JSON.stringify(r))).join("\n") + "\n");
  writeFileSync(join(out, "demo.timeline.json"), scrub(JSON.stringify(timeline.entries(), null, 2)) + "\n");
  rmSync(resolve(project, ".."), { recursive: true, force: true });
  console.error(`wrote ${records.length} Pi records and ${timeline.entries().length} Timeline entries to ${out}`);
}
