import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow } from "../lib/types";
import type { BlockContext } from "./registry";

export function KpiStripBlock({ ctx: _ctx }: { ctx: BlockContext }) {
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });

  const metrics = useMemo(() => {
    const all = studies.rows;
    const open = all.filter((s) => !s.closed);
    return {
      total: all.length,
      open: open.length,
      closed: all.filter((s) => s.closed).length,
      high: open.filter((s) => s.priority === "high").length,
      unassigned: open.filter((s) => !s.stage_key).length,
    };
  }, [studies.rows]);

  if (metrics.total === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard label="Open studies" value={metrics.open} highlight />
      <MetricCard label="High priority" value={metrics.high} />
      <MetricCard label="Closed" value={metrics.closed} muted />
      <MetricCard
        label="Unassigned stage"
        value={metrics.unassigned}
        muted={metrics.unassigned === 0}
        warning={metrics.unassigned > 0}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight,
  muted,
  warning,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (highlight
          ? "bg-brand-50/40 border-brand-100"
          : warning
          ? "bg-amber-50/40 border-amber-100"
          : muted
          ? "bg-slate-50 border-slate-200"
          : "bg-white border-slate-200")
      }
    >
      <div
        className={
          "text-[11px] font-semibold mb-1 " +
          (warning ? "text-amber-700" : "text-slate-500")
        }
      >
        {label}
      </div>
      <div
        className={
          "text-2xl font-display font-extrabold tracking-tight " +
          (highlight
            ? "text-brand-700"
            : warning
            ? "text-amber-800"
            : muted
            ? "text-slate-400"
            : "text-slate-900")
        }
      >
        {value}
      </div>
    </div>
  );
}
