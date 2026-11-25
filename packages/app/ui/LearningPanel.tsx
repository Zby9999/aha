import { useEffect, useRef } from "react";
import { activeLesson, pendingLessonError, type CardAnswer, type TimelineEntry, type TimelineEntryOf, type UserAction } from "@aha/contracts";
import { BookOpen, Sparkles } from "lucide-react";
import { LessonCardView } from "./cards/LessonCardView.tsx";

interface LearningPanelProps {
  entries: readonly TimelineEntry[];
  cards: TimelineEntryOf<"lesson_card">[];
  answers: ReadonlyMap<string, CardAnswer>;
  flaggedExplanations: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, TimelineEntryOf<"lesson_end">["outcome"]>;
  latestLessonId: string | undefined;
  lessonTitle: string | undefined;
  isDone: (entry: TimelineEntryOf<"lesson_card">) => boolean;
  dispatch: (action: UserAction) => void;
  connected: boolean;
  visible: boolean;
}

export function LearningPanel({ entries, cards, answers, flaggedExplanations, outcomes, latestLessonId, lessonTitle, isDone, dispatch, connected, visible }: LearningPanelProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const seen = useRef<string | undefined>(undefined);
  const lesson = activeLesson(entries);
  const outcome = !lesson && latestLessonId ? outcomes.get(latestLessonId) : undefined;
  const currentCards = lesson ? cards.filter((card) => card.lessonId === lesson.lessonId && card.seq > (lesson.startSeq ?? Infinity)) : [];
  const probe = currentCards.find((card) => card.step === "probe");
  const waiting = lesson && !pendingLessonError(entries)
    ? currentCards.length === 0 ? "Preparing the lesson" :
      currentCards.length === 1 && probe && answers.has(probe.id) ? "Preparing the explanation" : undefined
    : undefined;

  useEffect(() => {
    const latestCard = cards.at(-1);
    if (!visible || !latestCard || !scroll.current || latestCard.id === seen.current) return;
    const earlier = cards.findIndex((entry) => entry.id === seen.current);
    const previousCard = cards.at(-2);
    const target = latestCard.step === "articulate" && previousCard?.step === "explain" && previousCard.lessonId === latestCard.lessonId
      ? cards.length - 2
      : earlier < 0 ? cards.findIndex((entry) => entry.lessonId === latestCard.lessonId) : earlier + 1;
    const next = scroll.current.children[target];
    if (next instanceof HTMLElement) {
      if (window.matchMedia("(max-width: 52.999rem)").matches) {
        next.scrollIntoView({ block: "start", inline: "nearest" });
      } else {
        scroll.current.scrollTop = next.offsetTop - 16;
      }
    }
    seen.current = latestCard.id;
  }, [cards, visible]);

  return (
    <>
      <header className="workspace-pane-heading lesson-pane-heading">
        <BookOpen aria-hidden="true" />
        <div className="lesson-pane-title">
          {lesson && <span className="lesson-pane-mode">Learning mode</span>}
          <h2>{lesson ? lessonTitle ?? "Learning" : "Learning"}</h2>
        </div>
        {outcome && <span className="ml-auto text-xs font-medium text-muted-foreground" role="status">
          {outcome === "completed" ? "Completed" : "Ended early · Read-only"}
        </span>}
      </header>
      {waiting && <div className="lesson-pending" role="status"><Sparkles aria-hidden="true" />{waiting}</div>}
      {cards.length ? (
        <div className="workspace-learn-cards" ref={scroll} role="log" aria-label="Lesson cards">
          {cards.map((entry) => {
            const submitted = answers.get(entry.id);
            const endedEarly = outcomes.get(entry.lessonId) === "abandoned";
            return (
              <div key={entry.id}>
                <LessonCardView
                  card={entry.card}
                  entryId={entry.id}
                  done={isDone(entry)}
                  endedEarly={endedEarly}
                  {...(entry.step === "explain" ? { flag: {
                    lessonId: entry.lessonId, recorded: flaggedExplanations.has(entry.id), enabled: connected && !endedEarly,
                  } } : {})}
                  {...(submitted ? { submitted } : {})}
                  dispatch={dispatch}
                />
              </div>
            );
          })}
        </div>
      ) : (
        !waiting && <div className="workspace-empty">
          <h3>Understand a code change</h3>
          <p>Choose <strong>Why?</strong> next to an edit or turn on <strong>Ask why</strong> below the conversation.</p>
        </div>
      )}
    </>
  );
}
