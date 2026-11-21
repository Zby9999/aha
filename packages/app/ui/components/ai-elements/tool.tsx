// Vendored from AI Elements 1.9.1 (Apache-2.0, © Vercel); trimmed, see README.md.
import type { ComponentProps, ReactNode } from "react";
import { CheckCircleIcon, ChevronDownIcon, ClockIcon, WrenchIcon, XCircleIcon } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";

export type ToolState = "running" | "completed" | "error";

const statusLabels: Record<ToolState, string> = { running: "Running", completed: "Completed", error: "Error" };
const statusIcons: Record<ToolState, ReactNode> = {
  running: <ClockIcon className="size-4 animate-pulse" />,
  completed: <CheckCircleIcon className="size-4 text-green-600" />,
  error: <XCircleIcon className="size-4 text-red-600" />,
};

export const Tool = ({ className, ...props }: ComponentProps<typeof Collapsible>) => (
  <Collapsible className={cn("group not-prose w-full rounded-md border bg-card", className)} {...props} />
);

export const ToolHeader = ({ className, title, state }: { className?: string; title: ReactNode; state: ToolState }) => (
  <CollapsibleTrigger className={cn("flex w-full items-center justify-between gap-4 p-3", className)}>
    <div className="flex min-w-0 items-center gap-2">
      <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{title}</span>
      <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
        {statusIcons[state]}
        {statusLabels[state]}
      </Badge>
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export const ToolContent = ({ className, ...props }: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent className={cn("space-y-4 p-4 pt-0 text-popover-foreground outline-none", className)} {...props} />
);

const Code = ({ children, className }: { children: string; className?: string }) => (
  <pre className={cn("overflow-x-auto rounded-md p-3 font-mono text-xs", className)}>{children}</pre>
);

export const ToolInput = ({ className, input, ...props }: ComponentProps<"div"> & { input: unknown }) => (
  <div className={cn("space-y-2 overflow-hidden", className)} {...props}>
    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</h4>
    <Code className="bg-muted/50">{JSON.stringify(input, null, 2)}</Code>
  </div>
);

export const ToolOutput = ({ className, output, errorText, ...props }: ComponentProps<"div"> & { output?: string; errorText?: string }) => {
  if (!(output || errorText)) return null;
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{errorText ? "Error" : "Result"}</h4>
      <Code className={errorText ? "bg-destructive/10 text-destructive" : "bg-muted/50"}>{errorText ?? output ?? ""}</Code>
    </div>
  );
};
