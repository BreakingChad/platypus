import type { ReactNode } from "react";

type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "info" | "dev";
const tones: Record<Tone, string> = {
  brand:   "bg-brand-50 text-brand-700 border-brand-100",
  success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  warning: "bg-amber-50 text-amber-800 border-amber-100",
  danger:  "bg-red-50 text-red-700 border-red-100",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  info:    "bg-sky-50 text-sky-700 border-sky-100",
  // Developer = high-trust tier, distinct from regular admin.
  dev:     "bg-gradient-to-r from-fuchsia-50 to-violet-50 text-violet-700 border-violet-200",
};

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap " +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}
