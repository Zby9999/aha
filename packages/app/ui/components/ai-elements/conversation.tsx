// Vendored from AI Elements 1.9.1 (Apache-2.0, © Vercel); trimmed, see README.md.
import type { ComponentProps } from "react";
import { ArrowDownIcon } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "../../lib/utils.ts";
import { Button } from "../ui/button.tsx";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom className={cn("relative flex-1 overflow-y-hidden", className)} initial="smooth" resize="smooth" role="log" {...props} />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col gap-8 p-4", className)} {...props} />
);

export const ConversationScrollButton = ({ className, ...props }: ComponentProps<typeof Button>) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    !isAtBottom && (
      <Button
        className={cn("absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted", className)}
        onClick={() => scrollToBottom()}
        size="icon"
        type="button"
        variant="outline"
        aria-label="Scroll to latest"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
