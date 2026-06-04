import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { SiteRow, StudyRow, FieldDefinitionRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import type { BlockContext } from "./registry";

/** SiteCoverageBlock — active sites with study counts + profile completeness.
 *  Quick read on where the work is and which site profiles need attention. */
export function SiteCoverageBlock({ ctx }: { ctx: BlockContext }) {
  const sites = useOrgTable<SiteRow>("sites", { orderBy: "name", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });

  const siteFields = useMemo(
    () => fields.rows.filter((f) => f.entity_type === "site" && f.enabled),
    [fields.rows]
  );
  const active = sites.rows.filter((s) => s.status === "active");
  if (active.length === 0) return null;

  const countBySite: Record<string, number> = {};
  for (const st of studies.rows) {
    if (!st.site_id || st.closed) continue;
    countBySite[st.site_id] = (countBySite[st.site_id] ?? 0) + 1;
  }

  const COL: Record<string, keyof SiteRow> = {
    siteName: "name", city: "city", state: "state", country: "country", siteStatus: "status",
  };
  const fillFor = (site: SiteRow): number => {
    if (siteFields.length === 0) return 0;
    let filled = 0;
    for (const f of siteFields) {
      const col = COL[f.key];
      const v = col ? (site as any)[col] : (site.profile ?? {})[f.key];
      if (v !== null && v !== undefined && v !== "") filled += 1;
    }
    return Math.round((filled / siteFields.length) * 100);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
            <Icon name="hospital" size={14} />
          </span>
          Site coverage
        </h2>
        <button
          onClick={() => ctx.navigate("#/sites")}
          className="text-xs font-semibold text-brand-700 hover:underline"
        >
          All sites →
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {active.slice(0, 6).map((s) => {
          const fill = fillFor(s);
          return (
            <button
              key={s.id}
              onClick={() => ctx.navigate("#/sites")}
              className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon name="hospital" size={14} className="text-slate-400" />
                <span className="text-sm font-semibold text-slate-900 truncate flex-1">
                  {s.name}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mb-2 truncate">
                {[s.city, s.state].filter(Boolean).join(", ") || "Location not set"}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Pill tone={countBySite[s.id] ? "brand" : "neutral"}>
                  {countBySite[s.id] ?? 0} active stud{(countBySite[s.id] ?? 0) === 1 ? "y" : "ies"}
                </Pill>
                <span className="flex items-center gap-1.5">
                  <span className="w-12 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <span
                      className={
                        "block h-full rounded-full " +
                        (fill >= 80 ? "bg-emerald-500" : fill >= 40 ? "bg-amber-500" : "bg-slate-300")
                      }
                      style={{ width: `${fill}%` }}
                    />
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">{fill}%</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
