import { expect, test } from "vitest";
import { moduleName } from "../src/index.ts";

test("learner-model package builds against the contracts", () => {
  expect(moduleName).toBe("learner-model");
});
