import type { Concept, Evidence } from "../learning.ts";
import type { NewTimelineEntry, TimelineEntry } from "../timeline.ts";
import recordedTurns from "../../fixtures/recorded/demo-agent-turns.json" with { type: "json" };
import { card, fixtureTimeline } from "./build.ts";

/**
 * Timeline of one demo session on the example project (examples/portfolio, issue #16): a portfolio site that logs
 * the user out and loses their projects on refresh after login was added. The agent turns are recorded from a real
 * Pi session that followed the demo script in docs/example-project.md (#24); every other entry is hand-written.
 *
 * Story:
 * 1. The user reports the logout. The agent keeps the token in localStorage (the partial fix); then the user reports
 *    lost projects and the agent stores them by username. A browser-side 401 (synthetic) follows each turn.
 * 2. Decisions detect the repeated gap: an Impasse and an Offer. The user accepts a full Lesson on session tokens:
 *    Probe (wrong prediction), Explain (data-flow diagram citing app.js and server.js), Articulate (correct restatement).
 * 3. The agent makes the real fix. The user presses Why on the server.js change: a second, related Impasse.
 *    Teaching adapts to the higher Mastery Level with a probe-first Lesson (no explanation) ending in a fix judgement.
 *
 * Entries keep the `source` of the module that would write them: replay agent-host and app entries as input,
 * and expect the decisions and teaching entries as output. All paths are relative to the example project root.
 */

export const DEMO_SESSION_ID = "demo-1";
/** Stand-in for the absolute project folder; tests map it to examples/portfolio. */
export const DEMO_PROJECT_DIR = "/demo/portfolio";
/** Every file in the example project, project-relative. */
export const DEMO_PROJECT_FILES = [
  "README.md",
  "package.json",
  "package-lock.json",
  "server.js",
  "public/index.html",
  "public/app.js",
  "public/style.css",
] as const;

export const DEMO_CONCEPTS = {
  pageReload: "page-reload-resets-state",
  sessionToken: "session-tokens",
  userData: "data-belongs-to-user",
} as const;

const t = fixtureTimeline(DEMO_SESSION_ID, "2026-11-21T10:00:00.000Z");
const ids = {} as Record<string, string>;

t.add({ kind: "session_start", source: "app", projectDir: DEMO_PROJECT_DIR });

// ------------------------------------------------- 1. agent turns (recorded), repeated error
// Agent turns are a real recording: the demo script run through Pi 1.5.2 with ollama-cloud/deepseek-v4.1-flash
// (packages/agent-host/scripts/record-demo.ts). Turn 1 keeps the token in localStorage (the partial fix).
// The 401 errors are synthetic: they come from the browser, not from Pi.
const recorded = recordedTurns as unknown as NewTimelineEntry[][];
const addTurn = (turn: number) => recorded[turn]!.map((entry) => t.add(entry));
const turn1 = addTurn(0);
ids.wrongFix = turn1[recorded[0]!.findIndex((e) => e.kind === "file_edit")]!;
ids.error1 = t.add({
  kind: "error",
  source: "agent-host",
  origin: "project",
  path: "public/app.js",
  message: "GET /api/me 401 (Unauthorized)",
});
// Turn 2: the user reports the lost projects; the agent stores projects by username in server.js.
const turn2 = addTurn(1);
ids.fixAgain1 = turn2[0]!;
ids.error2 = t.add({
  kind: "error",
  source: "agent-host",
  origin: "project",
  path: "public/app.js",
  message: "GET /api/me 401 (Unauthorized)",
});

