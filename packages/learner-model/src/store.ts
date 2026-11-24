import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Concept, ConceptSummary, LearnerModelFactory, LearnerModelFile } from "@aha/contracts";
import { SEED_CONCEPTS } from "./seeds.ts";

const folder = (projectDir: string) => join(projectDir, ".aha", "learner-model");
const conceptFile = (id: string) => `concepts/${id}.md`;

function renderConcept(concept: ConceptSummary): string {
  return `---\nid: ${concept.id}\nname: ${concept.name}\nmastery: ${concept.mastery}\nrelated_files: []\nuser_edited: false\n---\n\n# ${concept.name}\n\n## Evidence\n\nNo evidence yet.\n`;
}

function renderIndex(concepts: readonly ConceptSummary[]): string {
  return `# Learner model\n\nConcepts begin at not encountered. Only observed behavior changes mastery.\n\n| Concept | Mastery Level | File |\n|---|---|---|\n${concepts.map((c) => `| ${c.name} | ${c.mastery.replaceAll("_", " ")} | [${conceptFile(c.id)}](${conceptFile(c.id)}) |`).join("\n")}\n`;
}

/** Creates the model once, without replacing files the user or Dreaming already wrote. */
export const createLearnerModel: LearnerModelFactory = ({ projectDir }) => {
  const root = folder(projectDir);
  let ready: Promise<void> | undefined;
  const initialize = () => ready ??= (async () => {
    await mkdir(join(root, "concepts"), { recursive: true });
    const existing = await readdir(root);
    if (existing.some((name) => name !== "concepts")) return;
    const conceptNames = await readdir(join(root, "concepts"));
    if (conceptNames.length > 0) return;
    await Promise.all(SEED_CONCEPTS.map((c) => writeFile(join(root, conceptFile(c.id)), renderConcept(c), { flag: "wx" })));
    await writeFile(join(root, "index.md"), renderIndex(SEED_CONCEPTS), { flag: "wx" });
  })();

  async function files(): Promise<LearnerModelFile[]> {
    await initialize();
    const paths = ["index.md", ...(await readdir(join(root, "concepts"))).filter((p) => p.endsWith(".md")).map((p) => `concepts/${p}`)];
    return Promise.all(paths.map(async (path) => ({ path, markdown: await readFile(join(root, path), "utf8") })));
  }

  async function concepts(): Promise<Concept[]> {
    const markdownFiles = await files();
    return markdownFiles.filter((f) => f.path.startsWith("concepts/")).flatMap(({ markdown }) => {
      const get = (key: string) => markdown.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
      const id = get("id");
      const name = get("name");
      const mastery = get("mastery");
      if (!id || !name || !mastery) return [];
      return [{ id, name, mastery: mastery as Concept["mastery"], relatedFiles: [], evidence: [], userEdited: get("user_edited") === "true" }];
    });
  }

  return {
    async appendEvidence() { throw new Error("Evidence log is implemented in issue #39"); },
    async listConcepts() { return (await concepts()).map(({ id, name, mastery }) => ({ id, name, mastery })); },
    async readConcepts(ids) { return (await concepts()).filter((c) => ids.includes(c.id)); },
    readFiles: files,
    async writeFile() { throw new Error("User edits are implemented in issue #40"); },
    async dream() { throw new Error("Dreaming is implemented in issues #41 and #42"); },
  };
};
