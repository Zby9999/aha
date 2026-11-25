import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Citation, LessonInput, TimelineEntry, TimelineEntryOf } from "@aha/contracts";
import { relevantConcepts } from "./lesson-format.ts";

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|html?|css|py|rb|go|rs|java|kt|cs|php|sql)$/i;
const isSourceFile = (path: string) => SOURCE_FILE.test(path) && !path.split("/").some((part) => part.startsWith(".") || part === "node_modules");

export interface LessonSources {
  latestChange?: TimelineEntryOf<"file_edit">;
  focusFiles?: string[];
  evidence: { kind: string; text: string }[];
  files: { path: string; firstLine: number; lines: string[] }[];
}

function isAgentEdit(entry: TimelineEntry): entry is TimelineEntryOf<"file_edit"> {
  return entry.kind === "file_edit" && entry.source === "agent-host";
}

export async function captureLessonSources(
  { impasse, learner, project, timeline }: LessonInput,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): Promise<LessonSources> {
  const related = timeline.filter((entry) => impasse.sourceEntryIds.includes(entry.id));
  const throughSeq = related.at(-1)?.seq ?? Infinity;
  const edit = related.findLast(isAgentEdit) ?? timeline.filter(({ seq }) => seq <= throughSeq).findLast(isAgentEdit);
  const latestChange = edit && !isAbsolute(edit.path) && isSourceFile(edit.path) ? edit : undefined;
  const question = impasse.text ?? impasse.title;
  const triggerEntry = related.at(-1) ?? latestChange;
  const workRequest = impasse.trigger !== "ask_why" && triggerEntry
    ? timeline.findLast((entry) => entry.kind === "user_message" && entry.seq < triggerEntry.seq)
    : undefined;
  const recentRelated = related.slice(-4);
  const referencedFiles = related.flatMap((entry) => entry.kind === "file_edit" || (entry.kind === "error" && entry.path) ? [entry.path] : []);
  const evidence = [...new Set(workRequest ? [workRequest, ...recentRelated] : recentRelated)].flatMap<LessonSources["evidence"][number]>((entry) => {
    if (entry.kind === "error") return [{ kind: entry.kind, text: entry.message.slice(0, 750) }];
    if (entry.kind === "user_message" || entry.kind === "agent_message") return [{ kind: entry.kind, text: entry.text.slice(0, 750) }];
    return [];
  });
  const orderedPaths = new Set([
    ...referencedFiles,
    latestChange?.path,
    ...project.files.filter((path) => question.includes(path)),
    ...relevantConcepts(impasse, learner).flatMap(({ relatedFiles }) => relatedFiles),
    ...timeline.slice(-50).reverse().flatMap((entry) => (
      entry.kind === "tool_call" && entry.toolName === "read" && typeof entry.args.path === "string" ? [entry.args.path] : []
    )),
    ...project.files,
  ]);
  const allowed = new Set(project.files);
  const root = await realpath(project.projectDir);
  const files: LessonSources["files"] = [];

  for (const path of orderedPaths) {
    if (files.length === 4) break;
    if (!path || !allowed.has(path) || !isSourceFile(path)) continue;
    try {
      const resolved = await realpath(resolve(root, path));
      const fromRoot = relative(root, resolved);
      if (isAbsolute(fromRoot) || !isSourceFile(fromRoot.split(sep).join("/"))) continue;
      const info = await stat(resolved);
      if (!info.isFile() || info.size > 256_000) continue;
      const text = await readFile(resolved, "utf8");
      if (!text.trim() || text.includes("\0")) continue;
      const source = text.trimEnd().split(/\r?\n/);
      const location = [question, ...evidence.map(({ text }) => text)]
        .map((text) => text.split(`${path}:`)[1]?.match(/^\d+/)?.[0]).find(Boolean);
      const changeLine = path === latestChange?.path ? latestChange.diff?.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m)?.[1] : undefined;
      const focusedLine = Number(location ?? changeLine);
      const firstLine = focusedLine <= source.length ? Math.max(1, focusedLine - 30) : 1;
      const lines: string[] = [];
      let remaining = 10_000;
      for (const line of source.slice(firstLine - 1, firstLine + 199)) {
        if (line.length + 1 > remaining) break;
        lines.push(line);
        remaining -= line.length + 1;
      }
      if (lines.some((line) => line.trim())) files.push({ path, firstLine, lines });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM"].includes(String(error.code)))) throw error;
    }
  }

  if (!files.length && !allowEmpty) throw new Error("No readable project source was available for this Lesson.");
  const focusFiles = files.map(({ path }) => path).filter((path) => referencedFiles.includes(path) || question.includes(path));
  return { files, evidence, focusFiles, ...(latestChange ? { latestChange } : {}) };
}

export function changeCitation(sources: LessonSources): Citation | undefined {
  const edit = sources.latestChange;
  const file = edit && sources.files.find(({ path }) => path === edit.path);
  if (!file) return undefined;
  const hunkLine = Number(edit?.diff?.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m)?.[1]);
  const offset = file.lines.findIndex((line) => line.trim());
  const startLine = file.lines[hunkLine - file.firstLine]?.trim() ? hunkLine : file.firstLine + offset;
  return offset >= 0 ? { path: file.path, startLine } : undefined;
}

export function relevantCitation(input: LessonInput, sources: LessonSources, requireEdit: boolean): Citation | undefined {
  const { impasse, timeline } = input;
  const paths = new Set(relevantConcepts(impasse, input.learner).flatMap(({ relatedFiles }) => relatedFiles));
  for (const entry of timeline) {
    if (impasse.sourceEntryIds.includes(entry.id) && (entry.kind === "file_edit" || entry.kind === "error") && entry.path) paths.add(entry.path);
  }
  const title = impasse.text ?? impasse.title;
  const isRelevant = (path: string) => paths.has(path) || title.includes(path);
  if (sources.latestChange && isRelevant(sources.latestChange.path)) {
    const edit = changeCitation(sources);
    if (edit) return edit;
  }
  if (requireEdit) return undefined;
  const file = sources.files.find(({ path }) => isRelevant(path));
  if (!file) return undefined;
  return { path: file.path, startLine: file.firstLine + file.lines.findIndex((line) => line.trim()) };
}

/** Only cite actual lines from the source shown to Pi, using the project's relative paths. */
export function citesLessonSources(citations: readonly Citation[], sources: LessonSources): boolean {
  return citations.length > 0 && citations.every(({ path, startLine, endLine = startLine }) => {
    if (startLine === undefined || endLine === undefined || startLine > endLine) return false;
    return sources.files.some((file) => file.path === path
      && startLine >= file.firstLine && endLine < file.firstLine + file.lines.length
      && file.lines.slice(startLine - file.firstLine, endLine - file.firstLine + 1).some((line) => line.trim()));
  });
}

export function citesImpasseSources(citations: readonly Citation[], sources: LessonSources): boolean {
  const { focusFiles } = sources;
  return citesLessonSources(citations, sources) && (!focusFiles?.length || citations.some(({ path }) => focusFiles.includes(path)));
}
