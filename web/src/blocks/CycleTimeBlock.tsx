import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import type { AuditEventRow, PipelineStageRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/EmptyState";
import type { BlockContext } from "./registry";

/** CycleTimeBlock — uses audit_events with action='stage_changed' to compute
 *  per-stage average dwell time. For each study, consecutive stage_changed
 *  events give us [from, to, ts]; the time the study spent in the 'from'
 *  stage equals (ts of this event) - (ts of the prior event when from was set).
 *
 *  Falls back to a useful zero-state when no events exist yet.
 */

type StageAvg = {
  stage_key: string;
  label: string;
  color: string;
  target: number;
  observed: number;        // sample count
  avgDays: number;         // average dwell time in days
};

export function CycleTimeBlock({ ctx: _ctx }: { ctx: BlockContext }) {
  const { orgId } = useCurrentOrg();
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);

  // Load stage_changed events. Limit to a recent window so the query stays cheap.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("audit_events")
        .select("*")
        .eq("org_id", orgId)
        .eq("entity_type", "study")
        .eq("action", "stage_changed")
        .order("entity_id", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(2000);
      if (!cancelled) setEvents((data ?? []) as AuditEventRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Compute per-stage average dwell time from consecutive stage_changed events.
  const avgs: StageAvg[] = useMemo(() => {
    if (!events) return [];
    // Group by entity_id, then walk pairs.
    const byStudy = new Map<string, AuditEventRow[]>();
    for (const e of events) {
      if (!e.entity_id) continue;
      const arr = byStudy.get(e.entity_id) ?? [];
      arr.push(e);
      byStudy.set(e.entity_id, arr);
    }
    const sumByStage: Record<string, { total: number; count: number }> = {};
    for (const arr of byStudy.values()) {
      arr.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      for (let i = 1; i < arr.length; i += 1) {
        const prev = arr[i - 1];
        const curr = arr[i];
        const stageKey = String((prev.payload as any)?.to ?? "");
        if (!stageKey) continue;
        const dwellMs =
          new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
        const days = dwellMs / 86400000;
        if (!isFinite(days) || days < 0) continue;
        const bucket = (sumByStage[stageKey] = sumByStage[stageKey] ?? { total: 0, count: 0 });
        bucket.total += days;
        bucket.count += 1;
      }
    }
    return stages.rows
      .map<StageAvg | null>((s) => {
        const b = sumByStage[s.key];
        if (!b || b.count === 0) return null;
        return {
          stage_key: s.key,
          label: s.label,
          color: s.color,
          target: s.target_days,
          observed: b.count,
          avgDays: b.total / b.count,
        };
      })
      .filter((x): x is StageAvg => x !== null);
  }, [events, stages.rows]);

  if (events === null) return null;

  // No completed transitions yet — hide instead of showing a useless empty card.
  if (avgs.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          Cycle time by stage
        </h2>
      </div>
      <Card>
        <div className="space-y-3">
          {avgs.map((a) => {
            const overTarget = a.target > 0 && a.avgDays > a.target;
            const pct =
              a.target > 0
                ? Math.min(150, Math.round((a.avgDays / a.target) * 100))
                : null;
            return (
              <div key={a.stage_key}>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: a.color }}
                  />
                  <span className="text-sm font-semibold text-slate-900">{a.label}</span>
                  <span className="text-[10px] font-mono text-slate-400">
                    n={a.observed}
                  </span>
                  <div className="flex-1" />
                  <span
                    className={
                      "text-xs font-mono " +
                      (overTarget ? "text-red-700 font-bold" : "text-slate-600")
                    }
                  >
                    avg {a.avgDays.toFixed(1)}d
                    {a.target > 0 && (
                      <span className="text-slate-400">
                        {" "}
                        / target {a.target}d
                      </span>
                    )}
                  </span>
                </div>
                {pct !== null && (
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={"h-full rounded-full " + (overTarget ? "bg-red-500" : "bg-emerald-500")}
                      style={{ width: pct + "%" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
          Computed from <code className="font-mono">audit_events</code> with
          {" "}<code className="font-mono">action='stage_changed'</code>. As more transitions
          accumulate, these averages converge on the operational truth.
        </p>
      </Card>
    </section>
  );
}
