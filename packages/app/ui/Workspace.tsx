import { useEffect, useState, type ReactNode } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { BookOpen, FolderCode, Monitor, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { MemoryPanel } from "./MemoryPanel.tsx";
import { useMediaQuery } from "./hooks/use-media-query.ts";
import { IconAction } from "@/components/icon-action";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

type SideView = "preview" | "explain" | "memory";

/** Wide enough for the side panel to sit beside the conversation; narrower screens stack them. */
const WIDE = "(min-width: 53rem)";

function layoutStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

interface WorkspaceProps {
  projectName: string;
  modeChange?: TimelineEntryOf<"mode_change">;
  defaultTab: "explain" | "preview";
  children: ReactNode;
  preview: ReactNode;
  explain: (visible: boolean) => ReactNode;
  /** The Lesson view exists only while a Lesson is open: running, being reviewed, or just finished on its explanation. */
  showExplain: boolean;
  /** A view within the Mode, such as a reviewed Lesson; changing it resets a manual view choice like a Mode change does. */
  viewKey?: string | undefined;
}

export function Workspace({ projectName, modeChange, defaultTab, children, preview, explain, showExplain, viewKey }: WorkspaceProps) {
  const [manualView, setManualView] = useState<{ view: SideView; revision: string }>();
  const [collapsed, setCollapsed] = useState(false);
  const wide = useMediaQuery(WIDE);
  const panel = usePanelRef();
  const storage = layoutStorage();
  const layout = useDefaultLayout({ id: "aha.workspace", panelIds: ["chat", "side"], ...(storage ? { storage } : {}) });
  const mode = modeChange?.mode ?? "work";
  // A manual choice lasts until the next Timeline transition, including after a reconnect.
  const revision = `${modeChange ? `${modeChange.id}:${modeChange.at}` : ""}|${viewKey ?? ""}`;
  const base: SideView = defaultTab === "explain" && showExplain ? "explain" : "preview";
  const chosen = manualView?.revision === revision ? manualView.view : base;
  const view = chosen === "explain" && !showExplain ? "preview" : chosen;
  const hidden = wide && collapsed;

  // A Lesson's cards live in the side panel, so opening a Lesson opens the panel.
  useEffect(() => {
    if (base === "explain") panel.current?.expand();
  }, [revision, base, panel]);

  /** A header button shows its view, or returns to the default view when that view is already showing. */
  function toggle(target: SideView) {
    if (wide && panel.current?.isCollapsed()) {
      panel.current?.expand();
      setManualView({ view: target, revision });
      return;
    }
    setManualView({ view: view === target ? base : target, revision });
  }

  const conversation = (
    <section aria-label="Conversation" className="workspace-chat">
      {children}
    </section>
  );
  const side = (
    <div className="workspace-detail">
      <section hidden={view !== "preview"} inert={view !== "preview"} aria-label="Live preview" className="workspace-preview">
        {preview}
      </section>
      <section hidden={view !== "explain"} inert={view !== "explain"} aria-label="Learning panel" className="workspace-learn workspace-explain">
        {explain(view === "explain" && !hidden)}
      </section>
      <section hidden={view !== "memory"} aria-label="Learner model" className="workspace-learn">
        <MemoryPanel visible={view === "memory" && !hidden} />
      </section>
    </div>
  );

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
          {showExplain && (
            <Button size="sm" variant="ghost" aria-pressed={view === "preview" && !hidden} onClick={() => toggle("preview")}>
              <Monitor data-icon="inline-start" />Preview
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-pressed={view === "memory" && !hidden} onClick={() => toggle("memory")}>
            <BookOpen data-icon="inline-start" />Memory
          </Button>
          {wide && (
            <IconAction
              label={collapsed ? "Show side panel" : "Hide side panel"}
              onClick={() => (collapsed ? panel.current?.expand() : panel.current?.collapse())}
            >
              {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
            </IconAction>
          )}
        </div>
      </header>

      <main className="workspace-main" data-mode={mode}>
        {wide ? (
          <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
            <ResizablePanel id="chat" minSize={320}>{conversation}</ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize side panel" />
            <ResizablePanel
              id="side"
              panelRef={panel}
              defaultSize="58%"
              minSize={320}
              collapsible
              collapsedSize={0}
              onResize={(size) => setCollapsed(size.inPixels === 0)}
            >
              {side}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <>
            {conversation}
            {side}
          </>
        )}
      </main>
    </div>
  );
}
