import { supabase } from "./supabase";
import { writeAuditEvent } from "./auditLog";
import type { TaskRow, TeamRoleRow, TeamRoleHolderRow } from "./types";

/** Escalate a task: spawn an `escalation` task routed up the role hierarchy.
 *
 *  Target resolution:
 *   1. If the task is role-assigned, escalate to the most senior role
 *      (lowest level number) on the SAME team that isn't the task's role.
 *   2. Otherwise (or if no senior role exists), the escalation stays
 *      role-less and lands in the admin "All open" queue.
 *  Assignment follows the product rule: exactly one holder -> auto-assign;
 *  multiple -> role-queued for a manager pick.
 *  The original task is annotated via audit (task_escalated); it stays open.
 */
export async function escalateTask(opts: {
  orgId: string;
  task: TaskRow;
  reason: string;
  actorUserId: string;
  actorEmail: string | null;
  roles: TeamRoleRow[];
  holders: TeamRoleHolderRow[];
}): Promise<{ targetRole: TeamRoleRow | null }> {
  const { task, roles, holders } = opts;

  let targetRole: TeamRoleRow | null = null;
  if (task.assigned_to_role_id) {
    const current = roles.find((r) => r.id === task.assigned_to_role_id) ?? null;
    if (current) {
      const teamRoles = roles
        .filter((r) => r.team_id === current.team_id && r.id !== current.id)
        .sort((a, b) => a.level - b.level);
      targetRole = teamRoles.find((r) => r.level < current.level) ?? teamRoles[0] ?? null;
    }
  }

  const holdersOf = (roleId: string) => holders.filter((h) => h.team_role_id === roleId);
  let assignedUser: string | null = null;
  if (targetRole) {
    const hs = holdersOf(targetRole.id);
    if (hs.length === 1) assignedUser = hs[0].user_id;
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      org_id: opts.orgId,
      study_id: task.study_id,
      stage_key: task.stage_key,
      kind: "escalation",
      title: `Escalation: ${task.title}`,
      description: opts.reason,
      status: "open",
      due_at: new Date(Date.now() + 2 * 86400000).toISOString(),
      assigned_to_user_id: assignedUser,
      assigned_to_role_id: targetRole?.id ?? null,
      // Source link (0047): also the dedupe key the automatic overdue sweep
      // checks — a manually escalated task won't get auto-escalated again.
      receipt_of_task_id: task.id,
      created_by: opts.actorUserId,
    } as any)
    .select("id")
    .single();
  if (error) throw error;

  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "task",
    entityId: task.id,
    action: "task_escalated",
    payload: {
      reason: opts.reason,
      escalation_task_id: (data as any)?.id ?? null,
      to_role: targetRole?.title ?? null,
    },
  });
  if (task.study_id) {
    void writeAuditEvent({
      orgId: opts.orgId,
      actorId: opts.actorUserId,
      actorEmail: opts.actorEmail,
      entityType: "study",
      entityId: task.study_id,
      action: "escalation_raised",
      payload: { task_title: task.title, reason: opts.reason, to_role: targetRole?.title ?? null },
    });
  }
  return { targetRole };
}
