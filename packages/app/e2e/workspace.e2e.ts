import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test as base, type Page } from "@playwright/test";
import { isKind, type Evidence, type Timeline } from "@aha/contracts";
import { demoSession } from "@aha/contracts/fixtures";
import { buildModules, readConfig } from "../../../apps/aha/src/modules.ts";
import { replayUntilOffer } from "../../../apps/aha/src/replay.ts";
import { createBackend, startServer } from "../src/index.ts";

const root = join(import.meta.dirname, "../../..");

const test = base.extend<{ workspace: { timeline: Timeline; evidence: Evidence[] } }>({
  workspace: async ({ page }, use) => {
    const evidence: Evidence[] = [];
    const modules = buildModules(readConfig(join(root, "apps/aha/aha.config.json"), {}), { script: demoSession });
    const backend = await createBackend({
      projectDir: join(root, "examples/portfolio"),
      sessionId: "workspace-e2e",
      modules: {
        ...modules,
        decisions: {
          ...modules.decisions,
          async gateEvidence(input) {
            // Deliberately permissive test decision: the app must keep Skip out of Evidence.
            const skipped = input.newEntries.find((e) => e.kind === "offer_response" && e.response === "skip");
            if (!skipped) return modules.decisions.gateEvidence(input);
            return [{
              conceptId: "session-tokens",
              type: "repeated_gap",
              outcome: "negative",
              strength: "weak",
              entryIds: [skipped.id],
              note: "Test write-gate result",
            }];
          },
        },
        learnerModel(options) {
          const model = modules.learnerModel(options);
          return {
            ...model,
            async appendEvidence(entry) {
              evidence.push(entry);
              await model.appendEvidence(entry);
            },
          };
        },
      },
    });
    const server = await startServer({ backend, port: 0, uiDir: join(root, "packages/app/dist/ui") });
    try {
      await replayUntilOffer(backend, demoSession);
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      await expect(page.getByRole("button", { name: "Show me why" })).toBeEnabled();
      await use({ timeline: backend.timeline, evidence });
      await backend.settled();
    } finally {
      await page.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await backend.stop();
    }
  },
});

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const why = (page: Page) => page.getByRole("button", { name: "Why?", exact: true });
const askWhy = (page: Page) => page.getByRole("button", { name: "Ask why", exact: true });
const card = (page: Page, name: string) => page.getByRole("log", { name: "Lesson cards" }).getByLabel(name, { exact: true });
const answer = (page: Page, name: string) => card(page, name).getByRole("button", { name: "Answer", exact: true });

test("tabbed layout follows the Lesson and records Probe and Articulation answers once", async ({ page, workspace }) => {
  await page.getByRole("button", { name: "Tabbed layout" }).click();
  await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
  await tab(page, "Memory").click();
  await page.getByRole("button", { name: "Show me why" }).click();
  await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
  await expect(why(page).first()).toBeDisabled();
  await expect(askWhy(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toBeDisabled();
  await expect(answer(page, "Probe")).toBeEnabled();

  const userTurns = workspace.timeline.entries().filter((e) => e.kind === "user_message").length;
  const question = "Why does the token change on refresh?";
  await page.getByRole("textbox", { name: "Message" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Good question (stub)", { exact: true })).toBeVisible();
  expect(workspace.timeline.entries().findLast((e) => e.kind === "lesson_question")).toMatchObject({ text: question });
  expect(workspace.timeline.entries().filter((e) => e.kind === "user_message")).toHaveLength(userTurns);

  await page.reload();
  await expect(page.getByRole("button", { name: "Tabbed layout" })).toHaveAttribute("aria-pressed", "true");
  await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
  const probeAnswer = "The page creates a new session token when it loads.";
  await card(page, "Probe").getByRole("textbox", { name: "Answer" }).fill(probeAnswer);
  await answer(page, "Probe").click();
  await expect(answer(page, "Probe")).toBeDisabled();
  const articulation = "Persist the current session token across refreshes.";
  await card(page, "Articulation").getByRole("textbox", { name: "Answer" }).fill(articulation);
  await answer(page, "Articulation").click();
  await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Lesson complete. Back to work.", { exact: true })).toBeVisible();

  const entries = workspace.timeline.entries();
  expect(entries.filter((e) => isKind(e, "offer_response")).map((e) => e.response)).toEqual(["accept"]);
  expect(entries.filter((e) => isKind(e, "card_answer")).map(({ step, answer }) => ({ step, answer }))).toEqual([
    { step: "probe", answer: { type: "text", text: probeAnswer } },
    { step: "articulate", answer: { type: "text", text: articulation } },
  ]);

  await tab(page, "Explain").click();
  await expect(answer(page, "Articulation")).toBeDisabled();
});

test("three-pane Why is tied to a file edit and Back to work unlocks lesson entry points", async ({ page, workspace }) => {
  await expect(page.getByRole("button", { name: "Three-pane layout" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Live preview" })).toBeVisible();
  const edit = workspace.timeline.entries().find((entry) => entry.kind === "file_edit")!;
  await why(page).first().click();
  await expect(answer(page, "Probe")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Show me why" })).toBeDisabled();
  expect(workspace.timeline.entries().findLast((e) => e.kind === "impasse")).toMatchObject({
    impasse: { trigger: "why", sourceEntryIds: [edit.id] },
  });

  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show me why" })).toBeEnabled();
  await expect(answer(page, "Probe")).toBeDisabled();
  expect(workspace.timeline.entries().findLast((e) => e.kind === "lesson_end")).toMatchObject({ outcome: "abandoned" });
  expect(workspace.evidence).toHaveLength(0);

  const userTurns = workspace.timeline.entries().filter((e) => e.kind === "user_message").length;
  const question = "What does sessionStorage do here?";
  await askWhy(page).click();
  await page.getByRole("textbox", { name: "Message" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(answer(page, "Probe").last()).toBeEnabled();
  await expect(answer(page, "Probe").first()).toBeDisabled();
  expect(workspace.timeline.entries().findLast((e) => e.kind === "impasse")).toMatchObject({
    impasse: { trigger: "ask_why", text: question },
  });
  expect(workspace.timeline.entries().filter((e) => e.kind === "user_message")).toHaveLength(userTurns);

  await page.getByRole("button", { name: "Tabbed layout" }).click();
  await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
  await expect(askWhy(page)).toBeEnabled();
});

test("Skip is recorded without Evidence and leaves the composer in work mode", async ({ page, workspace }) => {
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("Skipped. The agent carries on.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show me why" })).toBeDisabled();
  const message = "Please continue checking the app.";
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(`(stub agent) You said: ${message}`, { exact: true })).toBeVisible();
  const entries = workspace.timeline.entries();
  expect(entries.filter((e) => isKind(e, "offer_response")).map((e) => e.response)).toEqual(["skip"]);
  expect(entries.some((e) => e.kind === "lesson_start")).toBe(false);
  expect(workspace.evidence).toHaveLength(0);
});
