import { useSyncExternalStore } from "react";
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

const shapes = [
  blob([0.8, 0.6, 0.4, 0.7], [11, 12, 10, 9]),
  blob([1.3, 0.3, 0.9, 0.4], [12, 10, 11, 10]),
  blob([0.5, 0.9, 0.5, 1.0], [10, 11, 9, 11]),
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

export type AhaMascotProps = {
  /** `idle` breathes, blinks and glances around; `thinking` tilts, looks up and puffs thought dots. */
  mood?: "idle" | "thinking";
  className?: string;
  /** Accessible name. Without it the mascot is decorative. */
  label?: string;
};

export function AhaMascot({ mood = "idle", className, label }: AhaMascotProps) {
  const reduced = useReducedMotion();
  const thinking = mood === "thinking";
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("aha-mascot", className)}
      data-mood={mood}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <g transform={thinking ? "translate(0 10) scale(.78)" : undefined}>
        <g className="aha-mascot-sway">
          <g className="aha-mascot-body">
            <path d={shapes[0]} fill="var(--mascot-body)">
              {!reduced && (
                <animate attributeName="d" dur="2.4s" repeatCount="indefinite" values={boil} calcMode="spline" keyTimes="0;.33;.66;1" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1" />
              )}
            </path>
            <g className="aha-mascot-eyes">
              <rect x="11.5" y="21" width="9.5" height="12" rx="3.6" fill="var(--mascot-eye)" />
              <rect x="23" y="21" width="9.5" height="12" rx="3.6" fill="var(--mascot-eye)" />
              <g className="aha-mascot-pupils" fill="var(--mascot-pupil)">
                <ellipse cx="16.25" cy="27" rx="2.5" ry="3.6" />
                <ellipse cx="27.75" cy="27" rx="2.5" ry="3.6" />
              </g>
            </g>
          </g>
        </g>
      </g>
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
