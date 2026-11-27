import { useRef, useState } from "react";
import { activeLesson, isKind, type TimelineEntry, type TimelineEntryOf, type UserAction } from "@aha/contracts";
import { AhaMascot } from "@/components/AhaMascot";
import { AlertIcon, ArrowLeftIcon, ArrowUpIcon, EditFileIcon, HistoryIcon, IdeaIcon, LearnIcon, RetryIcon } from "@/components/icons";
import { AgentSteps } from "./AgentSteps.tsx";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { ModelPicker, SLASH_MENU_ID, SlashCommandMenu, slashOptionId } from "./ComposerControls.tsx";
import { insertCommand, matchCommands, slashQuery } from "./slashCommands.ts";
import { LearningPanel } from "./LearningPanel.tsx";
import { ProjectPreview } from "./ProjectPreview.tsx";
import { Workspace } from "./Workspace.tsx";
import { DiffBlock } from "@/components/diff-block";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { Markdown } from "@/components/markdown";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
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
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { chatEntries, composerPlaceholder, conversationItems, replyParts, lessonSpan, lessonTitle, sessionView, type ConversationItem, type SessionView, type ViewItem } from "./timelineView.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, connected, dispatch, agentSettings } = useTimeline();
  const [text, setText] = useState("");
  const [slashActive, setSlashActive] = useState(0);
  /** Set when Escape closes the `/` menu; the next edit reopens it. */
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [askWhyRevision, setAskWhyRevision] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const lessonCards = entries.filter((entry) => isKind(entry, "lesson_card"));
  const lessonAnswers = new Map(entries.flatMap((entry) => entry.kind === "card_answer" ? [[entry.cardEntryId, entry.answer] as const] : []));
  const flaggedExplanations = new Set(entries.flatMap((entry) => entry.kind === "explanation_flagged" ? [entry.cardEntryId] : []));
  const lastLessonId = entries.findLast((entry) => isKind(entry, "lesson_start"))?.lessonId;
  const lessonOutcomes = new Map(entries.flatMap((entry) => entry.kind === "lesson_end" ? [[entry.lessonId, entry.outcome] as const] : []));
  const session = sessionView(entries);
  const { modeChange } = session;
  const learning = session.mode === "learning";
  // Reviewing a past Lesson is a view only: it never changes the Mode, and starting a Lesson ends it.
  const review = !learning && reviewRequest ? lessonSpan(entries, reviewRequest) : undefined;
  const reviewing = review ? reviewRequest : undefined;
  const reviewTitle = lessonTitle(entries, review?.impasseId);
  const shownLessonId = learning ? activeLesson(entries)?.lessonId : reviewing ?? lastLessonId;
  const items = conversationItems(chatEntries(entries, reviewing), connected && !learning && !reviewing);
  const revision = modeChange ? `${modeChange.id}:${modeChange.at}` : "";
  const asking = !learning && askWhyRevision === revision;
  const canSend = connected && !reviewing && Boolean(text.trim()) && (!learning || session.lessonReady);
  const lastEdit = entries.findLast((entry) => isKind(entry, "file_edit"));
  const projectDir = entries.findLast((entry) => isKind(entry, "session_start"))?.projectDir;
  // Learning-mode messages never reach the agent, so its model and commands are only offered at work.
  const agentControls = connected && !learning && !reviewing;
  // With Ask why on, the message starts a Lesson instead of going to the agent: no `/` commands either.
  const query = agentControls && !asking && !slashDismissed ? slashQuery(text) : null;
  const slashCommands = query === null ? [] : matchCommands(agentSettings?.commands ?? [], query);
  const slashOpen = slashCommands.length > 0;
  const slashIndex = Math.min(slashActive, slashCommands.length - 1);
  const pickCommand = (command: (typeof slashCommands)[number]) => {
    setText(insertCommand(command));
    setSlashActive(0);
  };
  const projectName = projectDir?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace";

  return (
    <Workspace
      projectName={projectName}
      modeChange={modeChange}
      defaultTab={reviewing ? "explain" : session.defaultTab}
      showExplain={learning || Boolean(reviewing) || session.defaultTab === "explain"}
      viewKey={reviewing}
      preview={<ProjectPreview lastEdit={lastEdit} />}
      explain={(visible) => (
        <LearningPanel
          entries={entries}
          cards={lessonCards}
          answers={lessonAnswers}
          flaggedExplanations={flaggedExplanations}
          outcomes={lessonOutcomes}
          lessonId={shownLessonId}
          lessonTitle={learning ? session.lessonTitle : lessonTitle(entries, lessonSpan(entries, shownLessonId ?? "")?.impasseId)}
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
                  <ViewItemView item={item} dispatch={dispatch} session={session} connected={connected} onReview={learning || reviewing ? undefined : setReviewRequest} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {error && (
        <Alert variant="destructive" className="workspace-connection-error">
          <AlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form
        ref={formRef}
        className="workspace-composer relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSend) return;
          // In learning mode the backend treats send_message as a follow-up question inside the Lesson.
          // A picked command ends with a space for its arguments; Pi gets the command without it.
          const message = text.startsWith("/") ? text.trimEnd() : text;
          if (!dispatch(asking ? { type: "ask_why", text: message } : { type: "send_message", text: message })) return;
          setText("");
          setAskWhyRevision(null);
        }}
      >
        {(learning || reviewing) && (
          <div className="lesson-work-mode mb-2 flex items-center gap-2 rounded-xl bg-lesson py-2 ps-4 pe-2 text-sm" role="status">
            <LearnIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {learning ? `Learning: ${session.lessonTitle ?? "starting a Lesson…"}` : `Reviewing: ${reviewTitle ?? "a past Lesson"}`}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={learning && !connected}
              onClick={() => learning ? dispatch({ type: "back_to_work" }) : setReviewRequest(undefined)}
            >
              <ArrowLeftIcon />
              Back to work
            </Button>
          </div>
        )}
        <InputGroup className={asking || learning ? "workspace-input ring-1 ring-lesson-border" : "workspace-input"}>
          {slashOpen && (
            <SlashCommandMenu commands={slashCommands} active={slashIndex} onPick={pickCommand} onHover={setSlashActive} />
          )}
          <InputGroupTextarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSlashActive(0);
              setSlashDismissed(false);
            }}
            disabled={Boolean(reviewing)}
            aria-controls={slashOpen ? SLASH_MENU_ID : undefined}
            aria-activedescendant={slashOpen ? slashOptionId(slashIndex) : undefined}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (slashOpen && !e.nativeEvent.isComposing) {
                const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                if (step) {
                  e.preventDefault();
                  setSlashActive((slashIndex + step + slashCommands.length) % slashCommands.length);
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  pickCommand(slashCommands[slashIndex]!);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashDismissed(true);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            placeholder={composerPlaceholder(session, asking, Boolean(reviewing))}
            aria-label="Message"
            className="p-3"
          />
          <InputGroupAddon align="block-end">
            <Toggle
              pressed={asking}
              disabled={!connected || !session.canStartLesson || Boolean(reviewing)}
              onPressedChange={(pressed) => setAskWhyRevision(pressed ? revision : null)}
              variant="outline"
              size="sm"
              aria-label="Ask why"
              className="data-[pressed]:bg-lesson data-[pressed]:text-foreground data-[pressed]:ring-1 data-[pressed]:ring-lesson-border"
            >
              <AhaMascot accessory="question" className="size-5" />
              Ask why
            </Toggle>
            <ModelPicker
              settings={agentSettings}
              disabled={!agentControls}
              onSelect={(model) => dispatch({ type: "set_model", provider: model.provider, modelId: model.id })}
            />
            <InputGroupButton
              type="submit"
              size="icon-sm"
              variant={canSend ? "default" : "secondary"}
              disabled={!canSend}
              aria-label={asking || learning ? "Ask" : "Send"}
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </Workspace>
  );
}

function ViewItemView({ item, dispatch, session, connected, onReview }: {
  item: ConversationItem;
  /** Opens a past Lesson's conversation; absent while a Lesson runs or is being reviewed. */
  onReview?: ((lessonId: string) => void) | undefined;
  dispatch: Dispatch;
  session: SessionView;
  connected: boolean;
}) {
  if (item.type === "agent_turn" || item.type === "agent_message") {
    const parts = item.type === "agent_turn" ? item.parts : [item];
    const runningTool = parts.some((part) => part.type === "tool" && part.state === "running");
    const pending = item.type === "agent_turn" && item.pending;
    return (
      <Message className="gap-3" data-agent-pending={pending || runningTool || undefined}>
        <AhaMascot mood={pending || runningTool ? "thinking" : "idle"} className="workspace-reply-mark self-start" />
        <MessageContent className="gap-1">
          <MessageHeader className="px-0 font-semibold text-foreground">Aha</MessageHeader>
          {replyParts(parts).map((part) => part.type === "agent_message" ? (
            <Markdown key={part.key} streaming={part.streaming}>{part.text}</Markdown>
          ) : part.type === "steps" ? <AgentSteps key={part.key} steps={part.steps} /> : (
            <ViewItemView key={part.key} item={part} dispatch={dispatch} session={session} connected={connected} />
          ))}
          {pending && !runningTool && (
            <Trace role="status">
              <TraceLine status="running">
                <TraceIcon><Spinner aria-hidden="true" /></TraceIcon>
                <TraceTitle>{parts.length ? "Waiting for the reply" : "Working on your request"}</TraceTitle>
              </TraceLine>
            </Trace>
          )}
        </MessageContent>
      </Message>
    );
  }
  if (item.type === "tool") return <AgentSteps steps={[item]} />;
  const { entry } = item;
  return (
    <Entry
      entry={entry}
      dispatch={dispatch}
      done={!connected || session.isDone(entry)}
      canStartLesson={connected && session.canStartLesson}
      canRetry={connected && session.canRetry(entry)}
      onReview={onReview}
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

function Meta({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{children}</p>;
}

function Entry({ entry, dispatch, done, canStartLesson, canRetry, onReview }: {
  entry: TimelineEntry;
  dispatch: Dispatch;
  done: boolean;
  canStartLesson: boolean;
  canRetry: boolean;
  onReview?: ((lessonId: string) => void) | undefined;
}) {
  switch (entry.kind) {
    case "user_message":
      return <UserMessage>{entry.text}</UserMessage>;
    case "file_edit":
      return (
        <div role="group" aria-label={`Edited ${entry.path}`} className="rounded-lg border bg-card px-3 py-3 text-sm">
          {/* The row is as tall as the Why button: indent the icon so it sits as far from the left edge as from the top. */}
          <div className="flex min-w-0 items-center gap-2 ps-1.5">
            <EditFileIcon className="size-4 shrink-0 text-muted-foreground" />
            <span>Edited</span>
            <Badge variant="outline" className="min-w-0 shrink overflow-hidden font-mono" title={entry.path}><span className="truncate">{entry.path}</span></Badge>
            <Button size="xs" variant="secondary" className="ml-auto" disabled={!canStartLesson} onClick={() => dispatch({ type: "why", entryId: entry.id })}>Why?</Button>
          </div>
          {entry.diff && (
            <DiffBlock diff={entry.diff} path={entry.path} />
          )}
        </div>
      );
    case "error":
      return (
        // Only the app's own errors interrupt a screen reader; the agent's are part of its reply.
        <Alert variant="destructive" role={entry.source === "app" ? "alert" : undefined} className="min-w-0">
          <AlertIcon />
          {/* Errors can be long and contain unbroken JSON: wrap anywhere and keep Pi's line breaks. */}
          <AlertDescription className="min-w-0 whitespace-pre-wrap wrap-anywhere">
            {entry.message}
            {entry.path && <span className="ms-2 font-mono text-xs opacity-80">{entry.path}</span>}
          </AlertDescription>
        </Alert>
      );
    case "impasse":
      // The user's own Ask why question shows as their turn; an explicit Why uses a quiet line.
      if (entry.impasse.trigger === "ask_why") {
        return (
          <UserMessage>
            <span className="inline-flex items-center gap-1.5">
              <AhaMascot accessory="question" className="size-4 shrink-0" />
              {entry.impasse.text ?? entry.impasse.title}
            </span>
          </UserMessage>
        );
      }
      return <Meta icon={<IdeaIcon className="size-3.5" />}>{entry.impasse.title}</Meta>;
    case "offer":
      return <LessonCardView card={entry.card} entryId={entry.id} done={done} dispatch={dispatch} />;
    case "offer_response":
      return <Meta>{entry.response === "accept" ? "Let's look at why." : "Skipped. The agent carries on."}</Meta>;
    case "lesson_question":
      return <UserMessage>{entry.text}</UserMessage>;
    case "lesson_error":
      return (
        <Alert variant="destructive">
          <AlertIcon />
          <AlertDescription className="wrap-anywhere">{entry.message} Your answer is saved.</AlertDescription>
          {canRetry && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={() => dispatch({ type: "retry_answer", lessonId: entry.lessonId, cardEntryId: entry.cardEntryId })}>
                <RetryIcon />
                Retry
              </Button>
            </AlertAction>
          )}
        </Alert>
      );
    case "lesson_end":
      return (
        <div className="flex items-center gap-2">
          <Meta>{entry.outcome === "completed" ? "Lesson complete." : "Left the Lesson."} Back to work.</Meta>
          {onReview && (
            <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onReview(entry.lessonId)}>
              <HistoryIcon />
              Review
            </Button>
          )}
        </div>
      );
    case "tool_call":
    case "tool_result":
    case "agent_message":
    case "agent_message_delta":
    case "session_start":
    case "session_end":
    case "lesson_start":
    case "lesson_card":
    case "card_answer":
    case "mode_change":
    case "answer_assessment":
    case "lesson_answer_recovered":
    case "explanation_flagged":
    case "unknown_agent_event":
      return null;
  }
}

