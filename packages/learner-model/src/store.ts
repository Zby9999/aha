import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Concept, ConceptSummary, DreamingReport, Evidence, LearnerModelFactory, LearnerModelFile } from "@aha/contracts";
import { masteryFromEvidence, proposedMerges } from "./dreaming.ts";
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

function consolidatedConcept(concept: Concept, aliases: readonly string[]): string {
  const related = concept.relatedFiles.length ? `\n${concept.relatedFiles.map((file) => `  - ${file}`).join("\n")}` : " []";
  const evidence = concept.evidence.length ? concept.evidence.map((item) => {
    const first = item.entryIds[0] ?? item.sessionId;
    return `- ${item.id} · ${item.type.replaceAll("_", " ")} · ${item.outcome} · ${item.strength} · [${first}](../sessions/${item.sessionId}.md#${item.id}): ${item.note}`;
  }).join("\n") : "No evidence yet.";
  return `---\nid: ${concept.id}\nname: ${concept.name}\nmastery: ${concept.mastery}\nrelated_files:${related}\nmerged_from: [${aliases.join(", ")}]\nuser_edited: false\n---\n\n# ${concept.name}\n\n## Evidence\n\n${evidence}\n`;
}

/** Creates the model once, without replacing files the user or Dreaming already wrote. */
export const createLearnerModel: LearnerModelFactory = ({ projectDir, background }) => {
  const root = folder(projectDir);
  let ready: Promise<void> | undefined;
  let writing: Promise<void> = Promise.resolve();
  let dreaming: Promise<DreamingReport> | undefined;
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
    const rootFiles = (await readdir(root)).filter((p) => p === "index.md" || p === "changelog.md");
    const paths = [...rootFiles, ...(await readdir(join(root, "concepts"))).filter((p) => p.endsWith(".md")).map((p) => `concepts/${p}`), ...sessions.filter((p) => p.endsWith(".md")).map((p) => `sessions/${p}`)];
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
      const aliases = markdown.match(/^merged_from: \[(.*)\]$/m)?.[1]?.split(", ").filter(Boolean) ?? [];
      return [{ id, name, mastery: mastery as Concept["mastery"], relatedFiles, evidence: evidence.filter((item) => item.conceptId === id || aliases.includes(item.conceptId)), userEdited: get("user_edited") === "true" }];
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
      if (file.path === "index.md" && !markdown.includes("<!-- user_edited: true -->")) markdown += "\n<!-- user_edited: true -->\n";
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
    async dream(trigger) {
      if (dreaming) return dreaming;
      dreaming = (async (): Promise<DreamingReport> => {
        await writing;
        const before = await concepts();
        let modelUnavailable = false;
        const result = await background.run({
          cwd: projectDir,
          tools: ["read", "grep", "find", "ls"],
          writableDirs: [],
          systemPrompt: "Identify only truly duplicate learner-model Concepts. Return JSON only: {\"merges\":[{\"from\":[\"duplicate-id\"],\"into\":\"canonical-id\"}]}. Do not infer mastery. Never modify files.",
          prompt: JSON.stringify(before.map(({ id, name }) => ({ id, name }))),
        }).catch(() => { modelUnavailable = true; return { text: "", filesWritten: [] }; });
        const proposals = proposedMerges(result.text, before);
        const report: DreamingReport = { changeLogPath: "changelog.md", merged: [], masteryChanges: [], skippedUserEdits: [] };
        const current = await concepts();
        const byId = new Map(current.map((item) => [item.id, item]));
        const consumed = new Set<string>();
        const aliases = new Map<string, string[]>();
        for (const proposal of proposals) {
          const target = byId.get(proposal.into);
          const sources = proposal.from.map((id) => byId.get(id)).filter((item): item is Concept => Boolean(item));
          if (!target || target.userEdited || sources.some((item) => item.userEdited) || sources.length !== proposal.from.length || consumed.has(target.id) || sources.some((item) => consumed.has(item.id))) {
            for (const item of [target, ...sources]) if (item?.userEdited) report.skippedUserEdits.push(item.id);
            continue;
          }
          for (const source of sources) {
            target.evidence.push(...source.evidence);
            target.relatedFiles.push(...source.relatedFiles);
            consumed.add(source.id);
          }
          const inherited = await Promise.all(sources.map(async (item) => {
            const markdown = await readFile(join(root, conceptFile(item.id)), "utf8");
            return markdown.match(/^merged_from: \[(.*)\]$/m)?.[1]?.split(", ").filter(Boolean) ?? [];
          }));
          aliases.set(target.id, [...sources.map((item) => item.id), ...inherited.flat()]);
          report.merged.push({ from: sources.map((item) => item.id), into: target.id });
        }
        for (const concept of current) {
          if (consumed.has(concept.id)) continue;
          const latest = await readFile(join(root, conceptFile(concept.id)), "utf8");
          if (/^user_edited: true$/m.test(latest)) {
            if (!report.skippedUserEdits.includes(concept.id)) report.skippedUserEdits.push(concept.id);
            continue;
          }
          const next = masteryFromEvidence(concept.mastery, concept.evidence);
          if (next !== concept.mastery) report.masteryChanges.push({ conceptId: concept.id, from: concept.mastery, to: next });
          concept.mastery = next;
          concept.relatedFiles = [...new Set(concept.relatedFiles)];
          const priorAliases = latest.match(/^merged_from: \[(.*)\]$/m)?.[1]?.split(", ").filter(Boolean) ?? [];
          await writeFile(join(root, conceptFile(concept.id)), consolidatedConcept(concept, [...new Set([...priorAliases, ...(aliases.get(concept.id) ?? [])])]));
        }
        for (const id of consumed) {
          const latest = await readFile(join(root, conceptFile(id)), "utf8");
          if (/^user_edited: true$/m.test(latest)) { report.skippedUserEdits.push(id); continue; }
          await rm(join(root, conceptFile(id)));
        }
        const remaining = await concepts();
        const index = await readFile(join(root, "index.md"), "utf8");
        if (!index.includes("<!-- user_edited: true -->")) await writeFile(join(root, "index.md"), renderIndex(remaining));
        const lines = [`\n## Dreaming (${trigger}, ${new Date().toISOString()})`,
          ...(modelUnavailable ? ["- Restricted Pi unavailable; duplicate detection skipped."] : []),
          ...report.merged.map((item) => `- Merged ${item.from.join(", ")} into ${item.into}.`),
          ...report.masteryChanges.map((item) => `- ${item.conceptId}: ${item.from} → ${item.to}.`),
          ...report.skippedUserEdits.map((id) => `- Preserved user edit: ${id}.`)];
        await writeFile(join(root, "changelog.md"), "# Change log\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
        await appendFile(join(root, "changelog.md"), `${lines.join("\n")}\n`);
        return report;
      })();
      try { return await dreaming; } finally { dreaming = undefined; }
    },
  };
};
