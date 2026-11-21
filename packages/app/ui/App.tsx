import { useRef, useState } from "react";
import type { CardAnswer, TimelineEntry, UserAction } from "@aha/contracts";
import { AlertTriangle, ArrowLeft, ArrowUp, GraduationCap, FilePen, FileText, HelpCircle, Lightbulb, Search, Wrench } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Message, MessageContent } from "@/components/ui/message";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
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
import { sessionView, toViewItems, type SessionView, type ViewItem } from "./timelineView.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const [askWhy, setAskWhy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const items = toViewItems(entries);
  const session = sessionView(entries);
  const learning = session.mode === "learning";
  // Ask why starts a Lesson, so it cannot be on in learning mode.
  const asking = askWhy && !learning;

  return (
    // data-mode lets a layout follow the Mode (Explain in learning mode, Preview in work mode; #27).
    <main className="mx-auto flex h-dvh max-w-3xl flex-col" data-mode={session.mode}>
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
                  <ViewItemView item={item} dispatch={dispatch} session={session} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {error && <p className="px-4 text-sm text-destructive" role="alert">{error}</p>}
      <form
        ref={formRef}
        className="px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          // With Ask why on, the message starts an Impasse and a Lesson instead of going to the agent.
          // In learning mode the backend treats send_message as a follow-up question inside the Lesson.
          dispatch(asking ? { type: "ask_why", text } : { type: "send_message", text });
          setText("");
          setAskWhy(false);
        }}
      >
        {learning && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-lesson px-3 py-2 text-sm ring-1 ring-lesson-border" role="status">
            <GraduationCap className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Learning: {session.lessonTitle ?? "starting a Lesson…"}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => dispatch({ type: "back_to_work" })}>
              <ArrowLeft />
              Back to work
            </Button>
          </div>
        )}
        <InputGroup className={asking || learning ? "ring-1 ring-lesson-border" : undefined}>
          <InputGroupTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder={learning ? "Ask a follow-up about this Lesson…" : asking ? "What do you want to understand?" : "Message your agent…"}
            aria-label="Message"
            className="p-3"
          />
          <InputGroupAddon align="block-end">
            <Toggle
              pressed={asking}
              disabled={!session.canStartLesson}
              onPressedChange={setAskWhy}
              variant="outline"
              size="sm"
              aria-label="Ask why"
              className="rounded-full data-[pressed]:bg-lesson data-[pressed]:text-foreground data-[pressed]:ring-1 data-[pressed]:ring-lesson-border"
            >
              <HelpCircle />
              Ask why
            </Toggle>
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant="default"
              className="ml-auto rounded-full"
              disabled={!text.trim()}
              aria-label={asking || learning ? "Ask" : "Send"}
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </main>
  );
}

function ViewItemView({ item, dispatch, session }: { item: ViewItem; dispatch: Dispatch; session: SessionView }) {
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
  return <Entry entry={entry} dispatch={dispatch} done={session.isDone(entry)} canStartLesson={session.canStartLesson} />;
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted">
          <BubbleContent className="whitespace-pre-wrap">{children}</BubbleContent>
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

function Entry({ entry, dispatch, done, canStartLesson }: { entry: TimelineEntry; dispatch: Dispatch; done: boolean; canStartLesson: boolean }) {
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
            <Button size="xs" variant="secondary" className="ml-auto" disabled={!canStartLesson} onClick={() => dispatch({ type: "why", entryId: entry.id })}>Why?</Button>
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
    case "lesson_question":
      return <UserMessage>{entry.text}</UserMessage>;
    case "lesson_end":
      return <Meta>{entry.outcome === "completed" ? "Lesson complete." : "Left the Lesson."} Back to work.</Meta>;
    case "tool_call":
    case "tool_result":
    case "agent_message":
    case "agent_message_delta":
    case "session_start":
    case "session_end":
    case "lesson_start":
    case "mode_change":
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
