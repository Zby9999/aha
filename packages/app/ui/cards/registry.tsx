import { useState, type CSSProperties, type ReactNode } from "react";
import type { Citation } from "@aha/contracts";
import { defineRegistry } from "@json-render/react";
import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, BranchIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CodeFileIcon, FlagIcon } from "@/components/icons";
import { Button } from "../components/ui/button.tsx";
import { AhaMascot, type MascotAccessory } from "@/components/AhaMascot";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.tsx";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../components/ui/input-group.tsx";
import { cardCatalog } from "./catalog.ts";
import { CitedCode, type LineRange } from "./CitedCode.tsx";
import { InlineCode } from "./InlineCode.tsx";
import { useCard } from "./context.ts";

function Citations({ citations, expandable = false }: { citations: Citation[]; expandable?: boolean }) {
  if (citations.length === 0) return null;
  const files = new Map<string, { labels: Set<string>; ranges: LineRange[] }>();
  for (const { path, startLine, endLine } of citations) {
    const file = files.get(path) ?? { labels: new Set<string>(), ranges: [] };
    if (startLine !== undefined) {
      file.labels.add(endLine !== undefined && endLine !== startLine ? `${startLine}–${endLine}` : `${startLine}`);
      file.ranges.push({ start: startLine, end: endLine ?? startLine });
    }
    files.set(path, file);
  }
  // Each reference opens the cited lines from the project, so the learner can check the claim against the code.
  const references = (
      <ul aria-label="Code references" className="-mx-2 grid gap-0.5 text-xs text-muted-foreground">
        {[...files].map(([path, { labels, ranges }]) => (
          <li key={path} className="group/citation">
            <Collapsible>
              <CollapsibleTrigger className="lesson-citation-trigger flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
                <CodeFileIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <code className="min-w-0 flex-1 leading-snug wrap-anywhere">{path}{labels.size > 0 && `:${[...labels].join(", ")}`}</code>
                <ChevronDownIcon aria-hidden="true" className="lesson-citation-chevron size-3.5 shrink-0 transition-transform" />
              </CollapsibleTrigger>
              {/* Only a reference with another below it needs space under its code; the card pads the last one. */}
              <CollapsibleContent className="pt-1.5 group-not-last/citation:pb-1">
                <CitedCode path={path} ranges={ranges} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
  );
  if (expandable) {
    return (
      <Collapsible className="border-t pt-1">
        <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" className="lesson-evidence-trigger w-full justify-start" />}>
          <CodeFileIcon data-icon="inline-start" aria-hidden="true" />
          Code references
          <ChevronDownIcon data-icon="inline-end" className="ms-auto" aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1">{references}</CollapsibleContent>
      </Collapsible>
    );
  }
  return (
    <div className="grid gap-1.5 border-t pt-2.5 text-xs text-muted-foreground">
      <p className="font-medium">Code references</p>
      {references}
    </div>
  );
}

function TextAnswer({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    // The submit button sits inside the field, like the composer's send button, so it doesn't read as a second label.
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSubmit(text);
      }}
    >
      {/* 40px field, 12px radius; the 28px button is inset 6px with a 6px radius, so the corners nest. */}
      <InputGroup data-disabled={disabled || undefined} className="h-10 rounded-[0.75rem]">
        <InputGroupInput disabled={disabled} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" aria-label="Answer" />
        <InputGroupAddon align="inline-end" className="pr-[5px] has-[>button]:mr-0">
          <InputGroupButton type="submit" size="icon-xs" className="h-7 w-7 rounded-[6px]" aria-label="Answer" variant={disabled || !text.trim() ? "secondary" : "default"} disabled={disabled || !text.trim()}>
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

function StepLabel({ children }: { children: string }) {
  return <p className="text-xs font-semibold text-muted-foreground">{children}</p>;
}

function SubmittedAnswer({ children, label = "Your answer" }: { children: string; label?: string }) {
  // The learner recognises their own words; the label is only for screen readers.
  return <p className="wrap-anywhere text-sm leading-relaxed text-foreground"><span className="sr-only">{label}: </span>{children}</p>;
}

function ChoiceButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" className="w-full justify-between px-3 py-2.5 text-start font-normal" disabled={disabled} onClick={onClick}>
      <span className="min-w-0 wrap-anywhere">{children}</span>
      <ChevronRightIcon data-icon="inline-end" aria-hidden="true" className="text-muted-foreground" />
    </Button>
  );
}

function FlowNode({ children, start, outgoing, result }: {
  children: string | undefined; start?: boolean; outgoing: boolean; result?: boolean;
}) {
  return (
    <p className="lesson-flow-node" data-start={start || undefined} data-outgoing={outgoing || undefined} data-result={result || undefined}>
      {children}
    </p>
  );
}

const fixJudgementLabel = (addressesCause: boolean) => addressesCause ? "Fixes the cause" : "Only hides the symptom";

function FlagExplanation() {
  const { dispatch, entryId, flag } = useCard();
  if (!flag || (!flag.enabled && !flag.recorded)) return null;
  return (
    <CardFooter>
      {flag.recorded ? (
        <p className="text-xs text-muted-foreground" role="status">Flagged as incorrect</p>
      ) : (
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground"
          onClick={() => dispatch({ type: "flag_explanation", lessonId: flag.lessonId, cardEntryId: entryId })}>
          <FlagIcon data-icon="inline-start" aria-hidden="true" /> Flag as incorrect
        </Button>
      )}
    </CardFooter>
  );
}

function CardMascot({ accessory }: { accessory: MascotAccessory }) {
  return <CardAction><AhaMascot accessory={accessory} className="lesson-card-mascot" /></CardAction>;
}

function StructuredExplanation({ title, citations, accessory, children }: { title: string; citations: Citation[]; accessory: MascotAccessory; children: ReactNode }) {
  return (
    <Card aria-label="Explanation" className="lesson-reading-card min-w-0" data-diagram>
      <CardHeader><CardTitle role="heading" aria-level={3}>{title}</CardTitle><CardMascot accessory={accessory} /></CardHeader>
      <CardContent className="grid min-w-0 gap-3">
        {children}
        <Citations citations={citations} expandable />
      </CardContent>
      <FlagExplanation />
    </Card>
  );
}

function ProcessSteps({ steps, label }: { steps: string[]; label: string }) {
  return (
    <ol aria-label={label} role="list" className="lesson-process-steps">
      {steps.map((step, index) => (
        <li key={index}>
          {index > 0 && <ArrowDownIcon aria-hidden="true" />}
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export const { registry } = defineRegistry(cardCatalog, {
  components: {
    OfferCard: ({ props }) => {
      const { dispatch, done } = useCard();
      const respond = (response: "accept" | "skip") =>
        dispatch({ type: "offer_response", impasseId: props.impasseId, response });
      return (
        <Card aria-label="Offer" className="lesson-invitation" data-offer-state={done ? "inactive" : "available"}>
          <CardHeader>
            <span className="lesson-offer-caption">Optional lesson</span>
            <CardTitle>{props.title}</CardTitle>
            <CardDescription>{props.body}</CardDescription>
            <CardMascot accessory="bulb" />
          </CardHeader>
          <CardFooter className="flex-wrap gap-2">
            <Button variant={done ? "secondary" : "default"} disabled={done} onClick={() => respond("accept")}>Show me why</Button>
            <Button disabled={done} variant="ghost" onClick={() => respond("skip")}>Skip this time</Button>
          </CardFooter>
        </Card>
      );
    },
    ProbeCard: ({ props }) => {
      const { answer, done, endedEarly, submitted } = useCard();
      const response = submitted?.type === "choice"
        ? props.options?.find((option) => option.id === submitted.optionId)?.label
        : submitted?.type === "text" ? submitted.text : undefined;
      if (response !== undefined) {
        return (
          <div role="group" aria-label="Probe" className="px-1.5 py-1">
            <p className="sr-only">{props.question}</p>
            <SubmittedAnswer label="Your prediction">{response}</SubmittedAnswer>
          </div>
        );
      }
      return (
        <Card aria-label="Probe" className="lesson-reading-card">
          <CardHeader>
            <StepLabel>Predict</StepLabel>
            <CardTitle role="heading" aria-level={3}>{props.question}</CardTitle>
            <CardMascot accessory="question" />
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {endedEarly ? (
              <p className="text-sm text-muted-foreground">No prediction submitted.</p>
            ) : props.options ? (
              <div className="lesson-choices" role="group" aria-label="Prediction choices">
                {props.options.map((o) => (
                  <ChoiceButton key={o.id} disabled={done} onClick={() => answer(props.lessonId, { type: "choice", optionId: o.id })}>
                    {o.label}
                  </ChoiceButton>
                ))}
              </div>
            ) : (
              <TextAnswer disabled={done} onSubmit={(text) => answer(props.lessonId, { type: "text", text })} />
            )}
            <Citations citations={props.citations} />
          </CardContent>
        </Card>
      );
    },
    ArticulationCard: ({ props }) => {
      const { answer, done, endedEarly, submitted } = useCard();
      const response = submitted?.type === "fix_judgement"
        ? fixJudgementLabel(submitted.addressesCause)
        : submitted?.type === "text" ? submitted.text : undefined;
      const feedback = submitted?.type === "fix_judgement" ? props.feedback : undefined;
      return (
        <Card aria-label="Articulation" className="lesson-reading-card">
          {!feedback && (
            <CardHeader>
              <StepLabel>{props.mode === "judge_fix" ? "Judge the fix" : "Put it in your own words"}</StepLabel>
              <CardTitle role="heading" aria-level={3}>{props.prompt}</CardTitle>
              <CardMascot accessory="speech" />
            </CardHeader>
          )}
          <CardContent className="grid gap-2.5">
            {response !== undefined ? (
              <>
                {feedback && (
                  <section aria-label="Fix feedback" className="lesson-fix-feedback grid gap-1 text-sm">
                    <p className="sr-only">{props.prompt}</p>
                    <h3 className="text-base font-semibold">{fixJudgementLabel(feedback.addressesCause)}</h3>
                    <p className="leading-relaxed">{feedback.explanation}</p>
                  </section>
                )}
                <SubmittedAnswer>{response}</SubmittedAnswer>
              </>
            ) : endedEarly ? (
              <p className="text-sm text-muted-foreground">Final question unanswered.</p>
            ) : props.mode === "judge_fix" ? (
              <div className="lesson-choices" role="group" aria-label="Fix judgement choices">
                <ChoiceButton disabled={done} onClick={() => answer(props.lessonId, { type: "fix_judgement", addressesCause: true })}>{fixJudgementLabel(true)}</ChoiceButton>
                <ChoiceButton disabled={done} onClick={() => answer(props.lessonId, { type: "fix_judgement", addressesCause: false })}>{fixJudgementLabel(false)}</ChoiceButton>
              </div>
            ) : (
              <TextAnswer disabled={done} onSubmit={(text) => answer(props.lessonId, { type: "text", text })} />
            )}
            <Citations citations={props.citations} />
          </CardContent>
        </Card>
      );
    },
    Flowchart: ({ props }) => (
      <StructuredExplanation title={props.title} citations={props.citations} accessory="signpost">
        <div className="lesson-process">
          <ProcessSteps steps={props.steps} label="Process steps" />
          {props.decision && (
            <>
              <ArrowDownIcon aria-hidden="true" className="lesson-process-connector" />
              <p className="lesson-process-question"><BranchIcon aria-hidden="true" />{props.decision.question}</p>
              <ul aria-label="Decision branches" role="list" className="lesson-process-branches">
                {props.decision.branches.map(({ label, steps }) => (
                  <li key={label}>
                    <p>{label}</p>
                    <ProcessSteps steps={steps} label={`${label} steps`} />
                  </li>
                ))}
              </ul>
              {props.decision.continuation && (
                <>
                  <p className="lesson-process-join"><ArrowDownIcon aria-hidden="true" /> Paths rejoin</p>
                  <ProcessSteps steps={props.decision.continuation} label="Shared next steps" />
                </>
              )}
            </>
          )}
        </div>
      </StructuredExplanation>
    ),
    ContrastView: ({ props }) => (
      <StructuredExplanation title={props.title} citations={props.citations} accessory="contrast">
        <p className="lesson-comparison-takeaway">{props.takeaway}</p>
        <div className="lesson-comparison">
          <div className="lesson-comparison-head" aria-hidden="true">
            <p>{props.leftLabel}</p><p>{props.rightLabel}</p>
          </div>
          <dl>
            {props.rows.map(({ label, left, right }, index) => (
              <div className="lesson-comparison-row" key={index}>
                <dt>{label}</dt>
                <dd><span className="sr-only">{props.leftLabel}: </span>{left}</dd>
                <dd><span className="sr-only">{props.rightLabel}: </span>{right}</dd>
              </div>
            ))}
          </dl>
        </div>
      </StructuredExplanation>
    ),
    SequenceDiagram: ({ props }) => {
      const lanes = new Map(props.participants.map(({ id, label }, index) => [id, { position: index + 1, label }]));
      return (
        <StructuredExplanation title={props.title} citations={props.citations} accessory="envelope">
          <div className="lesson-sequence" style={{ "--sequence-lanes": lanes.size } as CSSProperties}>
            <div className="lesson-sequence-lanes" aria-hidden="true">
              {props.participants.map(({ id, label }) => <p key={id}>{label}</p>)}
            </div>
            <ol aria-label="Messages in time order" role="list" className="lesson-sequence-messages">
              {props.messages.map(({ from, to, label }, index) => {
                const sender = lanes.get(from)!;
                const receiver = lanes.get(to)!;
                const first = Math.min(sender.position, receiver.position);
                const last = Math.max(sender.position, receiver.position);
                const Arrow = sender.position < receiver.position ? ChevronRightIcon : ChevronLeftIcon;
                return (
                  <li key={index}>
                    <p className="lesson-sequence-route">
                      {sender.label} <ArrowRightIcon aria-hidden="true" /><span className="sr-only">to </span>{receiver.label}
                    </p>
                    <div className="lesson-sequence-message" style={{ gridColumn: `${first} / ${last + 1}`, "--sequence-span": last - first + 1 } as CSSProperties}>
                      <p>{label}</p>
                      <span className="lesson-sequence-arrow" data-reverse={sender.position > receiver.position || undefined} aria-hidden="true"><Arrow /></span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </StructuredExplanation>
      );
    },
    DataFlowDiagram: ({ props }) => {
      const labels = new Map(props.nodes.map(({ id, label }) => [id, label]));
      const sources = new Set(props.edges.map(({ from }) => from));
      return (
        <Card aria-label="Explanation" className="lesson-reading-card" data-explanation data-diagram>
          <CardHeader>
            <StepLabel>Explanation</StepLabel>
            <CardTitle role="heading" aria-level={3}>{props.title}</CardTitle>
            <CardMascot accessory="flow" />
          </CardHeader>
          <CardContent className="grid gap-3">
            {props.summary && <p className="text-sm leading-relaxed">{props.summary}</p>}
            <ol aria-label="Data flow" className="lesson-flow" role="list">
              {props.edges.map(({ from, to, label }, index) => {
                const startsPath = props.edges[index - 1]?.to !== from;
                const continuesPath = props.edges[index + 1]?.from === to;
                return (
                  <li key={index} data-start={startsPath || undefined}>
                    {startsPath && <FlowNode start outgoing>{labels.get(from)}</FlowNode>}
                    <p className="lesson-flow-edge">{label}</p>
                    <FlowNode outgoing={continuesPath} result={!sources.has(to)}>{labels.get(to)}</FlowNode>
                  </li>
                );
              })}
            </ol>
            <Citations citations={props.citations} />
          </CardContent>
          <FlagExplanation />
        </Card>
      );
    },
    TextExplanation: ({ props }) => (
      <Card aria-label="Explanation" className="lesson-reading-card" data-explanation>
        <CardHeader>
          <StepLabel>Explanation</StepLabel>
          <CardTitle><InlineCode text={props.title} /></CardTitle>
          <CardMascot accessory="cap" />
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm leading-relaxed"><InlineCode text={props.text} /></p>
          {props.background && (
            <aside aria-label="General background" className="grid gap-1 border-l-2 pl-3 text-sm text-muted-foreground" data-background>
              <span className="text-xs font-medium">General background, not from your project</span>
              <p className="leading-relaxed"><InlineCode text={props.background} /></p>
            </aside>
          )}
          <Citations citations={props.citations} />
        </CardContent>
        <FlagExplanation />
      </Card>
    ),
  },
});
