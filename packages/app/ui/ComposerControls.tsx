import type { AgentCommand, AgentModel, AgentSettings } from "@aha/contracts";
import { ChevronDownIcon } from "@/components/icons";
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { cn } from "cn";

const modelKey = (model: Pick<AgentModel, "provider" | "id">) => `${model.provider}/${model.id}`;

/** Model Selector (AI Elements): a menu in the composer's bottom bar that switches the agent's model, grouped by provider. */
export function ModelPicker({ settings, disabled, onSelect }: {
  settings: AgentSettings | null;
  disabled: boolean;
  onSelect: (model: AgentModel) => void;
}) {
  const models = settings?.models ?? [];
  const current = settings?.currentModel ?? null;
  const providers = [...new Set(models.map((model) => model.provider))];
  const label = current?.name ?? (settings ? "No model" : "Model");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || models.length === 0}
        render={
          <InputGroupButton
            size="sm"
            variant="ghost"
            aria-label={`Model: ${label}`}
            className="ml-auto max-w-48 rounded-full text-muted-foreground"
          />
        }
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuRadioGroup
          value={current ? modelKey(current) : ""}
          onValueChange={(value) => {
            const model = models.find((m) => modelKey(m) === value);
            if (model && value !== (current && modelKey(current))) onSelect(model);
          }}
        >
          {providers.map((provider, index) => (
            <Fragment key={provider}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{provider}</DropdownMenuLabel>
                {models.filter((m) => m.provider === provider).map((model) => (
                  <DropdownMenuRadioItem key={modelKey(model)} value={modelKey(model)} closeOnClick>
                    <span className="truncate">{model.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SOURCE_LABEL: Record<AgentCommand["source"], string> = { extension: "Extension", prompt: "Prompt", skill: "Skill" };

export const SLASH_MENU_ID = "composer-slash-commands";
export const slashOptionId = (index: number) => `${SLASH_MENU_ID}-${index}`;

/**
 * The agent's commands for a message starting with `/`. Focus stays in the textarea, which drives the list with
 * aria-activedescendant; the composer handles the arrow keys, Enter/Tab and Escape.
 */
export function SlashCommandMenu({ commands, active, onPick, onHover }: {
  commands: readonly AgentCommand[];
  active: number;
  onPick: (command: AgentCommand) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div
      id={SLASH_MENU_ID}
      role="listbox"
      aria-label="Commands"
      className="absolute inset-x-0 bottom-full z-50 mb-2 max-h-64 overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10"
    >
      {commands.map((command, index) => (
        <div
          key={command.name}
          id={slashOptionId(index)}
          role="option"
          aria-selected={index === active}
          // Keep focus in the textarea.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => onHover(index)}
          onClick={() => onPick(command)}
          className={cn(
            "flex min-h-7 cursor-default items-baseline gap-2 rounded-xl px-2 py-1.5 text-sm select-none",
            index === active && "bg-accent text-accent-foreground",
          )}
        >
          <span className="shrink-0 font-mono">/{command.name}</span>
          {command.description && <span className="min-w-0 flex-1 truncate text-muted-foreground">{command.description}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{SOURCE_LABEL[command.source]}</span>
        </div>
      ))}
    </div>
  );
}
