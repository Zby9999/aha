import { useState, type ReactNode } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { BookOpen, FolderCode, Monitor, Sparkles } from "lucide-react";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WorkspaceTab = "preview" | "explain" | "memory";

interface WorkspaceProps {
  projectName: string;
  modeChange?: TimelineEntryOf<"mode_change">;
  defaultTab: "explain" | "preview";
  children: ReactNode;
  preview: ReactNode;
  explain: (visible: boolean) => ReactNode;
  /** The Explain tab exists only while a Lesson is open: running, being reviewed, or just finished on its explanation. */
  showExplain: boolean;
  /** A view within the Mode, such as a reviewed Lesson; changing it resets a manual tab choice like a Mode change does. */
  viewKey?: string | undefined;
}

export function Workspace({ projectName, modeChange, defaultTab, children, preview, explain, showExplain, viewKey }: WorkspaceProps) {
  const [manualTab, setManualTab] = useState<{ tab: WorkspaceTab; revision: string }>();
  const mode = modeChange?.mode ?? "work";
  // A manual choice lasts until the next Timeline transition, including after a reconnect.
  const revision = `${modeChange ? `${modeChange.id}:${modeChange.at}` : ""}|${viewKey ?? ""}`;
  const chosen = manualTab?.revision === revision ? manualTab.tab : defaultTab;
  const tab = chosen === "explain" && !showExplain ? "preview" : chosen;

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <div className="workspace-identity">
          <div className="workspace-brand">
            <span className="workspace-brand-mark"><Sparkles aria-hidden="true" /></span>
            <h1>Aha</h1>
          </div>
          <div className="workspace-project">
            <FolderCode aria-hidden="true" />
            <span title={projectName}>{projectName}</span>
          </div>
        </div>
      </header>

      <main className="workspace-main" data-mode={mode}>
        <section aria-label="Conversation" className="workspace-chat">
          {children}
        </section>

        <Tabs value={tab} onValueChange={(next) => setManualTab({ tab: next, revision })} className="workspace-detail">
          <div className="workspace-tabbar">
            <TabsList aria-label="Workspace views">
              <TabsTrigger value="preview"><Monitor />Preview</TabsTrigger>
              {showExplain && <TabsTrigger value="explain"><Sparkles />Explain</TabsTrigger>}
              <TabsTrigger value="memory"><BookOpen />Memory</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="preview"
            keepMounted
            hidden={tab !== "preview"}
            inert={tab !== "preview"}
            aria-label="Live preview"
            className="workspace-preview"
          >
            {preview}
          </TabsContent>
          <TabsContent
            value="explain"
            keepMounted
            hidden={tab !== "explain"}
            inert={tab !== "explain"}
            aria-label="Learning panel"
            className="workspace-learn workspace-explain"
          >
            {explain(tab === "explain")}
          </TabsContent>
          <TabsContent value="memory" className="workspace-learn" hidden={tab !== "memory"}>
            <MemoryPanel visible={tab === "memory"} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
