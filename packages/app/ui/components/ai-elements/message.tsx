// Vendored from AI Elements 1.9.1 (Apache-2.0, © Vercel); trimmed, see README.md.
import { memo, type ComponentProps, type HTMLAttributes } from "react";
import { Streamdown } from "streamdown";
import { cn } from "../../lib/utils.ts";

export type MessageProps = HTMLAttributes<HTMLDivElement> & { from: "user" | "assistant" };

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn("group flex w-full max-w-[95%] flex-col gap-2", from === "user" ? "is-user ml-auto justify-end" : "is-assistant", className)}
    {...props}
  />
);

export const MessageContent = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

/** Markdown that renders cleanly while it is still streaming (unclosed code blocks, lists, emphasis). */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} {...props} />
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);
MessageResponse.displayName = "MessageResponse";
