import { useState } from "react";
import type { CardAnswer, TimelineEntry, UserAction } from "@aha/contracts";
import { AlertTriangle, FilePen, Lightbulb, Wrench } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { Badge } from "./components/ui/badge.tsx";
import { Button } from "./components/ui/button.tsx";
import { Input } from "./components/ui/input.tsx";
import { cn } from "./lib/utils.ts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const visible = entries.filter((e) => e.kind !== "agent_message_delta" && e.kind !== "tool_result");

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-32">
      <header className="mb-6 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Aha</h1>
        <span className="text-sm text-muted-foreground">Replaying the demo session with stub modules</span>
      </header>
      <ol className="flex flex-col gap-3" aria-label="Timeline">
        {visible.map((entry) => (
          <li key={entry.id} className="flex flex-col">
            <Entry entry={entry} dispatch={dispatch} done={answered.has(entry.id) || ("impasseId" in entry && entry.kind === "offer" && responded.has(entry.impasseId))} />
          </li>
        ))}
      </ol>
      {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
      <form
        className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          dispatch({ type: "send_message", text });
          setText("");
        }}
      >
        <div className="mx-auto flex max-w-3xl gap-2 px-4 py-3">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your agent…" aria-label="Message" />
          <Button type="submit">Send</Button>
          <Button type="button" variant="outline" onClick={() => text.trim() && (dispatch({ type: "teach_me", text }), setText(""))}>
            Teach me this
          </Button>
        </div>
      </form>
    </main>
  );
}

function Bubble({ from, children }: { from: "user" | "agent"; children: React.ReactNode }) {
  return (
    <p className={cn("max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed", from === "user" ? "self-end bg-primary text-primary-foreground" : "border bg-card")}>
      {children}
    </p>
  );
}

function Meta({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{children}</p>;
}

function Entry({ entry, dispatch, done }: { entry: TimelineEntry; dispatch: Dispatch; done: boolean }) {
  switch (entry.kind) {
    case "user_message":
      return <Bubble from="user">{entry.text}</Bubble>;
    case "agent_message":
      return <Bubble from="agent">{entry.text}</Bubble>;
    case "tool_call":
      return <Meta icon={<Wrench className="size-3.5" />}>{entry.toolName} {typeof entry.args.path === "string" ? entry.args.path : ""}</Meta>;
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
      return <Bubble from="user">{answerText(entry.answer)}</Bubble>;
    case "lesson_end":
      return <Meta>Lesson {entry.outcome}. Back to work.</Meta>;
    case "tool_result":
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
