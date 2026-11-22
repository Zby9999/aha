type Choice = { type: "choice"; instructions: string; criteria: Record<string, string> };
type Noul = { type: "noul"; instructions: string };
export type Question = Choice | Noul;

export interface JevOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type Answers = Record<string, unknown>;

function record(value: unknown): value is Answers {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createJevClient({
  apiKey = process.env.JEV_API_KEY,
  endpoint = process.env.JEV_ENDPOINT ?? "https://api.getjevai.com/v1/decisions",
  timeoutMs = 1500,
  fetch: request = globalThis.fetch,
}: JevOptions = {}) {
  return async (state: object, questions: Record<string, Question>): Promise<Answers | null> => {
    if (!apiKey?.trim()) return null;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
          controller.abort();
        }, timeoutMs);
      });
      const call = async () => {
        const response = await request(endpoint, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ state, questions }),
          signal: controller.signal,
        });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        return record(body) && record(body.answers) ? body.answers : null;
      };
      return await Promise.race([call(), timeout]);
    } catch {
      return null;
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
