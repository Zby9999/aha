import { useState } from "react";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { Button } from "@/components/ui/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockLine,
} from "@/components/ui/code-block";

// A unified diff in shadcn/ui's Code Block, following its "Diff" pattern: each line is a CodeBlockLine with an
// added or removed marker, highlighted in the edited file's language.

type Variant = "added" | "removed" | "highlighted" | "default";

/** Lines taller than this fold behind Show more. */
const FOLDED_LINES = 16;

function parse(diff: string): { variant: Variant; text: string }[] {
  return diff
    .replace(/\n$/, "")
    .split("\n")
    // The file is already named next to the diff, so the ---/+++ headers add nothing.
    .filter((line) => !line.startsWith("--- ") && !line.startsWith("+++ "))
    .map((line) => {
      if (line.startsWith("@@")) return { variant: "highlighted", text: line };
      if (line.startsWith("+")) return { variant: "added", text: line.slice(1) };
      if (line.startsWith("-")) return { variant: "removed", text: line.slice(1) };
      return { variant: "default", text: line.startsWith(" ") ? line.slice(1) : line };
    });
}

export function DiffBlock({ diff, path }: { diff: string; path: string }) {
  const lines = parse(diff);
  const language = /\.([a-z0-9]+)$/i.exec(path)?.[1] ?? "";
  // Hunk headers are not code; they keep their own text instead of a highlighted line.
  const highlighted = useHighlightedCode(lines.map((line) => (line.variant === "highlighted" ? "" : line.text)).join("\n"), language);
  const [expanded, setExpanded] = useState(false);
  const foldable = lines.length > FOLDED_LINES;

  return (
    <CodeBlock size="sm" className="mt-2">
      <CodeBlockActions>
        <CodeBlockCopyButton value={diff} />
      </CodeBlockActions>
      <CodeBlockContent className={foldable && !expanded ? "max-h-72 scroll-fade-y" : undefined}>
        {lines.map((line, index) => (
          <CodeBlockLine key={index} variant={line.variant} className={line.variant === "highlighted" ? "text-muted-foreground" : undefined}>
            {line.variant === "highlighted" ? line.text : highlighted[index]}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
      {foldable && (
        <CodeBlockFooter>
          <Button type="button" size="xs" variant="ghost" onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Show less" : `Show all ${lines.length} lines`}
          </Button>
        </CodeBlockFooter>
      )}
    </CodeBlock>
  );
}
