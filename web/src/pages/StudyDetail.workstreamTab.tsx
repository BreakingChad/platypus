import { useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { stamped } from "../lib/stamp";
import type {
  PipelineStageRow, StudyRow, TaskRow, WorkflowModuleRow, WorkstreamRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";

/** StudyWorkstreamTab (Wave S2) — the operating plan FOR THIS STUDY.
 *  Shows which workstream it's on (set at intake; admins can change it) and
 *  the pathway: each stage with its modules and this study's tasks, so you
 *  see what fires and what's done without leaving the record. */
export function StudyWorkstreamTab({
  study,
  stages,
}: {
  study: StudyRow;
  stages: PipelineStageRow[];
}) {
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const workstreams = useOrgTable<WorkstreamRow>("workstreams", { realtime: true });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position", realtime: true });
  const tasks = useOrgTable<TaskRow>("tasks", { realtime: true });

  const myTasks = useMemo(() => tasks.rows.filter((t) => t.study_id === study.id), [tasks.rows, study.id]);
  const active = workstreams.rows.filter((w) => w.status === "active");
  const current = workstreams.rows.find((w) => w.id === study.workstream_id) ?? null;
  const curIdx = stages.findIndex((s) => s.key === study.stage_key);

  const setWorkstream = async (id: string) => {
    try {
      const { error } = await supabase.from("studies").update({ workstream_id: id } as any).eq("id", study.id);
      if (error) throw error;
      toast.success(stamped("Work stream updated"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't change the work stream"));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3 flex-wrap">
          <Icon name="workflow" size={16} className="text-slate-400" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">On work stream</div>
            <div className="text-sm font-semibold text-slate-900">
              {current ? current.name : <span className="text-slate-400 italic">none assigned</span>}
            </div>
          </div>
          <div className="flex-1" />
          {isAdmin && active.length > 0 && (
            <select
              value={study.workstream_id ?? ""}
              onChange={(e) => e.target.value && void setWorkstream(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Change work stream"
            >
              <option value="">— Pick a work stream —</option>
              {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        {current?.description && <p className="text-xs text-slate-500 mt-2">{current.description}</p>}
      </Card>

      {/* the pathway for this study */}
      <div className="space-y-3">
        {stages.map((s, i) => {
          const mods = modules.rows.filter((m) => m.stage_key === s.key).sort((a, b) => a.position - b.position);
          const stageTasks = myTasks.filter((t) => t.stage_key === s.key);
          const done = stageTasks.filter((t) => t.status === "done").length;
          const state = i < curIdx ? "past" : i === curIdx ? "current" : "upcoming";
          return (
            <div
              key={s.id}
              className={
                "rounded-xl border bg-white overflow-hidden " +
                (state === "current" ? "border-brand-300 ring-1 ring-brand-500/20" : "border-slate-200")
              }
            >
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2" style={{ background: `linear-gradient(90deg, ${s.color}10, transparent 50%)` }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-semibold text-slate-900">{s.label}</span>
                {state === "current" && <Pill tone="brand">current</Pill>}
                {state === "past" && <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">done</span>}
                <div className="flex-1" />
                {stageTasks.length > 0 && (
                  <span className="text-[11px] font-mono text-slate-400">{done}/{stageTasks.length} tasks</span>
                )}
                {s.target_days > 0 && <span className="text-[11px] font-mono text-slate-400">{s.target_days}d</span>}
              </div>
              <div className="p-3">
                {mods.length === 0 && stageTasks.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">No modules or tasks on this stage.</p>
                ) : (
                  <div className="space-y-2">
                    {mods.map((m) => (
                      <div key={m.id} className="rounded-lg bg-slate-50 px-3 py-1.5">
                        <div className="text-xs font-semibold text-slate-700">{m.name}</div>
                      </div>
                    ))}
                    {stageTasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 px-3 py-1">
                        <Icon name={t.status === "done" ? "check" : "clock"} size={12} className={t.status === "done" ? "text-emerald-600" : "text-slate-400"} />
                        <span className={"text-xs " + (t.status === "done" ? "text-slate-400 line-through" : "text-slate-700")}>{t.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
