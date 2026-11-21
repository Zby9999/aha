import { expect, test } from "vitest";
import { moduleName } from "../src/index.ts";

test("app package builds against the contracts", () => {
  expect(moduleName).toBe("app");
});
