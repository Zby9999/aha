import type { CardSpec, Citation, LessonInput, NewTimelineEntry, ProbeCardProps, Teaching, TeachingFactory, TimelineEntryOf } from "@aha/contracts";
import { card, DEMO_CONCEPTS, portfolioSessionFlow } from "@aha/contracts/fixtures";
import { createLessonGenerator, type PreviousLesson } from "./generated-lesson.ts";
import { lessonFormat, relevantConcepts } from "./lesson-format.ts";
import { captureLessonSources, citesLessonSources, relevantCitation, type LessonSources } from "./lesson-sources.ts";

type Assessment = Extract<NewTimelineEntry, { kind: "answer_assessment" }>;
type LessonCard = Extract<NewTimelineEntry, { kind: "lesson_card" }>;
type RunningLesson = {
  id: string;
  title: string;
  portfolio: boolean;
  format: ReturnType<typeof lessonFormat>;
  controller: AbortController;
  /** "feedback": the Articulation was wrong or unclear and got feedback; the Lesson stays open for questions until Back to work. */
  step: "probe" | "articulate" | "feedback";
  generated?: {
    input: LessonInput; sources: LessonSources; question: string; answer?: string;
    articulation?: { question: string; citations: Citation[]; explanation?: CardSpec };
    feedback?: { answer: string; feedback: string };
  };
};

const predictions = [
  {
    id: "same",
    label: "It stays the same",
    feedback: "The token lives only in memory.",
  },
  {
    id: "new",
    label: "The page creates a new token",
    feedback: "Correct prediction.",
  },
  {
    id: "empty",
    label: "There is no token until I log in",
    feedback: "The browser creates the token before you sign in.",
  },
];
const predictionOptions = predictions.map(({ id, label }) => ({ id, label }));
const tokenSource = { path: "public/app.js", startLine: 1, endLine: 2 };
const sessionSource = { path: "server.js", startLine: 19, endLine: 21 };
const fixFeedback = {
  addressesCause: false,
  explanation: "Saving the list doesn’t fix the token mismatch.",
};

function matchesPortfolio({ impasse, project, timeline }: LessonInput): boolean {
  const dir = project.projectDir.replaceAll("\\", "/").replace(/\/$/, "");
  if (!dir.endsWith("/examples/portfolio") && dir !== "/demo/portfolio") return false;
  if (!project.files.includes(tokenSource.path) || !project.files.includes(sessionSource.path)) return false;
  if (impasse.conceptIds.includes(DEMO_CONCEPTS.sessionToken)) return true;
  if (impasse.trigger === "ask_why") return /session|token|refresh|401/i.test(impasse.text ?? "");
  return timeline.some((entry) => impasse.sourceEntryIds.includes(entry.id) && (
    (entry.kind === "error" && entry.message.includes("GET /api/me 401")) ||
    (entry.kind === "file_edit" && [tokenSource.path, sessionSource.path].includes(entry.path))
  ));
}

/**
 * The Lesson an Ask why follows up: the App Shell links the question to that Lesson's end in `sourceEntryIds` when it
 * comes right after it. Live (W5), "Which one should I fix first?" started a new Probe and was never answered.
 */
function previousLesson({ impasse, timeline }: LessonInput): PreviousLesson | undefined {
  if (impasse.trigger !== "ask_why") return undefined;
  const end = timeline.find((entry) => entry.kind === "lesson_end" && impasse.sourceEntryIds.includes(entry.id));
  if (end?.kind !== "lesson_end") return undefined;
  const start = timeline.find((entry) => entry.kind === "lesson_start" && entry.lessonId === end.lessonId);
  const asked = start?.kind === "lesson_start"
    ? timeline.find((entry) => entry.kind === "impasse" && entry.impasse.id === start.impasseId) : undefined;
  const explanations = timeline.flatMap((entry) => {
    if (entry.kind !== "lesson_card" || entry.lessonId !== end.lessonId || entry.step !== "explain") return [];
    const props = entry.card.elements[entry.card.root]?.props as Record<string, unknown> | undefined;
    const nodes = Array.isArray(props?.nodes) ? props.nodes.map((node) => (node as { label?: unknown }).label) : [];
    return [[props?.title, props?.text, props?.summary, ...nodes].filter((part) => typeof part === "string").join(" ").slice(0, 1200)];
  });
  const question = asked?.kind === "impasse" ? asked.impasse.text ?? asked.impasse.title : "";
  return { question: question.slice(0, 1200), explanations: explanations.slice(-3) };
}

