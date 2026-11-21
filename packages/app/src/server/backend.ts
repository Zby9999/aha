import { readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { join } from "node:path";
import {
  createTimeline,
  type AgentSession,
  type AhaModules,
  type AppBackend,
  type Evidence,
  type Impasse,
  type LearnerContext,
  type NewTimelineEntry,
  type ProjectSnapshot,
  type TimelineEntry,
  type UserAction,
} from "@aha/contracts";

export interface BackendOptions {
  modules: AhaModules;
  /** Absolute path of the user's project folder. */
  projectDir: string;
  sessionId: string;
  /** Learning features failing never blocks the work; failures are reported here. Defaults to console.error. */
  onLearningError?: (error: unknown) => void;
}

export interface Backend extends AppBackend {
  /** Resolves once every reaction to the entries so far (decisions, teaching, evidence) has finished. */
  settled(): Promise<void>;
  stop(): Promise<void>;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".aha"]);

/**
 * Wires the modules around one Timeline (packages/contracts/README.md, "Flow through the modules").
 * Agent work goes straight to the agent host; every learning step runs in one queue after it, so a slow
 * or failing learning module never blocks the user's work.
 */
export async function createBackend({ modules, projectDir, sessionId, onLearningError = console.error }: BackendOptions): Promise<Backend> {
  const timeline = createTimeline({ sessionId });
  const learner = modules.learnerModel({ projectDir, background: modules.background });
  const teaching = modules.teaching({ decisions: modules.decisions, background: modules.background });
  const { decisions } = modules;

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(onLearningError);
    return queue;
  };
  const appendAll = (entries: NewTimelineEntry[]) => entries.forEach((e) => timeline.append(e));
  let evidenceCount = 0;

  async function recordEvidence(decision: Omit<Evidence, "id" | "sessionId" | "at">) {
    await learner.appendEvidence({ ...decision, id: `ev-${++evidenceCount}`, sessionId, at: new Date().toISOString() });
  }

  async function learnerContextFor(impasse: Impasse): Promise<LearnerContext> {
    const ids = (await decisions.selectConcepts({ impasse, concepts: await learner.listConcepts() })) ?? [];
    return { concepts: ids.length > 0 ? await learner.readConcepts(ids) : [] };
  }

  async function startLesson(impasse: Impasse) {
    const learnerContext = await learnerContextFor(impasse);
    agent?.setLearnerContext(learnerContext.concepts.length > 0 ? learnerContext : null);
    appendAll(await teaching.startLesson({ impasse, learner: learnerContext, project: snapshot(projectDir), timeline: timeline.entries() }));
  }

  async function react(entry: TimelineEntry) {
    // Write gate: every entry is a candidate; assessments are Evidence by construction.
    if (entry.kind === "answer_assessment") {
      for (const conceptId of entry.conceptIds) {
        await recordEvidence({
          conceptId,
          type: entry.step === "probe" ? "probe_result" : "articulation",
          outcome: entry.result === "incorrect" ? "negative" : "positive",
          strength: entry.result === "partial" ? "weak" : "moderate",
          entryIds: [entry.answerEntryId, entry.id],
          note: `${entry.step} answer assessed as ${entry.result}`,
        });
      }
    } else {
      const decided = await decisions.gateEvidence({ timeline: timeline.entries(), newEntries: [entry], concepts: await learner.listConcepts() });
      for (const { newConcept: _new, ...decision } of decided ?? []) await recordEvidence(decision);
    }

    if (entry.source === "agent-host" && (entry.kind === "error" || entry.kind === "agent_message")) {
      const detection = await decisions.detectImpasse({ timeline: timeline.entries() });
      if (detection) timeline.append({ kind: "impasse", source: "decisions", impasse: detection.impasse });
    }
    if (entry.kind === "impasse") {
      if (entry.impasse.trigger === "detected") {
        const learnerContext = await learnerContextFor(entry.impasse);
        const card = await teaching.offer({ impasse: entry.impasse, learner: learnerContext });
        if (card) timeline.append({ kind: "offer", source: "teaching", impasseId: entry.impasse.id, card });
      } else {
        await startLesson(entry.impasse);
      }
    }
    if (entry.kind === "offer_response" && entry.response === "accept") {
      const impasse = findImpasse(timeline.entries(), entry.impasseId);
      if (impasse) await startLesson(impasse);
    }
    if (entry.kind === "card_answer") {
      appendAll(await teaching.answer({ lessonId: entry.lessonId, cardEntryId: entry.cardEntryId, answer: entry.answer, timeline: timeline.entries() }));
    }
    if (entry.kind === "lesson_end") agent?.setLearnerContext(null);
    if (entry.kind === "session_end") await learner.dream("session_end");
  }

  let agent: AgentSession | undefined;
  timeline.append({ kind: "session_start", source: "app", projectDir });
  timeline.subscribe((entry) => void enqueue(() => react(entry)));
  agent = await modules.agentHost.startSession({ projectDir, timeline });
  const session = agent;

  async function dispatch(action: UserAction): Promise<void> {
    switch (action.type) {
      case "send_message":
        await session.sendUserMessage(action.text);
        return;
      case "why": {
        const source = timeline.entries().find((e) => e.id === action.entryId);
        if (!source) throw new Error(`No Timeline entry ${action.entryId}`);
        timeline.append({ kind: "impasse", source: "app", impasse: newImpasse(timeline.entries(), "why", `Why: ${describe(source)}`, [source.id]) });
        return;
      }
      case "ask_why":
        timeline.append({ kind: "impasse", source: "app", impasse: { ...newImpasse(timeline.entries(), "ask_why", action.text, []), text: action.text } });
        return;
      case "offer_response":
        timeline.append({ kind: "offer_response", source: "app", impasseId: action.impasseId, response: action.response });
        return;
      case "card_answer": {
        const answered = timeline.entries().find((e) => e.id === action.cardEntryId);
        if (answered?.kind !== "lesson_card" || answered.step === "explain") throw new Error(`${action.cardEntryId} is not a Probe or Articulation card`);
        if (timeline.entries().some((e) => e.kind === "card_answer" && e.cardEntryId === action.cardEntryId)) throw new Error("This card was already answered");
        timeline.append({ kind: "card_answer", source: "app", lessonId: action.lessonId, cardEntryId: action.cardEntryId, step: answered.step, answer: action.answer });
        return;
      }
      case "flag_explanation":
        timeline.append({ kind: "explanation_flagged", source: "app", lessonId: action.lessonId, cardEntryId: action.cardEntryId, ...(action.reason ? { reason: action.reason } : {}) });
        return;
      case "end_session":
        timeline.append({ kind: "session_end", source: "app", reason: "user" });
        return;
    }
  }

  return {
    timeline,
    dispatch,
    settled: async () => {
      // Reactions can enqueue more reactions; wait until the queue stops growing.
      for (let seen: Promise<void> | undefined; seen !== queue; ) {
        seen = queue;
        await seen;
      }
    },
    stop: () => session.stop(),
  };
}

