import { createContext, useContext } from "react";
import type { CardAnswer, UserAction } from "@aha/contracts";

/** What a rendered card needs from the Timeline around it. */
export interface CardContextValue {
  dispatch: (action: UserAction) => void;
  /** Id of the Timeline entry holding the card. */
  entryId: string;
  /** True once the Offer was answered or the card submitted, so it cannot be used twice. */
  done: boolean;
  endedEarly: boolean;
  submitted?: CardAnswer;
  flag?: { lessonId: string; recorded: boolean; enabled: boolean };
}

export const CardContext = createContext<CardContextValue | null>(null);

export function useCard() {
  const value = useContext(CardContext);
  if (!value) throw new Error("Lesson cards render inside <LessonCardView>");
  const answer = (lessonId: string, answer: CardAnswer) =>
    value.dispatch({ type: "card_answer", lessonId, cardEntryId: value.entryId, answer });
  return { ...value, answer };
}
