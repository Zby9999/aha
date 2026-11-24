import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { expectedEvidenceAfterDemo } from "@aha/contracts/fixtures";
import { createLearnerModel, SEED_CONCEPTS } from "../src/index.ts";

const projects: string[] = [];
const background = { run: async () => ({ text: "", filesWritten: [] }) };

afterEach(async () => {
  await Promise.all(projects.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project() {
  const path = await mkdtemp(join(tmpdir(), "aha-learner-model-test-"));
  projects.push(path);
  return path;
}

it("loads 35 not-encountered seed Concepts into a new project's Markdown model", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });

  const concepts = await model.listConcepts();
  const files = await model.readFiles();

  expect(SEED_CONCEPTS).toHaveLength(35);
  expect(concepts).toHaveLength(35);
  expect(concepts.every((concept) => concept.mastery === "not_encountered")).toBe(true);
  expect(files).toHaveLength(36);
  expect(files.find((file) => file.path === "index.md")?.markdown).toContain("[concepts/session-tokens.md](concepts/session-tokens.md)");
  expect((await model.readConcepts(["session-tokens"]))[0]).toMatchObject({
    id: "session-tokens",
    name: "Session tokens identify a visitor across requests",
    mastery: "not_encountered",
    evidence: [],
  });
  expect(await readFile(join(projectDir, ".aha", "learner-model", "concepts", "session-tokens.md"), "utf8"))
    .toContain("## Evidence\n\nNo evidence yet.");
});

it("keeps an existing user-edited model unchanged instead of loading seeds over it", async () => {
  const projectDir = await project();
  const root = join(projectDir, ".aha", "learner-model");
  await mkdir(join(root, "concepts"), { recursive: true });
  const index = "# My learner model\n";
  const concept = "---\nid: custom-concept\nname: My own Concept\nmastery: explains_independently\nuser_edited: true\n---\n\nMy notes\n";
  await writeFile(join(root, "index.md"), index);
  await writeFile(join(root, "concepts", "custom-concept.md"), concept);

  const model = createLearnerModel({ projectDir, background });
  expect(await model.listConcepts()).toEqual([{ id: "custom-concept", name: "My own Concept", mastery: "explains_independently" }]);
  expect(await readFile(join(root, "index.md"), "utf8")).toBe(index);
  expect(await readFile(join(root, "concepts", "custom-concept.md"), "utf8")).toBe(concept);
});

it("appends demo Evidence to the golden session log without rewriting Concepts", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  await model.listConcepts();
  const conceptPath = join(projectDir, ".aha", "learner-model", "concepts", "session-tokens.md");
  const before = await readFile(conceptPath, "utf8");

  for (const evidence of expectedEvidenceAfterDemo) await model.appendEvidence(evidence);

  const produced = await readFile(join(projectDir, ".aha", "learner-model", "sessions", "demo-1.md"), "utf8");
  const golden = await readFile(join(import.meta.dirname, "../../contracts/fixtures/learner-model/after-demo/sessions/demo-1.md"), "utf8");
  expect(produced).toBe(golden.replaceAll("\r\n", "\n"));
  expect(await readFile(conceptPath, "utf8")).toBe(before);
  const [concept] = await model.readConcepts(["session-tokens"]);
  expect(concept?.mastery).toBe("not_encountered");
  expect(concept?.evidence.map((item) => item.id)).toEqual(["ev-1", "ev-3", "ev-4", "ev-7"]);
});

it("rejects a session id that could escape the model folder", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  await expect(model.appendEvidence({ ...expectedEvidenceAfterDemo[0]!, sessionId: "../outside" }))
    .rejects.toThrow("Invalid Evidence or session id");
});

