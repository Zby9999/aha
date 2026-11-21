import { expect, test } from "vitest";
import { MODULE_NAMES } from "../src/index.ts";

test("contracts list the five modules", () => {
  expect(MODULE_NAMES).toHaveLength(5);
});
