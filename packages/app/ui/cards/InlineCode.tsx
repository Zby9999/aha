import { Fragment } from "react";

/**
 * Plain text with `backtick` spans shown as code. Lesson text is asked for in plain text, but the model still wraps
 * identifiers in backticks, and showing them literally reads as noise to a novice. An unpaired backtick stays as it is.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split(/`([^`\n]+)`/);
  return parts.map((part, index) => index % 2 === 1
    ? <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{part}</code>
    : <Fragment key={index}>{part}</Fragment>);
}
