import { type ReactNode } from "react";

/** Tip — dependency-free tooltip that works for mouse AND keyboard (and
 *  taps, via focus). Wraps its anchor; shows a dark bubble on hover or
 *  focus-within. Use <InfoTip/> for a standalone ⓘ anchor next to labels.
 *
 *  Why not title=""? Native titles are mouse-only, invisible on touch,
 *  unreachable by keyboard, and unstylable — fine as a fallback, not as
 *  the primary way we explain regulated-world jargon.
 */
export function Tip({
  label,
  side = "top",
  block = false,
  children,
}: {
  label: string;
  side?: "top" | "bottom";
  /** Render as block-level wrapper (for full-width anchors). */
  block?: boolean;
  children: ReactNode;
}) {
  const pos =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
      : "top-full left-1/2 -translate-x-1/2 mt-1.5";
  return (
    <span className={(block ? "block " : "inline-flex ") + "relative group/tip"}>
      {children}
      <span
        role="tooltip"
        className={
          "pointer-events-none absolute " +
          pos +
          " z-[60] w-max max-w-[260px] rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium normal-case tracking-normal leading-snug text-white shadow-lg opacity-0 transition-opacity duration-150 delay-200 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
        }
      >
        {label}
      </span>
    </span>
  );
}

/** InfoTip — a small ⓘ that explains a term on hover/focus/tap. */
export function InfoTip({ label, side }: { label: string; side?: "top" | "bottom" }) {
  return (
    <Tip label={label} side={side}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200/80 text-slate-500 hover:bg-slate-300 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 text-[9px] font-bold leading-none cursor-pointer align-middle"
      >
        i
      </button>
    </Tip>
  );
}
