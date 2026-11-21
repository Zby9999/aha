import { expect, test } from "vitest";
import { moduleName } from "../src/index.ts";

test("decisions package builds against the contracts", () => {
  expect(moduleName).toBe("decisions");
});
