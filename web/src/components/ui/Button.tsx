import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition " +
  "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:ring-offset-1 focus:ring-offset-white " +
  "disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-gradient text-white shadow shadow-brand-500/25 hover:shadow-md hover:shadow-brand-500/30",
  secondary:
    "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 hover:border-slate-300",
  ghost:
    "bg-transparent text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300",
  danger:
    "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
  quiet:
    "bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button {...rest} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
}
