import { useState } from "react";
import type { CardAnswer, TimelineEntry, UserAction } from "@aha/contracts";
import { AlertTriangle, FilePen, Lightbulb } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { Conversation, ConversationContent, ConversationScrollButton } from "./components/ai-elements/conversation.tsx";
import { Message, MessageContent, MessageResponse } from "./components/ai-elements/message.tsx";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "./components/ai-elements/tool.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { toViewItems, type ViewItem } from "./timelineView.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const items = toViewItems(entries);

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="flex items-baseline gap-3 border-b px-4 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Aha</h1>
        <span className="text-sm text-muted-foreground">Replaying the demo session with stub modules</span>
      </header>
      <Conversation aria-label="Timeline">
        <ConversationContent className="gap-4">
          {items.map((item) => (
            <ViewItemView key={item.key} item={item} dispatch={dispatch} answered={answered} responded={responded} />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {error && <p className="px-4 text-sm text-destructive" role="alert">{error}</p>}
      <form
        className="flex gap-2 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          dispatch({ type: "send_message", text });
          setText("");
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your agent…" aria-label="Message" />
        <Button type="submit">Send</Button>
        <Button type="button" variant="outline" onClick={() => text.trim() && (dispatch({ type: "teach_me", text }), setText(""))}>
          Teach me this
        </Button>
      </form>
    </main>
  );
}

function ViewItemView({ item, dispatch, answered, responded }: { item: ViewItem; dispatch: Dispatch; answered: Set<string>; responded: Set<string> }) {
  if (item.type === "agent_message") {
    return (
      <Message from="assistant">
        <MessageContent>
          <MessageResponse isAnimating={item.streaming} mode={item.streaming ? "streaming" : "static"}>{item.text}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }
  if (item.type === "tool") {
    const path = typeof item.args.path === "string" ? item.args.path : "";
    return (
      <Tool>
        <ToolHeader title={`${item.toolName} ${path}`} state={item.state} />
        <ToolContent>
          <ToolInput input={item.args} />
          <ToolOutput {...(item.state === "error" ? { errorText: item.output } : { output: item.output })} />
        </ToolContent>
      </Tool>
    );
  }
  const { entry } = item;
  const done = answered.has(entry.id) || (entry.kind === "offer" && responded.has(entry.impasseId));
  return <Entry entry={entry} dispatch={dispatch} done={done} />;
}

function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <Message from="user">
      <MessageContent>{children}</MessageContent>
    </Message>
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
          {entry.diff && <pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">{entry.diff}</pre>}
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
      return <Meta icon={<Lightbulb className="size-3.5" />}>{entry.impasse.title}</Meta>;
    case "offer":
      return <LessonCardView card={entry.card} entryId={entry.id} done={done} dispatch={dispatch} />;
    case "offer_response":
      return <Meta>You chose: {entry.response.replaceAll("_", " ")}</Meta>;
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