function makeCard(lessonId: string, step: LessonCard["step"], spec: LessonCard["card"]): LessonCard {
  return { kind: "lesson_card", source: "teaching", lessonId, step, card: spec };
}

function fixtureShortcut(portfolio: boolean, hint: boolean, sources: LessonSources, related?: Citation): CardSpec {
  const citation = hint ? tokenSource : sessionSource;
  if (portfolio && citesLessonSources([citation], sources)) {
    return card("TextExplanation", {
      title: hint ? "Check which token is sent" : "Trace the request",
      text: hint
        ? "Find where the browser creates the token. Does that line run again when you refresh?"
        : "The server uses the token in the request to look up the session. Compare it with the token from sign-in.",
      citations: [citation],
    });
  }
  return card("TextExplanation", {
    title: related ? "Check the cited code" : "Find a code reference",
    text: related
      ? `Start at the cited code in ${related.path} and check what value its caller sees.`
      : "Open the change you want to understand and select Why to give this Lesson a code reference.",
    citations: related ? [related] : [],
  });
}

function assess(lesson: RunningLesson, submitted: TimelineEntryOf<"card_answer">, result: Assessment["result"], concepts: string[]): Assessment {
  return {
    kind: "answer_assessment",
    source: "teaching",
    lessonId: lesson.id,
    answerEntryId: submitted.id,
    step: submitted.step,
    conceptIds: concepts,
    result,
  };
}

export const createTeaching: TeachingFactory = (options) => lessonTeaching(createLessonGenerator(options));
export const createFixtureTeaching: TeachingFactory = () => lessonTeaching();

