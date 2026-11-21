import type { CardSpec, UserAction } from "@aha/contracts";
import { JSONUIProvider, Renderer, type ComponentRenderer } from "@json-render/react";
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { CardContext } from "./context.ts";
import { cardCatalog, registry } from "./registry.tsx";

/** Shown for components not in the catalog yet (the diagrams land in #45). */
const Unsupported: ComponentRenderer = ({ element }) => (
  <Card>
    <CardHeader>
      <CardTitle>{String((element.props as { title?: unknown }).title ?? element.type)}</CardTitle>
      <CardDescription>The {element.type} component is not in the catalog yet.</CardDescription>
    </CardHeader>
  </Card>
);

export function LessonCardView({ card, entryId, done, dispatch }: { card: CardSpec; entryId: string; done: boolean; dispatch: (action: UserAction) => void }) {
  const known = cardCatalog.validate(card).success;
  return (
    <CardContext.Provider value={{ dispatch, entryId, done }}>
      <JSONUIProvider registry={registry}>
        <Renderer spec={card} registry={known ? registry : {}} fallback={Unsupported} />
      </JSONUIProvider>
    </CardContext.Provider>
  );
}
