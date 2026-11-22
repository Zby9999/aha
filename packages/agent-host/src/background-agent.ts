import { isAbsolute, join, relative, resolve } from "node:path";
import {
  BACKGROUND_TOOLS,
  BackgroundAgentError,
  type BackgroundAgent,
  type BackgroundRunRequest,
  type BackgroundRunResult,
} from "@aha/contracts";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

type PiModel = NonNullable<Parameters<typeof createAgentSession>[0]>["model"];

export interface BackgroundAgentOptions {
  /** Pi's global config folder holding `auth.json` from `pi auth login`. Defaults to Pi's own (~/.pi/agent). */
  agentDir?: string;
  /** Model and credential runtime; defaults to one reading the user's Pi credentials. Tests pass one with a faux provider. */
  modelRuntime?: ModelRuntime;
  /** Model to use; defaults to the user's Pi default model, else the first logged-in one. */
  model?: PiModel;
}

const WRITE_TOOLS = new Set(["write", "edit"]);
const NOT_LOGGED_IN =
  "Pi is not logged in to any model provider. Run `pi auth login <provider>` (or `/login` inside pi), then try again.";

/**
 * Restricted Pi sessions for background agents (Dreaming, lesson content).
 * Each run gets only the tools in its allow-list, never shell, no extensions, skills, prompt templates or context files,
 * and writes limited to its writable folders. It uses the user's `pi auth login` credentials.
 */
export function createBackgroundAgent(options: BackgroundAgentOptions = {}): BackgroundAgent {
  const agentDir = options.agentDir ?? getAgentDir();

  return {
    async run(request: BackgroundRunRequest): Promise<BackgroundRunResult> {
      const notAllowed = request.tools.filter((tool) => !(BACKGROUND_TOOLS as readonly string[]).includes(tool));
      if (notAllowed.length > 0) {
        throw new BackgroundAgentError("tool_not_allowed", `Background agents cannot use: ${notAllowed.join(", ")}`);
      }
      if (request.signal?.aborted) throw new BackgroundAgentError("aborted", "The background run was cancelled.");

      const modelRuntime =
        options.modelRuntime ??
        (await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") }));
      if (!options.model && (await modelRuntime.getAvailable()).length === 0) {
        throw new BackgroundAgentError("not_logged_in", NOT_LOGGED_IN);
      }

      const cwd = resolve(request.cwd);
      const writableDirs = (request.writableDirs ?? [cwd]).map((dir) => resolve(cwd, dir));
      const isWritable = (path: string) =>
        writableDirs.some((dir) => {
          const rel = relative(dir, resolve(cwd, path));
          return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
        });

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: request.systemPrompt,
        extensionFactories: [
          (pi) => {
            pi.on("tool_call", (event) => {
              if (!request.tools.includes(event.toolName as never)) {
                return { block: true, reason: `${event.toolName} is not allowed in this session` };
              }
              const path = (event.input as { path?: unknown }).path;
              if (WRITE_TOOLS.has(event.toolName) && (typeof path !== "string" || !isWritable(path))) {
                return { block: true, reason: `Writing ${String(path)} is not allowed in this session` };
              }
              return undefined;
            });
          },
        ],
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        ...(options.model ? { model: options.model } : {}),
        resourceLoader,
        // An explicit empty list disables every tool, MCP included.
        tools: [...request.tools],
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.create(cwd, agentDir),
      });

      try {
        const active = session.getActiveToolNames().filter((tool) => !request.tools.includes(tool as never));
        if (active.length > 0) {
          throw new BackgroundAgentError("tool_not_allowed", `Pi enabled tools outside the allow-list: ${active.join(", ")}`);
        }
        if (!session.model) throw new BackgroundAgentError("not_logged_in", NOT_LOGGED_IN);

        const pathsByCall = new Map<string, string>();
        const filesWritten: string[] = [];
        session.subscribe((event) => {
          if (event.type === "tool_execution_start" && WRITE_TOOLS.has(event.toolName)) {
            pathsByCall.set(event.toolCallId, String((event.args as { path?: unknown }).path));
          }
          if (event.type === "tool_execution_end" && !event.isError) {
            const path = pathsByCall.get(event.toolCallId);
            if (path && !filesWritten.includes(path)) filesWritten.push(path);
          }
        });

        const onAbort = () => void session.abort();
        request.signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await session.prompt(request.prompt);
        } finally {
          request.signal?.removeEventListener("abort", onAbort);
        }
        if (request.signal?.aborted) throw new BackgroundAgentError("aborted", "The background run was cancelled.");

        const last = session.messages.findLast((message) => message.role === "assistant");
        if (last && "stopReason" in last && last.stopReason === "error") {
          const detail = "errorMessage" in last ? String(last.errorMessage) : "unknown error";
          throw new BackgroundAgentError("failed", `The background agent failed: ${detail}`);
        }
        return { text: session.getLastAssistantText() ?? "", filesWritten };
      } catch (error) {
        if (error instanceof BackgroundAgentError) throw error;
        throw new BackgroundAgentError("failed", `The background agent failed: ${(error as Error).message}`);
      } finally {
        session.dispose();
      }
    },
  };
}