// ----------------------------------------------------- 2. detected Impasse, Offer, full Lesson
const impasse1 = {
  id: "impasse-1",
  trigger: "detected" as const,
  title: "Why you are logged out after every refresh",
  conceptIds: [DEMO_CONCEPTS.sessionToken, DEMO_CONCEPTS.pageReload],
  sourceEntryIds: [ids.error1, ids.error2, ids.fixAgain1],
};
t.add({ kind: "impasse", source: "decisions", impasse: impasse1 });
t.add({
  kind: "offer",
  source: "teaching",
  impasseId: impasse1.id,
  card: card("OfferCard", {
    impasseId: impasse1.id,
    title: "Same error twice: want to see why?",
    body: "The 401 after refresh came back after two fixes. A 2-minute look at how your page remembers who is logged in could help.",
  }),
});
t.add({ kind: "offer_response", source: "app", impasseId: impasse1.id, response: "accept" });
t.add({ kind: "lesson_start", source: "teaching", lessonId: "lesson-1", impasseId: impasse1.id });
ids.probe1 = t.add({
  kind: "lesson_card",
  source: "teaching",
  lessonId: "lesson-1",
  step: "probe",
  card: card("ProbeCard", {
    lessonId: "lesson-1",
    question: "You log in, then refresh. What is `sessionToken` in public/app.js after the refresh?",
    options: [
      { id: "same", label: "The same token as before" },
      { id: "new", label: "A brand-new random token" },
      { id: "empty", label: "Empty, until you log in again" },
    ],
    citations: [{ path: "public/app.js", startLine: 1, endLine: 2 }],
  }),
});
ids.answer1 = t.add({ kind: "card_answer", source: "app", lessonId: "lesson-1", cardEntryId: ids.probe1, step: "probe", answer: { type: "choice", optionId: "same" } });
ids.assess1 = t.add({
  kind: "answer_assessment",
  source: "teaching",
  lessonId: "lesson-1",
  answerEntryId: ids.answer1,
  step: "probe",
  conceptIds: [DEMO_CONCEPTS.pageReload, DEMO_CONCEPTS.sessionToken],
  result: "incorrect",
});
t.add({
  kind: "lesson_card",
  source: "teaching",
  lessonId: "lesson-1",
  step: "explain",
  card: card("DataFlowDiagram", {
    title: "Where your login goes on refresh",
    nodes: [
      { id: "page", label: "public/app.js makes sessionToken" },
      { id: "server", label: "server.js keeps sessions[token]" },
      { id: "reload", label: "Refresh reruns app.js: new token" },
    ],
    edges: [
      { from: "page", to: "server", label: "X-Session-Token header" },
      { from: "reload", to: "server", label: "unknown token → 401" },
    ],
    citations: [
      { path: "public/app.js", startLine: 2, endLine: 2 },
      { path: "server.js", startLine: 19, endLine: 21 },
      { path: "server.js", startLine: 34, endLine: 34 },
    ],
  }),
});
ids.articulate1 = t.add({
  kind: "lesson_card",
  source: "teaching",
  lessonId: "lesson-1",
  step: "articulate",
  card: card("ArticulationCard", {
    lessonId: "lesson-1",
    prompt: "In your own words: why does the server forget you after a refresh?",
    mode: "restate",
    citations: [{ path: "public/app.js", startLine: 2, endLine: 2 }],
  }),
});
ids.answer2 = t.add({
  kind: "card_answer",
  source: "app",
  lessonId: "lesson-1",
  cardEntryId: ids.articulate1,
  step: "articulate",
  answer: { type: "text", text: "Refreshing runs app.js again, so it makes a new token, and the server only knows my old token, so I look logged out." },
});
ids.assess2 = t.add({
  kind: "answer_assessment",
  source: "teaching",
  lessonId: "lesson-1",
  answerEntryId: ids.answer2,
  step: "articulate",
  conceptIds: [DEMO_CONCEPTS.sessionToken, DEMO_CONCEPTS.pageReload],
  result: "correct",
});
t.add({ kind: "lesson_end", source: "teaching", lessonId: "lesson-1", outcome: "completed" });

// ------------------------------------------------------------- 3. real fix (recorded), Why, adapted Lesson
// Turn 3: the server creates the token at login (server.js), and the page keeps the one it gets (public/app.js).
const turn3 = addTurn(2);
ids.realFix = turn3[recorded[2]!.findIndex((e) => e.kind === "file_edit")]!;

const impasse2 = {
  id: "impasse-2",
  trigger: "why" as const,
  title: "Why the projects are now stored per user in server.js",
  conceptIds: [DEMO_CONCEPTS.userData, DEMO_CONCEPTS.sessionToken],
  sourceEntryIds: [ids.realFix],
};
t.add({ kind: "impasse", source: "app", impasse: impasse2 });
t.add({ kind: "lesson_start", source: "teaching", lessonId: "lesson-2", impasseId: impasse2.id });
ids.probe2 = t.add({
  kind: "lesson_card",
  source: "teaching",
  lessonId: "lesson-2",
  step: "probe",
  card: card("ProbeCard", {
    lessonId: "lesson-2",
    question: "After this change, you log out and log in again. Where are your projects?",
    options: [
      { id: "lost", label: "Gone, like before" },
      { id: "portfolios", label: "Still in projects[username] on the server" },
      { id: "browser", label: "In the browser's localStorage" },
    ],
    citations: [{ path: "server.js", startLine: 34, endLine: 35 }],
  }),
});
ids.answer3 = t.add({ kind: "card_answer", source: "app", lessonId: "lesson-2", cardEntryId: ids.probe2, step: "probe", answer: { type: "choice", optionId: "portfolios" } });
ids.assess3 = t.add({
  kind: "answer_assessment",
  source: "teaching",
  lessonId: "lesson-2",
  answerEntryId: ids.answer3,
  step: "probe",
  conceptIds: [DEMO_CONCEPTS.userData],
  result: "correct",
});
ids.articulate2 = t.add({
  kind: "lesson_card",
  source: "teaching",
  lessonId: "lesson-2",
  step: "articulate",
  card: card("ArticulationCard", {
    lessonId: "lesson-2",
    prompt: "The agent's first fix kept the session token in localStorage. Did that fix the cause of the lost projects?",
    mode: "judge_fix",
    citations: [{ path: "public/app.js", startLine: 40, endLine: 42 }],
  }),
});
ids.answer4 = t.add({
  kind: "card_answer",
  source: "app",
  lessonId: "lesson-2",
  cardEntryId: ids.articulate2,
  step: "articulate",
  answer: { type: "fix_judgement", addressesCause: false, reason: "It only hid the symptom; the projects still belonged to the login session, so logging out threw them away." },
});
ids.assess4 = t.add({
  kind: "answer_assessment",
  source: "teaching",
  lessonId: "lesson-2",
  answerEntryId: ids.answer4,
  step: "articulate",
  conceptIds: [DEMO_CONCEPTS.sessionToken, DEMO_CONCEPTS.userData],
  result: "correct",
});
t.add({ kind: "lesson_end", source: "teaching", lessonId: "lesson-2", outcome: "completed" });
t.add({ kind: "session_end", source: "app", reason: "user" });

