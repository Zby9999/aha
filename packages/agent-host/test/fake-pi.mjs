#!/usr/bin/env node
// A fake Pi that speaks the RPC protocol (`pi --mode rpc`) on stdin/stdout, for tests. No model, no network.
//
// Environment:
//   FAKE_PI_ON_START  "exit": print to stderr and exit 1 at once; "silent": never answer anything.
//   FAKE_PI_MODELS    "none": no models (not logged in); "no-default": models, but get_state has the "unknown" placeholder.
//   FAKE_PI_LOG       File that receives each command received, one JSON per line.
//   FAKE_PI_EVENTS    JSONL file of records (e.g. a recorded Pi event stream) emitted after accepting each prompt.
//   FAKE_PI_SPLIT     "turns": prompt n emits only the n-th run of FAKE_PI_EVENTS (records up to its agent_settled).
// A prompt "__crash__" makes the process exit with code 3.
import { appendFileSync, readFileSync } from "node:fs";

const env = process.env;
if (env.FAKE_PI_ON_START === "exit") {
  process.stderr.write("fake pi: failed to start\n");
  process.exit(1);
}

if (env.FAKE_PI_LOG) appendFileSync(env.FAKE_PI_LOG, `${JSON.stringify({ type: "__start__", argv: process.argv.slice(2), cwd: process.cwd(), learnerContextFile: env.AHA_LEARNER_CONTEXT_FILE })}\n`);

const MODEL ={ id: "fake-model", name: "Fake Model", provider: "fake", api: "fake" };
const events = env.FAKE_PI_EVENTS ? readFileSync(env.FAKE_PI_EVENTS, "utf8").split("\n").filter((line) => line.trim()) : [];
const turns = [[]];
for (const line of events) {
  turns.at(-1).push(line);
  if (JSON.parse(line).type === "agent_settled") turns.push([]);
}
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const respond = (command, data) => out({ id: command.id, type: "response", command: command.type, success: true, ...(data === undefined ? {} : { data }) });

function handle(command) {
  if (env.FAKE_PI_LOG) appendFileSync(env.FAKE_PI_LOG, `${JSON.stringify(command)}\n`);
  if (env.FAKE_PI_ON_START === "silent") return;
  switch (command.type) {
    case "get_available_models":
      return respond(command, { models: env.FAKE_PI_MODELS === "none" ? [] : [MODEL] });
    case "get_state":
      return respond(command, { model: env.FAKE_PI_MODELS === "no-default" ? { ...MODEL, id: "unknown" } : MODEL, isStreaming: false });
    case "prompt": {
      if (command.message === "__crash__") process.exit(3);
      respond(command, { disposition: "started" });
      for (const line of env.FAKE_PI_SPLIT === "turns" ? turns.shift() ?? [] : events) process.stdout.write(`${line}\n`);
      return;
    }
    case "extension_ui_response":
      return;
    default:
      return out({ id: command.id, type: "response", command: command.type, success: false, error: `Unknown command: ${command.type}` });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
