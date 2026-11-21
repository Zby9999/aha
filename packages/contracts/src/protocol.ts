import type { CardAnswer } from "./cards.ts";
import type { Timeline, TimelineEntry } from "./timeline.ts";

/** 2 App Shell: user actions routed from the UI to the backend. */
export type UserAction =
  | { type: "send_message"; text: string }
  | { type: "why"; entryId: string }
  | { type: "teach_me"; text: string }
  | { type: "offer_response"; impasseId: string; response: "accept" | "decline" | "let_agent_continue" }
  | { type: "card_answer"; lessonId: string; cardEntryId: string; answer: CardAnswer }
  | { type: "flag_explanation"; lessonId: string; cardEntryId: string; reason?: string }
  | { type: "end_session" };

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
