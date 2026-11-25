import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackend, type Backend } from "@aha/app";
import { currentMode, isKind, type NewTimelineEntry, type TimelineEntry, type UserAction } from "@aha/contracts";
import { demoSession } from "@aha/contracts/fixtures";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { buildModules, MODULE_KEYS, type BuildContext, type ModuleConfig } from "../src/modules.ts";

// Session replay with every module real (#49). Only the outermost boundaries are fakes:
// - agent host: the recorded Pi RPC stream (packages/agent-host/test/fixtures/recorded), replayed by fake Pi;
// - decisions: a scripted Jev behind the `fetch` the Jev client takes;
// - background agent: Pi's own agent loop with the faux model provider, scripted per prompt.
// The browser's 401s are not in the Pi recording; they are taken from the demoSession fixture, as the preview would add them.

const agentHostTests = join(import.meta.dirname, "../../../packages/agent-host/test");
const FAKE_PI = join(agentHostTests, "fake-pi.mjs");
const allReal = Object.fromEntries(MODULE_KEYS.map((k) => [k, "real"])) as ModuleConfig;
const SESSION_TOKENS = "session-tokens";

/** The recorded Pi stream, one array of JSONL lines per agent run. */
const recordedRuns = readFileSync(join(agentHostTests, "fixtures/recorded/demo.rpc.jsonl"), "utf8")
  .split("\n").filter((line) => line.trim())
  .reduce<string[][]>((runs, line) => {
    runs.at(-1)!.push(line);
    if (JSON.parse(line).type === "agent_settled") runs.push([]);
    return runs;
  }, [[]]).filter((run) => run.length);
const recordedTimeline = JSON.parse(readFileSync(join(agentHostTests, "fixtures/recorded/demo.timeline.json"), "utf8")) as TimelineEntry[];
const userMessages = demoSession.filter((e) => isKind(e, "user_message") && e.source === "agent-host") as Extract<TimelineEntry, { kind: "user_message" }>[];
const browserErrors = demoSession.filter((e) => isKind(e, "error") && e.origin === "project");

let root: string;
let projectDir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aha-real-replay-")));
  projectDir = join(root, "portfolio");
  // A copy: the real Learner Model writes <project>/.aha, which must never land in examples/portfolio.
  cpSync(join(import.meta.dirname, "../../../examples/portfolio"), projectDir, { recursive: true, filter: (src) => !src.includes("node_modules") });
  mkdirSync(join(root, "pi-agent"));
  jevCalls.length = 0;
  backgroundTasks.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

/** Jev, scripted: the same text twice is a recurring gap, and only the session token Concept is relevant. */
const jevCalls: string[][] = [];
const scriptedJev: typeof fetch = async (_url, init) => {
  const { state, questions } = JSON.parse(String(init?.body)) as { state: Record<string, any>; questions: Record<string, { type: string; criteria?: Record<string, string> }> };
  jevCalls.push(Object.keys(questions));
  const labelled = (state.concepts ?? []) as { label: string; name: string }[];
  const isSessionTokens = (name?: string) => /session token/i.test(name ?? "");
  const earlier = Object.entries((state.earlierEvents ?? {}) as Record<string, string>).find(([, text]) => text === state.current)?.[0];
  const answers = Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    if (q.type === "noul") {
      if (key === "recurring") return [key, { type: "noul", noul: earlier ? 0.95 : 0.05 }];
      if (key === "cooldown") return [key, { type: "noul", noul: 0 }];
      return [key, { type: "noul", noul: isSessionTokens(labelled.find((c) => c.label === key)?.name ?? state.concepts?.[Number(key.split("_")[1])]?.name) ? 0.9 : 0.05 }];
    }
    const pick = {
      earlier: earlier ?? "none",
      concept: labelled.find((c) => isSessionTokens(c.name))?.label ?? "new",
      kind: state.detectedGap ? "repeated_gap" : "none",
      strength: "moderate",
      outcome: "negative",
    }[key] ?? Object.keys(q.criteria ?? {})[0]!;
    return [key, { type: "choice", choice: pick }];
  }));
  return Response.json({ answers });
};

