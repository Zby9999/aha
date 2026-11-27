import type { AgentCommand } from "@aha/contracts";
import { expect, test } from "vitest";
import { insertCommand, matchCommands, slashQuery } from "../ui/slashCommands.ts";

const commands: AgentCommand[] = [
  { name: "fix-tests", source: "prompt" },
  { name: "review", source: "extension" },
  { name: "skill:explain-code", source: "skill" },
];

test("the menu opens only for a leading / with no space yet", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/fi")).toBe("fi");
  expect(slashQuery("/fix-tests now")).toBeNull();
  expect(slashQuery("hello /fix")).toBeNull();
  expect(slashQuery("")).toBeNull();
});

test("commands starting with the typed name come before those containing it", () => {
  expect(matchCommands(commands, "").map((c) => c.name)).toEqual(["fix-tests", "review", "skill:explain-code"]);
  expect(matchCommands(commands, "RE").map((c) => c.name)).toEqual(["review"]);
  expect(matchCommands(commands, "s").map((c) => c.name)).toEqual(["skill:explain-code", "fix-tests"]);
  expect(matchCommands(commands, "ex").map((c) => c.name)).toEqual(["skill:explain-code"]);
  expect(matchCommands(commands, "zzz")).toEqual([]);
});

test("picking a command leaves it ready for arguments", () => {
  expect(insertCommand(commands[0]!)).toBe("/fix-tests ");
});
