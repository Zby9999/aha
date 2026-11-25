import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackgroundAgent, createPiAgentHost } from "@aha/agent-host";
import { createBackend, type Backend } from "@aha/app";
import { currentMode, isKind, type AhaModules } from "@aha/contracts";
import { createDecisions, type DecisionOptions } from "@aha/decisions";
import { createLearnerModel } from "@aha/learner-model";
import { createTeaching } from "@aha/teaching";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Learning features failing never blocks ordinary use of the agent (#13, #50). Every module is real; Pi is the fake Pi
// replaying a short fix, and each case breaks Jev or the background agent the way it breaks in a live run.

const agentHostTests = join(import.meta.dirname, "../../../packages/agent-host/test");
let root: string;
let backend: Backend | undefined;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aha-failures-")));
  cpSync(join(import.meta.dirname, "../../../examples/portfolio"), join(root, "portfolio"), { recursive: true, filter: (src) => !src.includes("node_modules") });
  // A Pi config folder with no `auth.json`: the background agent is not logged in.
  mkdirSync(join(root, "pi-agent"));
  // Jev's client warns once per failure reason; keep the test output quiet.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await backend?.stop();
  backend = undefined;
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const never: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
});

const cases: { name: string; jev: DecisionOptions }[] = [
  { name: "no Jev key", jev: { apiKey: "" } },
  { name: "Jev timing out", jev: { apiKey: "test", timeoutMs: 50, fetch: never } },
  { name: "Jev answering 401", jev: { apiKey: "test", fetch: async () => new Response("unauthorized", { status: 401 }) } },
  { name: "Jev unreachable", jev: { apiKey: "test", fetch: async () => { throw new TypeError("fetch failed"); } } },
];

test.each(cases)("with $name and a background agent that is not logged in, chatting with the agent keeps working", async ({ jev }) => {
  const piLog = join(root, "pi.log");
  const modules: AhaModules = {
    agentHost: createPiAgentHost({
      command: process.execPath,
      args: [join(agentHostTests, "fake-pi.mjs")],
      env: { ...process.env, FAKE_PI_EVENTS: join(agentHostTests, "fixtures/fix-login.rpc.jsonl"), FAKE_PI_LOG: piLog },
    }),
    decisions: createDecisions(jev),
    learnerModel: createLearnerModel,
    teaching: createTeaching,
    background: createBackgroundAgent({ agentDir: join(root, "pi-agent") }),
  };
  const learningErrors: unknown[] = [];
  backend = await createBackend({ modules, projectDir: join(root, "portfolio"), sessionId: "failures", onLearningError: (e) => learningErrors.push(e) });
  const entries = () => backend!.timeline.entries();
  const replies = () => entries().filter((e) => isKind(e, "agent_message") && e.text.startsWith("Done."));
  const prompts = () => readFileSync(piLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => c.type === "prompt");
  const reply = async (count: number) => {
    for (const until = Date.now() + 5000; replies().length < count && Date.now() < until; ) await new Promise((r) => setTimeout(r, 10));
    expect(replies()).toHaveLength(count);
    await backend!.settled();
  };

  // Work mode: the message reaches Pi and the agent's reply comes back, twice.
  await backend.dispatch({ type: "send_message", text: "Fix my login" });
  await reply(1);
  await backend.dispatch({ type: "send_message", text: "Fix my login" });
  await reply(2);

  // Asking why cannot get a Lesson without a model; the user sees an error card and the session returns to work mode.
  await backend.dispatch({ type: "ask_why", text: "Why does a refresh log me out?" });
  await backend.settled();
  expect(currentMode(entries())).toBe("work");
  expect(entries().findLast((e) => isKind(e, "error"))).toMatchObject({ source: "app", message: expect.stringMatching(/Couldn't prepare this Lesson/) });

  // Why on the agent's change fails the same way, and the agent still takes the next message.
  await backend.dispatch({ type: "why", entryId: entries().findLast((e) => isKind(e, "file_edit"))!.id });
  await backend.settled();
  expect(currentMode(entries())).toBe("work");
  await backend.dispatch({ type: "send_message", text: "Thanks, carry on" });
  await reply(3);
  expect(prompts().map((p) => p.message)).toEqual(["Fix my login", "Fix my login", "Thanks, carry on"]);

  // Ending the session runs Dreaming without a model: it is logged and skipped, never thrown.
  await backend.dispatch({ type: "end_session" });
  await backend.settled();
  expect(readFileSync(join(root, "portfolio/.aha/learner-model/changelog.md"), "utf8")).toMatch(/Restricted Pi unavailable/);
  // Only the two failed Lesson starts reach the error reporter; Jev failures degrade silently.
  expect(learningErrors).toHaveLength(2);
}, 30_000);
