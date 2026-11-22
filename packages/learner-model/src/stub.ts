import type { ConceptSummary, Evidence, LearnerModelFactory, LearnerModelFile } from "@aha/contracts";

/** Learner model stub: keeps Evidence in memory, writes no files, and Dreaming changes nothing. */
export const createStubLearnerModel: LearnerModelFactory = () => {
  const evidence: Evidence[] = [];
  const edits = new Map<string, string>();
  const concepts = (): ConceptSummary[] =>
    [...new Set(evidence.map((e) => e.conceptId))].map((id) => ({ id, name: id, mastery: "seen_explanation" }));

  return {
    async appendEvidence(item) {
      evidence.push(item);
    },
    async listConcepts() {
      return concepts();
    },
    async readConcepts(ids) {
      return concepts()
        .filter((c) => ids.includes(c.id))
        .map((c) => ({ ...c, evidence: evidence.filter((e) => e.conceptId === c.id), relatedFiles: [], userEdited: edits.size > 0 }));
    },
    async readFiles(): Promise<LearnerModelFile[]> {
      const index = ["# Learner model (stub)", "", ...concepts().map((c) => `- ${c.name}: ${c.mastery}`)].join("\n");
      return [{ path: "index.md", markdown: edits.get("index.md") ?? index }];
    },
    async writeFile(file) {
      edits.set(file.path, file.markdown);
    },
    async dream() {
      return { changeLogPath: "changelog.md", merged: [], masteryChanges: [], skippedUserEdits: [] };
    },
  };
};
