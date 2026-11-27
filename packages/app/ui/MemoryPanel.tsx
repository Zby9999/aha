import { useEffect, useState } from "react";
import type { Concept, LearnerModelFile } from "@aha/contracts";
import { BookIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Model = { concepts: Concept[]; files: LearnerModelFile[] };

export function MemoryPanel({ visible }: { visible: boolean }) {
  const [model, setModel] = useState<Model>();
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetch("/api/learner-model").then(async (response) => {
      if (!response.ok) throw new Error("Could not load the learner model");
      return response.json() as Promise<Model>;
    }).then((next) => {
      if (cancelled) return;
      setModel(next);
      setSelected((current) => current ?? next.files.find((file) => file.path === "index.md")?.path);
    }).catch((error) => { if (!cancelled) setMessage((error as Error).message); });
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    setDraft(model?.files.find((file) => file.path === selected)?.markdown ?? "");
  }, [model, selected]);

  const dirty = draft !== (model?.files.find((file) => file.path === selected)?.markdown ?? "");

  async function save() {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/learner-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selected, markdown: draft }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save the file");
      const refreshed = await fetch("/api/learner-model");
      if (!refreshed.ok) throw new Error("Saved, but could not refresh the learner model");
      setModel(await refreshed.json() as Model);
      setMessage("Saved");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const files = model?.files.filter((file) => file.path === "index.md" || file.path.startsWith("concepts/")) ?? [];
  return (
    <>
      <header className="workspace-pane-heading">
        <BookIcon aria-hidden="true" />
        <h2>Learner model</h2>
        {message && <span role="status" className="ml-auto text-xs text-muted-foreground">{message}</span>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="memory-file">File</Label>
          <Select value={selected ?? null} onValueChange={(value) => value && setSelected(value)}>
            <SelectTrigger id="memory-file" className="w-full font-mono text-xs">
              <SelectValue placeholder="Choose a file" />
            </SelectTrigger>
            <SelectContent>
              {files.map((file) => <SelectItem key={file.path} value={file.path} className="font-mono text-xs">{file.path}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {selected?.startsWith("concepts/") && model?.concepts.filter((concept) => `concepts/${concept.id}.md` === selected).map((concept) => (
          <Card key={concept.id} size="sm">
            <CardHeader>
              <CardTitle>{concept.name}</CardTitle>
              <CardAction><Badge variant="secondary">{concept.mastery.replaceAll("_", " ")}</Badge></CardAction>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              <p className="text-muted-foreground">Evidence: {concept.evidence.length}</p>
              <ul className="list-inside list-disc">
                {concept.evidence.map((item) => <li key={`${item.sessionId}:${item.id}`}>{item.note} ({item.outcome}, {item.strength})</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
        <div className="flex min-h-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="memory-markdown">Markdown</Label>
          <Textarea id="memory-markdown" className="min-h-40 flex-1 resize-y font-mono text-xs" value={draft} onChange={(event) => setDraft(event.target.value)} />
        </div>
        {/* The theme colour only marks a save that would change something. */}
        <Button variant={dirty ? "default" : "secondary"} disabled={!selected || saving} onClick={() => void save()}>{saving ? <><Spinner aria-hidden="true" />Saving…</> : "Save changes"}</Button>
      </div>
    </>
  );
}
