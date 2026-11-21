import type { Concept, Evidence } from "../learning.ts";
import type { TimelineEntry } from "../timeline.ts";
import { card, fixtureTimeline } from "./build.ts";

/**
 * Hand-written synthetic Timeline of one demo session on the example project (examples/portfolio, issue #16):
 * a portfolio site that logs the user out and loses their projects on refresh after login was added.
 *
 * Story:
 * 1. The user reports the bug. The agent reads the code and makes a wrong fix (projects in localStorage), then another
 *    change to server.js; the same 401 error comes back each time and the user asks for a fix again.
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

// ------------------------------------------------- 1. agent edits, repeated error
t.add({
  kind: "user_message",
  source: "agent-host",
  text: "I added a login to my portfolio. Now every time I refresh the page I'm logged out and my projects are gone. Can you fix it?",
});
t.add({ kind: "tool_call", source: "agent-host", toolCallId: "call-1", toolName: "read", args: { path: "public/app.js" } });
t.add({
  kind: "tool_result",
  source: "agent-host",
  toolCallId: "call-1",
  toolName: "read",
  output: "// A random id for this visitor. The server uses it to remember who is logged in.\nconst sessionToken = Math.random().toString(36).slice(2);\n...",
  isError: false,
});
t.add({ kind: "tool_call", source: "agent-host", toolCallId: "call-2", toolName: "read", args: { path: "server.js" } });
t.add({
  kind: "tool_result",
  source: "agent-host",
  toolCallId: "call-2",
  toolName: "read",
  output: "// Everyone who is logged in right now, looked up by their session token.\nconst sessions = {};\n...",
  isError: false,
});
t.add({ kind: "agent_message_delta", source: "agent-host", messageId: "msg-1", delta: "Your projects are only kept " });
t.add({
  kind: "agent_message",
  source: "agent-host",
  messageId: "msg-1",
  text: "Your projects are only kept in memory, so I'll also save them in the browser with localStorage and load them on startup.",
});
t.add({
  kind: "tool_call",
  source: "agent-host",
  toolCallId: "call-3",
  toolName: "edit",
  args: { path: "public/app.js", oldText: "function showPortfolio(user) {", newText: "function showPortfolio(user) {\n  localStorage.setItem('projects', JSON.stringify(user.projects));" },
});
t.add({ kind: "tool_result", source: "agent-host", toolCallId: "call-3", toolName: "edit", output: "Edited public/app.js", isError: false });
ids.wrongFix = t.add({
  kind: "file_edit",
  source: "agent-host",
  path: "public/app.js",
  change: "modify",
  toolCallId: "call-3",
  diff: "@@ -40,2 +40,3 @@\n function showPortfolio(user) {\n+  localStorage.setItem('projects', JSON.stringify(user.projects));\n   loginSection.hidden = true;",
});
t.add({ kind: "agent_message", source: "agent-host", messageId: "msg-2", text: "Done. Refresh the page and your projects should still be there." });
ids.error1 = t.add({
  kind: "error",
  source: "agent-host",
  origin: "project",
  path: "public/app.js",
  message: "GET /api/me 401 (Unauthorized)",
});
ids.fixAgain1 = t.add({ kind: "user_message", source: "agent-host", text: "Still logged out after refresh and the projects are gone again. Fix it again please." });
t.add({
  kind: "tool_call",
  source: "agent-host",
  toolCallId: "call-4",
  toolName: "edit",
  args: { path: "server.js", oldText: "return res.status(401).json({ error: 'Not logged in' });", newText: "return res.status(401).json({ error: 'Not logged in, please log in again' });" },
});
t.add({ kind: "tool_result", source: "agent-host", toolCallId: "call-4", toolName: "edit", output: "Edited server.js", isError: false });
t.add({
  kind: "file_edit",
  source: "agent-host",
  path: "server.js",
  change: "modify",
  toolCallId: "call-4",
  diff: "@@ -40,3 +40,3 @@\n   if (!session) {\n-    return res.status(401).json({ error: 'Not logged in' });\n+    return res.status(401).json({ error: 'Not logged in, please log in again' });",
});
t.add({ kind: "agent_message", source: "agent-host", messageId: "msg-3", text: "I made the server's message clearer. Try logging in and refreshing again." });
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
t.add({
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
t.add({
  kind: "answer_assessment",
  source: "teaching",
  lessonId: "lesson-1",
  answerEntryId: ids.answer2,
  step: "articulate",
  conceptIds: [DEMO_CONCEPTS.sessionToken, DEMO_CONCEPTS.pageReload],
  result: "correct",
});
t.add({ kind: "lesson_end", source: "teaching", lessonId: "lesson-1", outcome: "completed" });

// ------------------------------------------------------------- 3. real fix, Why, adapted Lesson
t.add({
  kind: "user_message",
  source: "agent-host",
  text: "OK, so the token has to survive the refresh. Can the server make the token at login and the page keep it?",
});
t.add({ kind: "tool_call", source: "agent-host", toolCallId: "call-5", toolName: "edit", args: { path: "server.js", oldText: "const token = req.get('X-Session-Token');", newText: "const token = crypto.randomUUID();" } });
t.add({ kind: "tool_result", source: "agent-host", toolCallId: "call-5", toolName: "edit", output: "Edited server.js", isError: false });
ids.realFix = t.add({
  kind: "file_edit",
  source: "agent-host",
  path: "server.js",
  change: "modify",
  toolCallId: "call-5",
  diff: "@@ -26,13 +29,10 @@\n-  const token = req.get('X-Session-Token');\n-  sessions[token] = { username, projects: [] };\n-  res.json({ username, projects: [] });\n+  const token = crypto.randomUUID();\n+  sessions[token] = username;\n+  portfolios[username] = portfolios[username] || [];\n+  res.json({ token, username, projects: portfolios[username] });",
});
t.add({ kind: "tool_call", source: "agent-host", toolCallId: "call-6", toolName: "edit", args: { path: "public/app.js", oldText: "const sessionToken = Math.random().toString(36).slice(2);", newText: "let sessionToken = localStorage.getItem('sessionToken');" } });
t.add({ kind: "tool_result", source: "agent-host", toolCallId: "call-6", toolName: "edit", output: "Edited public/app.js", isError: false });
t.add({
  kind: "file_edit",
  source: "agent-host",
  path: "public/app.js",
  change: "modify",
  toolCallId: "call-6",
  diff: "@@ -1,2 +1,2 @@\n-const sessionToken = Math.random().toString(36).slice(2);\n+let sessionToken = localStorage.getItem('sessionToken');",
});
t.add({
  kind: "agent_message",
  source: "agent-host",
  messageId: "msg-4",
  text: "The server now creates the token at login and keeps projects per user; the page saves the token in localStorage. I also removed the localStorage copy of your projects.",
});

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
      { id: "portfolios", label: "Still in portfolios[username] on the server" },
      { id: "browser", label: "In the browser's localStorage" },
    ],
    citations: [{ path: "server.js", startLine: 34, endLine: 35 }],
  }),
});
ids.answer3 = t.add({ kind: "card_answer", source: "app", lessonId: "lesson-2", cardEntryId: ids.probe2, step: "probe", answer: { type: "choice", optionId: "portfolios" } });
t.add({
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
    prompt: "The agent's first fix saved your projects in localStorage. Did that fix the cause?",
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
  answer: { type: "fix_judgement", addressesCause: false, reason: "It only hid the symptom; the token was still new on every refresh, so the server still forgot me." },
});
t.add({
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
  seqs: number[],
  note: string,
): Evidence => ({
  id: `ev-${n}`,
  conceptId,
  type,
  outcome,
  strength,
  sessionId: DEMO_SESSION_ID,
  entryIds: seqs.map((seq) => `${DEMO_SESSION_ID}:${seq}`),
  at: demoSession[seqs.at(-1)!]!.at,
  note,
});

/**
 * Evidence the session should append to the session log: the write gate's repeated-gap decision plus one Evidence
 * per Concept of each answer_assessment. Mirrors `fixtures/learner-model/after-demo/sessions/demo-1.md`.
 */
