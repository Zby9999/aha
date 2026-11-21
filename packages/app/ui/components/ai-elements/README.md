# AI Elements (vendored, trimmed)

From [AI Elements](https://github.com/vercel/ai-elements) 1.9.1 (Apache-2.0, © Vercel), the shadcn/ui registry for agent interfaces (ADR-0004). Copied from `https://elements.ai-sdk.dev/api/registry/<name>.json` and trimmed:

- Their props are typed from our Timeline instead of the AI SDK's `UIMessage` / `ToolUIPart`, so the `ai` package is not needed.
- `conversation.tsx`: `Conversation`, `ConversationContent`, `ConversationScrollButton` (download helpers removed).
- `message.tsx`: `Message`, `MessageContent`, `MessageResponse` (Streamdown without the CJK/math/mermaid/code plugins; branches and actions removed).
- `tool.tsx`: `Tool`, `ToolHeader`, `ToolContent`, `ToolInput`, `ToolOutput` (states reduced to running / completed / error; a plain `<pre>` replaces `CodeBlock`).

To pull a newer version, fetch the same registry JSON and reapply these trims.
