import { useRef, useState } from "react";
import { isKind, probeCardSchema, type CardAnswer, type TimelineEntry, type TimelineEntryOf, type UserAction } from "@aha/contracts";
import { AlertTriangle, ArrowLeft, ArrowUp, FilePen, FileText, GraduationCap, HelpCircle, Lightbulb, RotateCw, Search, Sparkles, Wrench } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { LearningPanel } from "./LearningPanel.tsx";
import { ProjectPreview } from "./ProjectPreview.tsx";
import { Workspace } from "./Workspace.tsx";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
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
import { chatEntries, composerPlaceholder, conversationItems, sessionView, type ConversationItem, type SessionView, type ViewItem } from "./timelineView.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, connected, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const [askWhyRevision, setAskWhyRevision] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const lessonCards = entries.filter((entry) => isKind(entry, "lesson_card"));
  const cardsById = new Map(lessonCards.map((entry) => [entry.id, entry]));
  const lessonAnswers = new Map(entries.flatMap((entry) => entry.kind === "card_answer" ? [[entry.cardEntryId, entry.answer] as const] : []));
  const flaggedExplanations = new Set(entries.flatMap((entry) => entry.kind === "explanation_flagged" ? [entry.cardEntryId] : []));
  const lastLessonId = entries.findLast((entry) => isKind(entry, "lesson_start"))?.lessonId;
  const lessonOutcomes = new Map(entries.flatMap((entry) => entry.kind === "lesson_end" ? [[entry.lessonId, entry.outcome] as const] : []));
  const session = sessionView(entries);
  const { modeChange } = session;
  const learning = session.mode === "learning";
  const items = conversationItems(chatEntries(entries), connected && !learning);
  const revision = modeChange ? `${modeChange.id}:${modeChange.at}` : "";
  const asking = !learning && askWhyRevision === revision;
  const canSend = connected && Boolean(text.trim()) && (!learning || session.lessonReady);
  const lastEdit = entries.findLast((entry) => isKind(entry, "file_edit"));
  const projectDir = entries.findLast((entry) => isKind(entry, "session_start"))?.projectDir;
  const projectName = projectDir?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";

  return (
    <Workspace
      projectName={projectName}
      connected={connected}
      modeChange={modeChange}
      defaultTab={session.defaultTab}
      onBackToWork={() => dispatch({ type: "back_to_work" })}
      preview={<ProjectPreview lastEdit={lastEdit} />}
      explain={(visible) => (
        <LearningPanel
          entries={entries}
          cards={lessonCards}
          answers={lessonAnswers}
          flaggedExplanations={flaggedExplanations}
          outcomes={lessonOutcomes}
          latestLessonId={lastLessonId}
          lessonTitle={session.lessonTitle}
          isDone={(entry) => !connected || session.isDone(entry)}
          dispatch={dispatch}
          connected={connected}
          visible={visible}
        />
      )}
    >
      <MessageScrollerProvider autoScroll>
        <MessageScroller aria-label="Timeline" className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="workspace-chat-content gap-3">
              {items.map((item) => (
                <MessageScrollerItem
                  key={item.key}
                  messageId={item.key}
                  scrollAnchor={item.type === "entry" && item.entry.kind === "user_message"}
                  // Items use content-visibility, which clips paint at their box: leave room for card rings and shadows.
                  className="p-1"
                >
                  <ViewItemView item={item} dispatch={dispatch} session={session} connected={connected} cardsById={cardsById} />
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
        className="workspace-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          // In learning mode the backend treats send_message as a follow-up question inside the Lesson.
          if (!dispatch(asking ? { type: "ask_why", text } : { type: "send_message", text })) return;
          setText("");
          setAskWhyRevision(null);
        }}
      >
        {learning && (
          <div className="lesson-work-mode mb-2 flex items-center gap-2 rounded-xl bg-lesson px-3 py-2 text-sm" role="status">
            <GraduationCap className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Learning: {session.lessonTitle ?? "starting a Lesson…"}
            </span>
            <Button type="button" size="sm" variant="outline" disabled={!connected} onClick={() => dispatch({ type: "back_to_work" })}>
              <ArrowLeft />
              Back to work
            </Button>
          </div>
        )}
        <InputGroup className={asking || learning ? "workspace-input ring-1 ring-lesson-border" : "workspace-input"}>
          <InputGroupTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder={composerPlaceholder(session, asking)}
            aria-label="Message"
            className="p-3"
          />
          <InputGroupAddon align="block-end">
            <Toggle
              pressed={asking}
              disabled={!connected || !session.canStartLesson}
              onPressedChange={(pressed) => setAskWhyRevision(pressed ? revision : null)}
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
              disabled={!canSend}
              aria-label={asking || learning ? "Ask" : "Send"}
            >
              <ArrowUp />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </Workspace>
  );
}

