import { useMemo, type ReactNode } from "react";
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
import { flowColumns } from "../lib/flow";

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

  // Once a work stream is assigned, it's locked to the study — assignment is a
  // one-time decision. Only admins can make that initial assignment.
  const locked = !!study.workstream_id;

  const assignWorkstream = async (id: string) => {
    if (!id || locked) return;
    try {
      const { error } = await supabase.from("studies").update({ workstream_id: id } as any).eq("id", study.id);
      if (error) throw error;
      toast.success(stamped("Work stream assigned — now locked to this study"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't assign the work stream"));
    }
  };

  const renderStageCard = (s: PipelineStageRow): ReactNode => {
    const i = stages.findIndex((x) => x.id === s.id);
    const mods = modules.rows.filter((m) => m.stage_key === s.key && m.workstream_id === study.workstream_id);
    const stageTasks = myTasks
      .filter((t) => t.stage_key === s.key)
      .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
    const state = i < curIdx ? "past" : i === curIdx ? "current" : "upcoming";
    // Nothing to show for an upcoming stage with no config and no tasks.
    if (stageTasks.length === 0 && mods.length === 0 && state === "upcoming") return null;
    const done = stageTasks.filter((t) => t.status === "done").length;
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
          {stageTasks.length > 0 && <span className="text-[11px] font-mono text-slate-400">{done}/{stageTasks.length}</span>}
        </div>
        <div className="p-2">
          {stageTasks.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {stageTasks.map((t) => {
                const due = t.due_at ? new Date(t.due_at) : null;
                const overdue = due ? due.getTime() < Date.now() && t.status !== "done" : false;
                return (
                  <div key={t.id} className="flex items-center gap-2 px-2 py-1.5">
                    <Icon name={t.status === "done" ? "check" : t.status === "skipped" ? "x" : "clock"} size={13} className={t.status === "done" ? "text-emerald-600" : t.status === "skipped" ? "text-slate-300" : "text-slate-400"} />
                    <span className={"text-xs flex-1 truncate " + (t.status === "done" || t.status === "skipped" ? "text-slate-400 line-through" : "text-slate-800")}>{t.title}</span>
                    {t.assigned_to_role_id == null && t.assigned_to_user_id == null && <span className="text-[10px] text-slate-400 italic">unassigned</span>}
                    {due && <span className={"text-[10px] font-mono whitespace-nowrap " + (overdue ? "text-red-700 font-bold" : "text-slate-400")}>{due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                  </div>
                );
              })}
            </div>
          ) : mods.length > 0 ? (
            <p className="text-[11px] text-slate-400 italic px-2 py-1.5">
              {mods.length} module{mods.length === 1 ? "" : "s"} configured — tasks spawn when the study reaches this stage.
            </p>
          ) : (
            <p className="text-[11px] text-slate-400 italic px-2 py-1.5">No tasks here.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3 flex-wrap">
          <Icon name="workflow" size={16} className="text-slate-400" />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">On work stream</div>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              {current ? current.name : <span className="text-slate-400 italic">none assigned</span>}
              {locked && current && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500" title="Locked to this study — the work stream can't be changed once assigned">
                  <Icon name="lock" size={11} /> Locked
                </span>
              )}
            </div>
          </div>
          <div className="flex-1" />
          {/* Assign (one-time) only when none is set yet, and only for admins. */}
          {!locked && isAdmin && active.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && void assignWorkstream(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Assign work stream"
            >
              <option value="">— Assign a work stream —</option>
              {active.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        {current?.description && <p className="text-xs text-slate-500 mt-2">{current.description}</p>}
        {locked && (
          <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
            <Icon name="lock" size={11} className="flex-shrink-0" />
            A study's work stream is fixed once assigned. Changing it would require an amendment-style reassignment.
          </p>
        )}
      </Card>

      {/* the tasks this work stream creates, grouped by stage — parallel stages share a lane */}
      <div className="space-y-3">
        {(() => {
          let anyShown = false;
          const lanes = flowColumns(stages).map((col, ci) => {
            const cards = col.stages.map((s) => renderStageCard(s)).filter(Boolean) as ReactNode[];
            if (cards.length === 0) return null;
            anyShown = true;
            if (col.stages.length > 1) {
              return (
                <div key={`lane-${ci}`} className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/30 p-2 space-y-2">
                  <div className="px-1 flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Parallel</span>
                    <span className="text-[10px] text-slate-400">· these run at the same time</span>
                  </div>
                  {cards}
                </div>
              );
            }
            return <div key={`col-${ci}`}>{cards}</div>;
          });
          // Only show the catch-all empty when nothing above rendered — otherwise
          // the per-stage "modules spawn tasks" hints already make the point.
          return (
            <>
              {lanes}
              {!anyShown && (
                <Card><div className="text-xs text-slate-500 px-1 py-2">No tasks yet — this work stream spawns them as the study moves through its stages.</div></Card>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
