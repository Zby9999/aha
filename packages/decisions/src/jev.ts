type Choice = { type: "choice"; instructions: string; criteria: Record<string, string> };
type Noul = { type: "noul"; instructions: string };
export type Question = Choice | Noul;

export interface JevOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Receives a sanitized reason on every failed call, including repeated failures during evaluation. */
  onFailure?: (reason: string) => void;
}

type Answers = Record<string, unknown>;

function record(value: unknown): value is Answers {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export function jevConfig(env: Readonly<Record<string, string | undefined>>): JevOptions {
  const endpoint = env.JEV_ENDPOINT ?? TYPESAFE_ENDPOINT;
  return { endpoint, apiKey: endpoint === TYPESAFE_ENDPOINT ? env.TYPESAFE_API_KEY ?? env.JEV_API_KEY : env.JEV_API_KEY };
}

export function createJevClient({
  endpoint = TYPESAFE_ENDPOINT,
  apiKey,
  onFailure,
  timeoutMs = 1500,
  fetch: request = globalThis.fetch,
}: JevOptions = {}) {
  const reported = new Set<string>();
  function fail(reason: string) {
    if (!reported.has(reason)) {
      console.warn(`[decisions] Jev unavailable: ${reason}`);
      reported.add(reason);
    }
    onFailure?.(reason);
    return null;
  }
  return async (state: object, questions: Record<string, Question>): Promise<Answers | null> => {
    if (!apiKey?.trim()) return fail("missing API key");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(fail("request timed out"));
          controller.abort();
        }, timeoutMs);
      });
      const call = async () => {
        const response = await request(endpoint, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
          body: JSON.stringify(endpoint === TYPESAFE_ENDPOINT ? { model: "jev-latest", state, questions } : { state, questions }),
          signal: controller.signal,
        });
        if (!response.ok) return fail(`HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!record(body) || !record(body.answers)) return fail("invalid response");
        const answers = body.answers;
        for (const [name, question] of Object.entries(questions)) {
          if (question.type === "choice" ? choice(answers, name, question.criteria) === null : probability(answers, name) === null) {
            return fail("invalid answer");
          }
        }
        return answers;
      };
      return await Promise.race([call(), timeout]);
    } catch {
      return controller.signal.aborted ? null : fail("request failed");
    } finally {
      clearTimeout(timer);
    }
  };
}

export function choice(answers: Answers | null, key: string, criteria: Record<string, string>) {
  const answer = answers?.[key];
  return record(answer) && answer.type === "choice" && typeof answer.choice === "string"
    && Object.hasOwn(criteria, answer.choice) ? answer.choice : null;
}

export function probability(answers: Answers | null, key: string) {
  const answer = answers?.[key];
  return record(answer) && answer.type === "noul" && typeof answer.noul === "number"
    && answer.noul >= 0 && answer.noul <= 1 ? answer.noul : null;
}
