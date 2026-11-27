import { useEffect, useState } from "react";
import { useHighlightedCode } from "../hooks/use-highlighted-code.ts";
import { CodeBlock, CodeBlockContent, CodeBlockLine } from "../components/ui/code-block.tsx";

/** Lines shown around each cited range, so the cited lines read in context. */
const CONTEXT = 2;
/** A citation without line numbers shows the start of the file. */
const UNRANGED_LINES = 40;

export type LineRange = { start: number; end: number };

/** Each file is fetched once per page; every card citing it reuses the request. */
const files = new Map<string, Promise<string>>();

function projectFile(path: string): Promise<string> {
  let file = files.get(path);
  if (!file) {
    file = fetch(`/api/project-file?path=${encodeURIComponent(path)}`).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      return ((await response.json()) as { text: string }).text;
    });
    file.catch(() => files.delete(path));
    files.set(path, file);
  }
  return file;
}

/** The cited lines of a project file in a Code Block: line numbers, the cited lines highlighted, a little context around them. */
export function CitedCode({ path, ranges }: { path: string; ranges: LineRange[] }) {
  const [state, setState] = useState<{ text?: string; failed?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    projectFile(path).then(
      (text) => { if (!cancelled) setState({ text }); },
      () => { if (!cancelled) setState({ failed: true }); },
    );
    return () => { cancelled = true; };
  }, [path]);

  const language = /\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "";
  const highlighted = useHighlightedCode(state.text ?? "", language);

  if (state.failed) return <p className="px-1 py-2 text-xs text-muted-foreground">This file can't be shown here.</p>;
  if (state.text === undefined) return <p className="px-1 py-2 text-xs text-muted-foreground" role="status">Loading {path}…</p>;

  const total = highlighted.length;
  const windows = merge((ranges.length ? ranges : [{ start: 1, end: Math.min(total, UNRANGED_LINES) }]).map(({ start, end }) => ({
    start: Math.max(1, start - (ranges.length ? CONTEXT : 0)),
    end: Math.min(total, end + (ranges.length ? CONTEXT : 0)),
  })));
  const cited = (line: number) => ranges.some(({ start, end }) => line >= start && line <= end);

  return (
    <div className="grid gap-1.5">
      {windows.map((window) => (
        <CodeBlock key={window.start} size="sm" aria-label={`${path} lines ${window.start}–${window.end}`}>
          <CodeBlockContent lineNumbers startLine={window.start} className="max-h-72 scroll-fade-y">
            {highlighted.slice(window.start - 1, window.end).map((line, index) => (
              <CodeBlockLine key={index} variant={cited(window.start + index) ? "highlighted" : "default"}>{line}</CodeBlockLine>
            ))}
          </CodeBlockContent>
        </CodeBlock>
      ))}
    </div>
  );
}

/** Overlapping or adjacent windows become one block. */
function merge(windows: LineRange[]): LineRange[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  return sorted.reduce<LineRange[]>((merged, next) => {
    const last = merged.at(-1);
    if (last && next.start <= last.end + 1) last.end = Math.max(last.end, next.end);
    else merged.push({ ...next });
    return merged;
  }, []);
}
