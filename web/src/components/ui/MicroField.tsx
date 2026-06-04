import { type ReactNode } from "react";

/** MicroField — a persistent tiny label above a composer input. Fixes the
 *  placeholder-as-label pattern (labels must survive typing — WCAG + sanity). */
export function MicroField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + className}>
      <span className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
