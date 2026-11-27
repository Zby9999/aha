import { readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { join } from "node:path";
import {
  activeLesson,
  createTimeline,
  currentMode,
  pendingLessonError,
  startsLesson,
  type AgentSession,
  type AhaModules,
  type Concept,
  type AppBackend,
  type Evidence,
  type Impasse,
  type LearnerContext,
  type LearnerModelFile,
  type NewTimelineEntry,
  type ProjectSnapshot,
  type TimelineEntry,
  type TimelineEntryOf,
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
  readLearnerModel(): Promise<{ concepts: Concept[]; files: LearnerModelFile[] }>;
  writeLearnerModelFile(file: LearnerModelFile): Promise<void>;
  /** Resolves once every reaction to the entries so far (decisions, teaching, evidence) has finished. */
  settled(): Promise<void>;
  stop(): Promise<void>;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".aha"]);
type LessonRequest = { entryId: string; impasseId: string };

/**
 * Wires the modules around one Timeline (packages/contracts/README.md, "Flow through the modules").
 * Learning reactions run in a queue. Agent work and Back to work can proceed while a Lesson is generating.
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
  let idleTimer: NodeJS.Timeout | undefined;
  let ended = false;
  const idleMs = Number(process.env.AHA_DREAM_IDLE_MS ?? 300_000);
  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch(onLearningError);
    return queue;
  };
  let activeRequest: LessonRequest | undefined;
  let evidenceCount = 0;

  async function recordEvidence(decision: Omit<Evidence, "id" | "sessionId" | "at">) {
    await learner.appendEvidence({ ...decision, id: `ev-${++evidenceCount}`, sessionId, at: new Date().toISOString() });
  }

  async function learnerContextFor(impasse: Impasse): Promise<LearnerContext> {
    const ids = (await decisions.selectConcepts({ impasse: forReadGate(timeline.entries(), impasse), concepts: await learner.listConcepts() })) ?? [];
    return { concepts: ids.length > 0 ? await learner.readConcepts(ids) : [] };
  }

  function enterLearning(impasseId: string, entryId: string) {
    activeRequest = { entryId, impasseId };
    timeline.append({ kind: "mode_change", source: "app", mode: "learning", impasseId });
  }

  function closeRequest(request: LessonRequest) {
    if (activeRequest !== request) return;
    activeRequest = undefined;
    try {
      agent?.setLearnerContext(null);
    } catch (error) {
      onLearningError(error);
    } finally {
      timeline.append({ kind: "mode_change", source: "app", mode: "work", impasseId: request.impasseId });
    }
  }

  function requestForLessonEntry(entry: TimelineEntryOf<"card_answer"> | TimelineEntryOf<"lesson_question"> | TimelineEntryOf<"lesson_end">) {
    const lesson = activeLesson(timeline.entries());
    if (lesson?.lessonId === entry.lessonId && entry.seq > (lesson.startSeq ?? Infinity)) return activeRequest;
  }

  function publishLessonEntries(request: LessonRequest, entries: NewTimelineEntry[]) {
    for (const entry of entries) {
      if (activeRequest !== request) return;
      const published = timeline.append(entry);
      if (published.kind === "lesson_end" && requestForLessonEntry(published) === request) closeRequest(request);
    }
  }

  /** Starts the exact request that queued this reaction. */
  async function startRequestedLesson(entryId: string) {
    const request = activeRequest;
    if (request?.entryId !== entryId) return;
    try {
      const impasse = findImpasse(timeline.entries(), request.impasseId);
      if (!impasse) return;
      const learnerContext = await learnerContextFor(impasse);
      if (activeRequest !== request) return;
      agent?.setLearnerContext(learnerContext.concepts.length > 0 ? learnerContext : null);
      const entries = await teaching.startLesson({ impasse, learner: learnerContext, project: snapshot(projectDir), timeline: timeline.entries() });
      if (activeRequest === request) {
        publishLessonEntries(request, entries);
      } else {
        // An unpublished start has no Lesson ID until Teaching returns. Release its state before starting another Lesson.
        const start = entries.find((entry) => entry.kind === "lesson_start" && entry.impasseId === request.impasseId);
        if (start?.kind === "lesson_start") await teaching.abandon(start.lessonId).catch(onLearningError);
      }
    } catch (error) {
      if (activeRequest === request) {
        timeline.append({ kind: "error", source: "app", origin: "agent", message: "Couldn't prepare this Lesson. Try Why again." });
        throw error;
      }
    } finally {
      if (activeRequest === request && !activeLesson(timeline.entries())?.lessonId) closeRequest(request);
    }
  }

  /** Teaching takes the Lesson on after an answer; on failure the card gets a `lesson_error` the user can retry. */
  async function takeAnswer(answer: TimelineEntryOf<"card_answer">, retry = false) {
    const request = requestForLessonEntry(answer);
    if (!request) return;
    try {
      const entries = await teaching.answer({ lessonId: answer.lessonId, cardEntryId: answer.cardEntryId, answer: answer.answer, timeline: timeline.entries() });
      if (activeRequest !== request) return;
      if (retry && entries.length) {
        timeline.append({ kind: "lesson_answer_recovered", source: "app", lessonId: answer.lessonId, cardEntryId: answer.cardEntryId });
      }
      publishLessonEntries(request, entries);
    } catch (error) {
      if (activeRequest !== request) return;
      timeline.append({ kind: "lesson_error", source: "app", lessonId: answer.lessonId, cardEntryId: answer.cardEntryId, message: "Couldn't prepare the next step." });
      throw error;
    }
  }

  function lessonHasEnded(lessonId: string, startSeq: number) {
    return timeline.entries().some((entry) => entry.kind === "lesson_end" && entry.lessonId === lessonId && entry.seq > startSeq);
  }

  async function abandonPublishedLesson(lessonId: string, startSeq: number) {
    let end: NewTimelineEntry | undefined;
    try {
      const entries = await teaching.abandon(lessonId);
      // A Lesson waiting after feedback ends completed: Back to work is its last step.
      end = entries.find((entry) => entry.kind === "lesson_end" && entry.lessonId === lessonId);
    } catch (error) {
      onLearningError(error);
    } finally {
      if (!lessonHasEnded(lessonId, startSeq)) {
        // Teaching may already have produced a completion that the backend has not published.
        timeline.append(end ?? { kind: "lesson_end", source: "app", lessonId, outcome: "abandoned" });
      }
    }
  }

  async function react(entry: TimelineEntry) {
    // Teaching publishes a Lesson's end before its Evidence is gated, so the work mode returns at once.
    if (entry.kind === "lesson_end") await reactLearning(entry);
    // A streamed turn may already have appended later events by the time this reaction runs.
    const history = timeline.entries().filter((item) => item.seq <= entry.seq);
    const evidence = gateEvidence(entry, history).catch(onLearningError);
    if (entry.source === "agent-host" && (entry.kind === "user_message" || entry.kind === "error" || entry.kind === "agent_message")) {
      // The write gate and Impasse detection read the same snapshot in parallel.
      const [write, read] = await Promise.allSettled([evidence, decisions.detectImpasse({ timeline: history })]);
      if (write.status === "rejected") throw write.reason;
      if (read.status === "rejected") throw read.reason;
      const detection = read.value;
      if (detection && !timeline.entries().some((item) => item.kind === "impasse" && item.impasse.id === detection.impasse.id)) {
        timeline.append({ kind: "impasse", source: "decisions", impasse: detection.impasse });
      }
      return;
    }
    await evidence;
    if (entry.kind !== "lesson_end") await reactLearning(entry);
  }

  async function gateEvidence(entry: TimelineEntry, history: readonly TimelineEntry[]) {
    if (entry.kind === "offer_response" && entry.response === "skip") return;
    if (entry.kind === "error" && entry.source === "app") return;
    if (entry.kind === "lesson_end") {
      if (entry.outcome !== "completed") return;
      const earlier = timeline.entries().filter((event) => event.seq < entry.seq);
      if (earlier.some((event) => event.kind === "lesson_end" && event.lessonId === entry.lessonId)) return;
      const recordedByAnswer = new Map<string, Set<string>>();
      // A Lesson without a Probe (a hint or a review) asks for the Articulation after little help, so a correct one is strong.
      const probed = earlier.some((event) => event.kind === "lesson_card" && event.lessonId === entry.lessonId && event.step === "probe");
      for (const assessment of earlier) {
        if (assessment.kind !== "answer_assessment" || assessment.lessonId !== entry.lessonId) continue;
        const submitted = earlier.find((event) => event.kind === "card_answer" && event.id === assessment.answerEntryId);
        if (submitted?.kind !== "card_answer" || submitted.lessonId !== entry.lessonId || submitted.step !== assessment.step) continue;
        const recordedConcepts = recordedByAnswer.get(submitted.id) ?? new Set<string>();
        recordedByAnswer.set(submitted.id, recordedConcepts);
        for (const conceptId of assessment.conceptIds) {
          if (recordedConcepts.has(conceptId)) continue;
          recordedConcepts.add(conceptId);
          await recordEvidence({
            conceptId,
            type: assessment.step === "probe" ? "probe_result" : submitted.answer.type === "fix_judgement" ? "fix_judgement" : "articulation",
            outcome: assessment.result === "incorrect" ? "negative" : "positive",
            strength: assessment.result === "partial" ? "weak"
              : assessment.result === "correct" && assessment.step === "articulate" && submitted.answer.type === "text" && !probed ? "strong" : "moderate",
            entryIds: [assessment.answerEntryId, assessment.id],
            note: `${assessment.step} answer assessed as ${assessment.result}`,
          });
        }
      }
      return;
    }
    // Lesson assessments are the only source of Evidence about answers within the Lesson.
    if ("lessonId" in entry) return;
    const decided = await decisions.gateEvidence({ timeline: history, newEntries: [entry], concepts: await learner.listConcepts() });
    for (const { newConcept: _new, ...decision } of decided ?? []) await recordEvidence(decision);
  }

  async function reactLearning(entry: TimelineEntry) {
    if (entry.kind === "impasse") {
      if (entry.impasse.trigger === "detected") {
        const learnerContext = await learnerContextFor(entry.impasse);
        const card = await teaching.offer({ impasse: entry.impasse, learner: learnerContext });
        if (card) timeline.append({ kind: "offer", source: "teaching", impasseId: entry.impasse.id, card });
      } else {
        await startRequestedLesson(entry.id);
      }
    }
    if (entry.kind === "offer_response" && entry.response === "accept") await startRequestedLesson(entry.id);
    if (entry.kind === "lesson_question") {
      const request = requestForLessonEntry(entry);
      if (!request) return;
      try {
        const entries = await teaching.followUp({ lessonId: entry.lessonId, question: entry.text, timeline: timeline.entries() });
        publishLessonEntries(request, entries);
      } catch (error) {
        if (activeRequest === request) {
          timeline.append({ kind: "error", source: "app", origin: "agent", message: "Couldn't answer that question. Ask again or go back to work." });
          throw error;
        }
      }
    }
    if (entry.kind === "card_answer") await takeAnswer(entry);
    if (entry.kind === "lesson_end") {
      const request = requestForLessonEntry(entry);
      if (request) closeRequest(request);
    }
    if (entry.kind === "session_end") await learner.dream("session_end");
  }

  let agent: AgentSession | undefined;
  let retrying = false;
  timeline.append({ kind: "session_start", source: "app", projectDir });
  timeline.subscribe((entry) => {
    if (idleTimer) clearTimeout(idleTimer);
    if (entry.kind === "session_end") ended = true;
    if (!ended && Number.isFinite(idleMs) && idleMs > 0) {
      idleTimer = setTimeout(() => void enqueue(async () => { await learner.dream("idle"); }), idleMs);
      idleTimer.unref();
    }
    void enqueue(() => react(entry));
  });
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
        const entry = timeline.append({ kind: "impasse", source: "app", impasse });
        enterLearning(impasse.id, entry.id);
        return;
      }
      case "ask_why": {
        const ended = justEndedLesson(timeline.entries());
        const impasse = { ...newImpasse(timeline.entries(), "ask_why", action.text, ended ? [ended.id] : []), text: action.text };
        const entry = timeline.append({ kind: "impasse", source: "app", impasse });
        enterLearning(impasse.id, entry.id);
        return;
      }
      case "offer_response": {
        const entries = timeline.entries();
        if (!entries.some((entry) => entry.kind === "offer" && entry.impasseId === action.impasseId)) {
          throw new Error("No Offer for this Impasse");
        }
        if (entries.some((e) => e.kind === "offer_response" && e.impasseId === action.impasseId)) {
          throw new Error("This Offer was already answered");
        }
        const entry = timeline.append({ kind: "offer_response", source: "app", impasseId: action.impasseId, response: action.response });
        if (action.response === "accept") enterLearning(action.impasseId, entry.id);
        return;
      }
      case "back_to_work": {
        const request = activeRequest;
        if (!request) return;
        const { lessonId, startSeq } = activeLesson(timeline.entries()) ?? {};
        const abandonment = lessonId && startSeq !== undefined && !lessonHasEnded(lessonId, startSeq)
          ? Promise.resolve().then(() => abandonPublishedLesson(lessonId, startSeq))
          : undefined;
        // Keep future Teaching starts behind cleanup while letting this exit bypass the queue.
        if (abandonment) void enqueue(() => abandonment);
        closeRequest(request);
        await abandonment;
        return;
      }
      case "retry_answer": {
        const error = pendingLessonError(timeline.entries(), "explicit");
        if (!error || error.cardEntryId !== action.cardEntryId || error.lessonId !== action.lessonId || retrying) {
          throw new Error("There is nothing to retry for this card");
        }
        const answer = timeline.entries().findLast((e): e is TimelineEntryOf<"card_answer"> => e.kind === "card_answer" && e.cardEntryId === action.cardEntryId);
        if (!answer) throw new Error("There is nothing to retry for this card");
        retrying = true;
        await enqueue(async () => {
          try {
            const pending = pendingLessonError(timeline.entries(), "explicit");
            if (pending?.cardEntryId === answer.cardEntryId) await takeAnswer(answer, true);
          } finally {
            retrying = false;
          }
        });
        return;
      }
      case "card_answer": {
        const entries = timeline.entries();
        const lesson = activeLesson(entries);
        const answered = entries.find((e) => e.id === action.cardEntryId);
        if (lesson?.lessonId !== action.lessonId || answered?.kind !== "lesson_card" || answered.lessonId !== action.lessonId || answered.seq < (lesson.startSeq ?? Infinity)) {
          throw new Error("This Lesson is no longer running");
        }
        if (answered.step === "explain") throw new Error(`${action.cardEntryId} is not a Probe or Articulation card`);
        if (entries.some((e) => e.kind === "card_answer" && e.cardEntryId === action.cardEntryId)) throw new Error("This card was already answered");
        timeline.append({ kind: "card_answer", source: "app", lessonId: action.lessonId, cardEntryId: action.cardEntryId, step: answered.step, answer: action.answer });
        return;
      }
      case "flag_explanation": {
        const entries = timeline.entries();
        const card = entries.find((entry) => entry.id === action.cardEntryId);
        if (card?.kind !== "lesson_card" || card.step !== "explain" || card.lessonId !== action.lessonId) {
          throw new Error("Only an explanation from this Lesson can be flagged.");
        }
        if (entries.some((entry) => entry.kind === "explanation_flagged" && entry.cardEntryId === card.id)) return;
        if (entries.some((entry) => entry.kind === "lesson_end" && entry.lessonId === card.lessonId && entry.outcome === "abandoned")) {
          throw new Error("This Lesson ended early and is read-only.");
        }
        timeline.append({ kind: "explanation_flagged", source: "app", lessonId: action.lessonId, cardEntryId: action.cardEntryId, ...(action.reason ? { reason: action.reason } : {}) });
        return;
      }
      case "end_session":
        timeline.append({ kind: "session_end", source: "app", reason: "user" });
        return;
    }
  }

  return {
    timeline,
    dispatch,
    readLearnerModel: async () => ({ concepts: await learner.readConcepts((await learner.listConcepts()).map((concept) => concept.id)), files: await learner.readFiles() }),
    writeLearnerModelFile: (file) => learner.writeFile(file),
    settled: async () => {
      // Reactions can enqueue more reactions; wait until the queue stops growing.
      for (let seen: Promise<void> | undefined; seen !== queue; ) {
        seen = queue;
        await seen;
      }
    },
    stop: async () => { if (idleTimer) clearTimeout(idleTimer); await session.stop(); },
  };
}

