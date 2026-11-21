import { expect, test } from "vitest";
import { moduleName } from "../src/index.ts";

test("teaching package builds against the contracts", () => {
  expect(moduleName).toBe("teaching");
});
