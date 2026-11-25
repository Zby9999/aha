import { posix } from "node:path";
import type { CatalogComponent, DecisionService, LessonStep } from "@aha/contracts";

const COMPONENT_FOR_STEP: Record<LessonStep, CatalogComponent> = {
  probe: "ProbeCard",
  explain: "TextExplanation",
  articulate: "ArticulationCard",
};

const normalize = (path: string) => posix.normalize(path.replaceAll("\\", "/"));

export const cardDecisions: Pick<DecisionService, "chooseComponent" | "checkGrounding"> = {
  async chooseComponent({ step }) {
    return COMPONENT_FOR_STEP[step];
  },
  async checkGrounding({ explanation, citations, project, latestChange }) {
    const known = new Set(project.files.map(normalize));
    if (latestChange?.kind === "file_edit") known.add(normalize(latestChange.path));
    const props = explanation.elements[explanation.root]?.props;
    const rendered: unknown = props?.citations;
    const paths: string[] = [];
    const valid = Array.isArray(rendered) && rendered.length > 0 && rendered.every((item: unknown) => {
      if (!item || typeof item !== "object" || !("path" in item) || typeof item.path !== "string") return false;
      paths.push(normalize(item.path));
      return true;
    });
    const declared = citations.map(({ path }) => normalize(path));
    const missingFiles = [...new Set([...paths, ...declared].filter((path) => !known.has(path)))];
    const grounded = valid && missingFiles.length === 0 && paths.every((p) => declared.includes(p))
      && declared.every((p) => paths.includes(p));
    return { grounded, missingFiles, reason: grounded ? "Card cites project files" : "Missing or inconsistent project citations" };
  },
};
