import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Tech-validation live preview (#22), meant to be replaced by the App Shell's own preview.
 * Runs the user's project so the UI can show it in an iframe: `node --watch server.js` when the project has a
 * server.js, so the agent's server edits restart it on their own; otherwise `npm start`.
 * The UI reloads the iframe after each `file_edit` entry, which picks up changes to static files.
 */
export interface ProjectPreview {
  /** Where the running project is served. */
  url: string;
  stop(): Promise<void>;
}

export interface PreviewOptions {
  projectDir: string;
  /** Port given to the project as PORT. */
  port: number;
  /** Where the project's output goes. Defaults to stderr with a prefix. */
  log?: (line: string) => void;
}

export function startPreview({ projectDir, port, log = (line) => process.stderr.write(`[preview] ${line}`) }: PreviewOptions): ProjectPreview {
  const [command, args] = existsSync(join(projectDir, "server.js"))
    ? [process.execPath, ["--watch", "server.js"]]
    : ["npm", ["start"]];
  const child = spawn(command, args, { cwd: projectDir, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
  child.on("error", (error) => log(`could not start the project: ${error.message}\n`));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  return {
    url: `http://localhost:${port}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    },
  };
}