function lessonTeaching(generator?: ReturnType<typeof createLessonGenerator>): Teaching {
  let nextLesson = 0;
  let active: RunningLesson | undefined;

  function complete(lesson: RunningLesson, entries: NewTimelineEntry[]): NewTimelineEntry[] {
    if (active !== lesson) return [];
    active = undefined;
    return [...entries, { kind: "lesson_end", source: "teaching", lessonId: lesson.id, outcome: "completed" }];
  }

  return {
    async offer({ impasse, learner }) {
      const format = lessonFormat(impasse, learner);
      if (format === "direct" && impasse.trigger === "detected") return null;
      if (format === "hint" || format === "review" || format === "probe_first") {
        return card("OfferCard", {
          impasseId: impasse.id,
          title: format === "hint" ? "Want a hint?" : format === "review" ? "Take a closer look?" : "Check your prediction?",
          body: impasse.title,
        });
      }
      const loginRequestFailed = impasse.title.includes("GET /api/me 401");
      return card("OfferCard", {
        impasseId: impasse.id,
        title: loginRequestFailed ? "Why does the page lose your login?" : "This has come up before. Look at why?",
        body: loginRequestFailed
          ? "This request failed more than once. See how the browser and server keep track of your session."
          : impasse.title,
      });
    },
    async startLesson(input) {
      if (active) throw new Error("A Lesson is already running.");
      const id = `lesson-${++nextLesson}`;
      const portfolio = !generator && matchesPortfolio(input);
      const format = lessonFormat(input.impasse, input.learner);
      if (format === "direct" && input.impasse.trigger === "detected"
        && !input.timeline.some((entry) => entry.kind === "offer_response" && entry.impasseId === input.impasse.id && entry.response === "accept")) return [];
      const lesson: RunningLesson = { id, portfolio, format, title: input.impasse.title, controller: new AbortController(), step: "probe" };
      active = lesson;
      const start = { kind: "lesson_start", source: "teaching", lessonId: id, impasseId: input.impasse.id } as const;
      let probe: ProbeCardProps = {
        lessonId: id,
        question: portfolio ? "You log in, then refresh. What happens to the session token?" : input.impasse.title,
        ...(portfolio ? { options: predictionOptions } : {}),
        citations: portfolio ? [tokenSource] : [],
      };
      try {
        const shortcut = format === "hint" || format === "direct" || format === "review";
        const sources = generator || shortcut ? await captureLessonSources(input, { allowEmpty: !generator }) : undefined;
        const followed = generator && sources ? previousLesson(input) : undefined;
        if (generator && sources && followed) {
          // A follow-up to the Lesson that just ended is answered directly, without a new Probe.
          const question = input.impasse.text ?? input.impasse.title;
          const explanation = await generator.explain(input, sources, { directQuestion: question, previousLesson: followed }, lesson.controller.signal);
          return complete(lesson, [start, makeCard(id, "explain", explanation.card)]);
        }
        if (shortcut && sources) {
          const anchor = relevantCitation(input, sources, true);
          if (format === "review" && anchor) {
            const question = `What would you check to verify the agent's change in ${anchor.path}? Explain what result you'd expect.`;
            lesson.step = "articulate";
            if (generator) lesson.generated = { input, sources, question, articulation: { question, citations: [anchor] } };
            return [start, makeCard(id, "articulate", card("ArticulationCard", { lessonId: id, prompt: question, mode: "restate", citations: [anchor] }))];
          }
          const related = anchor ?? relevantCitation(input, sources, false);
          if (!generator) return complete(lesson, [start, makeCard(id, "explain", fixtureShortcut(portfolio, format === "hint", sources, related))]);
          // A question the learner asked is always answered; mastery only makes the answer shorter. The hint that leaves
          // the conclusion to the learner is for a Why? on an agent change (live, "why a salt?" got a hint and no answer).
          const hint = format === "hint" && input.impasse.trigger !== "ask_why";
          const explanation = await generator.explain(input, sources, hint
            ? { hint: true }
            : { directQuestion: input.impasse.text ?? input.impasse.title }, lesson.controller.signal);
          if (format !== "hint") return complete(lesson, [start, makeCard(id, "explain", explanation.card)]);
          if (active !== lesson) return [];
          // A hint Lesson used to record nothing, so Lessons alone could never lift a Concept past correct_with_hints.
          const prompt = "In one sentence, what causes this behavior?";
          lesson.step = "articulate";
          lesson.generated = { input, sources, question: prompt, articulation: { question: prompt, citations: explanation.citations, explanation: explanation.card } };
          return [
            start,
            makeCard(id, "explain", explanation.card),
            makeCard(id, "articulate", card("ArticulationCard", { lessonId: id, prompt, mode: "restate", citations: explanation.citations })),
          ];
        }
        if (generator && sources) {
          probe = await generator.probe(input, sources, id, lesson.controller.signal);
          lesson.generated = { input, sources, question: probe.question };
        }
      } catch (error) {
        if (active === lesson) active = undefined;
        throw error;
      }
      if (active !== lesson) return [];
      return [start, makeCard(id, "probe", card("ProbeCard", probe))];
    },
    async answer({ lessonId, cardEntryId, timeline }) {
      const lesson = active;
      if (!lesson || lesson.id !== lessonId) return [];
      const current = timeline.findLast((entry) => entry.kind === "lesson_card" && entry.lessonId === lessonId && entry.step === lesson.step);
      if (current?.id !== cardEntryId) return [];
      const submitted = timeline.findLast((entry): entry is TimelineEntryOf<"card_answer"> =>
        entry.kind === "card_answer" && entry.lessonId === lessonId && entry.cardEntryId === cardEntryId && entry.step === lesson.step
      );
      if (!submitted) return [];

      if (lesson.step === "probe") {
        const { answer } = submitted;
        if (generator && lesson.generated) {
          if (answer.type !== "text" || !answer.text.trim()) throw new Error("This prediction requires a written answer.");
          const { input, sources, question } = lesson.generated;
          const prediction = answer.text.slice(0, 1500);
          const brief = lesson.format === "probe_first";
          const explanation = await generator.explain(input, sources, { probe: question, answer: prediction, ...(brief ? { brief } : {}) }, lesson.controller.signal);
          if (active !== lesson) return [];
          const explained = makeCard(lessonId, "explain", explanation.card);
          if (brief) return complete(lesson, [explained]);
          lesson.generated.answer = prediction;
          // Neutral wording: the prediction may have been wrong or "I don't know", so there is no predicted behavior to explain.
          const prompt = "In your own words, what causes this behavior?";
          lesson.generated.articulation = { question: prompt, citations: explanation.citations, explanation: explanation.card };
          lesson.step = "articulate";
          return [
            explained,
            makeCard(lessonId, "articulate", card("ArticulationCard", {
              lessonId, prompt, mode: "restate", citations: explanation.citations,
            })),
          ];
        }
        const prediction = answer.type === "choice" ? predictions.find(({ id }) => id === answer.optionId) : undefined;
        const assessment = lesson.portfolio && prediction
          ? [assess(lesson, submitted, prediction.id === "new" ? "correct" : "incorrect", [DEMO_CONCEPTS.pageReload, DEMO_CONCEPTS.sessionToken])]
          : [];
        if (lesson.format === "probe_first") {
          const text = lesson.portfolio
            ? "The server looks up a session using the token sent in the request. A different token does not identify the previous session."
            : "Compare your prediction with the current result. Trace the value that changes first.";
          return complete(lesson, [...assessment, makeCard(lessonId, "explain", card("TextExplanation", {
            title: lesson.portfolio ? "Check the session lookup" : "Check your prediction",
            text, citations: lesson.portfolio ? [sessionSource] : [],
          }))]);
        }
        const entries = [
          ...assessment,
          makeCard(lessonId, "explain", lesson.portfolio
            ? card("DataFlowDiagram", { ...portfolioSessionFlow, summary: prediction?.feedback })
            : card("TextExplanation", {
              title: "Trace the change",
              text: "Start with your prediction. Find the code that first creates the value you are asking about, then follow where that value goes. Compare that path with what you observed.",
              citations: [],
            })),
          makeCard(lessonId, "articulate", card("ArticulationCard", {
            lessonId,
            prompt: lesson.portfolio
              ? "Would saving the project list in the browser prevent logout?"
              : "In your own words, what connects the change to the result you observed?",
            mode: lesson.portfolio ? "judge_fix" : "restate",
            citations: [],
            ...(lesson.portfolio ? { feedback: fixFeedback } : {}),
          })),
        ];
        lesson.step = "articulate";
        return entries;
      }

      if (generator && lesson.generated?.articulation && submitted.answer.type === "text") {
        const { input, sources, articulation } = lesson.generated;
        const graded = await generator.assess(input, sources, {
          ...articulation, answer: submitted.answer.text, concepts: relevantConcepts(input.impasse, input.learner),
        }, lesson.controller.signal);
        if (active !== lesson) return [];
        const assessment = graded && graded.result !== "unclear" ? [assess(lesson, submitted, graded.result, graded.conceptIds)] : [];
        if (!graded?.feedback) return complete(lesson, assessment);
        // Live, a wrong or confused Articulation ended the Lesson with only "Completed". Correct it and stay for questions.
        lesson.step = "feedback";
        lesson.generated.feedback = { answer: submitted.answer.text.slice(0, 1500), feedback: graded.feedback.text };
        return [...assessment, makeCard(lessonId, "explain", card("TextExplanation", {
          title: graded.result === "incorrect" ? "Not quite" : "Let's make it clearer",
          text: graded.feedback.text,
          citations: graded.feedback.citations,
        }))];
      }
      const assessment = lesson.portfolio && lesson.format !== "review" && submitted.answer.type === "fix_judgement"
        ? [assess(lesson, submitted, submitted.answer.addressesCause === fixFeedback.addressesCause ? "correct" : "incorrect", [DEMO_CONCEPTS.sessionToken])]
        : [];
      return complete(lesson, assessment);
    },
    async followUp({ lessonId, question }) {
      const lesson = active;
      if (lesson?.id !== lessonId) return [];
      if (generator && lesson.generated) {
        const { input, sources, question: probe, answer, feedback } = lesson.generated;
        const predictionPending = lesson.step === "probe" ? { predictionPending: true as const } : {};
        const explanation = await generator.explain(input, sources, {
          probe, ...(answer ? { answer } : {}), ...predictionPending, ...(feedback ? { articulation: feedback } : {}), followUp: question.slice(0, 1500),
        }, lesson.controller.signal);
        return active === lesson ? [makeCard(lessonId, "explain", explanation.card)] : [];
      }
      const aboutToken = lesson.portfolio && /token|session|refresh|401/i.test(question);
      return [makeCard(lessonId, "explain", card("TextExplanation", {
        title: aboutToken ? "What the token identifies" : "Check your question against the change",
        text: aboutToken
          ? "The token is a lookup key. The browser sends it with each request, and the server uses it to find the session."
          : `For “${lesson.title}”, start by locating the code that produces the behavior. Try comparing one input before and after the change.`,
        citations: aboutToken ? [tokenSource, sessionSource] : [],
      }))];
    },
    async abandon(lessonId) {
      if (active?.id !== lessonId) return [];
      // After feedback every step is done, so Back to work completes the Lesson and its assessment becomes Evidence.
      const outcome = active.step === "feedback" ? "completed" : "abandoned";
      active.controller.abort();
      active = undefined;
      return [{ kind: "lesson_end", source: "teaching", lessonId, outcome }];
    },
  };
}
