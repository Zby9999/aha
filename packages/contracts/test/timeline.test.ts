import { describe, expect, expectTypeOf, test } from "vitest";
import { createTimeline, isKind, type NewTimelineEntry, type TimelineEntry, type TimelinePayloads } from "../src/index.ts";

const fixedClock = () => new Date("2026-11-21T10:00:00.000Z");

describe("createTimeline", () => {
  test("append assigns id, seq, time and version and keeps the payload", () => {
    const timeline = createTimeline({ sessionId: "s1", now: fixedClock });
    timeline.append({ kind: "session_start", source: "app", projectDir: "/tmp/portfolio" });
    const entry = timeline.append({ kind: "user_message", source: "agent-host", text: "Add login" });

    expect(entry).toEqual({
      kind: "user_message",
      source: "agent-host",
      text: "Add login",
      id: "s1:1",
      sessionId: "s1",
      seq: 1,
      at: "2026-11-21T10:00:00.000Z",
      version: 1,
    });
    expect(timeline.entries().map((e) => e.seq)).toEqual([0, 1]);
  });

  test("subscribers see entries appended after they subscribe, until they unsubscribe", () => {
    const timeline = createTimeline({ sessionId: "s1" });
    timeline.append({ kind: "agent_message", source: "agent-host", messageId: "m", text: "before" });
    const seen: string[] = [];
    const unsubscribe = timeline.subscribe((e) => seen.push(e.id));
    timeline.append({ kind: "agent_message", source: "agent-host", messageId: "m", text: "during" });
    unsubscribe();
    timeline.append({ kind: "agent_message", source: "agent-host", messageId: "m", text: "after" });

    expect(seen).toEqual(["s1:1"]);
  });

  test("a subscriber can append in response without losing order", () => {
    const timeline = createTimeline({ sessionId: "s1" });
    timeline.subscribe((e) => {
      if (e.kind === "error") timeline.append({ kind: "agent_message", source: "agent-host", messageId: "m1", text: "fixing" });
    });
    timeline.append({ kind: "error", source: "agent-host", origin: "project", message: "boom" });
    expect(timeline.entries().map((e) => [e.seq, e.kind])).toEqual([
      [0, "error"],
      [1, "agent_message"],
    ]);
  });

  test("starts from replayed entries and continues their numbering", () => {
    const first = createTimeline({ sessionId: "s1" });
    first.append({ kind: "user_message", source: "agent-host", text: "hi" });
    const replay = createTimeline({ sessionId: "s1", initial: first.entries() });
    const next = replay.append({ kind: "agent_message", source: "agent-host", messageId: "m", text: "hello" });

    expect(next.seq).toBe(1);
    expect(replay.entries()).toHaveLength(2);
  });

  test("entries() returns a copy that cannot change the Timeline", () => {
    const timeline = createTimeline({ sessionId: "s1" });
    timeline.append({ kind: "user_message", source: "app", text: "x" });
    (timeline.entries() as TimelineEntry[]).pop();
    expect(timeline.entries()).toHaveLength(1);
  });

  test("rejects replayed entries from another session", () => {
    const entry = createTimeline({ sessionId: "other" }).append({ kind: "user_message", source: "app", text: "x" });
    expect(() => createTimeline({ sessionId: "s1", initial: [entry] })).toThrow(/session other/);
  });

  test("rejects replayed entries with gaps in seq", () => {
    const entry = createTimeline({ sessionId: "s1" }).append({ kind: "user_message", source: "app", text: "x" });
    expect(() => createTimeline({ sessionId: "s1", initial: [{ ...entry, seq: 3 }] })).toThrow(/seq 3/);
  });
});

describe("Timeline entry types", () => {
  test("isKind narrows an entry to its payload", () => {
    const entry: TimelineEntry = createTimeline({ sessionId: "s1" }).append({
      kind: "file_edit",
      source: "agent-host",
      path: "src/auth.js",
      change: "modify",
    });
    if (isKind(entry, "file_edit")) {
      expectTypeOf(entry.path).toEqualTypeOf<string>();
      expect(entry.path).toBe("src/auth.js");
    } else {
      throw new Error("expected file_edit");
    }
  });

  test("a new entry must carry the payload of its kind", () => {
    expectTypeOf<{ kind: "user_message"; source: "app"; text: string }>().toExtend<NewTimelineEntry>();
    expectTypeOf<{ kind: "user_message"; source: "app" }>().not.toExtend<NewTimelineEntry>();
    expectTypeOf<{ kind: "offer"; source: "teaching"; text: string }>().not.toExtend<NewTimelineEntry>();
  });
});

test("every kind's payload is compatible with the entry base (no field collisions)", () => {
  // A payload field that collides with a base field (e.g. `source`) turns its kind into `never` and silently drops it.
  type Kinds = TimelineEntry["kind"];
  expectTypeOf<Kinds>().toEqualTypeOf<keyof TimelinePayloads>();
});
