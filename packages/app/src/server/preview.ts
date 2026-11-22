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
  // Its own process group, so stopping it also stops the server `npm start` launches.
  const child = spawn(command, args, { cwd: projectDir, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stdout.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => log(chunk.toString("utf8")));
  let done = false;
  let stopping = false;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      done = true;
      if (!stopping) log(`the project stopped (${signal ?? `exit code ${code}`}); the preview is empty until Aha restarts\n`);
      resolve();
    });
    // A failed spawn may never emit "exit".
    child.once("error", (error) => {
      done = true;
      log(`could not start the project: ${error.message}\n`);
      resolve();
    });
  });
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, signal);
    } catch {
      child.kill(signal);
    }
  };

  return {
    url: `http://localhost:${port}`,
    async stop() {
      if (done || child.pid === undefined) return;
      stopping = true;
      kill("SIGTERM");
      const timer = setTimeout(() => kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    },
  };
}
