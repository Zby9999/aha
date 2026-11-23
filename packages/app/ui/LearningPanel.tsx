import { useEffect, useRef } from "react";
import type { TimelineEntryOf, UserAction } from "@aha/contracts";
import { Sparkles } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";

interface LearningPanelProps {
  cards: TimelineEntryOf<"lesson_card">[];
  isDone: (entry: TimelineEntryOf<"lesson_card">) => boolean;
  dispatch: (action: UserAction) => void;
  visible: boolean;
}

export function LearningPanel({ cards, isDone, dispatch, visible }: LearningPanelProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const latestCard = cards.at(-1);

  useEffect(() => {
    if (visible && latestCard && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [latestCard, visible]);

  return (
    <>
      <header className="workspace-pane-heading">
        <Sparkles aria-hidden="true" /><h2>Learning</h2>
      </header>
      {cards.length ? (
        <div className="workspace-learn-cards" ref={scroll} role="log" aria-label="Lesson cards">
          {cards.map((entry) => (
            <LessonCardView
              key={entry.id}
              card={entry.card}
              entryId={entry.id}
              done={isDone(entry)}
              dispatch={dispatch}
            />
          ))}
        </div>
      ) : (
        <div className="workspace-empty">
          <span className="workspace-empty-icon"><Sparkles aria-hidden="true" /></span>
          <h3>Explore a change</h3>
          <p>Choose <strong>Why?</strong> next to an edit or turn on <strong>Ask why</strong> in the composer to start a lesson here.</p>
        </div>
      )}
    </>
  );
}
