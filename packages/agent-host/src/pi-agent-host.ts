import { resolve } from "node:path";
import { AgentHostError, type AgentHost, type AgentSession, type AgentSessionOptions } from "@aha/contracts";
import { createPiEventMapper, LOGIN_HINT } from "./pi-events.ts";
import { spawnRpc, type PiExit, type RpcConnection, type SpawnRpcOptions } from "./rpc-connection.ts";

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
/** Extension UI methods that block Pi until the client answers. Aha has no dialog UI for them yet, so it cancels them. */
const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

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
      const args = [...(options.args ?? []), "--mode", "rpc"];
      const pi = await startPi({ command, args, cwd: resolve(projectDir), env }, startTimeoutMs);

      const map = createPiEventMapper({ projectDir, timeline });
      pi.onRecord((record) => {
        map(record);
        if (record.type === "extension_ui_request" && DIALOGS.has(String(record.method))) {
          pi.send({ type: "extension_ui_response", id: record.id, cancelled: true });
        }
      });

      let stopping = false;
      pi.onExit((exit) => {
        if (stopping) return;
        timeline.append({ kind: "error", source: "agent-host", origin: "agent", message: crashMessage(exit) });
        timeline.append({ kind: "session_end", source: "agent-host", reason: "agent_exit" });
      });

      return {
        async sendUserMessage(text) {
          if (stopping) throw new Error("The agent session has stopped.");
          if (pi.exited) throw new AgentHostError("crashed", "Pi is not running any more. Start Aha again to continue.");
          timeline.append({ kind: "user_message", source: "agent-host", text });
          try {
            // followUp: a message sent while Pi is still working waits for it instead of being rejected.
            await pi.request({ type: "prompt", message: text, streamingBehavior: "followUp" });
          } catch (error) {
            // A crash while sending is already on the Timeline; never throw it into the app.
            if (pi.exited) return;
            const message = `Pi did not accept the message: ${(error as Error).message}`;
            timeline.append({ kind: "error", source: "agent-host", origin: "agent", message });
          }
        },
        // The bridge extension that adds learner context to Pi requests comes with #23.
        setLearnerContext() {},
        async stop() {
          stopping = true;
          await pi.close();
        },
      };
    },
  };
}

async function startPi(spawnOptions: SpawnRpcOptions, timeoutMs: number): Promise<RpcConnection> {
  const { command } = spawnOptions;
  let pi: RpcConnection;
  try {
    pi = await spawnRpc(spawnOptions);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new AgentHostError("pi_missing", `Aha could not find Pi (\`${command}\`). ${INSTALL_HINT}`);
    if (code === "EACCES") {
      throw new AgentHostError("start_failed", `Aha found \`${command}\` but is not allowed to run it. Check the file's permissions.`);
    }
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
    if (answer === "timeout") {
      const hint = `Check that \`${command} --mode rpc\` works in a terminal.`;
      throw new AgentHostError("start_failed", `Pi did not answer within ${timeoutMs / 1000} s. ${hint}`);
    }
    if ("exit" in answer) throw new AgentHostError("start_failed", `Pi exited while starting${exitDetail(answer.exit)}`);
    if ("error" in answer) {
      if (pi.exited) throw new AgentHostError("start_failed", `Pi exited while starting${exitDetail(await exited)}`);
      throw new AgentHostError("start_failed", `Pi did not start: ${answer.error.message}`);
    }
    if (answer.models.length === 0) {
      throw new AgentHostError("not_logged_in", `Pi is not logged in to any model provider. ${LOGIN_HINT}`);
    }
    // With providers but no usable default, Pi reports no model or a placeholder with id "unknown".
    const state = (await pi.request({ type: "get_state" })) as { model?: { id?: string } } | undefined;
    if (!state?.model?.id || state.model.id === "unknown") {
      throw new AgentHostError("not_logged_in", `Pi has no model to use. ${LOGIN_HINT}`);
    }
    return pi;
  } catch (error) {
    await pi.close(1000);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** " (exit code 1).", followed by Pi's last stderr lines when it wrote any. */
function exitDetail({ code, signal, stderr }: PiExit, hint = ""): string {
  const how = signal ? ` (signal ${signal})` : code !== null ? ` (exit code ${code})` : "";
  const lastLines = stderr.split("\n").slice(-5).join("\n").trim();
  return `${how}.${hint ? ` ${hint}` : ""}${lastLines ? `\nPi said:\n${lastLines}` : ""}`;
}

function crashMessage(exit: PiExit): string {
  return `Pi stopped unexpectedly${exitDetail(exit, "Start Aha again to continue.")}`;
}
