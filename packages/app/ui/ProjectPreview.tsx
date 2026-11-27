import { useEffect, useState } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { ExternalLinkIcon, GlobeIcon, MonitorIcon, ReloadIcon } from "@/components/icons";
import { IconAction } from "@/components/icon-action";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from "@/components/ui/code-block";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

const START_EXAMPLE = "cd examples/portfolio\nnpm install\nnpm start";

/** Time for `node --watch` to restart the project after a server edit before the frame reloads. */
const RELOAD_DELAY_MS = 1200;

/** An http(s) URL on another origin, so the app/preview boundary holds with allow-same-origin. */
function safePreviewUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return /^(http|https):$/.test(url.protocol) && url.origin !== window.location.origin &&
      !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Without a backend-run preview: VITE_AHA_PREVIEW_URL, or port 3000 on this host (the portfolio's `npm start`). */
function fallbackPreviewUrl(): URL | null {
  const fallback = new URL(window.location.origin);
  fallback.port = "3000";
  return safePreviewUrl(import.meta.env.VITE_AHA_PREVIEW_URL || fallback.href);
}

/** The project server the backend runs (GET /api/preview, #22), else the fallback. */
function usePreviewUrl(): { url: URL | null; managed: boolean } | undefined {
  const [preview, setPreview] = useState<{ url: URL | null; managed: boolean }>();
  useEffect(() => {
    let cancelled = false;
    type Answer = { url?: string | null };
    fetch("/api/preview")
      .then((res): Promise<Answer> | Answer => (res.ok ? res.json() : {}))
      .catch((): Answer => ({}))
      .then(({ url }) => {
        if (cancelled) return;
        const managed = url ? safePreviewUrl(url) : null;
        setPreview(managed ? { url: managed, managed: true } : { url: fallbackPreviewUrl(), managed: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return preview;
}

export function ProjectPreview({ lastEdit }: { lastEdit?: TimelineEntryOf<"file_edit"> }) {
  const preview = usePreviewUrl();
  const url = preview?.url ?? null;
  const [refresh, setRefresh] = useState(0);
  // Reload a moment after each edit, so a server edit has restarted the project first.
  const editKey = `${lastEdit?.id ?? ""}:${lastEdit?.at ?? ""}`;
  const [reloadedEdit, setReloadedEdit] = useState(editKey);
  useEffect(() => {
    const timer = window.setTimeout(() => setReloadedEdit(editKey), RELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [editKey]);
  const revision = `${reloadedEdit}:${refresh}`;
  const [check, setCheck] = useState<{ revision: string; reachable: boolean } | null>(null);
  const checking = preview === undefined || (url !== null && check?.revision !== revision);
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
        <h2 className="sr-only">Live preview</h2>
        <GlobeIcon aria-hidden="true" />
        <span className="workspace-preview-url" title={url?.href}>{url ? `${url.host}${url.pathname}` : "No preview address"}</span>
        <div className="workspace-preview-actions">
          <IconAction label="Refresh preview" disabled={!url} onClick={() => setRefresh((count) => count + 1)}>
            <ReloadIcon />
          </IconAction>
          {url && <IconAction label="Open preview in new tab" nativeButton={false} render={<a href={url.href} target="_blank" rel="noopener noreferrer" />}>
            <ExternalLinkIcon />
          </IconAction>}
        </div>
      </header>
      <div className="workspace-preview-canvas">
        <div className="workspace-browser">
          {url && reachable ? (
            <iframe
              key={revision}
              title="Project preview"
              src={url.href}
              sandbox="allow-scripts allow-forms allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Empty className="workspace-preview-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon">{checking ? <Spinner aria-hidden="true" /> : <MonitorIcon aria-hidden="true" />}</EmptyMedia>
                <EmptyTitle role="heading" aria-level={3}>{checking ? "Connecting to preview…" : "Preview unavailable"}</EmptyTitle>
                {!checking && (
                  <EmptyDescription>
                    {!url ? "Set VITE_AHA_PREVIEW_URL to an HTTP or HTTPS address on a different origin." :
                      preview?.managed ? "Aha is starting your project. Refresh the preview in a moment." :
                      import.meta.env.VITE_AHA_PREVIEW_URL ? "Start the project server, then refresh the preview." :
                      "Start the portfolio example, then refresh the preview."}
                  </EmptyDescription>
                )}
              </EmptyHeader>
              {!checking && url && !preview?.managed && !import.meta.env.VITE_AHA_PREVIEW_URL && (
                <EmptyContent>
                  <CodeBlock size="sm" className="text-start">
                    <CodeBlockActions><CodeBlockCopyButton value={START_EXAMPLE} /></CodeBlockActions>
                    <CodeBlockContent>{START_EXAMPLE}</CodeBlockContent>
                  </CodeBlock>
                </EmptyContent>
              )}
            </Empty>
          )}
        </div>
        <p className="workspace-preview-footer" role="status">
          {lastEdit ? <><span>Last edit</span><code title={lastEdit.path}>{lastEdit.path}</code></> : "Refreshes when the agent edits a file"}
        </p>
      </div>
    </>
  );
}
