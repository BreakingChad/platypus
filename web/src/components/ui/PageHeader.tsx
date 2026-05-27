import type { ReactNode } from "react";

type Props = {
  kicker?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function PageHeader({ kicker, title, subtitle, actions }: Props) {
  return (
    <header className="mb-8 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {kicker && (
          <div className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold mb-2">
            {kicker}
          </div>
        )}
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="text-slate-600 mt-2 max-w-3xl leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </header>
  );
}
