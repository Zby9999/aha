import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

/** A record Pi writes on stdout that is not a command response: a session event or an extension UI request. */
export type PiRecord = { type: string; [field: string]: unknown };

export interface PiExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** The last lines Pi wrote to stderr, for error messages. */
  stderr: string;
}

export interface RpcConnection {
  /** Sends a command and resolves with its response `data`; rejects with the response `error` when it fails. */
  request(command: { type: string; [field: string]: unknown }): Promise<unknown>;
  /** Writes a record that gets no response (e.g. `extension_ui_response`). */
  send(record: object): void;
  onRecord(listener: (record: PiRecord) => void): void;
  /** Called once when the process exits, for whatever reason. */
  onExit(listener: (exit: PiExit) => void): void;
  readonly exited: boolean;
  /** Closes stdin for an orderly shutdown, then escalates to signals if Pi does not exit. */
  close(graceMs?: number): Promise<void>;
}

export interface SpawnRpcOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

const STDERR_KEEP = 4000;

/**
 * Spawns a process that speaks Pi's RPC protocol: strict JSONL on stdin/stdout, split only on LF
 * (not Node's readline, which also splits on U+2028/U+2029), responses correlated by `id`.
 * Resolves once the process is running; rejects with the spawn error (e.g. ENOENT) otherwise.
 */
export function spawnRpc({ command, args, cwd, env }: SpawnRpcOptions): Promise<RpcConnection> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.off("error", reject);
      resolve(connect(child));
    });
  });
}

function connect(child: ChildProcess): RpcConnection {
  const recordListeners: ((record: PiRecord) => void)[] = [];
  const exitListeners: ((exit: PiExit) => void)[] = [];
  const pending = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let exited = false;
  let stderr = "";
  let exitInfo: PiExit | undefined;
  const exitPromise = new Promise<void>((resolve) => exitListeners.push(() => resolve()));

  const decoder = new StringDecoder("utf8");
  let buffer = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim()) handleLine(line);
    }
  });
  const stderrDecoder = new StringDecoder("utf8");
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr = (stderr + stderrDecoder.write(chunk)).slice(-STDERR_KEEP);
  });
  // Writing to a Pi that just died raises EPIPE here, and a failed kill raises on the child; the exit handler reports
  // the death itself, so these only need to not crash the app.
  child.stdin!.on("error", () => {});
  child.on("error", (error) => console.warn(`[agent-host] Pi process error: ${error.message}`));
  child.once("exit", (code, signal) => {
    exited = true;
    exitInfo = { code, signal, stderr: stderr.trim() };
    for (const { reject } of pending.values()) reject(new Error("Pi exited before answering."));
    pending.clear();
    for (const listener of exitListeners) listener(exitInfo);
  });

  function handleLine(line: string) {
    let record: PiRecord;
    try {
      record = JSON.parse(line) as PiRecord;
    } catch {
      return; // Not protocol data; Pi reserves stdout for JSONL, so ignore stray output.
    }
    if (record.type === "response" && typeof record.id === "string" && pending.has(record.id)) {
      const waiter = pending.get(record.id)!;
      pending.delete(record.id);
      if (record.success) waiter.resolve(record.data);
      else waiter.reject(new Error(String(record.error ?? `Pi rejected ${String(record.command)}`)));
      return;
    }
    for (const listener of recordListeners) listener(record);
  }

  function write(record: object) {
    if (exited || !child.stdin!.writable) throw new Error("Pi is not running.");
    child.stdin!.write(`${JSON.stringify(record)}\n`);
  }

  return {
    request(command) {
      return new Promise((resolve, reject) => {
        const id = `aha-${++nextId}`;
        pending.set(id, { resolve, reject });
        try {
          write({ ...command, id });
        } catch (error) {
          pending.delete(id);
          reject(error as Error);
        }
      });
    },
    send: write,
    onRecord: (listener) => void recordListeners.push(listener),
    onExit(listener) {
      if (exitInfo) listener(exitInfo);
      else exitListeners.push(listener);
    },
    get exited() {
      return exited;
    },
    async close(graceMs = 3000) {
      if (exited) return;
      child.stdin!.end();
      const waitExit = (ms: number) => Promise.race([exitPromise.then(() => true), new Promise<boolean>((r) => setTimeout(r, ms, false).unref())]);
      if (await waitExit(graceMs)) return;
      child.kill("SIGTERM");
      if (await waitExit(graceMs)) return;
      child.kill("SIGKILL");
      await exitPromise;
    },
  };
}
