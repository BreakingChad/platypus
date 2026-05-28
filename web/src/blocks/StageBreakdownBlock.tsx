import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

export function StageBreakdownBlock({ ctx }: { ctx: BlockContext }) {
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });

  const totalOpen = studies.rows.filter((s) => !s.closed).length;
  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of studies.rows) {
      if (s.closed) continue;
      const k = s.stage_key ?? "__unassigned__";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [studies.rows]);

  if (totalOpen === 0 || stages.rows.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900">Stage breakdown</h2>
        <button
          onClick={() => ctx.navigate("#/pipeline")}
          className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          Open pipeline view <Icon name="chevron-right" size={10} />
        </button>
      </div>
      <Card>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 mb-4 h-8">
          {stages.rows.map((stage) => {
            const c = stageCounts[stage.key] ?? 0;
            if (c === 0) return null;
            const pct = (c / totalOpen) * 100;
            return (
              <button
                key={stage.id}
                onClick={() => ctx.navigate("#/pipeline")}
                className="h-full flex items-center justify-center text-[10px] font-bold uppercase tracking-wider text-white hover:opacity-80 transition"
                style={{ backgroundColor: stage.color, width: `${pct}%` }}
                title={`${stage.label}: ${c} stud${c === 1 ? "y" : "ies"}`}
              >
                {pct > 8 ? c : ""}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {stages.rows.map((stage) => {
            const c = stageCounts[stage.key] ?? 0;
            return (
              <button
                key={stage.id}
                onClick={() => ctx.navigate("#/pipeline")}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-slate-100 hover:border-brand-200 hover:bg-brand-50/30 transition text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-xs font-semibold text-slate-700 truncate">
                    {stage.label}
                  </span>
                </div>
                <span className="text-xs font-mono text-slate-500">{c}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </section>
  );
}
