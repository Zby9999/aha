import { card } from "@aha/contracts/fixtures";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { LessonCardView } from "../ui/cards/LessonCardView.tsx";

const renderExplanation = (text: string) => renderToStaticMarkup(createElement(LessonCardView, {
  card: card("TextExplanation", { title: "How `login` checks", text, citations: [{ path: "server.js", startLine: 3 }] }),
  entryId: "e1",
  done: false,
  dispatch: () => {},
}));

test("backticks in a TextExplanation render as code, not as literal backticks", () => {
  // Live, explanations showed `checkPassword` with the backticks.
  const html = renderExplanation("Login calls `checkPassword` with the stored `hash`.");
  expect(html).not.toContain("`");
  expect(html).toMatch(/Login calls <code[^>]*>checkPassword<\/code> with the stored <code[^>]*>hash<\/code>\./);
  expect(html).toMatch(/How <code[^>]*>login<\/code> checks/);
});

test("text without a closed backtick pair stays as it is", () => {
  expect(renderExplanation("A lone ` stays.")).toContain("A lone ` stays.");
});

test("general background is labelled as not coming from the project", () => {
  const html = renderToStaticMarkup(createElement(LessonCardView, {
    card: card("TextExplanation", { title: "Why a salt", text: "Line 3 adds a salt.", background: "A salt makes equal passwords hash differently.", citations: [{ path: "server.js", startLine: 3 }] }),
    entryId: "e2",
    done: false,
    dispatch: () => {},
  }));
  expect(html).toContain("General background, not from your project");
  expect(html).toContain("A salt makes equal passwords hash differently.");
  expect(renderExplanation("No background here.")).not.toContain("General background");
});