function findImpasse(entries: readonly TimelineEntry[], id: string): Impasse | undefined {
  for (const e of entries) if (e.kind === "impasse" && e.impasse.id === id) return e.impasse;
  return undefined;
}

function newImpasse(entries: readonly TimelineEntry[], trigger: Impasse["trigger"], title: string, sourceEntryIds: string[]): Impasse {
  const n = entries.filter((e) => e.kind === "impasse").length + 1;
  return { id: `impasse-${n}`, trigger, title, conceptIds: [], sourceEntryIds };
}

function describe(entry: TimelineEntry): string {
  if (entry.kind === "file_edit") return `the change to ${entry.path}`;
  if (entry.kind === "agent_message") return entry.text.slice(0, 80);
  return entry.kind;
}

/** Project-relative paths of the project's files, skipping dependencies and Aha's own folder. */
export function snapshot(projectDir: string): ProjectSnapshot {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return IGNORED_DIRS.has(name) ? [] : walk(path);
      return [projectPath(projectDir, path)];
    });
  return { projectDir, files: walk(projectDir).sort() };
}

/**
 * The path of `file` relative to `projectDir`, always with `/` separators, as citations and fixtures write it.
 * `paths` is the platform's path module; tests pass `path.win32` to check the Windows case.
 */
export function projectPath(projectDir: string, file: string, paths: Pick<typeof nodePath, "relative" | "sep"> = nodePath): string {
  return paths.relative(projectDir, file).split(paths.sep).join("/");
}
