import { expect, test } from "vitest";
import { moduleName } from "../src/index.ts";

test("agent-host package builds against the contracts", () => {
  expect(moduleName).toBe("agent-host");
});
