import { useState, type ReactNode } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { BookOpen, Columns2, Columns3, FolderCode, MessageSquare, Monitor, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Layout = "three-pane" | "tabbed";
type WorkspaceTab = "preview" | "explain" | "memory";

const LAYOUT_KEY = "aha.workspace.layout";

function savedLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "tabbed" ? "tabbed" : "three-pane";
  } catch {
    return "three-pane";
  }
}

interface WorkspaceProps {
  projectName: string;
  connected: boolean;
  modeChange?: TimelineEntryOf<"mode_change">;
  children: ReactNode;
  preview: ReactNode;
  explain: (visible: boolean) => ReactNode;
}

export function Workspace({ projectName, connected, modeChange, children, preview, explain }: WorkspaceProps) {
  const [layout, setLayout] = useState(savedLayout);
  const [manualTab, setManualTab] = useState<{ tab: WorkspaceTab; revision: string }>();
  const mode = modeChange?.mode ?? "work";
  // A manual choice lasts until the next Timeline transition, including after a reconnect.
  const revision = modeChange ? `${modeChange.id}:${modeChange.at}` : "";
  const tab = manualTab?.revision === revision ? manualTab.tab : mode === "learning" ? "explain" : "preview";
  const tabbed = layout === "tabbed";

  function changeLayout(next: Layout) {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // The layout remains usable when browser storage is unavailable.
    }
  }

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
        <div className="workspace-header-tools">
          <span className="workspace-connection" role="status" data-connected={connected}>
            <span aria-hidden="true" />
            {connected ? "Connected" : "Connecting"}
          </span>
          <div className="workspace-layout-picker" role="group" aria-label="Workspace layout">
            <Button
              size="sm"
              variant="ghost"
              aria-label="Three-pane layout"
              aria-pressed={!tabbed}
              onClick={() => changeLayout("three-pane")}
            >
              <Columns3 data-icon="inline-start" /><span>Three panes</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Tabbed layout"
              aria-pressed={tabbed}
              onClick={() => changeLayout("tabbed")}
            >
              <Columns2 data-icon="inline-start" /><span>Tabbed</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="workspace-main" data-mode={mode}>
        <section aria-labelledby="conversation-heading" className="workspace-chat">
          <header className="workspace-pane-heading">
            <MessageSquare aria-hidden="true" />
            <h2 id="conversation-heading">Conversation</h2>
          </header>
          {children}
        </section>

        <Tabs value={tab} onValueChange={(next) => setManualTab({ tab: next, revision })} className="workspace-detail" data-layout={layout}>
          <div className="workspace-tabbar" hidden={!tabbed}>
            <TabsList aria-label="Workspace views">
              <TabsTrigger value="preview"><Monitor />Preview</TabsTrigger>
              <TabsTrigger value="explain"><Sparkles />Explain</TabsTrigger>
              <TabsTrigger value="memory"><BookOpen />Memory</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="preview"
            keepMounted
            hidden={tabbed && tab !== "preview"}
            inert={tabbed && tab !== "preview"}
            role={tabbed ? "tabpanel" : "region"}
            aria-label="Live preview"
            className="workspace-preview"
          >
            {preview}
          </TabsContent>
          <TabsContent
            value="explain"
            keepMounted
            hidden={tabbed && tab !== "explain"}
            inert={tabbed && tab !== "explain"}
            role={tabbed ? "tabpanel" : "region"}
            aria-label="Learning panel"
            className="workspace-learn"
          >
            {explain(!tabbed || tab === "explain")}
          </TabsContent>
          <TabsContent value="memory" className="workspace-learn" hidden={!tabbed || tab !== "memory"}>
            <header className="workspace-pane-heading"><BookOpen aria-hidden="true" /><h2>Memory</h2></header>
            <div className="workspace-empty">
              <span className="workspace-empty-icon"><BookOpen aria-hidden="true" /></span>
              <h3>Learner model unavailable</h3>
              <p>The Memory view will show your project’s learner model when it is connected.</p>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
