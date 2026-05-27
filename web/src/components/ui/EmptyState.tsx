import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({
  iconName,
  title,
  sub,
  action,
}: {
  iconName?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="py-12 text-center">
      {iconName && (
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
          <Icon name={iconName} size={22} />
        </div>
      )}
      <div className="text-base font-display font-bold text-slate-900">{title}</div>
      {sub && (
        <div className="text-sm text-slate-600 mt-1 max-w-md mx-auto leading-relaxed">
          {sub}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
