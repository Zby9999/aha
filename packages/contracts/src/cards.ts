import type { Spec } from "@json-render/core";
import type { z } from "zod";
import type {
  articulationCardSchema,
  offerCardSchema,
  probeCardSchema,
  probeOptionSchema,
  textExplanationSchema,
} from "./catalog.ts";
import type { Citation } from "./learning.ts";

/**
 * A lesson card is a json-render Spec built from the Teaching catalog.
 * The catalog's structure (Zod props) is in `catalog.ts`; the app renders it with shadcn/ui (ADR-0004).
 */
export type CardSpec = Spec;

export const CATALOG_COMPONENTS = [
  "OfferCard",
  "ProbeCard",
  "ArticulationCard",
  "Flowchart",
  "DataFlowDiagram",
  "SequenceDiagram",
  "ContrastView",
  "TextExplanation",
  "LearnerModelPanel",
] as const;
export type CatalogComponent = (typeof CATALOG_COMPONENTS)[number];

/** Components that can carry an explanation (the Explain step). */
export const EXPLANATION_COMPONENTS = [
  "Flowchart",
  "DataFlowDiagram",
  "SequenceDiagram",
  "ContrastView",
  "TextExplanation",
] as const satisfies readonly CatalogComponent[];
export type ExplanationComponent = (typeof EXPLANATION_COMPONENTS)[number];

/** Actions the app routes back to the backend when a card is used. */
export const CARD_ACTIONS = ["accept_offer", "decline_offer", "let_agent_continue", "submit_answer", "flag_explanation"] as const;
export type CardAction = (typeof CARD_ACTIONS)[number];

export type OfferCardProps = z.infer<typeof offerCardSchema>;
export type ProbeOption = z.infer<typeof probeOptionSchema>;
export type ProbeCardProps = z.infer<typeof probeCardSchema>;
export type ArticulationCardProps = z.infer<typeof articulationCardSchema>;
export type TextExplanationProps = z.infer<typeof textExplanationSchema>;

/** Every explanation component carries citations so the grounding check can verify them. */
export interface ExplanationProps {
  title: string;
  citations: Citation[];
}

/** The user's answer to a Probe or Articulation card. */
export type CardAnswer =
  | { type: "choice"; optionId: string }
  | { type: "text"; text: string }
  | { type: "fix_judgement"; addressesCause: boolean; reason?: string };
