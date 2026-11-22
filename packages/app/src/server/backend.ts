import { readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { join } from "node:path";
import {
  activeLesson,
  createTimeline,
  currentMode,
  startsLesson,
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
 *
 * The backend owns the session Mode and records each change as a `mode_change` entry. A Lesson request switches to
 * learning mode at once, so a second request is rejected even before the first Lesson has started. In learning mode
 * composer messages become follow-up questions inside the Lesson; when the Lesson ends the Mode returns to work.
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

  const enterLearning = (impasseId: string) => timeline.append({ kind: "mode_change", source: "app", mode: "learning", impasseId });

  function backToWork() {
    const lesson = activeLesson(timeline.entries());
    if (lesson) timeline.append({ kind: "mode_change", source: "app", mode: "work", impasseId: lesson.impasseId });
  }

  async function startLesson(impasse: Impasse) {
    try {
      const learnerContext = await learnerContextFor(impasse);
      agent?.setLearnerContext(learnerContext.concepts.length > 0 ? learnerContext : null);
      appendAll(await teaching.startLesson({ impasse, learner: learnerContext, project: snapshot(projectDir), timeline: timeline.entries() }));
    } finally {
      // A Lesson that failed to start must not leave the session stuck in learning mode.
      if (!activeLesson(timeline.entries())?.lessonId) backToWork();
    }
  }

  async function react(entry: TimelineEntry) {
    // Declines and abandoned Lessons are not Evidence. Assessments are Evidence by construction.
    if (entry.kind === "offer_response" && entry.response === "skip") return;
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
    } else if (entry.kind !== "lesson_end" || entry.outcome !== "abandoned") {
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
      } else if (activeLesson(timeline.entries())?.impasseId === entry.impasse.id) {
        await startLesson(entry.impasse);
      }
    }
    if (entry.kind === "offer_response" && entry.response === "accept") {
      const impasse = findImpasse(timeline.entries(), entry.impasseId);
      if (impasse && activeLesson(timeline.entries())?.impasseId === impasse.id) await startLesson(impasse);
    }
    if (entry.kind === "lesson_question") {
      appendAll(await teaching.followUp({ lessonId: entry.lessonId, question: entry.text, timeline: timeline.entries() }));
    }
    if (entry.kind === "card_answer") {
      appendAll(await teaching.answer({ lessonId: entry.lessonId, cardEntryId: entry.cardEntryId, answer: entry.answer, timeline: timeline.entries() }));
    }
    if (entry.kind === "lesson_end") {
      agent?.setLearnerContext(null);
      if (activeLesson(timeline.entries())?.lessonId === entry.lessonId) backToWork();
    }
    if (entry.kind === "session_end") await learner.dream("session_end");
  }

  let agent: AgentSession | undefined;
  timeline.append({ kind: "session_start", source: "app", projectDir });
  timeline.subscribe((entry) => void enqueue(() => react(entry)));
  agent = await modules.agentHost.startSession({ projectDir, timeline });
  const session = agent;

  async function dispatch(action: UserAction): Promise<void> {
    if (startsLesson(action) && currentMode(timeline.entries()) === "learning") {
      throw new Error("A Lesson is already running. Finish it or go back to work first.");
    }
    switch (action.type) {
      case "send_message": {
        if (currentMode(timeline.entries()) === "work") {
          await session.sendUserMessage(action.text);
          return;
        }
        // Learning mode: a follow-up question inside the current Lesson. It never reaches the agent.
        const lessonId = activeLesson(timeline.entries())?.lessonId;
        if (!lessonId) throw new Error("The Lesson is still starting. Try again in a moment.");
        timeline.append({ kind: "lesson_question", source: "app", lessonId, text: action.text });
        return;
      }
      case "why": {
        const source = timeline.entries().find((e) => e.id === action.entryId);
        if (!source) throw new Error(`No Timeline entry ${action.entryId}`);
        const impasse = newImpasse(timeline.entries(), "why", `Why: ${describe(source)}`, [source.id]);
        timeline.append({ kind: "impasse", source: "app", impasse });
        enterLearning(impasse.id);
        return;
      }
      case "ask_why": {
        const impasse = { ...newImpasse(timeline.entries(), "ask_why", action.text, []), text: action.text };
        timeline.append({ kind: "impasse", source: "app", impasse });
        enterLearning(impasse.id);
        return;
      }
      case "offer_response":
        if (timeline.entries().some((e) => e.kind === "offer_response" && e.impasseId === action.impasseId)) {
          throw new Error("This Offer was already answered");
        }
        timeline.append({ kind: "offer_response", source: "app", impasseId: action.impasseId, response: action.response });
        if (action.response === "accept") enterLearning(action.impasseId);
        return;
      case "back_to_work":
        // Queued after any Lesson start still in flight, so it always abandons the Lesson that is actually running.
        await enqueue(async () => {
          const entries = timeline.entries();
          const lessonId = activeLesson(entries)?.lessonId;
          const modeChange = entries.findLast((e) => e.kind === "mode_change");
          const alreadyEnded = entries.some((e) => e.kind === "lesson_end" &&
            e.lessonId === lessonId && e.seq > (modeChange?.seq ?? -1));
          try {
            if (lessonId && !alreadyEnded) appendAll(await teaching.abandon(lessonId));
          } finally {
            backToWork();
          }
        });
        return;
      case "card_answer": {
        const entries = timeline.entries();
        if (activeLesson(entries)?.lessonId !== action.lessonId) throw new Error("This Lesson is no longer running");
        const answered = entries.find((e) => e.id === action.cardEntryId);
        if (answered?.kind !== "lesson_card" || answered.step === "explain") throw new Error(`${action.cardEntryId} is not a Probe or Articulation card`);
        const modeChange = entries.findLast((e) => e.kind === "mode_change");
        if (answered.lessonId !== action.lessonId || answered.seq <= (modeChange?.seq ?? -1)) throw new Error("This card does not belong to the current Lesson");
        if (entries.some((e) => e.kind === "card_answer" && e.cardEntryId === action.cardEntryId)) throw new Error("This card was already answered");
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
