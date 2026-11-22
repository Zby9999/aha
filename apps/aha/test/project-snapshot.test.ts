import { join, win32 } from "node:path";
import { projectPath, snapshot } from "@aha/app";
import { DEMO_PROJECT_FILES, card } from "@aha/contracts/fixtures";
import { createStubDecisions } from "@aha/decisions";
import { describe, expect, test } from "vitest";

// Citations and fixtures write project paths with `/`; the snapshot must match them on every OS,
// or checkGrounding() reports real files as missing (seen on Windows in review of #56).

const projectDir = join(import.meta.dirname, "../../../examples/portfolio");
const explanation = card("TextExplanation", { title: "Why", body: "Because." });

describe("project snapshot paths", () => {
  test("a Windows path becomes a / path that grounds a citation of the real file", async () => {
    const file = projectPath("C:\\work\\portfolio", "C:\\work\\portfolio\\public\\app.js", win32);
    expect(file).toBe("public/app.js");

    const result = await createStubDecisions().checkGrounding({
      explanation,
      citations: [{ path: "public/app.js" }],
      project: { projectDir: "C:\\work\\portfolio", files: [file] },
    });
    expect(result).toMatchObject({ grounded: true, missingFiles: [] });
  });

  test("the example project's snapshot lists exactly the fixture's / paths", () => {
    const { files } = snapshot(projectDir);
    expect(files.filter((f) => f.includes("\\"))).toEqual([]);
    expect(files).toEqual([...DEMO_PROJECT_FILES].sort());
  });
});
