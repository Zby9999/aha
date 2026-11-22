import type { Backend } from "@aha/app";
import type { TimelineEntry } from "@aha/contracts";

/**
 * Sends the user messages of a recorded session to the backend, one turn at a time, stopping before the
 * first message that comes after an Offer in the recording (so the app opens on a pending Offer).
 */
export async function replayUntilOffer(backend: Backend, recording: readonly TimelineEntry[]): Promise<void> {
  const firstOffer = recording.find((e) => e.kind === "offer")?.seq ?? Infinity;
  for (const entry of recording) {
    if (entry.seq > firstOffer) break;
    if (entry.kind === "user_message" && entry.source === "agent-host") {
      await backend.dispatch({ type: "send_message", text: entry.text });
      await backend.settled();
    }
  }
}
