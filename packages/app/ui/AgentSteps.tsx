import { useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, FileIcon, LoaderIcon, SearchIcon, ToolIcon } from "@/components/icons";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { AgentStep } from "./timelineView.ts";

// The agent's tool calls inside a reply, following shadcn/ui AI Elements: each call is a "Tool" step, and a run of
// several calls is a "Chain of Thought" summary that expands into its steps.

const TOOL_VERBS: Record<string, [running: string, done: string]> = {
  read: ["Reading", "Read"],
  edit: ["Editing", "Edited"],
  write: ["Writing", "Wrote"],
  grep: ["Searching", "Searched"],
  find: ["Finding", "Found"],
  ls: ["Listing", "Listed"],
  bash: ["Running", "Ran"],
};

function stepTitle(step: AgentStep): string {
  const [running, done] = TOOL_VERBS[step.toolName] ?? ["Running", "Ran"];
  const target = typeof step.args.path === "string" ? step.args.path : typeof step.args.command === "string" ? step.args.command : step.toolName;
  if (step.state === "running") return `${running} ${target}`;
  return `${done} ${target}${step.state === "error" || step.error ? " (failed)" : ""}`;
}

function stepIcon(step: AgentStep) {
  if (step.toolName === "read") return <FileIcon />;
  return step.toolName === "grep" || step.toolName === "find" ? <SearchIcon /> : <ToolIcon />;
}

const failed = (step: AgentStep) => step.state === "error" || Boolean(step.error);

/** One tool call: a plain line while it runs, then a line that opens its output (or its error, opened by default). */
function ToolStep({ step }: { step: AgentStep }) {
  const line = (status?: "running" | "error") => (
    <TraceLine status={status}>
      <TraceIcon>{stepIcon(step)}</TraceIcon>
      <TraceTitle>{stepTitle(step)}</TraceTitle>
    </TraceLine>
  );
  if (step.state === "running") return line("running");
  const error = failed(step);
  const output = step.error ?? step.output ?? "";
  if (!output) return line(error ? "error" : undefined);
  return (
    <TraceCollapsible defaultOpen={error}>
      <TraceCollapsibleTrigger>{line(error ? "error" : undefined)}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <CodeBlock size="sm" variant={error ? "destructive" : "default"}>
          <CodeBlockContent wrap className="max-h-64">{output}</CodeBlockContent>
        </CodeBlock>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function StatusIcon({ status }: { status?: "running" | "error" }) {
  if (status === "running") return <LoaderIcon className="animate-spin" />;
  return status === "error" ? <CircleAlertIcon /> : <CircleCheckIcon />;
}

/** A run of tool calls. One call shows as itself; several fold under a summary that stays open while they run. */
export function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const [open, setOpen] = useState<boolean>();
  if (steps.length === 1) return <Trace><ToolStep step={steps[0]!} /></Trace>;

  const current = steps.find((step) => step.state === "running");
  const failures = steps.filter(failed).length;
  const status = current ? "running" : failures > 0 ? "error" : undefined;
  return (
    <Trace>
      <TraceCollapsible open={open ?? Boolean(current)} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceIcon><StatusIcon status={status} /></TraceIcon>
            <TraceTitle>
              {current ? stepTitle(current) : `Worked in ${steps.length} steps${failures > 0 ? `, ${failures} failed` : ""}`}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          <Trace>
            {steps.map((step) => <ToolStep key={step.key} step={step} />)}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
