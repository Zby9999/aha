import type { AgentCommand } from "@aha/contracts";

/** The command name being typed: the text after a leading `/`, while it has no space yet. Null otherwise. */
export function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? match[1]! : null;
}

/** Commands matching the typed name: those starting with it first, then those containing it, in the agent's order. */
export function matchCommands(commands: readonly AgentCommand[], query: string): AgentCommand[] {
  const q = query.toLowerCase();
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}

/** The composer text after picking a command: the command and a space, ready for arguments. */
export function insertCommand(command: AgentCommand): string {
  return `/${command.name} `;
}
