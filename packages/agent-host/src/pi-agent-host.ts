import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentHostError, type AgentHost, type AgentSession, type AgentSessionOptions } from "@aha/contracts";
import { LEARNER_CONTEXT_FILE_ENV } from "./bridge-extension.ts";
import { renderLearnerContext } from "./learner-context.ts";
import { createPiEventMapper, LOGIN_HINT } from "./pi-events.ts";
import { spawnRpc, type PiExit, type PiRecord, type RpcConnection, type SpawnRpcOptions } from "./rpc-connection.ts";

export interface PiAgentHostOptions {
  /** Program to run. Defaults to `AHA_PI_COMMAND`, else `pi` on the PATH. */
  command?: string;
  /** Arguments placed before Pi's own (`--mode rpc`); tests use it to run a fake Pi with node. */
  args?: string[];
  /** Environment for Pi; defaults to this process's, so the user's own Pi settings and credentials apply. */
  env?: NodeJS.ProcessEnv;
  /** How long Pi may take to answer its first command. Default 20 s. */
  startTimeoutMs?: number;
  /** Sees every record Pi sends after start, before it is mapped; used to record sessions as fixtures. */
  onRecord?: (record: PiRecord) => void;
}

/** Aha's bridge extension, loaded into Pi next to the user's own extensions. */
const BRIDGE_EXTENSION = join(import.meta.dirname, "bridge-extension.ts");
const INSTALL_HINT = "Install it with `npm install -g @earendil-works/pi-coding-agent`, then start Aha again.";
/** Extension UI methods that block Pi until the client answers. Aha has no dialog UI for them yet, so it cancels them. */
const DIALOGS = new Set(["select", "confirm", "input", "editor"]);

/**
 * The real agent host: runs the Pi the user installed, in RPC mode (`pi --mode rpc`), in the project folder.
 * Starting fails with an AgentHostError a novice can act on when Pi is missing, not logged in or does not start.
 * Once running, a Pi crash never throws: it is reported on the Timeline as an `error` and a `session_end`.
 * Pi also loads Aha's bridge extension (`-e`), which adds the current learner context to each request; the user's
 * own settings and extensions load as usual.
 */
export function createPiAgentHost(options: PiAgentHostOptions = {}): AgentHost {
  const env = options.env ?? process.env;
  const command = options.command ?? env.AHA_PI_COMMAND ?? "pi";
  const startTimeoutMs = options.startTimeoutMs ?? 20_000;

  return {
    async startSession({ projectDir, timeline }: AgentSessionOptions): Promise<AgentSession> {
      // The bridge reads the learner context from this file before each run; no file means no context.
      const contextDir = mkdtempSync(join(tmpdir(), "aha-learner-context-"));
      const contextFile = join(contextDir, "learner-context.md");
      const args = [...(options.args ?? []), "-e", BRIDGE_EXTENSION, "--mode", "rpc"];
      let pi: RpcConnection;
      try {
        pi = await startPi({ command, args, cwd: resolve(projectDir), env: { ...piEnv(env), [LEARNER_CONTEXT_FILE_ENV]: contextFile } }, startTimeoutMs);
      } catch (error) {
        rmSync(contextDir, { recursive: true, force: true });
        throw error;
      }

      const map = createPiEventMapper({ projectDir, timeline });
      pi.onRecord((record) => {
        options.onRecord?.(record);
        map(record);
        if (record.type === "extension_ui_request" && DIALOGS.has(String(record.method))) {
          pi.send({ type: "extension_ui_response", id: record.id, cancelled: true });
        }
      });

      let stopping = false;
      const removeContext = () => rmSync(contextDir, { recursive: true, force: true });
      pi.onExit((exit) => {
        if (stopping) return;
        removeContext();
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
        setLearnerContext(context) {
          if (stopping || pi.exited) return;
          const text = renderLearnerContext(context);
          if (!text) return rmSync(contextFile, { force: true });
          // Write then rename, so the bridge never reads a half-written file.
          writeFileSync(`${contextFile}.tmp`, `${text}\n`);
          renameSync(`${contextFile}.tmp`, contextFile);
        },
        async stop() {
          stopping = true;
          await pi.close();
          removeContext();
        },
      };
    },
  };
}

/**
 * The user's environment without Aha's own settings. Pi runs the user's project, and a project server reads PORT:
 * inheriting Aha's port let a server Pi started take over localhost:<Aha's port>. Aha's Jev key is not Pi's either.
 */
function piEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key !== "PORT" && key !== "TYPESAFE_API_KEY" && !key.startsWith("AHA_")));
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