it("saves a Concept edit and marks it as user edited", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  const path = "concepts/session-tokens.md";
  const original = (await model.readFiles()).find((file) => file.path === path)!.markdown;

  await model.writeFile({ path, markdown: original.replace("No evidence yet.", "My own note.") });

  const saved = (await model.readFiles()).find((file) => file.path === path)!.markdown;
  expect(saved).toContain("My own note.");
  expect(saved).toContain("user_edited: true");
  expect((await model.readConcepts(["session-tokens"]))[0]?.userEdited).toBe(true);
});

it("rejects an invalid Concept edit without changing its file", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  const path = "concepts/session-tokens.md";
  const original = (await model.readFiles()).find((file) => file.path === path)!.markdown;

  await expect(model.writeFile({ path, markdown: original.replace("id: session-tokens", "id: another-concept") }))
    .rejects.toThrow("matching id");
  expect((await model.readFiles()).find((file) => file.path === path)?.markdown).toBe(original);
  await expect(model.writeFile({ path: "../outside.md", markdown: original })).rejects.toThrow("Only the index");
});

it("Dreaming merges duplicate Concepts, keeps their Evidence, and uses restricted Pi tools", async () => {
  const projectDir = await project();
  const calls: unknown[] = [];
  const agent = { run: async (request: unknown) => {
    calls.push(request);
    return { text: JSON.stringify({ merges: [{ from: ["token-alias"], into: "session-tokens" }] }), filesWritten: [] };
  } };
  const model = createLearnerModel({ projectDir, background: agent });
  await model.listConcepts();
  const duplicate = "---\nid: token-alias\nname: Session tokens identify a visitor across requests\nmastery: not_encountered\nrelated_files: []\nuser_edited: false\n---\n\n# Token alias\n";
  await writeFile(join(projectDir, ".aha", "learner-model", "concepts", "token-alias.md"), duplicate);
  await model.appendEvidence({ ...expectedEvidenceAfterDemo[2]!, id: "ev-alias", conceptId: "token-alias" });

  const report = await model.dream("session_end");

  expect(report.merged).toEqual([{ from: ["token-alias"], into: "session-tokens" }]);
  expect((await model.readConcepts(["session-tokens"]))[0]?.evidence.map((item) => item.id)).toContain("ev-alias");
  await model.dream("idle");
  expect((await model.readConcepts(["session-tokens"]))[0]?.evidence.map((item) => item.id)).toContain("ev-alias");
  expect((await model.listConcepts()).some((item) => item.id === "token-alias")).toBe(false);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ tools: ["read", "grep", "find", "ls"], writableDirs: [] });
});

it("Dreaming changes Mastery only from behavioral Evidence and logs every run", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  await model.listConcepts();
  const first = await model.dream("idle");
  expect(first.masteryChanges).toEqual([]);
  await model.appendEvidence({ ...expectedEvidenceAfterDemo[5]!, id: "ev-new" });
  const second = await model.dream("session_end");
  expect(second.masteryChanges).toContainEqual({ conceptId: "data-belongs-to-user", from: "not_encountered", to: "correct_with_hints" });
  const log = await readFile(join(projectDir, ".aha", "learner-model", "changelog.md"), "utf8");
  expect(log.match(/## Dreaming/g)).toHaveLength(2);
});

it("Dreaming preserves a user-edited Concept unchanged", async () => {
  const projectDir = await project();
  const model = createLearnerModel({ projectDir, background });
  const path = "concepts/session-tokens.md";
  const original = (await model.readFiles()).find((file) => file.path === path)!.markdown;
  await model.writeFile({ path, markdown: original.replace("No evidence yet.", "My correction.") });
  const before = (await model.readFiles()).find((file) => file.path === path)!.markdown;
  await model.appendEvidence({ ...expectedEvidenceAfterDemo[3]!, id: "ev-protected" });

  const report = await model.dream("session_end");

  expect(report.skippedUserEdits).toContain("session-tokens");
  expect((await model.readFiles()).find((file) => file.path === path)?.markdown).toBe(before);
  expect((await model.readConcepts(["session-tokens"]))[0]?.evidence.map((item) => item.id)).toContain("ev-protected");
});
