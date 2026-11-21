import { useEffect, useState } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { ExternalLink, Globe2, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function previewUrl(): URL | null {
  const fallback = new URL(window.location.origin);
  fallback.port = "3000";
  try {
    const url = new URL(import.meta.env.VITE_AHA_PREVIEW_URL || fallback.href);
    // The preview needs its own origin to preserve the app/preview boundary with allow-same-origin.
    return /^(http|https):$/.test(url.protocol) && url.origin !== window.location.origin &&
      !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function ProjectPreview({ lastEdit }: { lastEdit?: TimelineEntryOf<"file_edit"> }) {
  const [url] = useState(previewUrl);
  const [refresh, setRefresh] = useState(0);
  const revision = `${lastEdit?.id ?? ""}:${lastEdit?.at ?? ""}:${refresh}`;
  const [check, setCheck] = useState<{ revision: string; reachable: boolean } | null>(null);
  const checking = url !== null && check?.revision !== revision;
  const reachable = !checking && check?.reachable;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setCheck({ revision, reachable: false });
      controller.abort();
    }, 4000);
    // Most project servers do not send CORS headers. This only checks that the URL responds.
    void fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal })
      .then(() => {
        if (!controller.signal.aborted) setCheck({ revision, reachable: true });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCheck({ revision, reachable: false });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [revision, url]);

  return (
    <>
      <header className="workspace-pane-heading">
        <Monitor aria-hidden="true" /><h2>Live preview</h2>
        <div className="workspace-preview-actions">
          <Button size="icon-sm" variant="ghost" aria-label="Refresh preview" title="Refresh preview" disabled={!url}
            onClick={() => setRefresh((count) => count + 1)}>
            <RefreshCw />
          </Button>
          {url && <Button size="icon-sm" variant="ghost" aria-label="Open preview in new tab" title="Open in new tab"
            nativeButton={false} render={<a href={url.href} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLink />
          </Button>}
        </div>
      </header>
      <div className="workspace-preview-canvas">
        <div className="workspace-browser">
          <div className="workspace-address">
            <Globe2 aria-hidden="true" />
            <span title={url?.href}>{url ? `${url.host}${url.pathname}` : "Preview URL"}</span>
          </div>
          {url && reachable ? (
            <iframe
              key={revision}
              title="Project preview"
              src={url.href}
              sandbox="allow-scripts allow-forms allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="workspace-empty workspace-preview-empty">
              <span className="workspace-empty-icon"><Monitor aria-hidden="true" /></span>
              <h3>{checking ? "Connecting to preview…" : "Preview unavailable"}</h3>
              {!checking && (url ? (
                import.meta.env.VITE_AHA_PREVIEW_URL ? (
                  <p>Start the project server, then refresh the preview.</p>
                ) : (
                  <>
                    <p>Start the portfolio example, then refresh the preview.</p>
                    <code>cd examples/portfolio<br />npm install<br />npm start</code>
                  </>
                )
              ) : <p>Set VITE_AHA_PREVIEW_URL to an HTTP or HTTPS address on a different origin.</p>)}
            </div>
          )}
        </div>
        <p className="workspace-preview-footer" role="status">
          {lastEdit ? <><span>Last edit</span><code title={lastEdit.path}>{lastEdit.path}</code></> : "Refreshes when the agent edits a file"}
        </p>
      </div>
    </>
  );
}
