import type { ReactNode } from "react";

type Props = {
  label?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
};

export function Field({ label, hint, required, children }: Props) {
  return (
    <div>
      {label && (
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && <div className="text-xs text-slate-500 mt-1.5">{hint}</div>}
    </div>
  );
}
