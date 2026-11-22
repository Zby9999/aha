import { useState } from "react";
import type { CardAnswer, CardSpec, TimelineEntry, UserAction } from "@aha/contracts";
import { useTimeline } from "./useTimeline.ts";

type Dispatch = (action: UserAction) => void;

export function App() {
  const { entries, error, dispatch } = useTimeline();
  const [text, setText] = useState("");
  const answered = new Set(entries.flatMap((e) => (e.kind === "card_answer" ? [e.cardEntryId] : [])));
  const responded = new Set(entries.flatMap((e) => (e.kind === "offer_response" ? [e.impasseId] : [])));
  const visible = entries.filter((e) => e.kind !== "agent_message_delta");

  return (
    <main className="app">
      <header>
        <h1>Aha</h1>
        <span className="hint">Replaying the demo session with stub modules</span>
      </header>
      <ol className="timeline" aria-label="Timeline">
        {visible.map((entry) => (
          <li key={entry.id} className={`entry entry-${entry.kind}`}>
            <Entry entry={entry} dispatch={dispatch} answered={answered.has(entry.id)} responded={"impasseId" in entry && responded.has(entry.impasseId)} />
          </li>
        ))}
      </ol>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          dispatch({ type: "send_message", text });
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your agent…" aria-label="Message" />
        <button type="submit">Send</button>
        <button type="button" className="secondary" onClick={() => text.trim() && (dispatch({ type: "teach_me", text }), setText(""))}>
          Teach me this
        </button>
      </form>
    </main>
  );
}

function Entry({ entry, dispatch, answered, responded }: { entry: TimelineEntry; dispatch: Dispatch; answered: boolean; responded: boolean }) {
  switch (entry.kind) {
    case "user_message":
      return <p className="bubble user">{entry.text}</p>;
    case "agent_message":
      return <p className="bubble agent">{entry.text}</p>;
    case "tool_call":
      return <p className="meta">🔧 {entry.toolName} {typeof entry.args.path === "string" ? entry.args.path : ""}</p>;
    case "tool_result":
      return null;
    case "file_edit":
      return (
        <div className="edit">
          <span>✏️ Edited <code>{entry.path}</code></span>
          <button className="why" onClick={() => dispatch({ type: "why", entryId: entry.id })}>Why?</button>
          {entry.diff && <pre>{entry.diff}</pre>}
        </div>
      );
    case "error":
      return <p className="error">⚠️ {entry.message}{entry.path ? ` (${entry.path})` : ""}</p>;
    case "impasse":
      return <p className="meta">💡 {entry.impasse.title}</p>;
    case "offer":
      return <OfferCard card={entry.card} impasseId={entry.impasseId} responded={responded} dispatch={dispatch} />;
    case "offer_response":
      return <p className="meta">You chose: {entry.response.replaceAll("_", " ")}</p>;
    case "lesson_card":
      return <LessonCard entry={entry} answered={answered} dispatch={dispatch} />;
    case "card_answer":
      return <p className="bubble user">{answerText(entry.answer)}</p>;
    case "lesson_end":
      return <p className="meta">Lesson {entry.outcome}. Back to work.</p>;
    case "session_start":
    case "session_end":
    case "lesson_start":
    case "answer_assessment":
    case "explanation_flagged":
    case "unknown_agent_event":
    case "agent_message_delta":
      return <p className="meta subtle">{entry.kind.replaceAll("_", " ")}</p>;
  }
}

/** Props of the card's root element. The real json-render catalog renderer replaces this (#45). */
function rootProps(card: CardSpec): { type: string; props: Record<string, any> } {
  const root = card.elements[card.root];
  return { type: root?.type ?? "unknown", props: (root?.props ?? {}) as Record<string, any> };
}

function OfferCard({ card, impasseId, responded, dispatch }: { card: CardSpec; impasseId: string; responded: boolean; dispatch: Dispatch }) {
  const { props } = rootProps(card);
  const respond = (response: "accept" | "decline" | "let_agent_continue") => dispatch({ type: "offer_response", impasseId, response });
  return (
    <section className="card offer" aria-label="Offer">
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <div className="actions">
        <button disabled={responded} onClick={() => respond("accept")}>Show me</button>
        <button disabled={responded} className="secondary" onClick={() => respond("decline")}>Not now</button>
        <button disabled={responded} className="secondary" onClick={() => respond("let_agent_continue")}>Let the agent continue</button>
      </div>
    </section>
  );
}

function LessonCard({ entry, answered, dispatch }: { entry: Extract<TimelineEntry, { kind: "lesson_card" }>; answered: boolean; dispatch: Dispatch }) {
  const { type, props } = rootProps(entry.card);
  const [text, setText] = useState("");
  const submit = (answer: CardAnswer) => dispatch({ type: "card_answer", lessonId: entry.lessonId, cardEntryId: entry.id, answer });
  const citations = (props.citations ?? []) as { path: string; startLine?: number }[];
  return (
    <section className={`card lesson step-${entry.step}`} aria-label={type}>
      <p className="step">{entry.step}</p>
      <h2>{props.question ?? props.prompt ?? props.title}</h2>
      {props.text && <p>{props.text}</p>}
      {citations.length > 0 && (
        <p className="citations">{citations.map((c) => <code key={`${c.path}:${c.startLine}`}>{c.path}{c.startLine ? `:${c.startLine}` : ""}</code>)}</p>
      )}
      {entry.step !== "explain" &&
        (props.options ? (
          <div className="actions">
            {(props.options as { id: string; label: string }[]).map((o) => (
              <button key={o.id} disabled={answered} onClick={() => submit({ type: "choice", optionId: o.id })}>{o.label}</button>
            ))}
          </div>
        ) : (
          <form className="answer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) submit({ type: "text", text }); }}>
            <input disabled={answered} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" aria-label="Answer" />
            <button disabled={answered} type="submit">Answer</button>
          </form>
        ))}
    </section>
  );
}

function answerText(answer: CardAnswer): string {
  if (answer.type === "choice") return `Chose: ${answer.optionId}`;
  if (answer.type === "text") return answer.text;
  return answer.addressesCause ? "The fix addresses the cause." : `The fix does not address the cause. ${answer.reason ?? ""}`;
}
