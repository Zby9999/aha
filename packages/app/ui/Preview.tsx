import { useEffect, useState } from "react";
import type { TimelineEntry } from "@aha/contracts";
import { RotateCw } from "lucide-react";
import { Button } from "./components/ui/button.tsx";

/** Time for `node --watch` to restart the project after a server edit before the frame reloads. */
const RELOAD_DELAY_MS = 1200;

/**
 * Tech-validation live preview (#22), to be replaced by the App Shell's own preview: the running project in an
 * iframe, reloaded shortly after each `file_edit` entry. Hidden when the backend runs no preview.
 */
export function Preview({ entries }: { entries: readonly TimelineEntry[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const edits = entries.filter((e) => e.kind === "file_edit").length;

  useEffect(() => {
    fetch("/api/preview")
      .then((res) => res.json() as Promise<{ url: string | null }>)
      .then(({ url }) => setUrl(url))
      .catch(() => setUrl(null));
  }, []);

  useEffect(() => {
    if (edits === 0) return;
    const timer = setTimeout(() => setReloads((n) => n + 1), RELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [edits]);

  if (!url) return null;
  return (
    <aside className="hidden min-w-0 flex-1 flex-col border-l lg:flex" aria-label="Live preview">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Preview</span>
        <span className="truncate font-mono text-xs">{url}</span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Reload preview" onClick={() => setReloads((n) => n + 1)}>
          <RotateCw />
        </Button>
      </div>
      {/* A new key remounts the frame, which reloads it even though it is cross-origin. */}
      <iframe key={reloads} src={url} title="Live preview of your project" className="min-h-0 flex-1 bg-white" />
    </aside>
  );
}
