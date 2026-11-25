import { createTimeline, type TimelineEntry } from "@aha/contracts";
import { demoEntryIds, demoSession } from "@aha/contracts/fixtures";

interface Example {
  name: string;
  timeline: readonly TimelineEntry[];
  impasse: boolean;
  evidence: boolean;
}

function messages(name: string, turns: string[], impasse: boolean, evidence: boolean): Example {
  const timeline = createTimeline({ sessionId: name });
  for (const text of turns) timeline.append({ kind: "user_message", source: "agent-host", text });
  return { name, timeline: timeline.entries(), impasse, evidence };
}

function recorded401(id: string | undefined, impasse: boolean): Example {
  const index = demoSession.findIndex((entry) => entry.id === id);
  const error = demoSession[index];
  if (error?.kind !== "error" || error.origin !== "project" || error.message !== "GET /api/me 401 (Unauthorized)") {
    throw new Error("Missing labeled project 401 in the recorded session");
  }
  // Raw project errors can trigger detection. The resulting Impasse is assessed separately for Evidence.
  return { name: impasse ? "repeated-project-401" : "first-project-401",
    timeline: demoSession.slice(0, index + 1), impasse, evidence: false };
}

export const examples: Example[] = [
  recorded401(demoEntryIds.error1, false),
  recorded401(demoEntryIds.error2, true),
  messages("self-report", ["I understand session tokens perfectly."], false, false),
  messages("routine", ["Please rename the login button."], false, false),
  messages("unrelated-requests", ["Please rename the button.", "Make the footer blue."], false, false),
  messages("repeated-question", ["Why does a refresh give me a different token?",
    "I still cannot tell why reloading creates a different token. Can you explain again?"], true, true),
  messages("independent-fix", ["I moved token creation out of the reload handler and verified the same token survived three refreshes."], false, true),
  messages("caught-mistake", ["Your patch regenerates the session token on every page load. I logged both values and they differ."], false, true),
  messages("fix-judgement", ["Saving the token only in memory still loses it on refresh. The new request uses a different token, so the patch misses the cause."], false, true),
];
