import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, BookOpen, Sparkles } from "lucide-react";
import { EXPLANATION_COMPONENTS, type CardAnswer, type UserAction } from "@aha/contracts";
import { lessonGalleryFixtures } from "@aha/contracts/fixtures";
import { LessonCardView } from "./cards/LessonCardView.tsx";
import { Button } from "./components/ui/button.tsx";
import "./globals.css";
import "./gallery.css";

type Sample = keyof typeof lessonGalleryFixtures;

const names = {
  Flowchart: "Flowchart",
  ContrastView: "Contrast view",
  SequenceDiagram: "Sequence diagram",
  DataFlowDiagram: "Data flow",
  TextExplanation: "Text explanation",
  OfferCard: "Offer",
  ProbeCard: "Probe",
  ArticulationCard: "Articulation",
} satisfies Record<Sample, string>;

const samples = Object.keys(names) as Sample[];

function CardPreview({ sample, onReset }: { sample: Sample; onReset: () => void }) {
  const [submitted, setSubmitted] = useState<CardAnswer>();
  const [offer, setOffer] = useState<"accept" | "skip">();
  const [flagged, setFlagged] = useState(false);
  const canFlag = EXPLANATION_COMPONENTS.some((component) => component === sample);

  function dispatch(action: UserAction) {
    if (action.type === "card_answer") setSubmitted(action.answer);
    if (action.type === "offer_response") setOffer(action.response);
    if (action.type === "flag_explanation") setFlagged(true);
  }

  return (
    <>
      <LessonCardView
        card={lessonGalleryFixtures[sample]}
        entryId={sample}
        done={Boolean(submitted || offer)}
        {...(submitted ? { submitted } : {})}
        {...(canFlag ? { flag: { lessonId: "gallery", recorded: flagged, enabled: true } } : {})}
        dispatch={dispatch}
      />
      {offer && <p className="gallery-result" role="status">{offer === "accept" ? "Lesson accepted in this preview." : "Lesson skipped in this preview."}</p>}
      {(submitted || offer || flagged) && (
        <Button type="button" variant="ghost" className="gallery-reset" onClick={onReset}>Reset preview</Button>
      )}
    </>
  );
}

function Gallery() {
  const [sample, setSample] = useState<Sample>("Flowchart");
  const [wide, setWide] = useState(false);
  const [revision, setRevision] = useState(0);
  const preview = useRef<HTMLDivElement>(null);

  return (
    <main className="gallery-shell">
      <header className="gallery-header">
        <a href="/" className="gallery-back"><ArrowLeft aria-hidden="true" /><span className="workspace-brand-mark"><Sparkles aria-hidden="true" /></span> Aha</a>
        <div>
          <h1>Lesson cards</h1>
          <p>Portfolio · Signing in after a refresh</p>
        </div>
      </header>
      <div className="gallery-layout">
        <nav aria-label="Lesson card examples" className="gallery-index">
          {samples.map((id) => (
            <Button key={id} variant={sample === id ? "secondary" : "ghost"} aria-current={sample === id ? "true" : undefined} onClick={() => setSample(id)}>{names[id]}</Button>
          ))}
        </nav>
        <section className="gallery-preview" aria-label={`${names[sample]} preview`} data-wide={wide || undefined}>
          <header className="gallery-toolbar">
            <h2><BookOpen aria-hidden="true" /> Learning</h2>
            <Button type="button" variant="outline" size="sm" className="gallery-width" aria-pressed={wide} onClick={() => setWide(!wide)}>Wide preview</Button>
          </header>
          <div className="gallery-stage">
            <div className="gallery-card" role="group" aria-label="Card preview" tabIndex={-1} ref={preview}>
              <CardPreview key={`${sample}-${revision}`} sample={sample} onReset={() => {
                preview.current?.focus();
                setRevision((value) => value + 1);
              }} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