function ViewItemView({ item, dispatch, session, connected, cardsById }: {
  item: ConversationItem;
  dispatch: Dispatch;
  session: SessionView;
  connected: boolean;
  cardsById: ReadonlyMap<string, TimelineEntryOf<"lesson_card">>;
}) {
  if (item.type === "agent_turn" || item.type === "agent_message") {
    const parts = item.type === "agent_turn" ? item.parts : [item];
    const runningTool = parts.some((part) => part.type === "tool" && part.state === "running");
    const pending = item.type === "agent_turn" && item.pending;
    return (
      <Message className="gap-3" data-agent-pending={pending || runningTool || undefined}>
        <MessageAvatar className="workspace-reply-mark self-start">
          <Sparkles className="size-4" aria-hidden="true" />
        </MessageAvatar>
        <MessageContent className="gap-1">
          <MessageHeader className="px-0 font-semibold text-foreground">Aha</MessageHeader>
          {parts.map((part) => part.type === "agent_message" ? (
            <Markdown key={part.key} streaming={part.streaming}>{part.text}</Markdown>
          ) : <ViewItemView key={part.key} item={part} dispatch={dispatch} session={session} connected={connected} cardsById={cardsById} />)}
          {pending && !runningTool && (
            <p className="text-sm text-muted-foreground" role="status">
              {parts.length ? "Waiting for the reply" : "Working on your request"}
            </p>
          )}
        </MessageContent>
      </Message>
    );
  }
  if (item.type === "tool") return <ToolLine item={item} />;
  const { entry } = item;
  if (entry.kind === "card_answer") {
    return <UserMessage>{answerText(entry.answer, cardsById.get(entry.cardEntryId))}</UserMessage>;
  }
  return (
    <Entry
      entry={entry}
      dispatch={dispatch}
      done={!connected || session.isDone(entry)}
      canStartLesson={connected && session.canStartLesson}
      canRetry={connected && session.canRetry(entry)}
    />
  );
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="muted" className="workspace-user-bubble">
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

function Entry({ entry, dispatch, done, canStartLesson, canRetry }: {
  entry: Exclude<TimelineEntry, TimelineEntryOf<"card_answer">>;
  dispatch: Dispatch;
  done: boolean;
  canStartLesson: boolean;
  canRetry: boolean;
}) {
  switch (entry.kind) {
    case "user_message":
      return <UserMessage>{entry.text}</UserMessage>;
    case "file_edit":
      return (
        <div role="group" aria-label={`Edited ${entry.path}`} className="rounded-lg border bg-card px-3 py-3 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <FilePen className="size-4 shrink-0 text-muted-foreground" />
            <span>Edited</span>
            <Badge variant="outline" className="min-w-0 shrink overflow-hidden font-mono" title={entry.path}><span className="truncate">{entry.path}</span></Badge>
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
        <p role={entry.source === "app" ? "alert" : undefined} className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          {entry.message}
          {entry.path && <span className="font-mono text-xs opacity-80">{entry.path}</span>}
        </p>
      );
    case "impasse":
      // The user's own Ask why question shows as their turn; an explicit Why uses a quiet line.
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
    case "lesson_question":
      return <UserMessage>{entry.text}</UserMessage>;
    case "lesson_error":
      return (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">{entry.message} Your answer is saved.</span>
          {canRetry && (
            <Button size="xs" variant="outline" onClick={() => dispatch({ type: "retry_answer", lessonId: entry.lessonId, cardEntryId: entry.cardEntryId })}>
              <RotateCw />
              Retry
            </Button>
          )}
        </div>
      );
    case "lesson_end":
      return <Meta>{entry.outcome === "completed" ? "Lesson complete." : "Left the Lesson."} Back to work.</Meta>;
    case "tool_call":
    case "tool_result":
    case "agent_message":
    case "agent_message_delta":
    case "session_start":
    case "session_end":
    case "lesson_start":
    case "lesson_card":
    case "mode_change":
    case "answer_assessment":
    case "lesson_answer_recovered":
    case "explanation_flagged":
    case "unknown_agent_event":
      return null;
  }
}

function answerText(answer: CardAnswer, card: TimelineEntryOf<"lesson_card"> | undefined): string {
  if (answer.type === "choice") {
    const root = card?.card.elements[card.card.root];
    const probe = probeCardSchema.safeParse(root?.props);
    return probe.data?.options?.find((option) => option.id === answer.optionId)?.label ?? "Prediction submitted.";
  }
  if (answer.type === "text") return answer.text;
  return answer.addressesCause ? "The fix addresses the cause." : `The fix only hides the symptom. ${answer.reason ?? ""}`;
}
