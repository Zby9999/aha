import { z } from "zod";

/**
 * Props and descriptions of the lesson-card components (ADR-0004). This is the structure of the json-render
 * catalog: teaching uses it to generate and validate specs, the app renders it with shadcn/ui components.
 * Explanation diagrams (Flowchart, DataFlowDiagram, SequenceDiagram, ContrastView) are added here in #45.
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
});

export const textExplanationSchema = z.object({
  title: z.string(),
  text: z.string(),
  citations: z.array(citationSchema),
});

/** Catalog component definitions, in the shape `defineCatalog(schema, { components })` takes. */
export const cardComponentDefinitions = {
  OfferCard: {
    props: offerCardSchema,
    description: "A light, skippable suggestion to start a Lesson at a detected Impasse. The user can accept, decline or let the agent continue.",
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
