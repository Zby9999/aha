import { z } from "zod";

/**
 * Props and descriptions of the lesson-card components (ADR-0004). This is the structure of the json-render
 * catalog: teaching uses it to generate and validate specs, the app renders it with shadcn/ui components.
 */

export const citationSchema = z.object({
  /** Project-relative path, e.g. "public/app.js". */
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export const offerCardSchema = z.object({
  impasseId: z.string(),
  title: z.string(),
  body: z.string(),
});

export const probeOptionSchema = z.object({ id: z.string(), label: z.string() });

export const probeCardSchema = z.object({
  lessonId: z.string(),
  question: z.string(),
  /** Multiple choice when present; free-text prediction otherwise. */
  options: z.array(probeOptionSchema).optional(),
  citations: z.array(citationSchema),
});

export const articulationCardSchema = z.object({
  lessonId: z.string(),
  prompt: z.string(),
  /** "restate": explain in own words. "judge_fix": decide whether the agent's fix addresses the cause. */
  mode: z.enum(["restate", "judge_fix"]),
  citations: z.array(citationSchema),
  /** The explanation shown after the user submits a fix judgement. */
  feedback: z.object({ addressesCause: z.boolean(), explanation: z.string().min(1) }).optional(),
});

const flowLabel = z.string().trim().min(1);
const flowCitation = citationSchema.extend({ path: flowLabel }).refine(({ startLine, endLine }) => (
  endLine === undefined || (startLine !== undefined && endLine >= startLine)
), { path: ["endLine"], message: "The end line must be on or after the start line." });

export const flowchartSchema = z.object({
  title: flowLabel,
  steps: z.array(flowLabel).min(1),
  decision: z.object({
    question: flowLabel,
    branches: z.array(z.object({ label: flowLabel, steps: z.array(flowLabel).min(1) })).min(2)
      .refine((branches) => new Set(branches.map(({ label }) => label)).size === branches.length, "Branch labels must be distinct."),
    continuation: z.array(flowLabel).min(1).optional(),
  }).optional(),
  citations: z.array(flowCitation).min(1),
});

export const contrastViewSchema = z.object({
  title: flowLabel,
  leftLabel: flowLabel,
  rightLabel: flowLabel,
  rows: z.array(z.object({ label: flowLabel, left: flowLabel, right: flowLabel })).min(1),
  takeaway: flowLabel,
  citations: z.array(flowCitation).min(1),
}).refine(({ leftLabel, rightLabel }) => leftLabel !== rightLabel, { path: ["rightLabel"], message: "Name the two alternatives distinctly." });

export const sequenceDiagramSchema = z.object({
  title: flowLabel,
  participants: z.array(z.object({ id: flowLabel, label: flowLabel })).min(2).max(4),
  messages: z.array(z.object({ from: flowLabel, to: flowLabel, label: flowLabel })).min(1),
  citations: z.array(flowCitation).min(1),
}).refine(({ participants, messages }) => {
  const ids = new Set(participants.map(({ id }) => id));
  const endpoints = new Set(messages.flatMap(({ from, to }) => [from, to]));
  return ids.size === participants.length && endpoints.size === ids.size
    && messages.every(({ from, to }) => from !== to && ids.has(from) && ids.has(to));
}, { path: ["messages"], message: "Every message must connect two different participants, and each participant must take part." })
  .refine(({ participants }) => new Set(participants.map(({ label }) => label.toLowerCase())).size === participants.length,
    { path: ["participants"], message: "Give each participant a distinct display name." });

export const dataFlowDiagramSchema = z.object({
  title: flowLabel,
  summary: flowLabel.optional(),
  nodes: z.array(z.object({ id: flowLabel, label: flowLabel })).min(2),
  /** Directed connections in reading order. */
  edges: z.array(z.object({ from: flowLabel, to: flowLabel, label: flowLabel })).min(1),
  citations: z.array(flowCitation).min(1),
}).refine(({ nodes, edges }) => {
  const ids = new Set(nodes.map((node) => node.id));
  const endpoints = new Set(edges.flatMap(({ from, to }) => [from, to]));
  return ids.size === nodes.length && endpoints.size === ids.size && [...endpoints].every((id) => ids.has(id));
}, { path: ["edges"], message: "Connections must reference every node by a unique node ID." });

/** Counts sentences in English and in CJK text, for limits such as `background`'s two sentences. */
export function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?。！？])\s*/).filter((part) => part.trim()).length;
}

export const textExplanationSchema = z.object({
  title: z.string(),
  text: z.string(),
  citations: z.array(citationSchema),
  /**
   * At most two sentences of general knowledge the project code cannot show, labelled "General background, not from
   * your project". Only for answers to the learner's own questions (Ask why, follow-ups); the grounding check skips it,
   * and `text` must still tie it to the cited lines.
   */
  background: z.string().trim().min(1).max(400).refine((text) => sentenceCount(text) <= 2, "Keep the background to two sentences.").optional(),
});

/** The original card catalog used by App builds before they adopt the diagram renderers. */
export const cardComponentDefinitions = {
  OfferCard: {
    props: offerCardSchema,
    description: "A light, skippable suggestion to start a Lesson at a detected Impasse. The user can accept it (Show me why) or skip it, which lets the agent carry on.",
  },
  ProbeCard: {
    props: probeCardSchema,
    description: "The prediction or choice the user makes before an explanation. Multiple choice when options are given.",
  },
  ArticulationCard: {
    props: articulationCardSchema,
    description: "Asks the user to restate the idea in their own words, or to judge whether the agent's fix addresses the cause.",
  },
  TextExplanation: {
    props: textExplanationSchema,
    description: "A short plain-text explanation citing the user's files. Also the fallback when a diagram fails the grounding check.",
  },
} as const;

/** Complete Lesson catalog for renderers that support the diagram components. */
export const lessonCardComponentDefinitions = {
  ...cardComponentDefinitions,
  Flowchart: {
    props: flowchartSchema,
    description: "A process in reading order, with one decision that branches into labeled paths. Include common continuation steps if the branches merge.",
  },
  DataFlowDiagram: {
    props: dataFlowDiagramSchema,
    description: "Shows how data moves between parts of the project. Each labeled connection has a source and destination, in reading order. Cite the code that supports the flow.",
  },
  SequenceDiagram: {
    props: sequenceDiagramSchema,
    description: "Messages exchanged by two to four participants in chronological order. Cite the code behind the exchange.",
  },
  ContrastView: {
    props: contrastViewSchema,
    description: "Two approaches compared on the same criteria, with a short takeaway and source citations.",
  },
} as const;
