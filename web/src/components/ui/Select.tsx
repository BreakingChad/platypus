import type { SelectHTMLAttributes, ReactNode } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

export function Select({ className = "", children, ...rest }: Props) {
  return (
    <select
      {...rest}
      className={
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 " +
        "outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 " +
        "disabled:bg-slate-50 disabled:cursor-not-allowed transition " +
        className
      }
    >
      {children}
    </select>
  );
}
