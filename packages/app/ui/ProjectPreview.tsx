import { useEffect, useState } from "react";
import type { TimelineEntryOf } from "@aha/contracts";
import { ExternalLinkIcon, GlobeIcon, MonitorIcon, ReloadIcon } from "@/components/icons";
import { IconAction } from "@/components/icon-action";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton } from "@/components/ui/code-block";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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

/** What the address bar shows for a URL: no scheme, like a browser's bar. */
function displayAddress(url: URL): string {
  return `${url.host}${url.pathname}${url.search}${url.hash}`;
}

/** An address typed into the bar: a path opens on the current preview host, a bare host gets http://. */
function typedPreviewUrl(input: string, base: URL | null): URL | null {
  const text = input.trim();
  if (!text) return null;
  if (text.startsWith("/")) return base ? safePreviewUrl(new URL(text, base).href) : null;
  return safePreviewUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
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
  // An address the user typed replaces the project's own until the page reloads.
  const [typed, setTyped] = useState<URL | null>(null);
  const url = typed ?? preview?.url ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const editAddress = (value: string) => {
    setDraft(value);
    setInvalid(false);
  };
  const resetAddress = () => {
    setDraft(null);
    setInvalid(false);
  };
  const goTo = (input: string) => {
    const next = typedPreviewUrl(input, url);
    if (!next) {
      setInvalid(true);
      return false;
    }
    setTyped(next);
    resetAddress();
    setRefresh((count) => count + 1);
    return true;
  };
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
        <form
          className="workspace-preview-address"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem("address") as HTMLInputElement;
            if (goTo(input.value)) input.blur();
          }}
        >
          <InputGroup className="h-8 border-transparent bg-transparent shadow-none hover:bg-muted has-[input:focus-visible]:bg-background">
            <InputGroupAddon><GlobeIcon /></InputGroupAddon>
            <InputGroupInput
              name="address"
              aria-label="Preview address"
              aria-invalid={invalid || undefined}
              title={invalid ? "Enter an http or https address, or a path such as /about" : url?.href}
              placeholder="Enter an address or a path"
              spellCheck={false}
              autoComplete="off"
              value={draft ?? (url ? displayAddress(url) : "")}
              onChange={(event) => editAddress(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={resetAddress}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                resetAddress();
                event.currentTarget.blur();
              }}
            />
          </InputGroup>
        </form>
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
