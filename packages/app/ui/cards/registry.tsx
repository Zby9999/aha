import { useState } from "react";
import { cardComponentDefinitions, type Citation } from "@aha/contracts";
import { defineCatalog } from "@json-render/core";
import { defineRegistry } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Input } from "../components/ui/input.tsx";
import { useCard } from "./context.ts";

/** The lesson-card catalog: structure from @aha/contracts, rendering with shadcn/ui (ADR-0004). */
export const cardCatalog = defineCatalog(schema, { components: cardComponentDefinitions, actions: {} });

function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {citations.map((c) => (
        <Badge key={`${c.path}:${c.startLine ?? ""}`} variant="outline" className="font-mono">
          {c.path}
          {c.startLine ? `:${c.startLine}` : ""}
        </Badge>
      ))}
    </div>
  );
}

function TextAnswer({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text);
      }}
    >
      <Input disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" aria-label="Answer" />
      <Button disabled={disabled} type="submit">Answer</Button>
    </form>
  );
}

export const { registry } = defineRegistry(cardCatalog, {
  components: {
    OfferCard: ({ props }) => {
      const { dispatch, done } = useCard();
      const respond = (response: "accept" | "skip") =>
        dispatch({ type: "offer_response", impasseId: props.impasseId, response });
      return (
        <Card aria-label="Offer" className="bg-lesson ring-lesson-border">
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
            <CardDescription>{props.body}</CardDescription>
          </CardHeader>
          <CardFooter className="flex-wrap gap-2">
            <Button disabled={done} onClick={() => respond("accept")}>Show me why</Button>
            <Button disabled={done} variant="ghost" onClick={() => respond("skip")}>Skip</Button>
          </CardFooter>
        </Card>
      );
    },
    ProbeCard: ({ props }) => {
      const { answer, done } = useCard();
      return (
        <Card aria-label="Probe">
          <CardHeader>
            <Badge variant="secondary">Predict</Badge>
            <CardTitle>{props.question}</CardTitle>
          </CardHeader>
          <CardContent>
            <Citations citations={props.citations} />
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            {props.options ? (
              props.options.map((o) => (
                <Button key={o.id} variant="outline" disabled={done} onClick={() => answer(props.lessonId, { type: "choice", optionId: o.id })}>
                  {o.label}
                </Button>
              ))
            ) : (
              <TextAnswer disabled={done} onSubmit={(text) => answer(props.lessonId, { type: "text", text })} />
            )}
          </CardFooter>
        </Card>
      );
    },
    ArticulationCard: ({ props }) => {
      const { answer, done } = useCard();
      return (
        <Card aria-label="Articulation">
          <CardHeader>
            <Badge variant="secondary">{props.mode === "judge_fix" ? "Judge the fix" : "In your own words"}</Badge>
            <CardTitle>{props.prompt}</CardTitle>
          </CardHeader>
          <CardContent>
            <Citations citations={props.citations} />
          </CardContent>
          <CardFooter className="flex-wrap gap-2">
            {props.mode === "judge_fix" ? (
              <>
                <Button variant="outline" disabled={done} onClick={() => answer(props.lessonId, { type: "fix_judgement", addressesCause: true })}>Fixes the cause</Button>
                <Button variant="outline" disabled={done} onClick={() => answer(props.lessonId, { type: "fix_judgement", addressesCause: false })}>Only hides the symptom</Button>
              </>
            ) : (
              <TextAnswer disabled={done} onSubmit={(text) => answer(props.lessonId, { type: "text", text })} />
            )}
          </CardFooter>
        </Card>
      );
    },
    TextExplanation: ({ props }) => (
      <Card aria-label="Explanation">
        <CardHeader>
          <Badge variant="secondary">Explain</Badge>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm leading-relaxed">{props.text}</p>
          <Citations citations={props.citations} />
        </CardContent>
      </Card>
    ),
  },
});
