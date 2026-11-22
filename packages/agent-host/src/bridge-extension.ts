/**
 * Aha's bridge extension, loaded into the user's Pi with `-e` next to their own extensions.
 * Before each run it reads the learner context the agent host wrote to the file named by AHA_LEARNER_CONTEXT_FILE
 * and puts it in its own system prompt section. With no file (no learner context) it adds nothing, so the request
 * is unchanged. Pi loads this file itself (through jiti), so it imports nothing at runtime.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LEARNER_CONTEXT_FILE_ENV = "AHA_LEARNER_CONTEXT_FILE";
/** Prompt section name; Pi wraps it in a tag of the same name. */
export const LEARNER_CONTEXT_SECTION = "aha_learner_context";

export default function ahaBridge(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const text = readLearnerContext(process.env[LEARNER_CONTEXT_FILE_ENV]);
    const { sections } = event.systemPromptOptions;
    // Editing sections (not the whole prompt) lets Pi patch only this section and keep the provider cache.
    if (text) sections[LEARNER_CONTEXT_SECTION] = text;
    else delete sections[LEARNER_CONTEXT_SECTION];
  });
}

function readLearnerContext(file: string | undefined): string {
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}
