import { friendlyError } from "../lib/errors";
import { stamped } from "../lib/stamp";
import { maybeSpawnHandoffReceipt } from "../lib/handoff";
import { fmtDate } from "../lib/dates";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import type { TaskRow, StudyRow, PipelineStageRow, TeamRoleHolderRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

/** TasksDueBlock — surfaces tasks the signed-in user needs to handle today.
 *  Includes:
 *    - directly assigned tasks (assigned_to_user_id = me)
 *    - role-tasks for roles I hold
 *  Filters to: open/in_progress, due today or overdue.
 *  Hides itself when there's nothing.
 */
export function TasksDueBlock({ ctx }: { ctx: BlockContext }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders");

  const myRoleIds = useMemo(() => {
    if (!userId) return new Set<string>();
    return new Set(holders.rows.filter((h) => h.user_id === userId).map((h) => h.team_role_id));
  }, [holders.rows, userId]);

  const studyById = useMemo(() => {
    const m: Record<string, StudyRow> = {};
    for (const s of studies.rows) m[s.id] = s;
    return m;
  }, [studies.rows]);

  const stageByKey = useMemo(() => {
    const m: Record<string, PipelineStageRow> = {};
    for (const s of stages.rows) m[s.key] = s;
    return m;
  }, [stages.rows]);

  // End of today.
  const endOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);

  const dueSoon = useMemo(() => {
    return tasks.rows.filter((t) => {
      if (t.status !== "open" && t.status !== "in_progress") return false;
      const assignedToMe = t.assigned_to_user_id === userId;
      const assignedToMyRole =
        t.assigned_to_role_id != null && myRoleIds.has(t.assigned_to_role_id);
      if (!assignedToMe && !assignedToMyRole) return false;
      if (!t.due_at) return false;
      return new Date(t.due_at).getTime() <= endOfToday;
    });
  }, [tasks.rows, userId, myRoleIds, endOfToday]);

  if (dueSoon.length === 0) return null;

  const overdueCount = dueSoon.filter((t) => new Date(t.due_at!).getTime() < Date.now()).length;

  const complete = async (t: TaskRow) => {
    try {
      const { error } = await supabase
        .from("tasks")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          completed_by: userId,
        })
        .eq("id", t.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "task", entityId: t.id,
          action: "task_completed",
          payload: { title: t.title, study_id: t.study_id, source: "home_block" },
        });
      }
      toast.success(stamped(`Completed: ${t.title}`));
      if (orgId && userId) {
        const handoff = await maybeSpawnHandoffReceipt({ task: t, orgId, actorUserId: userId, actorEmail: userEmail ?? null });
        if (handoff.spawned) toast.success(stamped(`Handoff sent to ${handoff.toRoleTitle ?? "the receiving role"}`));
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't complete task"));
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-display font-bold text-slate-900 flex items-center gap-2">
          Due today
          {overdueCount > 0 && (
            <Pill tone="danger">{overdueCount} overdue</Pill>
          )}
        </h2>
        <button
          onClick={() => ctx.navigate("#/inbox")}
          className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          Open inbox <Icon name="chevron-right" size={10} />
        </button>
      </div>
      <Card flush>
        <ul className="divide-y divide-slate-100">
          {dueSoon.map((t) => {
            const study = t.study_id ? studyById[t.study_id] : null;
            const stage = t.stage_key ? stageByKey[t.stage_key] : null;
            const due = new Date(t.due_at!);
            const overdue = due.getTime() < Date.now();
            return (
              <li
                key={t.id}
                className="px-4 py-3 grid grid-cols-[24px_1fr_140px_140px_auto] gap-3 items-center group"
              >
                <input
                  type="checkbox"
                  onChange={() => complete(t)}
                  className="accent-brand-500 w-4 h-4 cursor-pointer"
                  title="Complete"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{t.title}</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 truncate">
                    {study && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          ctx.navigate(`#/studies/${study.id}`);
                        }}
                        className="font-mono hover:text-brand-700 transition"
                      >
                        {study.code}
                      </button>
                    )}
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                        style={{ backgroundColor: stage.color }}
                      >
                        {stage.label}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <Pill tone={t.kind === "escalation" ? "danger" : "neutral"}>{t.kind}</Pill>
                </div>
                <div
                  className={
                    "text-xs font-mono " + (overdue ? "text-red-700 font-bold" : "text-slate-600")
                  }
                >
                  {overdue ? "Overdue " : "Due "}
                  {fmtDate(due)}
                </div>
                <Button size="sm" variant="primary" onClick={() => complete(t)}>
                  Complete
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
