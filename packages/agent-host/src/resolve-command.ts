import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";

export interface ResolvedCommand {
  command: string;
  args: string[];
  /** Set when the command runs through cmd.exe, whose arguments are already quoted. */
  windowsVerbatimArguments?: boolean;
}

export interface ResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

const SCRIPT = /\.(?:c|m)?js$|\.ts$/i;
/** The script path in an npm command shim, e.g. `"%dp0%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"`. */
const NPM_SHIM_SCRIPT = /"%~?dp0%\\([^"]+?\.(?:c|m)?js)"/i;

/**
 * How to spawn the Pi command on this platform:
 * - a JavaScript file (`fake-pi.mjs`, Pi's `cli.js`) runs with this Node, since Windows cannot execute it directly;
 * - on Windows, a bare name like `pi` is looked up on PATH with PATHEXT. npm installs it as `pi.cmd`, which Node cannot
 *   spawn without a shell, so the script the npm shim points at runs with this Node. Any other `.cmd`/`.bat` runs
 *   through cmd.exe with quoted arguments.
 * Anything else is spawned as it is, so a missing command still fails with ENOENT.
 */
export function resolveCommand(command: string, args: string[], { platform = process.platform, env = process.env }: ResolveOptions = {}): ResolvedCommand {
  if (SCRIPT.test(command)) return { command: process.execPath, args: [command, ...args] };
  if (platform !== "win32") return { command, args };

  const found = findOnWindows(command, env);
  if (!found || !/\.(?:cmd|bat)$/i.test(found)) return { command: found ?? command, args };
  const script = readFileSync(found, "utf8").match(NPM_SHIM_SCRIPT)?.[1];
  if (script) {
    const path = join(dirname(found), script.split("\\").join(sep));
    if (existsSync(path)) return { command: process.execPath, args: [path, ...args] };
  }
  const quote = (arg: string) => `"${arg.replace(/"/g, '""')}"`;
  return {
    command: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${[found, ...args].map(quote).join(" ")}"`],
    windowsVerbatimArguments: true,
  };
}

function findOnWindows(command: string, env: NodeJS.ProcessEnv): string | undefined {
  // Windows matches names in any case; trying lower case too keeps the lookup right on a case-sensitive disk.
  const pathext = (env.PATHEXT ?? env.Pathext ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const extensions = ["", ...new Set(pathext.flatMap((ext) => [ext, ext.toLowerCase()]))];
  const hasDir = isAbsolute(command) || /[\\/]/.test(command);
  const dirs = hasDir ? [""] : (env.Path ?? env.PATH ?? "").split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = dir ? join(dir, command + ext) : command + ext;
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
