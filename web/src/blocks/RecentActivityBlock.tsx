import { useMemo } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

export function RecentActivityBlock({ ctx }: { ctx: BlockContext }) {
  const limit = clampLimit((ctx.settings.limit as number) ?? 5);
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "updated_at", realtime: true });

  const recent = useMemo(() => {
    return [...studies.rows]
      .filter((s) => !s.closed)
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, limit);
  }, [studies.rows, limit]);

  if (recent.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900">Recently touched</h2>
        <button
          onClick={() => ctx.navigate("#/studies")}
          className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          All studies <Icon name="chevron-right" size={10} />
        </button>
      </div>
      <Card flush>
        {recent.map((s) => {
          const stage = stages.rows.find((st) => st.key === s.stage_key);
          const updated = s.updated_at ? new Date(s.updated_at) : null;
          return (
            <button
              key={s.id}
              onClick={() => ctx.navigate(`#/studies/${s.id}`)}
              className="w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-brand-50/30 transition grid grid-cols-[100px_1fr_140px_120px] gap-3 items-center"
            >
              <span className="font-mono text-xs text-slate-600">{s.code}</span>
              <span className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{s.title}</div>
                {(s.sponsor || s.therapeutic_area) && (
                  <div className="text-[11px] text-slate-500 truncate">
                    {[s.sponsor, s.therapeutic_area].filter(Boolean).join(" · ")}
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
              <span className="text-xs text-slate-500 font-mono text-right">
                {updated ? timeAgo(updated) : "—"}
              </span>
            </button>
          );
        })}
      </Card>
    </section>
  );
}

function clampLimit(n: unknown): number {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return 5;
  return Math.min(25, Math.max(1, Math.floor(v)));
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString();
}