export const expectedEvidenceAfterDemo: readonly Evidence[] = [
  ev(1, C.sessionToken, "repeated_gap", "negative", "moderate", [12, 13, 18], "The same 401 came back after two agent fixes and the user asked for a fix again."),
  ev(2, C.pageReload, "probe_result", "negative", "moderate", [24, 25], "Predicted that sessionToken stays the same after a refresh."),
  ev(3, C.sessionToken, "probe_result", "negative", "moderate", [24, 25], "Predicted that sessionToken stays the same after a refresh."),
  ev(4, C.sessionToken, "articulation", "positive", "strong", [28, 29], "Explained in their own words that a refresh makes a new token the server does not know."),
  ev(5, C.pageReload, "articulation", "positive", "strong", [28, 29], "Explained in their own words that a refresh runs app.js again."),
  ev(6, C.userData, "probe_result", "positive", "moderate", [42, 43], "Predicted that the projects stay in portfolios[username] after logging out and in."),
  ev(7, C.sessionToken, "fix_judgement", "positive", "strong", [45, 46], "Judged that the agent's localStorage fix hid the symptom without fixing the cause."),
  ev(8, C.userData, "fix_judgement", "positive", "strong", [45, 46], "Judged that the agent's localStorage fix hid the symptom without fixing the cause."),
];
