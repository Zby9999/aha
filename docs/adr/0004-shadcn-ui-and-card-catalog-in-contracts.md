# shadcn/ui for every screen, with the lesson-card catalog in contracts and its rendering in the app

The app shell (Zeng) and the lesson cards (Junchi) appear on the same screen, so they need one visual language. We use shadcn/ui on Tailwind CSS 4: its components are copied into the repo (`packages/app/ui/components/ui`), so anyone can change them, and every colour, radius and font comes from the CSS variables in `packages/app/ui/globals.css`. json-render publishes `@json-render/shadcn` for the same stack, so generated lesson cards look like the rest of the app.

Because module packages may depend only on `@aha/contracts` (ADR-0002), the lesson-card catalog is split. Its structure (each component's Zod props and description) lives in `packages/contracts/src/catalog.ts`; teaching uses it to generate and validate specs. Its rendering (a json-render registry built from shadcn components) lives in `packages/app/ui/cards`. A new card component therefore needs a contracts change (its props) and an app change (its view). Teaching owns the props and content, and the app owns how the card looks.

The chat itself uses AI Elements (Vercel's shadcn/ui registry for agent interfaces): `Conversation` keeps the view pinned to the latest entry, `MessageResponse` renders agent replies as Markdown while they stream in (from `agent_message_delta` entries), and `Tool` shows each tool call with its parameters and result. They are vendored and trimmed in `packages/app/ui/components/ai-elements` and take props mapped from Timeline entries, not the AI SDK's message types, because our data source is the Timeline, not `useChat`.

## Considered Options

- A shared `packages/ui` used by both app and teaching: clearer ownership of card views, but it breaks the "depend only on contracts" rule and adds a sixth package to keep in step.
- Mantine or Ant Design: complete out of the box, but they bring their own look and no json-render integration, so cards and shell would drift apart.