function findImpasse(entries: readonly TimelineEntry[], id: string): Impasse | undefined {
  for (const e of entries) if (e.kind === "impasse" && e.impasse.id === id) return e.impasse;
  return undefined;
}

const FOLLOW_UP_WINDOW_MS = 10 * 60_000;

/**
 * The end of a Lesson that an Ask why follows up: nothing else was asked since it ended, a short while ago. Teaching
 * answers such a question directly instead of starting a new Probe (live, W5's "Which one should I fix first?").
 */
function justEndedLesson(entries: readonly TimelineEntry[], now = Date.now()): TimelineEntry | undefined {
  const end = entries.findLast((entry) => entry.kind === "lesson_end");
  if (!end || now - Date.parse(end.at) > FOLLOW_UP_WINDOW_MS) return undefined;
  const later = entries.filter((entry) => entry.seq > end.seq);
  return later.some((entry) => entry.kind === "user_message" || entry.kind === "impasse") ? undefined : end;
}

function newImpasse(entries: readonly TimelineEntry[], trigger: Impasse["trigger"], title: string, sourceEntryIds: string[]): Impasse {
  const n = entries.filter((e) => e.kind === "impasse").length + 1;
  return { id: `impasse-${n}`, trigger, title, conceptIds: [], sourceEntryIds };
}

/**
 * A Why on an agent change is titled only by its path, which gives the read gate nothing to judge. It sees the change
 * itself as the question; the Timeline keeps the short title.
 */
function forReadGate(entries: readonly TimelineEntry[], impasse: Impasse): Impasse {
  if (impasse.trigger !== "why" || impasse.text) return impasse;
  const source = entries.find((entry) => entry.id === impasse.sourceEntryIds[0]);
  if (source?.kind !== "file_edit" || !source.diff) return impasse;
  // Only the changed lines: a diff's file headers can be long absolute paths.
  const changed = source.diff.split("\n").filter((line) => /^[+-](?![+-]{2})/.test(line)).join("\n").slice(0, 500);
  return { ...impasse, text: `Why did the agent make this change to ${source.path}?\n${changed}` };
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