/** The whole demo session, in seq order. */
export const demoSession: readonly TimelineEntry[] = t.entries();

/** Entry ids the stories above refer to, for assertions. */
export const demoEntryIds = { ...ids } as Readonly<typeof ids>;

/**
 * Expected Concepts after the session and Dreaming. Evidence lists are given in full in the Markdown files under
 * `packages/contracts/fixtures/learner-model/after-demo/`; here only Mastery Levels and related files.
 */
export const expectedConceptsAfterDemo: readonly Omit<Concept, "evidence">[] = [
  {
    id: DEMO_CONCEPTS.pageReload,
    name: "A page reload restarts the page's JavaScript",
    mastery: "correct_with_hints",
    relatedFiles: ["public/app.js"],
    userEdited: false,
  },
  {
    id: DEMO_CONCEPTS.sessionToken,
    name: "Session tokens identify a visitor across requests",
    mastery: "catches_agent_mistakes",
    relatedFiles: ["public/app.js", "server.js"],
    userEdited: false,
  },
  {
    id: DEMO_CONCEPTS.userData,
    name: "Data belongs to the user, not to one login session",
    mastery: "correct_with_hints",
    relatedFiles: ["server.js"],
    userEdited: false,
  },
];

const C = DEMO_CONCEPTS;
const ev = (
  n: number,
  conceptId: string,
  type: Evidence["type"],
  outcome: Evidence["outcome"],
  strength: Evidence["strength"],
  entryIds: string[],
  note: string,
): Evidence => ({
  id: `ev-${n}`,
  conceptId,
  type,
  outcome,
  strength,
  sessionId: DEMO_SESSION_ID,
  entryIds,
  at: demoSession.find((e) => e.id === entryIds.at(-1))!.at,
  note,
});

/**
 * Evidence the session should append to the session log: the write gate's repeated-gap decision plus one Evidence
 * per Concept of each answer_assessment. Mirrors `fixtures/learner-model/after-demo/sessions/demo-1.md`.
 */
export const expectedEvidenceAfterDemo: readonly Evidence[] = [
  ev(1, C.sessionToken, "repeated_gap", "negative", "moderate", [ids.error1!, ids.fixAgain1!, ids.error2!], "The same 401 came back after two agent fixes and the user asked for a fix again."),
  ev(2, C.pageReload, "probe_result", "negative", "moderate", [ids.answer1!, ids.assess1!], "Predicted that sessionToken stays the same after a refresh."),
  ev(3, C.sessionToken, "probe_result", "negative", "moderate", [ids.answer1!, ids.assess1!], "Predicted that sessionToken stays the same after a refresh."),
  ev(4, C.sessionToken, "articulation", "positive", "strong", [ids.answer2!, ids.assess2!], "Explained in their own words that a refresh makes a new token the server does not know."),
  ev(5, C.pageReload, "articulation", "positive", "strong", [ids.answer2!, ids.assess2!], "Explained in their own words that a refresh runs app.js again."),
  ev(6, C.userData, "probe_result", "positive", "moderate", [ids.answer3!, ids.assess3!], "Predicted that the projects stay in projects[username] after logging out and in."),
  ev(7, C.sessionToken, "fix_judgement", "positive", "strong", [ids.answer4!, ids.assess4!], "Judged that the agent's localStorage fix hid the symptom without fixing the cause."),
  ev(8, C.userData, "fix_judgement", "positive", "strong", [ids.answer4!, ids.assess4!], "Judged that the agent's localStorage fix hid the symptom without fixing the cause."),
];