/** The background model, scripted: answers each Lesson request with valid, cited JSON; Dreaming proposes no merges. */
const backgroundTasks: string[] = [];
const scriptedModel: FauxResponseFactory = (context) => {
  const last = context.messages.findLast((m) => m.role === "user");
  const prompt = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((c) => ("text" in c ? c.text : "")).join("");
  const marker = "Lesson context (JSON):\n";
  if (!prompt.includes(marker)) {
    backgroundTasks.push("dreaming");
    return fauxAssistantMessage(JSON.stringify({ merges: [] }));
  }
  const lesson = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as {
    focusFiles?: string[]; files: { path: string; source: string }[]; discussion?: { answer?: string; concepts?: { id: string }[] };
  };
  const file = lesson.files.find(({ path }) => lesson.focusFiles?.includes(path)) ?? lesson.files[0]!;
  const line = Number(file.source.split("\n").find((l) => /^\d+: \S/.test(l))!.split(":")[0]);
  const citations = [{ path: file.path, startLine: line, endLine: line }];
  const reply = (task: string, body: object) => (backgroundTasks.push(task), fauxAssistantMessage(JSON.stringify(body)));
  if (prompt.startsWith("Write one short open-ended prediction")) {
    return reply("probe", { question: "You log in, then refresh the page. What happens to the session token?", citations });
  }
  if (prompt.startsWith("Assess the actual Articulation answer")) {
    const answer = lesson.discussion!.answer!;
    const conceptId = lesson.discussion!.concepts!.find(({ id }) => id === SESSION_TOKENS)?.id ?? lesson.discussion!.concepts![0]!.id;
    return reply("assess", { result: "partial", conceptId, answerQuote: answer.split(" ").slice(0, 4).join(" "), citations });
  }
  const task = prompt.startsWith("Give one short hint") ? "hint" : prompt.startsWith("Answer the user's question") ? "answer" : "explain";
  return reply(task, { component: "TextExplanation", props: { title: "Where the token comes from", text: "The page makes a new token each time it loads.", citations } });
};

/** More scripted answers than one replay asks for; each background run takes one. */
const MODEL_REPLIES = 50;

async function realModules(sessionId: string, piEvents: string[][]): Promise<ReturnType<typeof buildModules>> {
  const eventsFile = join(root, `${sessionId}.rpc.jsonl`);
  writeFileSync(eventsFile, piEvents.flat().map((line) => `${line}\n`).join(""));
  const agentDir = join(root, "pi-agent");
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const faux = fauxProvider();
  modelRuntime.registerNativeProvider(faux.provider);
  faux.setResponses(Array.from({ length: MODEL_REPLIES }, () => scriptedModel));
  const ctx: BuildContext = {
    pi: { command: process.execPath, args: [FAKE_PI], env: { ...process.env, FAKE_PI_EVENTS: eventsFile, FAKE_PI_SPLIT: "turns" } },
    jev: { apiKey: "scripted", fetch: scriptedJev },
    backgroundAgent: { agentDir, modelRuntime, model: faux.getModel() },
  };
  return buildModules(allReal, ctx);
}

async function startSession(sessionId: string, piEvents: string[][]) {
  const errors: unknown[] = [];
  const backend = await createBackend({ modules: await realModules(sessionId, piEvents), projectDir, sessionId, onLearningError: (e) => errors.push(e) });
  const entries = () => backend.timeline.entries();
  const act = async (action: UserAction) => {
    await backend.dispatch(action);
    await backend.settled();
  };
  /** Sends a recorded user message and waits until fake Pi has replayed that whole run onto the Timeline. */
  const agentTurn = async (message: string, run: number) => {
    const start = recordedTimeline.findIndex((e, i) => e.kind === "user_message" && recordedTimeline.slice(0, i).filter((p) => p.kind === "user_message").length === run);
    const next = recordedTimeline.findIndex((e, i) => i > start && e.kind === "user_message");
    const expected = (next === -1 ? recordedTimeline.length : next) - start;
    const before = entries().length;
    await backend.dispatch({ type: "send_message", text: message });
    const fromPi = () => entries().slice(before).filter((e) => e.source === "agent-host").length;
    for (const until = Date.now() + 10_000; fromPi() < expected && Date.now() < until; ) await new Promise((r) => setTimeout(r, 10));
    expect(fromPi(), `recorded run ${run + 1}`).toBe(expected);
    await backend.settled();
  };
  const browserError = async (index: number) => {
    const { id: _id, sessionId: _s, seq: _q, at: _a, version: _v, ...error } = browserErrors[index]!;
    backend.timeline.append(error as NewTimelineEntry);
    await backend.settled();
  };
  return { backend, errors, entries, act, agentTurn, browserError };
}

const lessonSteps = (entries: readonly TimelineEntry[], lessonId: string) =>
  entries.filter((e) => isKind(e, "lesson_card") && e.lessonId === lessonId).map((e) => (e as { step: string }).step);

const waitFor = async (check: () => boolean, what: string) => {
  for (const until = Date.now() + 10_000; !check() && Date.now() < until; ) await new Promise((r) => setTimeout(r, 20));
  expect(check(), what).toBe(true);
};

