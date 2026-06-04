import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow, FieldDefinitionRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

/** IntakeQueueBlock — studies awaiting triage with their data completeness.
 *  The cross-page version of the Intake page's core signal. Hides when clear. */
export function IntakeQueueBlock({ ctx }: { ctx: BlockContext }) {
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });

  const studyFields = useMemo(
    () => fields.rows.filter((f) => f.entity_type === "study" && f.enabled),
    [fields.rows]
  );

  const queue = studies.rows.filter(
    (s) => !s.closed && (s.stage_key === "intake" || s.stage_key === null) && !s.committed_at
  );
  if (queue.length === 0) return null;

  const KEY_TO_COLUMN: Record<string, keyof StudyRow> = {
    shortTitle: "title", sponsor: "sponsor", nct: "nct",
    therapeuticArea: "therapeutic_area", phase: "phase",
    piName: "pi_name", studyKind: "study_kind", priority: "priority",
  };
  const pctFor = (s: StudyRow): number => {
    if (studyFields.length === 0) return 0;
    let score = 0, weight = 0;
    for (const f of studyFields) {
      const w = f.required ? 2 : 1;
      weight += w;
      const col = KEY_TO_COLUMN[f.key];
      const v = col ? (s as any)[col] : (s.custom_field_values ?? {})[f.key];
      if (v !== null && v !== undefined && v !== "") score += w;
    }
    return Math.round((score / Math.max(1, weight)) * 100);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
            <Icon name="inbox" size={14} />
          </span>
          Awaiting intake triage
        </h2>
        <button
          onClick={() => ctx.navigate("#/intake")}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          Open intake →
        </button>
      </div>
      <Card flush className="overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {queue.slice(0, 6).map((s) => {
            const pct = pctFor(s);
            return (
              <li key={s.id}>
                <button
                  onClick={() => ctx.navigate(`#/studies/${s.id}`)}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-brand-50/30 transition"
                >
                  <span className="font-mono text-xs text-slate-500">{s.code}</span>
                  <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">
                    {s.title}
                  </span>
                  <span className="flex items-center gap-1.5 w-28">
                    <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <span
                        className={
                          "block h-full rounded-full " +
                          (pct >= 85 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400")
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">{pct}%</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
