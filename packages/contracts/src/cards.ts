import type { Spec } from "@json-render/core";
import type { Citation } from "./learning.ts";

/**
 * A lesson card is a json-render Spec built from the Teaching catalog.
 * The catalog itself (Zod props, renderers) is owned by the teaching package;
 * the contracts fix only component names, the interactive cards' props and the action names.
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

export interface OfferCardProps {
  impasseId: string;
  title: string;
  body: string;
}

export interface ProbeOption {
  id: string;
  label: string;
}

export interface ProbeCardProps {
  lessonId: string;
  question: string;
  /** Multiple choice when present; free-text prediction otherwise. */
  options?: ProbeOption[];
  citations: Citation[];
}

export interface ArticulationCardProps {
  lessonId: string;
  prompt: string;
  /** "restate": explain in own words. "judge_fix": decide whether the agent's fix addresses the cause. */
  mode: "restate" | "judge_fix";
  citations: Citation[];
}

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