// Dreaming runs when the session ends, or when it has been idle for AHA_DREAM_IDLE_MS (default five minutes).
describe.each(["session_end", "idle"] as const)("with every module real, Dreaming on %s", (trigger) => {
  test("the second related Impasse gets a shorter Lesson after Evidence and Dreaming", async () => {
    const backends: Backend[] = [];
    if (trigger === "idle") vi.stubEnv("AHA_DREAM_IDLE_MS", "300");
    try {
      // Session 1: the two recorded turns and the browser's repeated 401.
      const first = await startSession("replay-1", recordedRuns.slice(0, 2));
      backends.push(first.backend);
      await first.agentTurn(userMessages[0]!.text, 0);
      await first.browserError(0);
      await first.agentTurn(userMessages[1]!.text, 1);
      await first.browserError(1);

      // Jev sees the same 401 in two attempts: one detected Impasse and one Offer for it.
      const impasses = first.entries().filter((e) => isKind(e, "impasse"));
      expect(impasses).toHaveLength(1);
      const offer = first.entries().findLast((e) => isKind(e, "offer"))!;
      expect(offer.impasseId).toBe((impasses[0] as Extract<TimelineEntry, { kind: "impasse" }>).impasse.id);

      // A full generated Lesson: Probe, Explain, Articulate. The Articulation is assessed partial for session tokens.
      await first.act({ type: "offer_response", impasseId: offer.impasseId, response: "accept" });
      const probe = first.entries().findLast((e) => isKind(e, "lesson_card"))!;
      expect(probe.step).toBe("probe");
      await first.act({ type: "card_answer", lessonId: probe.lessonId, cardEntryId: probe.id, answer: { type: "text", text: "It stays the same token." } });
      const articulate = first.entries().findLast((e) => isKind(e, "lesson_card"))!;
      expect(articulate.step).toBe("articulate");
      await first.act({
        type: "card_answer", lessonId: probe.lessonId, cardEntryId: articulate.id,
        answer: { type: "text", text: "Refreshing reruns app.js, which makes a new random token, so the server finds no session." },
      });
      expect(lessonSteps(first.entries(), probe.lessonId)).toEqual(["probe", "explain", "articulate"]);
      expect(first.entries().findLast((e) => isKind(e, "lesson_end"))).toMatchObject({ lessonId: probe.lessonId, outcome: "completed" });
      expect(first.entries().findLast((e) => isKind(e, "answer_assessment"))).toMatchObject({ result: "partial", conceptIds: [SESSION_TOKENS] });
      expect(currentMode(first.entries())).toBe("work");

      // Evidence is in the session file: Jev's repeated gap, and the assessed Articulation.
      const sessionFile = readFileSync(join(projectDir, ".aha/learner-model/sessions/replay-1.md"), "utf8");
      expect(sessionFile).toMatch(/concept: session-tokens\n- type: repeated_gap · outcome: negative · strength: moderate/);
      expect(sessionFile).toMatch(/concept: session-tokens\n- type: articulation · outcome: positive · strength: weak/);
      const conceptFile = join(projectDir, ".aha/learner-model/concepts/session-tokens.md");
      const mastery = () => readFileSync(conceptFile, "utf8").match(/^mastery: (.*)$/m)?.[1];
    const changelog = () => { try { return readFileSync(join(projectDir, ".aha/learner-model/changelog.md"), "utf8"); } catch { return ""; } };

      // Dreaming runs on the background agent and raises the Mastery Level; until then the Concept file is unchanged.
      if (trigger === "session_end") {
        expect(mastery()).toBe("not_encountered");
        await first.act({ type: "end_session" });
      } else {
        // Dreaming writes the Concept files, then appends its changelog entry: wait for the last write.
      await waitFor(() => /session-tokens: not_encountered → correct_with_hints/.test(changelog()), "idle Dreaming raised the Mastery Level");
      }
      expect(backgroundTasks).toContain("dreaming");
      expect(mastery()).toBe("correct_with_hints");
      expect(changelog()).toMatch(/session-tokens: not_encountered → correct_with_hints/);
      expect(first.errors).toEqual([]);
      await first.backend.stop();
      vi.unstubAllEnvs();

      // Session 2: the recorded third turn makes the real fix; Why on its server.js change is the related Impasse.
      const second = await startSession("replay-2", recordedRuns.slice(2));
      backends.push(second.backend);
      await second.agentTurn(userMessages[2]!.text, 2);
      const edit = second.entries().find((e) => isKind(e, "file_edit") && e.path === "server.js")!;
      const tasksBefore = backgroundTasks.length;
      const jevBefore = jevCalls.length;
      await second.act({ type: "why", entryId: edit.id });
      const start = second.entries().findLast((e) => isKind(e, "lesson_start"))!;

      // Adapted to correct with hints: a single hint card, no Probe or Articulation, and the Lesson completes.
      expect(lessonSteps(second.entries(), start.lessonId)).toEqual(["explain"]);
      expect(backgroundTasks.slice(tasksBefore)).toEqual(["hint"]);
      expect(second.entries().findLast((e) => isKind(e, "lesson_end"))).toMatchObject({ lessonId: start.lessonId, outcome: "completed" });
      expect(currentMode(second.entries())).toBe("work");
      expect(second.errors).toEqual([]);
      // The read gate asked Jev which Concepts the Why concerns; the hint came from the learned one.
      expect(jevCalls.slice(jevBefore).some((keys) => keys.every((key) => key.startsWith("concept_")))).toBe(true);
    } finally {
      await Promise.allSettled(backends.map((b) => b.stop()));
    }
  }, 60_000);
});
