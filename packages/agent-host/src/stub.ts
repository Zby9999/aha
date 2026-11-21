import type { AgentHost, AgentSession, BackgroundAgent, TimelineEntry } from "@aha/contracts";
import { asNewEntry } from "@aha/contracts/fixtures";

export interface StubAgentHostOptions {
  /** A recorded or synthetic session. Each user message replays the agent-host entries that followed the same message. */
  script?: readonly TimelineEntry[];
}

/** Agent host stub: no Pi. Replays scripted agent events, or echoes when the message is not in the script. */
export function createStubAgentHost({ script = [] }: StubAgentHostOptions = {}): AgentHost {
  return {
    async startSession({ timeline }): Promise<AgentSession> {
      const turns = splitIntoTurns(script);
      let stopped = false;
      let replies = 0;
      return {
        async sendUserMessage(text) {
          if (stopped) throw new Error("The agent session has stopped.");
          timeline.append({ kind: "user_message", source: "agent-host", text });
          const turn = turns.find((t) => t.text === text && !t.used);
          if (turn) {
            turn.used = true;
            for (const entry of turn.entries) timeline.append(asNewEntry(entry));
          } else {
            timeline.append({ kind: "agent_message", source: "agent-host", messageId: `stub-${++replies}`, text: `(stub agent) You said: ${text}` });
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
