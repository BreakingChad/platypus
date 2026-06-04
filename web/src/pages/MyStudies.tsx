import { useMemo } from "react";
import { useAuth } from "../auth/useAuth";
import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow, TaskRow, PipelineStageRow } from "../lib/types";
import { computeHealth } from "../lib/studyHealth";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Pill } from "../components/ui/Pill";
import { HealthDot } from "../components/ui/HealthDot";

/** My Studies — the portfolio scoped to ME: studies where I have open work,
 *  recent activity, or that I created. Personnel-role scoping (PI/CRC/DOA)
 *  takes over once study personnel land (Wave H). */
export function MyStudies({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });

  const mine = useMemo(() => {
    if (!userId) return [];
    const withMyTasks = new Set(
      tasks.rows
        .filter((t) => t.assigned_to_user_id === userId && t.status !== "done")
        .map((t) => t.study_id)
        .filter(Boolean) as string[]
    );
    return studies.rows
      .filter((s) => !s.closed && (withMyTasks.has(s.id) || (s as any).created_by === userId))
      .map((s) => ({ s, health: computeHealth(s, stages.rows), open: tasks.rows.filter((t) => t.study_id === s.id && t.assigned_to_user_id === userId && t.status !== "done").length }));
  }, [studies.rows, tasks.rows, stages.rows, userId]);

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Studies"
        title="My studies"
        subtitle="The studies you're actively working — anything with open tasks assigned to you. The full portfolio lives under Portfolio."
      />
      <div className="mt-6">
        {mine.length === 0 ? (
          <Card>
            <EmptyState
              iconName="folder"
              title="Nothing assigned to you right now"
              sub="When tasks are routed to you, their studies show up here automatically."
            />
          </Card>
        ) : (
          <Card flush className="overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {mine.map(({ s, health, open }) => (
                <li key={s.id}>
                  <button
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-brand-50/30 transition"
                  >
                    <HealthDot health={health} />
                    <span className="font-mono text-xs text-slate-500">{s.code}</span>
                    <span className="flex-1 min-w-0 text-sm font-semibold text-slate-900 truncate">{s.title}</span>
                    {open > 0 && <Pill tone="brand">{open} open task{open === 1 ? "" : "s"}</Pill>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
