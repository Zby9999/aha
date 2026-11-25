import { cardComponentDefinitions, type CardSpec } from "@aha/contracts";
import { defineCatalog, validateSpec } from "@json-render/core";
import { schema } from "@json-render/react/schema";

export const cardCatalog = defineCatalog(schema, { components: cardComponentDefinitions, actions: {} });

export function parseLessonCard(card: CardSpec): CardSpec | undefined {
  if (!cardCatalog.validate(card).success || !validateSpec(card).valid) return undefined;
  // json-render validates the spec and component names, but its shared props record is untyped across components.
  const elements: CardSpec["elements"] = Object.create(null);
  for (const [id, element] of Object.entries(card.elements)) {
    const { type, props, children, slots } = element;
    // Lesson components render as leaves and cannot contain other cards.
    if (children?.length || Object.values(slots ?? {}).some((slot) => slot.length)) return undefined;
    const definition = cardComponentDefinitions[type as keyof typeof cardComponentDefinitions];
    const parsed = definition.props.safeParse(props);
    if (!parsed.success) return undefined;
    // Pass schema-normalized props to the renderer, including canonical diagram IDs.
    elements[id] = { ...element, props: parsed.data };
  }
  return { ...card, elements };
}
