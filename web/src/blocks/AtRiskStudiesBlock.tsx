import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow, StudyRow } from "../lib/types";
import { computeHealth, healthSortWeight } from "../lib/studyHealth";
import { HealthDot } from "../components/ui/HealthDot";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import type { BlockContext } from "./registry";

/** AtRiskStudiesBlock — surfaces every yellow / red study across the
 *  portfolio. Helps directors see what's slipping at a glance. Hides
 *  itself when nothing is at risk. */
export function AtRiskStudiesBlock({ ctx }: { ctx: BlockContext }) {
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "updated_at", realtime: true });

  const atRisk = useMemo(() => {
    const out = studies.rows
      .filter((s) => !s.closed)
      .map((s) => ({ row: s, health: computeHealth(s, stages.rows) }))
      .filter(({ health }) => health.level === "red" || health.level === "yellow");
    out.sort((a, b) => {
      const w = healthSortWeight(a.health) - healthSortWeight(b.health);
      if (w !== 0) return w;
      // Then by days overdue (deepest red first)
      return a.health.daysToTarget - b.health.daysToTarget;
    });
    return out;
  }, [studies.rows, stages.rows]);

  if (atRisk.length === 0) return null;

  const overdueCount = atRisk.filter((x) => x.health.level === "red").length;
  const atRiskCount = atRisk.filter((x) => x.health.level === "yellow").length;

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          Studies needing attention
          {overdueCount > 0 && <Pill tone="danger">{overdueCount} overdue</Pill>}
          {atRiskCount > 0 && <Pill tone="warning">{atRiskCount} at risk</Pill>}
        </h2>
        <button
          onClick={() => ctx.navigate("#/pipeline")}
          className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          Open pipeline <Icon name="chevron-right" size={10} />
        </button>
      </div>
      <Card flush>
        <ul className="divide-y divide-slate-100">
          {atRisk.slice(0, 10).map(({ row: s, health }) => {
            const stage = s.stage_key ? stages.rows.find((st) => st.key === s.stage_key) : null;
            return (
              <li key={s.id}>
                <button
                  onClick={() => ctx.navigate(`#/studies/${s.id}`)}
                  className="w-full text-left px-4 py-2.5 hover:bg-brand-50/30 transition grid grid-cols-[120px_1fr_160px_180px] gap-3 items-center"
                >
                  <span className="font-mono text-xs text-slate-600 flex items-center gap-2">
                    <HealthDot health={health} variant="dot" />
                    {s.code}
                  </span>
                  <span className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{s.title}</div>
                    {(s.sponsor || s.pi_name) && (
                      <div className="text-[11px] text-slate-500 truncate">
                        {[s.sponsor, s.pi_name].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </span>
                  <span>
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        style={{ backgroundColor: stage.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                        {stage.label}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-600 truncate text-right" title={health.summary}>
                    {health.summary}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {atRisk.length > 10 && (
          <div className="px-4 py-2 border-t border-slate-100 text-[11px] font-mono text-slate-500 text-center">
            +{atRisk.length - 10} more — open pipeline to see all
          </div>
        )}
      </Card>
    </section>
  );
}
