import type { AgentHost, AgentSession, BackgroundAgent, TimelineEntry } from "@aha/contracts";
import { asNewEntry } from "@aha/contracts/fixtures";

export interface StubAgentHostOptions {
  /** A recorded or synthetic session. Each user message replays the agent-host entries that followed the same message. */
  script?: readonly TimelineEntry[];
  /** When above 0, agent messages stream word by word as agent_message_delta entries, this many ms apart. */
  streamDelayMs?: number;
}

/** Agent host stub: no Pi. Replays scripted agent events, or echoes when the message is not in the script. */
export function createStubAgentHost({ script = [], streamDelayMs = 0 }: StubAgentHostOptions = {}): AgentHost {
  return {
    async startSession({ timeline }): Promise<AgentSession> {
      const turns = splitIntoTurns(script);
      let stopped = false;
      let replies = 0;
      return {
        async sendUserMessage(text) {
          if (stopped) throw new Error("The agent session has stopped.");
          timeline.append({ kind: "user_message", source: "agent-host", text });
          const say = async (messageId: string, reply: string) => {
            if (streamDelayMs > 0) {
              for (const delta of reply.match(/\S+\s*/g) ?? []) {
                timeline.append({ kind: "agent_message_delta", source: "agent-host", messageId, delta });
                await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
              }
            }
            timeline.append({ kind: "agent_message", source: "agent-host", messageId, text: reply });
          };
          const turn = turns.find((t) => t.text === text && !t.used);
          if (!turn) return say(`stub-${++replies}`, `(stub agent) You said: ${text}`);
          turn.used = true;
          for (const entry of turn.entries) {
            if (entry.kind === "agent_message_delta" && streamDelayMs > 0) continue;
            if (entry.kind === "agent_message") await say(entry.messageId, entry.text);
            else timeline.append(asNewEntry(entry));
          }
        },
        setLearnerContext() {},
        async stop() {
          stopped = true;
        },
      };
    },
  };
}

function splitIntoTurns(script: readonly TimelineEntry[]) {
  const turns: { text: string; entries: TimelineEntry[]; used: boolean }[] = [];
  for (const entry of script) {
    if (entry.source !== "agent-host") continue;
    if (entry.kind === "user_message") turns.push({ text: entry.text, entries: [], used: false });
    else turns.at(-1)?.entries.push(entry);
  }
  return turns;
}

/** Restricted Pi session stub: answers without Pi and writes nothing. */
export function createStubBackgroundAgent(): BackgroundAgent {
  return {
    async run() {
      return { text: "(stub background agent)", filesWritten: [] };
    },
  };
}
