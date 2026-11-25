import { describe, expect, it, vi } from "vitest";
import { createTimeline } from "@aha/contracts";
import { card, fixtureTimeline } from "@aha/contracts/fixtures";
import { createDecisions } from "../src/index.ts";

const choice = (choice: string) => ({ type: "choice", choice });
const noul = (noul: number) => ({ type: "noul", noul });
const response = (answers: object) => Response.json({ answers });
const concept = { id: "session-tokens", name: "Session tokens", mastery: "not_encountered" as const };

function repeatedGap() {
  const timeline = createTimeline({ sessionId: "decision-test" });
  const first = timeline.append({ kind: "user_message", source: "agent-host", text: "Why does refreshing log me out?" });
  timeline.append({ kind: "error", source: "agent-host", origin: "project", message: "401 after refresh" });
  const second = timeline.append({ kind: "user_message", source: "agent-host", text: "Refreshing still logs me out. Why?" });
  return { timeline, first, second };
}

describe("DecisionService", () => {
  it("uses Jev across distinct attempts and honors a skip on the same topic", async () => {
    const { timeline, first, second } = repeatedGap();
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const { questions } = JSON.parse(String(init?.body));
      return response({ recurring: noul(0.95), earlier: choice("event_0"),
        ...(questions.cooldown ? { cooldown: noul(0.9) } : {}) });
    });
    const service = createDecisions({ apiKey: "test", fetch: request });
    expect(await service.detectImpasse({ timeline: timeline.entries().slice(0, 2) })).toBeNull();
    expect(request).not.toHaveBeenCalled();
    const result = await service.detectImpasse({ timeline: timeline.entries() });
    expect(result?.impasse.sourceEntryIds).toEqual([first.id, second.id]);
    timeline.append({ kind: "impasse", source: "decisions", impasse: result!.impasse });
    timeline.append({ kind: "offer_response", source: "app", impasseId: result!.impasse.id, response: "skip" });
    timeline.append({ kind: "user_message", source: "agent-host", text: "I still get logged out after refresh" });
    expect(await service.detectImpasse({ timeline: timeline.entries() })).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores repeated tool and agent errors during streaming and detects the repeated project 401", async () => {
    const timeline = createTimeline({ sessionId: "error-origins" });
    const request = vi.fn<typeof fetch>(async () => response({ recurring: noul(0.95), earlier: choice("event_0") }));
    const service = createDecisions({ apiKey: "test", fetch: request });
    const projectIds: string[] = [];
    for (const origin of ["tool", "agent", "tool", "project", "agent", "project"] as const) {
      const entry = timeline.append({ kind: "error", source: "agent-host", origin,
        message: origin === "project" ? "GET /api/me 401 (Unauthorized)" : "The active page became unverified" });
      if (origin === "project") projectIds.push(entry.id);
      const detection = await service.detectImpasse({ timeline: timeline.entries() });
      if (projectIds.length < 2) expect(detection).toBeNull();
      else expect(detection?.impasse.sourceEntryIds).toEqual(projectIds);
    }
    expect(request).toHaveBeenCalledTimes(1);
    timeline.append({ kind: "error", source: "agent-host", origin: "tool", message: "Tool disconnected" });
    expect(await service.detectImpasse({ timeline: timeline.entries() })).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stops waiting on timeout, including for a transport that ignores abort", async () => {
    const { timeline } = repeatedGap();
    const request = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const service = createDecisions({ apiKey: "test", timeoutMs: 5, fetch: request });
    expect(await service.detectImpasse({ timeline: timeline.entries() })).toBeNull();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("does not turn self-report or an offer skip into Evidence", async () => {
    const t = fixtureTimeline("decision-test", "2026-11-21T10:00:00Z");
    t.add({ kind: "user_message", source: "agent-host", text: "I am good at tokens" });
    t.add({ kind: "offer_response", source: "app", impasseId: "a", response: "skip" });
    t.add({ kind: "user_message", source: "agent-host", text: "That change still generates a new token on each page load." });
    const entries = t.entries();
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const { state } = JSON.parse(String(init?.body));
      return response(state.event.startsWith("I am")
        ? { kind: choice("none"), strength: choice("weak"), outcome: choice("positive"), concept: choice("new") }
        : { kind: choice("caught_agent_mistake"), strength: choice("strong"),
          outcome: choice("positive"), concept: choice("concept_0") });
    });
    const service = createDecisions({ apiKey: "test", fetch: request });
    const evidence = await service.gateEvidence({ timeline: entries, newEntries: entries, concepts: [concept] });
    expect(evidence).toMatchObject([{ conceptId: concept.id, type: "caught_agent_mistake", entryIds: [entries[2]!.id] }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reads only relevant concepts and chooses a rendered component for the step", async () => {
    const service = createDecisions({ apiKey: "test", fetch: async () =>
      response({ concept_0: noul(0.95), concept_1: noul(0.1) }) });
    const impasse = { id: "a", title: "Why does refresh log me out?", trigger: "why" as const, conceptIds: [], sourceEntryIds: [] };
    expect(await service.selectConcepts({ impasse, concepts: [concept, { ...concept, id: "css", name: "CSS" }] }))
      .toEqual([concept.id]);
    expect(await service.chooseComponent({ impasse, step: "explain", learner: { concepts: [] } })).toBe("TextExplanation");
  });

  it("keeps untrusted text in state and considers concepts beyond the first batch", async () => {
    const marker = "arbitrary prose from the session";
    const { timeline } = repeatedGap();
    const entry = timeline.append({ kind: "user_message", source: "agent-host", text: marker });
    const catalog = Array.from({ length: 25 }, (_, i) => ({ ...concept, id: String(i), name: marker + i }));
    const request: typeof fetch = async (_url, init) => {
      const { state, questions } = JSON.parse(String(init?.body));
      expect(JSON.stringify(questions)).not.toContain(marker);
      const target = state.concepts.find((item: { name: string }) => item.name === marker + 24);
      return response({ concept: choice(target?.label ?? "new"), kind: choice("independent_fix"),
        strength: choice("strong"), outcome: choice("positive") });
    };
    const service = createDecisions({ apiKey: "test", fetch: request });
    expect(await service.gateEvidence({ timeline: timeline.entries(), newEntries: [entry], concepts: catalog }))
      .toMatchObject([{ conceptId: "24", entryIds: [entry.id] }]);
  });

  it("defers out-of-vocabulary evidence with both an empty and a nonmatching catalog", async () => {
    const { timeline, second } = repeatedGap();
    const request = vi.fn<typeof fetch>(async () => response({ concept: choice("new"),
      kind: choice("repeated_gap"), strength: choice("strong"), outcome: choice("negative") }));
    const service = createDecisions({ apiKey: "test", fetch: request });
    const input = { timeline: timeline.entries(), newEntries: [second] };
    expect(await service.gateEvidence({ ...input, concepts: [] })).toEqual([]);
    expect(await service.gateEvidence({ ...input, concepts: [concept] })).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns null and warns once for repeated unavailable reads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const service = createDecisions({ apiKey: "test-secret", fetch: async () => new Response(null, { status: 503 }) });
      const input = { concepts: [concept], impasse: { id: "i", title: "request text", trigger: "why" as const, conceptIds: [], sourceEntryIds: [] } };
      expect(await service.selectConcepts(input)).toBeNull();
      expect(await service.selectConcepts(input)).toBeNull();
      expect(warn.mock.calls).toEqual([["[decisions] Jev unavailable: HTTP 503"]]);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects uncited or missing project files", async () => {
    const service = createDecisions({ apiKey: "" });
    const project = { projectDir: "/demo", files: ["server.js"] };
    const mismatched = card("TextExplanation", { title: "Session", text: "Session token", citations: [{ path: "missing.js" }] });
    expect(await service.checkGrounding({ explanation: mismatched, citations: [{ path: "server.js" }], project }))
      .toMatchObject({ grounded: false, missingFiles: ["missing.js"] });
    for (const [citations, grounded] of [[[], false], [[{ path: "missing.js" }], false], [[{ path: "./server.js" }], true]] as const) {
      const explanation = card("TextExplanation", { title: "Session", text: "Session token", citations });
      expect(await service.checkGrounding({ explanation, citations, project })).toMatchObject({ grounded });
    }
  });
});
