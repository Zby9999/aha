import type { CardAnswer, CardSpec, UserAction } from "@aha/contracts";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { Card, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { parseLessonCard } from "./catalog.ts";
import { CardContext, type CardContextValue } from "./context.ts";
import { registry } from "./registry.tsx";

export function LessonCardView({ card, entryId, done, endedEarly = false, submitted, dispatch, flag }: {
  card: CardSpec;
  entryId: string;
  done: boolean;
  endedEarly?: boolean;
  submitted?: CardAnswer;
  dispatch: (action: UserAction) => void;
  flag?: CardContextValue["flag"];
}) {
  const parsedCard = parseLessonCard(card);
  if (!parsedCard) {
    return (
      <Card className="lesson-reading-card">
        <CardHeader><CardTitle>This lesson card couldn't be displayed.</CardTitle></CardHeader>
      </Card>
    );
  }
  return (
    <CardContext.Provider value={{ dispatch, entryId, done, endedEarly, ...(submitted ? { submitted } : {}), ...(flag ? { flag } : {}) }}>
      <JSONUIProvider registry={registry}>
        <Renderer spec={parsedCard} registry={registry} />
      </JSONUIProvider>
    </CardContext.Provider>
  );
}
