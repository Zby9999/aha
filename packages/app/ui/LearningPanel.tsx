import { useEffect, useRef } from "react";
import { activeLesson, type CardAnswer, type TimelineEntry, type TimelineEntryOf, type UserAction } from "@aha/contracts";
import { BookIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { lessonProgress } from "./timelineView.ts";

interface LearningPanelProps {
  entries: readonly TimelineEntry[];
  cards: TimelineEntryOf<"lesson_card">[];
  answers: ReadonlyMap<string, CardAnswer>;
  flaggedExplanations: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, TimelineEntryOf<"lesson_end">["outcome"]>;
  /** The one Lesson the panel shows: the running one, the one being reviewed, or the last one. */
  lessonId: string | undefined;
  lessonTitle: string | undefined;
  isDone: (entry: TimelineEntryOf<"lesson_card">) => boolean;
  dispatch: (action: UserAction) => void;
  connected: boolean;
  visible: boolean;
}

export function LearningPanel({ entries, cards, answers, flaggedExplanations, outcomes, lessonId, lessonTitle, isDone, dispatch, connected, visible }: LearningPanelProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const seen = useRef<string | undefined>(undefined);
  const lesson = activeLesson(entries);
  const outcome = lessonId && lesson?.lessonId !== lessonId ? outcomes.get(lessonId) : undefined;
  // Each Lesson stands alone: earlier Lessons are reached with Review in the work conversation.
  const shown = lessonId === undefined ? [] : cards.filter((card) => card.lessonId === lessonId &&
    (lesson?.lessonId !== lessonId || card.seq > (lesson.startSeq ?? Infinity)));
  const waiting = lessonProgress(entries);

  useEffect(() => {
    const latestCard = shown.at(-1);
    if (!visible || !latestCard || !scroll.current || latestCard.id === seen.current) return;
    const earlier = shown.findIndex((entry) => entry.id === seen.current);
    const previousCard = shown.at(-2);
    const target = latestCard.step === "articulate" && previousCard?.step === "explain" ? shown.length - 2 : earlier < 0 ? 0 : earlier + 1;
    const next = scroll.current.children[target];
    if (next instanceof HTMLElement) {
      if (window.matchMedia("(max-width: 52.999rem)").matches) {
        next.scrollIntoView({ block: "start", inline: "nearest" });
      } else {
        scroll.current.scrollTop = next.offsetTop - 16;
      }
    }
    seen.current = latestCard.id;
  }, [shown, visible]);

  return (
    <>
      <header className="workspace-pane-heading lesson-pane-heading">
        <BookIcon aria-hidden="true" />
        <div className="lesson-pane-title">
          {lesson && <span className="lesson-pane-mode">Learning mode</span>}
          <h2>{lessonTitle ?? "Learning"}</h2>
        </div>
        {outcome && <Badge variant="secondary" className="ml-auto" role="status">
          {outcome === "completed" ? "Completed" : "Ended early · Read-only"}
        </Badge>}
      </header>
      {waiting && !shown.length && <LessonProgress label={waiting} />}
      {shown.length ? (
        <div className="workspace-learn-cards" ref={scroll} role="log" aria-label="Lesson cards">
          {shown.map((entry) => {
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
          {/* The next step is prepared below the cards, where it will appear. */}
          {waiting && <LessonProgress label={waiting} />}
        </div>
      ) : (
        !waiting && <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><BookIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle role="heading" aria-level={3}>Understand a code change</EmptyTitle>
            <EmptyDescription>Choose <strong>Why?</strong> next to an edit or turn on <strong>Ask why</strong> below the conversation.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </>
  );
}

/** Teaching at work on the next card, as a running Trace line (shadcn/ui AI Elements). */
function LessonProgress({ label }: { label: string }) {
  return (
    <Trace className="lesson-pending" role="status">
      <TraceLine status="running">
        <TraceIcon><Spinner aria-hidden="true" /></TraceIcon>
        <TraceTitle>{label}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}
