import type { CardAnswer } from "./cards.ts";
import type { OfferResponse } from "./learning.ts";
import type { Timeline, TimelineEntry } from "./timeline.ts";

/**
 * 2 App Shell: user actions routed from the UI to the backend.
 * Layout choice (three-pane or tabbed) is a UI preference kept in the browser, not a backend action.
 */
export type UserAction =
  /** In work mode it goes to the agent; in learning mode it is a follow-up question inside the current Lesson. */
  | { type: "send_message"; text: string }
  | { type: "why"; entryId: string }
  /** A message sent with the Ask why toggle on: it starts an Impasse and a Lesson instead of going to the agent. */
  | { type: "ask_why"; text: string }
  | { type: "offer_response"; impasseId: string; response: OfferResponse }
  | { type: "card_answer"; lessonId: string; cardEntryId: string; answer: CardAnswer }
  | { type: "flag_explanation"; lessonId: string; cardEntryId: string; reason?: string }
  /** Leave the current Lesson early and return to work mode. Leaving early is never Evidence. */
  | { type: "back_to_work" }
  | { type: "end_session" };

/**
 * Actions that start a Lesson. The backend rejects them in learning mode, so only one Lesson runs at a time;
 * the UI disables their buttons there too.
 */
export function startsLesson(action: UserAction): boolean {
  return action.type === "why" || action.type === "ask_why" || (action.type === "offer_response" && action.response === "accept");
}

/** WebSocket messages, server → client. */
export type ServerMessage =
  | { type: "snapshot"; entries: TimelineEntry[] }
  | { type: "entry"; entry: TimelineEntry }
  | { type: "error"; message: string };

/** WebSocket messages, client → server. */
export type ClientMessage = { type: "action"; action: UserAction };

/** The backend as the App Shell sees it: render a Timeline, route user actions. */
export interface AppBackend {
  readonly timeline: Timeline;
  dispatch(action: UserAction): Promise<void>;
}
