import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Concept, ConceptSummary, Evidence, LearnerModelFactory, LearnerModelFile } from "@aha/contracts";
import { SEED_CONCEPTS } from "./seeds.ts";

const folder = (projectDir: string) => join(projectDir, ".aha", "learner-model");
const conceptFile = (id: string) => `concepts/${id}.md`;
const sessionFile = (sessionId: string) => `sessions/${sessionId}.md`;
const SESSION_HEADER = (sessionId: string) => `# Session ${sessionId}\n\nEvidence appended during the session, in order. Concept files are rewritten only by Dreaming.\n`;

function renderEvidence(e: Evidence): string {
  return `\n## ${e.id}\n- concept: ${e.conceptId}\n- type: ${e.type} · outcome: ${e.outcome} · strength: ${e.strength}\n- entries: ${e.entryIds.join(", ")}\n- at: ${e.at}\n- note: ${e.note}\n`;
}

function parseEvidence(markdown: string, sessionId: string): Evidence[] {
  return markdown.split(/\n## /).slice(1).flatMap((block) => {
    const field = (name: string) => block.match(new RegExp(`^- ${name}: (.*)$`, "m"))?.[1];
    const id = block.match(/^([^\n]+)/)?.[1];
    const conceptId = field("concept");
    const details = field("type")?.match(/^([^·]+) · outcome: ([^·]+) · strength: (.+)$/);
    const at = field("at");
    const note = field("note");
    if (!id || !conceptId || !details || !at || !note) return [];
    return [{ id, conceptId, type: details[1]!.trim() as Evidence["type"], outcome: details[2]!.trim() as Evidence["outcome"], strength: details[3]!.trim() as Evidence["strength"], sessionId, entryIds: field("entries")?.split(", ") ?? [], at, note }];
  });
}

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
  let writing: Promise<void> = Promise.resolve();
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
    const sessions = await readdir(join(root, "sessions")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const paths = ["index.md", ...(await readdir(join(root, "concepts"))).filter((p) => p.endsWith(".md")).map((p) => `concepts/${p}`), ...sessions.filter((p) => p.endsWith(".md")).map((p) => `sessions/${p}`)];
    return Promise.all(paths.map(async (path) => ({ path, markdown: await readFile(join(root, path), "utf8") })));
  }

  async function concepts(): Promise<Concept[]> {
    const markdownFiles = await files();
    const evidence = markdownFiles.filter((f) => f.path.startsWith("sessions/")).flatMap((f) => parseEvidence(f.markdown, f.path.slice("sessions/".length, -3)));
    return markdownFiles.filter((f) => f.path.startsWith("concepts/")).flatMap(({ markdown }) => {
      const get = (key: string) => markdown.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
      const id = get("id");
      const name = get("name");
      const mastery = get("mastery");
      if (!id || !name || !mastery) return [];
      const relatedFiles = markdown.match(/^related_files:\n((?:  - .*\n)*)/m)?.[1]?.trim().split("\n").map((line) => line.replace(/^\s*- /, "")) ?? [];
      return [{ id, name, mastery: mastery as Concept["mastery"], relatedFiles, evidence: evidence.filter((item) => item.conceptId === id), userEdited: get("user_edited") === "true" }];
    });
  }

  return {
    async appendEvidence(evidence) {
      if (!/^[a-zA-Z0-9_-]+$/.test(evidence.sessionId) || !/^[a-zA-Z0-9_-]+$/.test(evidence.id)) throw new Error("Invalid Evidence or session id");
      const append = async () => {
        await initialize();
        await mkdir(join(root, "sessions"), { recursive: true });
        const path = join(root, sessionFile(evidence.sessionId));
        await writeFile(path, SESSION_HEADER(evidence.sessionId), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
        await appendFile(path, renderEvidence(evidence));
      };
      const result = writing.then(append);
      writing = result.catch(() => {});
      return result;
    },
    async listConcepts() { return (await concepts()).map(({ id, name, mastery }) => ({ id, name, mastery })); },
    async readConcepts(ids) { await writing; return (await concepts()).filter((c) => ids.includes(c.id)); },
    readFiles: files,
    async writeFile(file) {
      if (file.path !== "index.md" && !/^concepts\/[a-z0-9-]+\.md$/.test(file.path)) throw new Error("Only the index and Concept files can be edited");
      await initialize();
      const path = join(root, file.path);
      await readFile(path, "utf8");
      let markdown = file.markdown;
      if (file.path.startsWith("concepts/")) {
        const id = file.path.slice("concepts/".length, -3);
        if (!markdown.startsWith("---\n") || !markdown.includes(`\nid: ${id}\n`) || !/^name: .+$/m.test(markdown) || !/^mastery: (not_encountered|seen_explanation|correct_with_hints|explains_independently|catches_agent_mistakes)$/m.test(markdown)) {
          throw new Error("Concept Markdown needs a matching id, name and valid Mastery Level");
        }
        markdown = /^user_edited: .*$/m.test(markdown)
          ? markdown.replace(/^user_edited: .*$/m, "user_edited: true")
          : markdown.replace(/^---\n/, "---\nuser_edited: true\n");
      }
      await writeFile(path, markdown);
    },
    async dream() { throw new Error("Dreaming is implemented in issues #41 and #42"); },
  };
};
