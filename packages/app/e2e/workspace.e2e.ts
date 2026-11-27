import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test as base, type Page } from "@playwright/test";
import { isKind, type Evidence, type Timeline } from "@aha/contracts";
import { DEMO_CONCEPTS, demoSession } from "@aha/contracts/fixtures";
import { buildModules, readConfig } from "../../../apps/aha/src/modules.ts";
import { replayUntilOffer } from "../../../apps/aha/src/replay.ts";
import { createBackend, startServer, type Backend } from "../src/index.ts";

const root = join(import.meta.dirname, "../../..");
const thirdMessage = demoSession.filter((entry) => isKind(entry, "user_message")).filter((entry) => entry.source === "agent-host")[2]!;
const recordedServerEdit = demoSession.filter((entry) => isKind(entry, "file_edit")).find((entry) => entry.seq > thirdMessage.seq && entry.path === "server.js")!;

const test = base.extend<{
  teachingImplementation: "stub" | "real";
  failFirstLessonAnswer: boolean;
  workspace: { timeline: Timeline; evidence: Evidence[]; holdNextLesson: () => () => void };
}>({
  teachingImplementation: ["stub", { option: true }],
  failFirstLessonAnswer: [false, { option: true }],
  workspace: async ({ page, teachingImplementation, failFirstLessonAnswer }, use) => {
    const evidence: Evidence[] = [];
    let nextLessonGate: Promise<void> | undefined;
    let releaseLesson: (() => void) | undefined;
    const config = readConfig(join(root, "apps/aha/aha.config.json"), {});
    const modules = buildModules({ ...config, teaching: teachingImplementation }, { script: demoSession });
    const backend: Backend = await createBackend({
      projectDir: join(root, "examples/portfolio"),
      sessionId: "workspace-e2e",
      modules: {
        ...modules,
        teaching(options) {
          const teaching = modules.teaching(options);
          let failed = false;
          return {
            ...teaching,
            async startLesson(input) {
              const gate = nextLessonGate;
              nextLessonGate = undefined;
              await gate;
              return teaching.startLesson(input);
            },
            async answer(input) {
              if (failFirstLessonAnswer && !failed) {
                failed = true;
                throw new Error("Test Lesson answer failure");
              }
              return teaching.answer(input);
            },
          };
        },
        decisions: {
          ...modules.decisions,
          async selectConcepts(input) {
            const isRelatedWhy = input.impasse.trigger === "why" && backend.timeline.entries().some((entry) =>
              entry.kind === "file_edit" && entry.source === "agent-host" && input.impasse.sourceEntryIds.includes(entry.id) &&
              entry.path === recordedServerEdit.path && entry.diff === recordedServerEdit.diff,
            );
            if (!isRelatedWhy) return modules.decisions.selectConcepts(input);
            return input.concepts.filter(({ id }) => id === DEMO_CONCEPTS.sessionToken).map(({ id }) => id);
          },
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
      await use({
        timeline: backend.timeline,
        evidence,
        holdNextLesson() {
          nextLessonGate = new Promise<void>((resolve) => { releaseLesson = resolve; });
          return releaseLesson!;
        },
      });
      await backend.settled();
    } finally {
      releaseLesson?.();
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

test("the pending state of a new Lesson stays visible and replaces the previous outcome", async ({ page, workspace }) => {
  await page.getByRole("button", { name: "Show me why" }).click();
  await expect(card(page, "Probe")).toBeVisible();
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  const oldOutcome = page.getByText("Ended early · Read-only", { exact: true });
  await expect(oldOutcome).toBeVisible();

  const continueLesson = workspace.holdNextLesson();
  try {
    await askWhy(page).click();
    await page.getByRole("textbox", { name: "Message" }).fill("Why does a new token break the old session?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByText("Preparing the lesson", { exact: true })).toBeInViewport();
    await expect(oldOutcome).toHaveCount(0);
  } finally {
    continueLesson();
  }
  await expect(card(page, "Probe").last().getByRole("textbox", { name: "Answer" })).toBeEnabled();
  await expect(page.getByText("Preparing the lesson", { exact: true })).toHaveCount(0);
});

test("the gallery renders each lesson card at a phone width and keeps preview actions local", async ({ page, workspace }) => {
  const entriesBefore = workspace.timeline.entries().length;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL("/gallery.html", page.url()).href);
  const index = page.getByRole("navigation", { name: "Lesson card examples" });
  const samples = [
    ["Flowchart", "What decides which screen opens?"],
    ["Contrast view", "What would keep you signed in?"],
    ["Sequence diagram", "The token changes between requests"],
    ["Data flow", "Why the server loses your session"],
    ["Text explanation", "Refresh makes a new token"],
    ["Offer", "Why does the page lose your login?"],
    ["Probe", "You log in, then refresh. What happens to the session token?"],
    ["Articulation", "Would saving the project list in the browser prevent logout?"],
  ] as const;

  await expect(index.getByRole("button")).toHaveCount(samples.length);
  for (const [name, title] of samples) {
    await index.getByRole("button", { name, exact: true }).click();
    const preview = page.getByRole("region", { name: `${name} preview` });
    await expect(preview.getByText(title, { exact: true })).toBeVisible();
    expect(await page.evaluate<number>("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "Only hides the symptom" }).click();
  await expect(page.getByRole("region", { name: "Fix feedback" })).toContainText("Caching projects cannot restore the session");
  await page.getByRole("button", { name: "Reset preview" }).click();
  await expect(page.getByRole("region", { name: "Fix feedback" })).toHaveCount(0);
  await index.getByRole("button", { name: "Offer", exact: true }).click();
  await page.getByRole("button", { name: "Show me why" }).click();
  await expect(page.getByRole("status")).toHaveText("Lesson accepted in this preview.");

  await index.getByRole("button", { name: "Flowchart", exact: true }).click();
  const references = page.getByRole("button", { name: "Code references" });
  await expect(references).toHaveAttribute("aria-expanded", "false");
  await references.press("Enter");
  await expect(page.getByRole("list", { name: "Code references" })).toContainText("server.js:38–44");
  await page.getByRole("button", { name: "Flag as incorrect" }).click();
  await expect(page.getByRole("status")).toHaveText("Flagged as incorrect");
  await page.getByRole("button", { name: "Reset preview" }).press("Enter");
  await expect(page.getByRole("group", { name: "Card preview" })).toBeFocused();
  await expect(references).toHaveAttribute("aria-expanded", "false");
  expect(workspace.timeline.entries()).toHaveLength(entriesBefore);

  await page.setViewportSize({ width: 1100, height: 850 });
  await index.getByRole("button", { name: "Sequence diagram", exact: true }).click();
  const stage = page.getByRole("group", { name: "Card preview" });
  const narrowWidth = (await stage.boundingBox())!.width;
  await page.getByRole("button", { name: "Wide preview" }).click();
  await expect(page.getByRole("button", { name: "Wide preview" })).toHaveAttribute("aria-pressed", "true");
  expect((await stage.boundingBox())!.width).toBeGreaterThan(narrowWidth);
  await expect(stage.getByText("Browser", { exact: true })).toBeVisible();
  await expect(stage.getByText("Server", { exact: true })).toBeVisible();
});

test("tabbed layout follows the Lesson and records Probe and Articulation answers once", async ({ page, workspace }) => {
  await page.getByRole("button", { name: "Tabbed layout" }).click();
  await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
  await tab(page, "Memory").click();
  await page.getByRole("button", { name: "Show me why" }).click();
  await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
  // The conversation pane shows only the Lesson, so the work's Why buttons are out of sight.
  await expect(page.getByRole("button", { name: "Back to work", exact: true })).toBeVisible();
  await expect(why(page)).toHaveCount(0);
  await expect(askWhy(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Skip this time", exact: true })).toBeDisabled();
  await expect(card(page, "Probe").getByRole("textbox", { name: "Answer" })).toBeEnabled();

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
  await expect(card(page, "Probe")).toContainText(probeAnswer);
  await expect(answer(page, "Probe")).toHaveCount(0);
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
  await expect(card(page, "Articulation")).toContainText(articulation);
  await expect(answer(page, "Articulation")).toHaveCount(0);
});

test("three-pane Why is tied to a file edit and Back to work unlocks lesson entry points", async ({ page, workspace }) => {
  await expect(page.getByRole("button", { name: "Three-pane layout" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Live preview" })).toBeVisible();
  const edit = workspace.timeline.entries().find((entry) => entry.kind === "file_edit")!;
  await why(page).first().click();
  await expect(card(page, "Probe").getByRole("textbox", { name: "Answer" })).toBeEnabled();
  // A Lesson started from Why is its own conversation: the work's Offer is out of sight until Back to work.
  await expect(page.getByRole("button", { name: "Show me why" })).toHaveCount(0);
  expect(workspace.timeline.entries().findLast((e) => e.kind === "impasse")).toMatchObject({
    impasse: { trigger: "why", sourceEntryIds: [edit.id] },
  });

  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show me why" })).toBeEnabled();
  await expect(card(page, "Probe")).toContainText("No prediction submitted.");
  await expect(card(page, "Probe").getByRole("textbox")).toHaveCount(0);
  expect(workspace.timeline.entries().findLast((e) => e.kind === "lesson_end")).toMatchObject({ outcome: "abandoned" });
  expect(workspace.evidence).toHaveLength(0);

  const userTurns = workspace.timeline.entries().filter((e) => e.kind === "user_message").length;
  const question = "What does sessionStorage do here?";
  await askWhy(page).click();
  await page.getByRole("textbox", { name: "Message" }).fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(card(page, "Probe").last().getByRole("textbox", { name: "Answer" })).toBeEnabled();
  await expect(card(page, "Probe").first()).toContainText("No prediction submitted.");
  await expect(card(page, "Probe").first().getByRole("button")).toHaveCount(0);
  expect(workspace.timeline.entries().findLast((e) => e.kind === "impasse")).toMatchObject({
    impasse: { trigger: "ask_why", text: question },
  });
  expect(workspace.timeline.entries().filter((e) => e.kind === "user_message")).toHaveLength(userTurns);

  await page.getByRole("button", { name: "Tabbed layout" }).click();
  await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Back to work", exact: true }).click();
  await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
  await expect(askWhy(page)).toBeEnabled();
  await expect(why(page).first()).toBeEnabled();
});

test.describe("fixture teaching", () => {
  test.use({ teachingImplementation: "real" });

  test("a shorter Lesson keeps Explain selected and unlocks work after the recorded server edit", async ({ page, workspace }) => {
    await page.getByRole("button", { name: "Tabbed layout" }).click();
    await page.getByRole("button", { name: "Show me why" }).click();
    await card(page, "Probe").getByRole("button", { name: "It stays the same", exact: true }).click();
    await card(page, "Articulation").getByRole("button", { name: "Only hides the symptom" }).click();
    const completed = page.getByText("Lesson complete. Back to work.", { exact: true });
    await expect(completed).toHaveCount(1);
    await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => workspace.evidence).toContainEqual(expect.objectContaining({ conceptId: DEMO_CONCEPTS.sessionToken, type: "fix_judgement" }));

    const priorEntries = workspace.timeline.entries();
    const previousServerEdits = priorEntries.filter((entry) => entry.kind === "file_edit" && entry.path === recordedServerEdit.path).length;
    const message = page.getByRole("textbox", { name: "Message" });
    await message.fill(thirdMessage.text);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const serverEdits = page.getByRole("group", { name: `Edited ${recordedServerEdit.path}`, exact: true });
    await serverEdits.nth(previousServerEdits).getByRole("button", { name: "Why?", exact: true }).click();
    const newEdit = workspace.timeline.entries().slice(priorEntries.length).find((entry) =>
      entry.kind === "file_edit" && entry.path === recordedServerEdit.path,
    );
    expect(newEdit).toMatchObject({ diff: recordedServerEdit.diff });
    await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
    expect(workspace.timeline.entries().findLast((entry) => entry.kind === "impasse")).toMatchObject({
      impasse: { trigger: "why", sourceEntryIds: [newEdit!.id] },
    });
    await card(page, "Probe").last().getByRole("button", { name: "The page creates a new token" }).click();

    await expect(completed).toHaveCount(2);
    await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
    await expect(card(page, "Explanation").last()).toContainText("Check the session lookup");
    await expect(card(page, "Articulation")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Back to work", exact: true })).toHaveCount(0);
    await expect(askWhy(page)).toBeEnabled();
    await expect(message).toHaveAttribute("placeholder", "Message your agent…");

    await page.reload();
    await expect(tab(page, "Explain")).toHaveAttribute("aria-selected", "true");
    await expect(card(page, "Explanation").last()).toBeVisible();
    await tab(page, "Preview").click();
    await expect(tab(page, "Preview")).toHaveAttribute("aria-selected", "true");
    await tab(page, "Memory").click();
    const nextMessage = "Please continue checking the portfolio.";
    await message.fill(nextMessage);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(`(stub agent) You said: ${nextMessage}`, { exact: true })).toBeVisible();
    await expect(tab(page, "Memory")).toHaveAttribute("aria-selected", "true");
  });

  test("the learning invitation complements the 401 logs and an early exit leaves a read-only record", async ({ page, workspace }) => {
    const timeline = page.getByLabel("Timeline", { exact: true });
    await expect(timeline.getByText(/GET \/api\/me 401 \(Unauthorized\)/)).toHaveCount(2);
    await expect(timeline.getByLabel("Offer", { exact: true })).toContainText("Why does the page lose your login?");

    await page.getByRole("button", { name: "Show me why" }).click();
    await expect(page.getByText("Learning: Why does the page lose your login?", { exact: true })).toBeVisible();
    await card(page, "Probe").getByRole("button", { name: "There is no token until I log in" }).click();
    const finalQuestion = card(page, "Articulation");
    await expect(finalQuestion.getByRole("button", { name: "Only hides the symptom" })).toBeEnabled();
    await page.getByRole("button", { name: "Back to work", exact: true }).click();

    await expect(page.getByText("Ended early · Read-only", { exact: true })).toBeVisible();
    await expect(card(page, "Probe")).toContainText("Your prediction · There is no token until I log in");
    await expect(card(page, "Explanation")).toContainText("The browser creates the token before you sign in");
    await expect(card(page, "Explanation").getByRole("button", { name: "Flag as incorrect" })).toHaveCount(0);
    await expect(finalQuestion).toContainText("Final question unanswered.");
    await expect(finalQuestion.getByRole("region", { name: "Fix feedback" })).toHaveCount(0);
    await expect(finalQuestion.getByRole("button")).toHaveCount(0);
    expect(workspace.evidence).toHaveLength(0);
  });

  test("a prediction reveals the grounded explanation and a fix judgement", async ({ page, workspace }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Show me why" }).click();
    const probe = card(page, "Probe");
    await expect(probe).toBeInViewport();
    await probe.getByRole("button", { name: "The page creates a new token" }).click();
    await expect(probe).toContainText("Your prediction · The page creates a new token");
    const explanation = card(page, "Explanation");
    await expect(explanation).toBeInViewport();
    await expect(explanation).toContainText("Correct prediction.");
    await expect(explanation.getByRole("list", { name: "Data flow" }).getByRole("listitem")).toHaveText([
      /Page reloads.*app\.js reruns.*Browser creates a new token/,
      /GET \/api\/me.*Server finds no matching session/,
      /if \(!session\).*401 Unauthorized/,
    ]);
    const references = explanation.getByRole("list", { name: "Code references" }).getByRole("listitem");
    await expect(references).toHaveText(["public/app.js:2, 23–26", "server.js:19–21, 38–42"]);
    await card(page, "Articulation").getByRole("button", { name: "Only hides the symptom" }).click();
    await expect(page.getByText("Lesson complete. Back to work.", { exact: true })).toBeVisible();
    expect(workspace.timeline.entries().findLast((entry) => entry.kind === "lesson_end")).toMatchObject({ outcome: "completed" });
  });

  test("a mistaken prediction and fix judgement receive feedback on the lesson cards", async ({ page, workspace }) => {
    await page.getByRole("button", { name: "Show me why" }).click();
    const probe = card(page, "Probe");
    await probe.getByRole("button", { name: "It stays the same", exact: true }).click();
    await expect(probe).toContainText("Your prediction · It stays the same");
    await expect(probe.getByRole("button")).toHaveCount(0);
    await expect(card(page, "Explanation")).toContainText("The token lives only in memory.");
    const judgement = card(page, "Articulation");
    await expect(judgement.getByRole("region", { name: "Fix feedback" })).toHaveCount(0);
    await judgement.getByRole("button", { name: "Fixes the cause", exact: true }).click();
    await expect(page.getByText("Lesson complete. Back to work.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(judgement).toContainText("Your answer · Fixes the cause");
    await expect(judgement.getByRole("region", { name: "Fix feedback" }).getByRole("heading", { name: "Only hides the symptom" })).toBeVisible();
    await expect(judgement).toContainText("Saving the list doesn’t fix the token mismatch.");
    await expect.poll(() => workspace.evidence).toContainEqual(expect.objectContaining({ type: "fix_judgement", outcome: "negative" }));
  });
});

test.describe("Lesson answer recovery", () => {
  test.use({ failFirstLessonAnswer: true });

  test("retains the prediction after a failed answer request, then retries and records an explanation flag", async ({ page, workspace }) => {
    await page.getByRole("button", { name: "Show me why" }).click();
    const probe = card(page, "Probe");
    await probe.getByRole("textbox", { name: "Answer" }).fill("The browser keeps the old token.");
    await answer(page, "Probe").click();
    const error = page.getByRole("alert").filter({ hasText: "Your answer is saved." });
    await expect(error).toBeVisible();
    await expect(card(page, "Explanation")).toHaveCount(0);
    await error.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card(page, "Explanation")).toBeVisible();
    await expect(error.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    expect(workspace.timeline.entries().filter((entry) => entry.kind === "card_answer" && entry.step === "probe")).toHaveLength(1);
    await card(page, "Articulation").getByRole("textbox", { name: "Answer" }).fill("The new token has no stored session.");
    await answer(page, "Articulation").click();
    await expect(page.getByText("Lesson complete. Back to work.", { exact: true })).toBeVisible();
    expect(workspace.timeline.entries().findLast((entry) => entry.kind === "lesson_end")).toMatchObject({ outcome: "completed" });
    const explanation = workspace.timeline.entries().filter((entry) => isKind(entry, "lesson_card")).find((entry) => entry.step === "explain")!;
    await card(page, "Explanation").getByRole("button", { name: "Flag as incorrect" }).click();
    await expect(card(page, "Explanation").getByRole("status")).toHaveText("Flagged as incorrect");
    expect(workspace.timeline.entries().filter((entry) => entry.kind === "explanation_flagged")).toMatchObject([
      { lessonId: explanation.lessonId, cardEntryId: explanation.id },
    ]);
    await page.reload();
    await expect(card(page, "Explanation").getByRole("status")).toHaveText("Flagged as incorrect");
  });
});

test("Skip is recorded without Evidence and leaves the composer in work mode", async ({ page, workspace }) => {
  await expect(page.getByLabel("Offer", { exact: true })).toContainText("Optional lesson");
  await page.getByRole("button", { name: "Skip this time", exact: true }).click();
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
