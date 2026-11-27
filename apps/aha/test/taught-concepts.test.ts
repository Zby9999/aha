import { join } from "node:path";
import { createBackend } from "@aha/app";
import { isKind, type AhaModules, type BackgroundRunRequest, type Concept, type Evidence, type Impasse } from "@aha/contracts";
import { expect, test } from "vitest";
import { buildModules } from "../src/modules.ts";

// Seam: the backend with real Teaching, a fake model and a fake read gate. Live (W5), an Ask why about session tokens
// was credited to client-server and shared-state, the Concepts the question alone suggested (#96).

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const concept = (id: string, name: string): Concept => ({ id, name, mastery: "not_encountered", evidence: [], relatedFiles: [], userEdited: false });
const concepts = [concept("client-server", "Client and server"), concept("shared-state", "Shared state"), concept("session-tokens", "Session tokens")];
const citations = [{ path: "server.js", startLine: 19, endLine: 21 }];

test("an Articulation is credited to the Concepts the Lesson explained, not only those its question suggested", async () => {
  const trace: BackgroundRunRequest[] = [];
  const gated: Impasse[] = [];
  const evidence: Evidence[] = [];
  const base = buildModules({ agentHost: "stub", background: "real", decisions: "stub", learnerModel: "stub", teaching: "real" });
  const modules: AhaModules = {
    ...base,
    background: { async run(request) {
      trace.push(request);
      const draft = request.prompt.includes('"question":"..."') ? { question: "What happens to the token on refresh?", citations }
        : request.prompt.includes("Assess the actual Articulation")
          ? { result: "correct", credits: [{ conceptId: "session-tokens", answerQuote: "a new token" }, { conceptId: "client-server", answerQuote: "the server" }], citations }
          : { component: "TextExplanation", props: { title: "A new session token", text: "Each page load makes a new sessionToken the server has never seen.", citations } };
      return { text: JSON.stringify(draft), filesWritten: [] };
    } },
    decisions: {
      ...base.decisions,
      async selectConcepts({ impasse }) {
        gated.push(impasse);
        return impasse.text?.includes("The Lesson explained:") ? ["session-tokens"] : ["client-server", "shared-state"];
      },
    },
    learnerModel(options) {
      return {
        ...base.learnerModel(options),
        async listConcepts() { return concepts.map(({ id, name, mastery }) => ({ id, name, mastery })); },
        async readConcepts(ids) { return concepts.filter(({ id }) => ids.includes(id)); },
        async appendEvidence(entry) { evidence.push(entry); },
      };
    },
  };
  const backend = await createBackend({ projectDir, sessionId: "taught", modules });
  try {
    await backend.dispatch({ type: "ask_why", text: "My projects disappear when I refresh. Why?" });
    await backend.settled();
    for (const [step, text] of [["probe", "I don't know."], ["articulate", "The page makes a new token, so the server doesn't know me."]] as const) {
      const card = backend.timeline.entries().filter((entry) => isKind(entry, "lesson_card")).findLast((entry) => entry.step === step)!;
      await backend.dispatch({ type: "card_answer", lessonId: card.lessonId, cardEntryId: card.id, answer: { type: "text", text } });
      await backend.settled();
    }
    expect(gated.at(-1)?.text).toContain("My projects disappear when I refresh. Why?");
    expect(gated.at(-1)?.text).toContain("The Lesson explained: A new session token Each page load makes a new sessionToken");
    const assessment = trace.find(({ prompt }) => prompt.includes("Assess the actual Articulation"))!;
    const context = JSON.parse(assessment.prompt.split("Lesson context (JSON):\n")[1]!);
    expect(context.discussion.concepts).toEqual([{ id: "session-tokens", name: "Session tokens" }]);
    expect(backend.timeline.entries().find((entry) => entry.kind === "answer_assessment")).toMatchObject({ conceptIds: ["session-tokens"] });
    expect(evidence.map(({ conceptId }) => conceptId)).toEqual(["session-tokens"]);
  } finally {
    await backend.stop();
  }
});
