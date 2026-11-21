import { useState } from "react";
import type { CardAnswer, TimelineEntry, UserAction } from "@aha/contracts";
import { AlertTriangle, FilePen, FileText, HelpCircle, Lightbulb, Search, Wrench } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Message, MessageContent } from "@/components/ui/message";
import { Toggle } from "@/components/ui/toggle";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { toViewItems, type ViewItem } from "./timelineView.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const [askWhy, setAskWhy] = useState(false);
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const items = toViewItems(entries);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="flex items-baseline gap-3 border-b px-4 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Aha</h1>
        <span className="text-sm text-muted-foreground">Replaying the demo session with stub modules</span>
      </header>
      <MessageScrollerProvider autoScroll>
        <MessageScroller aria-label="Timeline">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-3 px-3 pt-6 pb-16">
              {items.map((item) => (
                <MessageScrollerItem
                  key={item.key}
                  messageId={item.key}
                  scrollAnchor={item.type === "entry" && item.entry.kind === "user_message"}
                  // Items use content-visibility, which clips paint at their box: leave room for card rings and shadows.
                  className="p-1"
                >
                  <ViewItemView item={item} dispatch={dispatch} answered={answered} responded={responded} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {error && <p className="px-4 text-sm text-destructive" role="alert">{error}</p>}
      <form
        className="flex gap-2 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          // With Ask why on, the message starts an Impasse and a Lesson instead of going to the agent.
          dispatch(askWhy ? { type: "ask_why", text } : { type: "send_message", text });
          setText("");
          setAskWhy(false);
        }}
      >
        <Toggle
          pressed={askWhy}
          onPressedChange={setAskWhy}
          variant="outline"
          aria-label="Ask why"
          className="shrink-0 data-[pressed]:bg-lesson data-[pressed]:text-foreground data-[pressed]:ring-1 data-[pressed]:ring-lesson-border"
        >
          <HelpCircle />
          Ask why
        </Toggle>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={askWhy ? "What do you want to understand?" : "Message your agent…"}
          aria-label="Message"
        />
        <Button type="submit">{askWhy ? "Ask" : "Send"}</Button>
      </form>
    </main>
  );
}

function ViewItemView({ item, dispatch, answered, responded }: { item: ViewItem; dispatch: Dispatch; answered: Set<string>; responded: Set<string> }) {
  if (item.type === "agent_message") {
    return (
      <Message>
        <MessageContent>
          <Markdown streaming={item.streaming}>{item.text}</Markdown>
        </MessageContent>
      </Message>
    );
  }
  if (item.type === "tool") return <ToolLine item={item} />;
  const { entry } = item;
  const done = answered.has(entry.id) || (entry.kind === "offer" && responded.has(entry.impasseId));
  return <Entry entry={entry} dispatch={dispatch} done={done} />;
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

const TOOL_VERBS: Record<string, [running: string, done: string]> = {
  read: ["Reading", "Read"],
  edit: ["Editing", "Edited"],
  write: ["Writing", "Wrote"],
  grep: ["Searching", "Searched"],
  find: ["Finding", "Found"],
  ls: ["Listing", "Listed"],
  bash: ["Running", "Ran"],
};

/** A tool call as a Trace line (shadcn/ui "Tool" pattern): a plain line while it runs, collapsible once output arrives. */
function ToolLine({ item }: { item: Extract<ViewItem, { type: "tool" }> }) {
  const [running, done] = TOOL_VERBS[item.toolName] ?? ["Running", "Ran"];
  const target = typeof item.args.path === "string" ? item.args.path : typeof item.args.command === "string" ? item.args.command : item.toolName;
  const icon = item.toolName === "read" ? <FileText /> : item.toolName === "grep" || item.toolName === "find" ? <Search /> : <Wrench />;
  if (item.state === "running") {
    return (
      <Trace>
        <TraceLine status="running">
          <TraceIcon>{icon}</TraceIcon>
          <TraceTitle>{running} {target}</TraceTitle>
        </TraceLine>
      </Trace>
    );
  }
  const failed = item.state === "error";
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine status={failed ? "error" : undefined}>
            <TraceIcon>{icon}</TraceIcon>
            <TraceTitle>{failed ? `Failed to ${running.toLowerCase()}` : done} {target}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">{item.output ?? ""}</CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

function Meta({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{children}</p>;
}

function Entry({ entry, dispatch, done }: { entry: TimelineEntry; dispatch: Dispatch; done: boolean }) {
  switch (entry.kind) {
    case "user_message":
      return <UserMessage>{entry.text}</UserMessage>;
    case "file_edit":
      return (
        <div className="rounded-lg border bg-card px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <FilePen className="size-4 text-muted-foreground" />
            <span>Edited</span>
            <Badge variant="outline" className="font-mono">{entry.path}</Badge>
            <Button size="xs" variant="secondary" className="ml-auto" onClick={() => dispatch({ type: "why", entryId: entry.id })}>Why?</Button>
          </div>
          {entry.diff && (
            <CodeBlock size="sm" className="mt-2">
              <CodeBlockContent>{entry.diff}</CodeBlockContent>
            </CodeBlock>
          )}
        </div>
      );
    case "error":
      return (
        <p className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {entry.message}
          {entry.path && <span className="font-mono text-xs opacity-80">{entry.path}</span>}
        </p>
      );
    case "impasse":
      // The user's own Ask why question shows as their turn; Why and detected Impasses as a quiet line.
      if (entry.impasse.trigger === "ask_why") {
        return (
          <UserMessage>
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" />
              {entry.impasse.text ?? entry.impasse.title}
            </span>
          </UserMessage>
        );
      }
      return <Meta icon={<Lightbulb className="size-3.5" />}>{entry.impasse.title}</Meta>;
    case "offer":
      return <LessonCardView card={entry.card} entryId={entry.id} done={done} dispatch={dispatch} />;
    case "offer_response":
      return <Meta>{entry.response === "accept" ? "Let's look at why." : "Skipped. The agent carries on."}</Meta>;
    case "lesson_card":
      return <LessonCardView card={entry.card} entryId={entry.id} done={done} dispatch={dispatch} />;
    case "card_answer":
      return <UserMessage>{answerText(entry.answer)}</UserMessage>;
    case "lesson_end":
      return <Meta>Lesson {entry.outcome}. Back to work.</Meta>;
    case "tool_call":
    case "tool_result":
    case "agent_message":
    case "agent_message_delta":
    case "session_start":
    case "session_end":
    case "lesson_start":
    case "answer_assessment":
    case "explanation_flagged":
    case "unknown_agent_event":
      return null;
  }
}

function answerText(answer: CardAnswer): string {
  if (answer.type === "choice") return `Chose: ${answer.optionId}`;
  if (answer.type === "text") return answer.text;
  return answer.addressesCause ? "The fix addresses the cause." : `The fix only hides the symptom. ${answer.reason ?? ""}`;
}
