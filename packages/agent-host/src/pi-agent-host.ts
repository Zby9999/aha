import { resolve } from "node:path";
import { AgentHostError, type AgentHost, type AgentSession, type AgentSessionOptions } from "@aha/contracts";
import { spawnRpc, type PiExit, type RpcConnection } from "./rpc-connection.ts";

export interface PiAgentHostOptions {
  /** Program to run. Defaults to `AHA_PI_COMMAND`, else `pi` on the PATH. */
  command?: string;
  /** Arguments placed before Pi's own (`--mode rpc`); tests use it to run a fake Pi with node. */
  args?: string[];
  /** Environment for Pi; defaults to this process's, so the user's own Pi settings and credentials apply. */
  env?: NodeJS.ProcessEnv;
  /** How long Pi may take to answer its first command. Default 20 s. */
  startTimeoutMs?: number;
}

const INSTALL_HINT = "Install it with `npm install -g @earendil-works/pi-coding-agent`, then start Aha again.";
const LOGIN_HINT = "Run `pi auth login <provider>` in a terminal (or `/login` inside pi), then start Aha again.";

/**
 * The real agent host: runs the Pi the user installed, in RPC mode (`pi --mode rpc`), in the project folder.
 * Starting fails with an AgentHostError a novice can act on when Pi is missing, not logged in or does not start.
 * Once running, a Pi crash never throws: it is reported on the Timeline as an `error` and a `session_end`.
 */
export function createPiAgentHost(options: PiAgentHostOptions = {}): AgentHost {
  const env = options.env ?? process.env;
  const command = options.command ?? env.AHA_PI_COMMAND ?? "pi";
  const startTimeoutMs = options.startTimeoutMs ?? 20_000;

  return {
    async startSession({ projectDir, timeline }: AgentSessionOptions): Promise<AgentSession> {
      const pi = await startPi(command, [...(options.args ?? []), "--mode", "rpc"], resolve(projectDir), env, startTimeoutMs);

      let stopping = false;
      pi.onExit((exit) => {
        if (stopping) return;
        timeline.append({ kind: "error", source: "agent-host", origin: "agent", message: crashMessage(exit) });
        timeline.append({ kind: "session_end", source: "agent-host", reason: "agent_exit" });
      });

      return {
        async sendUserMessage(text) {
          if (stopping) throw new AgentHostError("crashed", "The agent session has stopped.");
          if (pi.exited) throw new AgentHostError("crashed", "Pi is not running any more. Start Aha again to continue.");
          timeline.append({ kind: "user_message", source: "agent-host", text });
          try {
            // followUp: a message sent while Pi is still working waits for it instead of being rejected.
            await pi.request({ type: "prompt", message: text, streamingBehavior: "followUp" });
          } catch (error) {
            // A crash while sending is already on the Timeline; never throw it into the app.
            if (pi.exited) return;
            timeline.append({ kind: "error", source: "agent-host", origin: "agent", message: `Pi did not accept the message: ${(error as Error).message}` });
          }
        },
        setLearnerContext() {},
        async stop() {
          stopping = true;
          await pi.close();
        },
      };
    },
  };
}

async function startPi(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<RpcConnection> {
  let pi: RpcConnection;
  try {
    pi = await spawnRpc({ command, args, cwd, env });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new AgentHostError("pi_missing", `Aha could not find Pi (\`${command}\`). ${INSTALL_HINT}`);
    if (code === "EACCES") throw new AgentHostError("pi_missing", `Aha found \`${command}\` but could not run it. ${INSTALL_HINT}`);
    throw new AgentHostError("start_failed", `Pi did not start: ${(error as Error).message}`);
  }

  const exited = new Promise<PiExit>((resolve) => pi.onExit(resolve));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(resolve, timeoutMs, "timeout")));
  try {
    const answer = await Promise.race([
      pi.request({ type: "get_available_models" }).then(
        (data) => ({ models: (data as { models?: unknown[] } | undefined)?.models ?? [] }),
        (error: Error) => ({ error }),
      ),
      exited.then((exit) => ({ exit })),
      timeout,
    ]);
    if (answer === "timeout") throw new AgentHostError("start_failed", `Pi did not answer within ${Math.round(timeoutMs / 1000)} s. Check that \`${command} --mode rpc\` works in a terminal.`);
    if ("exit" in answer) throw new AgentHostError("start_failed", `Pi exited while starting${exitDetail(answer.exit)}`);
    if ("error" in answer) {
      if (pi.exited) throw new AgentHostError("start_failed", `Pi exited while starting${exitDetail(await exited)}`);
      throw new AgentHostError("start_failed", `Pi did not start: ${answer.error.message}`);
    }
    if (answer.models.length === 0) throw new AgentHostError("not_logged_in", `Pi is not logged in to any model provider. ${LOGIN_HINT}`);
    return pi;
  } catch (error) {
    await pi.close(1000);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function exitDetail({ code, signal, stderr }: PiExit): string {
  const how = signal ? ` (signal ${signal})` : code !== null ? ` (exit code ${code})` : "";
  const lastLines = stderr.split("\n").slice(-5).join("\n").trim();
  return `${how}.${lastLines ? `\n${lastLines}` : ""}`;
}

function crashMessage(exit: PiExit): string {
  return `Pi stopped unexpectedly${exitDetail(exit)} Start Aha again to continue.`;
}
