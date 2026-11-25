import type { CardSpec } from "../cards.ts";
import type { cardComponentDefinitions } from "../catalog.ts";
import { card } from "./build.ts";
import { portfolioSessionFlow } from "./demo-session.ts";

const browserToken = { path: "public/app.js", startLine: 1, endLine: 2 };
const lookupSession = { path: "server.js", startLine: 38, endLine: 44 };
const lessonId = "gallery-session-refresh";

export const lessonGalleryFixtures = {
  OfferCard: card("OfferCard", {
    impasseId: "gallery-repeat-401",
    title: "Why does the page lose your login?",
    body: "This request failed more than once. See how the browser and server keep track of your session.",
  }),
  ProbeCard: card("ProbeCard", {
    lessonId,
    question: "You log in, then refresh. What happens to the session token?",
    options: [
      { id: "same", label: "The browser keeps the same token" },
      { id: "new", label: "The browser creates a new token" },
    ],
    citations: [browserToken],
  }),
  ArticulationCard: card("ArticulationCard", {
    lessonId,
    prompt: "Would saving the project list in the browser prevent logout?",
    mode: "judge_fix",
    citations: [lookupSession],
    feedback: { addressesCause: false, explanation: "The server still has no session for the new token. Caching projects cannot restore the session." },
  }),
  Flowchart: card("Flowchart", {
    title: "What decides which screen opens?",
    steps: ["Browser requests /api/me"],
    decision: {
      question: "Did the server find a session?",
      branches: [
        { label: "Session found", steps: ["Show the portfolio"] },
        { label: "No session", steps: ["Return 401", "Show the login screen"] },
      ],
    },
    citations: [lookupSession, { path: "public/app.js", startLine: 120, endLine: 121 }],
  }),
  DataFlowDiagram: card("DataFlowDiagram", portfolioSessionFlow),
  SequenceDiagram: card("SequenceDiagram", {
    title: "The token changes between requests",
    participants: [{ id: "browser", label: "Browser" }, { id: "server", label: "Server" }],
    messages: [
      { from: "browser", to: "server", label: "Sign in with token A" },
      { from: "server", to: "browser", label: "Return the user after saving the session for token A" },
      { from: "browser", to: "server", label: "After refresh, send GET /api/me with X-Session-Token set to token B" },
      { from: "server", to: "browser", label: "Return 401 because there’s no session for token B" },
    ],
    citations: [browserToken, { path: "public/app.js", startLine: 19, endLine: 26 }, { path: "server.js", startLine: 29, endLine: 44 }],
  }),
  ContrastView: card("ContrastView", {
    title: "What would keep you signed in?",
    leftLabel: "Cache projects",
    rightLabel: "Preserve the session",
    rows: [
      { label: "What changes", left: "A copy of the list stays in the browser.", right: "The request uses the token from the signed-in session." },
      { label: "After refresh", left: "The server still rejects the new token.", right: "The server can find the session while it’s valid." },
    ],
    takeaway: "Caching projects can’t restore a session.",
    citations: [browserToken, { path: "public/app.js", startLine: 19, endLine: 26 }, { path: "server.js", startLine: 19, endLine: 21 }, lookupSession],
  }),
  TextExplanation: card("TextExplanation", {
    title: "Refresh makes a new token",
    text: "On refresh, the browser creates a new token. The server has no session for it, so /api/me returns 401.",
    citations: [browserToken, lookupSession],
  }),
} satisfies Record<keyof typeof cardComponentDefinitions, CardSpec>;
