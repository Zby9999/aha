import { useId, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "cn";

type Edges = [top: number, right: number, bottom: number, left: number];

// A rounded square whose edges bulge by `bulge` and whose corners have radius `radius`.
// Every variant has the same commands, so SMIL can morph between them.
function blob(bulge: Edges, radius: Edges, box = { x0: 5, y0: 6, x1: 43, y1: 43 }) {
  const { x0, y0, x1, y1 } = box;
  const [bt, br, bb, bl] = bulge;
  const [rtl, rtr, rbr, rbl] = radius;
  const k = 0.72;
  const f = (n: number) => Number(n.toFixed(2));
  const c = (...n: number[]) => `C${n.map(f).join(" ")}`;
  const third = (a: number, b: number, t: number) => a + (b - a) * t;
  return [
    `M${f(x0 + rtl)} ${f(y0)}`,
    c(third(x0 + rtl, x1 - rtr, 1 / 3), y0 - bt, third(x0 + rtl, x1 - rtr, 2 / 3), y0 - bt, x1 - rtr, y0),
    c(x1 - rtr * (1 - k), y0, x1, y0 + rtr * (1 - k), x1, y0 + rtr),
    c(x1 + br, third(y0 + rtr, y1 - rbr, 1 / 3), x1 + br, third(y0 + rtr, y1 - rbr, 2 / 3), x1, y1 - rbr),
    c(x1, y1 - rbr * (1 - k), x1 - rbr * (1 - k), y1, x1 - rbr, y1),
    c(third(x1 - rbr, x0 + rbl, 1 / 3), y1 + bb, third(x1 - rbr, x0 + rbl, 2 / 3), y1 + bb, x0 + rbl, y1),
    c(x0 + rbl * (1 - k), y1, x0, y1 - rbl * (1 - k), x0, y1 - rbl),
    c(x0 - bl, third(y1 - rbl, y0 + rtl, 1 / 3), x0 - bl, third(y1 - rbl, y0 + rtl, 2 / 3), x0, y0 + rtl),
    c(x0, y0 + rtl * (1 - k), x0 + rtl * (1 - k), y0, x0 + rtl, y0),
    "Z",
  ].join(" ");
}

const flat: Edges = [0, 0, 0, 0];
const shapes = [
  blob(flat, [11, 11.5, 10.5, 10]),
  blob(flat, [11.8, 10.5, 11.2, 10.8], { x0: 4.7, y0: 6.2, x1: 43.2, y1: 42.8 }),
  blob(flat, [10.4, 11.2, 10, 11.4], { x0: 5.2, y0: 5.8, x1: 42.8, y1: 43.2 }),
];
const boil = [...shapes, shapes[0]].join(";");

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribe(change: () => void) {
  const query = window.matchMedia?.(reducedQuery);
  query?.addEventListener("change", change);
  return () => query?.removeEventListener("change", change);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribe, () => window.matchMedia?.(reducedQuery).matches ?? false, () => false);

/** A themed prop the mascot carries, one per kind of lesson card. */
export type MascotAccessory = "signpost" | "contrast" | "envelope" | "flow" | "cap" | "bulb" | "question" | "speech";

export type AhaMascotProps = {
  /** `idle` breathes, blinks and glances around; `thinking` tilts, looks up and puffs thought dots. */
  mood?: "idle" | "thinking";
  accessory?: MascotAccessory;
  className?: string;
  /** Accessible name. Without it the mascot is decorative. */
  label?: string;
};

const ink = "var(--mascot-pupil)";

// Drawn above or beside the head; the body shrinks to make room.
const gold = "oklch(0.86 0.16 90)";

// Worn on the head, so it is drawn in body coordinates and moves with it.
const cap = (
  <g className="aha-mascot-prop" data-prop="cap">
    <path d="M16.5 1.5V7c0 1.7 15 1.7 15 0V1.5Z" fill={ink} />
    <path d="M24-5.5 42 0 24 5.5 6 0Z" fill={ink} />
    <circle cx="24" cy="0" r="1.2" fill={gold} />
    <path d="M24 0 37.6 1.3" fill="none" stroke={gold} strokeWidth="1" strokeLinecap="round" />
    <g className="aha-mascot-tassel">
      <path d="M37.6 1.3V9" fill="none" stroke={gold} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M36.6 8.6h2l.9 5.4c.1.5-.3.9-.8.9h-2.2c-.5 0-.9-.4-.8-.9Z" fill={gold} />
    </g>
  </g>
);

const props: Record<Exclude<MascotAccessory, "contrast" | "cap">, ReactNode> = {
  signpost: (
    <g className="aha-mascot-prop" data-prop="signpost">
      <rect x="22.8" y="8" width="2.4" height="7" rx="1" fill={ink} />
      <path d="M15 2.5h16.5l4 3.5-4 3.5H15a1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 1 15 2.5Z" fill={ink} />
      <path d="M18 6h10" stroke="var(--mascot-eye)" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  ),
  envelope: (
    <g className="aha-mascot-prop" data-prop="envelope">
      <rect x="33" y="1.5" width="13" height="9" rx="1.8" fill={ink} />
      <path d="M34.5 3.2 39.5 7l5-3.8" fill="none" stroke="var(--mascot-eye)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  flow: (
    <g className="aha-mascot-prop" data-prop="flow">
      <rect x="9" y="4.5" width="30" height="5" rx="2.5" fill={ink} opacity=".18" />
      <g fill={ink}>
        <circle cx="13" cy="7" r="1.6" />
        <circle cx="21" cy="7" r="1.6" />
        <circle cx="29" cy="7" r="1.6" />
      </g>
    </g>
  ),
  bulb: (
    <g className="aha-mascot-prop" data-prop="bulb">
      <g className="aha-mascot-rays" stroke="oklch(0.86 0.16 90)" strokeWidth="1.4" strokeLinecap="round">
        <path d="M38 .8v1.6M31.7 3.6l1.2 1.1M44.3 3.6l-1.2 1.1M30 9.5h1.6M44.4 9.5H46" />
      </g>
      <circle cx="38" cy="9.5" r="5" fill="oklch(0.88 0.16 92)" />
      <rect x="35.6" y="13.6" width="4.8" height="3.6" rx="1.2" fill={ink} />
    </g>
  ),
  question: (
    <g className="aha-mascot-prop" data-prop="question">
      <path d="M34.5 5.5a4 4 0 1 1 5.6 3.7c-1.3.6-1.6 1.3-1.6 2.8" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="38.5" cy="16" r="1.6" fill={ink} />
    </g>
  ),
  speech: (
    <g className="aha-mascot-prop" data-prop="speech">
      <path d="M33 1h11a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-7l-3.5 3v-3H33a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" fill={ink} />
      <g fill="var(--mascot-eye)">
        <circle cx="34.5" cy="7" r="1.2" />
        <circle cx="38.5" cy="7" r="1.2" />
        <circle cx="42.5" cy="7" r="1.2" />
      </g>
    </g>
  ),
};

export function AhaMascot({ mood = "idle", accessory, className, label }: AhaMascotProps) {
  const reduced = useReducedMotion();
  const clip = useId();
  const thinking = mood === "thinking";
  const room = thinking ? "translate(0 10) scale(.78)" : accessory ? "translate(4.3 8.6) scale(.82)" : undefined;
  const morph = !reduced && (
    <animate attributeName="d" dur="2.4s" repeatCount="indefinite" values={boil} calcMode="spline" keyTimes="0;.33;.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
  );
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("aha-mascot", className)}
      data-mood={mood}
      data-accessory={accessory}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {accessory === "contrast" && (
        <clipPath id={clip}><rect x="24" y="0" width="24" height="48" /></clipPath>
      )}
      <g transform={room}>
        <g className="aha-mascot-sway">
          <g className="aha-mascot-body">
            <path d={shapes[0]} fill="var(--mascot-body)">{morph}</path>
            {accessory === "contrast" && (
              <path d={shapes[0]} fill="var(--mascot-eye)" opacity=".38" clipPath={`url(#${clip})`}>{morph}</path>
            )}
            <g className="aha-mascot-eyes">
              <rect x="11.5" y="18.5" width="9.5" height="16" rx="4.2" fill="var(--mascot-eye)" />
              <rect x="23" y="18.5" width="9.5" height="16" rx="4.2" fill="var(--mascot-eye)" />
              <g className="aha-mascot-pupils" fill="var(--mascot-pupil)">
                <rect x="13.65" y="21.5" width="5.2" height="10" rx="2" />
                <rect x="25.15" y="21.5" width="5.2" height="10" rx="2" />
              </g>
            </g>
            {accessory === "cap" && cap}
          </g>
        </g>
      </g>
      {accessory && accessory !== "contrast" && accessory !== "cap" && !thinking && props[accessory]}
      {thinking && (
        <g className="aha-mascot-thought" fill="var(--mascot-body)">
          <circle cx="35" cy="13" r="2.2" />
          <circle cx="39.8" cy="7.6" r="2.8" />
          <circle cx="44.9" cy="3.2" r="3.1" />
        </g>
      )}
    </svg>
  );
}
