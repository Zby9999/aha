import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// ADR-0002: the five module packages depend only on the shared contracts package.
const root = join(import.meta.dirname, "..");
const MODULES = ["agent-host", "app", "decisions", "learner-model", "teaching"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe.each(MODULES)("%s", (name) => {
  const dir = join(root, "packages", name);

  test("declares no workspace dependency other than @aha/contracts", () => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
    expect(deps.filter((d) => d.startsWith("@aha/"))).toEqual(["@aha/contracts"]);
  });

  test("imports no other workspace package", () => {
    const offenders = sourceFiles(dir).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/from\s+["'](@aha\/[^"'/]+)/g)]
        .map((m) => m[1])
        .filter((spec) => spec !== "@aha/contracts")
        .map((spec) => `${file}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
