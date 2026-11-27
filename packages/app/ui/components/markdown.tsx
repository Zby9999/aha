import type { ComponentProps } from "react";
import { Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/components/ui/code-block";

// Agent replies as Markdown that renders while it streams; fenced code goes to Code Block
// (shadcn/ui "Code Block → Markdown" pattern).

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  const incomplete = useIsCodeFenceIncomplete();
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({ node: _node, className, children, ...props }: ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with data-block; everything else is inline.
  if (!("data-block" in props)) {
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    );
  }
  return <MarkdownCodeBlock code={typeof children === "string" ? children : ""} language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""} />;
}

const components = { code: MarkdownCode };

export function Markdown({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown className="leading-relaxed" controls={false} components={components} isAnimating={streaming} mode={streaming ? "streaming" : "static"}>
      {children}
    </Streamdown>
  );
}
