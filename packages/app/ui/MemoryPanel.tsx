import { useEffect, useState } from "react";
import type { Concept, LearnerModelFile } from "@aha/contracts";
import { Button } from "./components/ui/button.tsx";

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
      setSelected((current) => current ?? next.files[0]?.path);
    }).catch((error) => { if (!cancelled) setMessage((error as Error).message); });
    return () => { cancelled = true; };
  }, [visible]);

  useEffect(() => {
    setDraft(model?.files.find((file) => file.path === selected)?.markdown ?? "");
  }, [model, selected]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <h2 className="font-semibold">Learner model</h2>
      {message && <p role="status" className="text-sm">{message}</p>}
      <label className="text-sm">File
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={selected ?? ""} onChange={(event) => setSelected(event.target.value)}>
          {model?.files.filter((file) => file.path === "index.md" || file.path.startsWith("concepts/")).map((file) =>
            <option key={file.path} value={file.path}>{file.path}</option>)}
        </select>
      </label>
      {selected?.startsWith("concepts/") && model?.concepts.filter((concept) => `concepts/${concept.id}.md` === selected).map((concept) => (
        <section key={concept.id} className="rounded-md border p-3 text-sm">
          <h3 className="font-medium">{concept.name}</h3>
          <p>Mastery: {concept.mastery.replaceAll("_", " ")}</p>
          <p>Evidence: {concept.evidence.length}</p>
          <ul className="mt-2 list-inside list-disc">
            {concept.evidence.map((item) => <li key={`${item.sessionId}:${item.id}`}>{item.note} ({item.outcome}, {item.strength})</li>)}
          </ul>
        </section>
      ))}
      <label className="flex min-h-40 flex-1 flex-col text-sm">Markdown
        <textarea className="mt-1 min-h-40 flex-1 resize-y rounded-md border bg-background p-2 font-mono text-xs" value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <Button disabled={!selected || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</Button>
    </div>
  );
}
