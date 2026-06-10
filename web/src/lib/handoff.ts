import { supabase } from "./supabase";
import { writeAuditEvent } from "./auditLog";
import type { TaskRow } from "./types";

/** Role-to-role handoffs (Wave F4).
 *
 *  A workflow handoff task can name the role that receives the work
 *  (`handoff_to_role_id`, copied from the template onto the task at spawn).
 *  When the sending role completes the task, we spawn a RECEIPT task for the
 *  receiving role — so the handoff is measurable on both sides, which is the
 *  whole reason modules belong to one team.
 */

export const HANDOFF_RECEIPT_PREFIX = "Handoff received: ";

export type HandoffReceiptInsert = {
  org_id: string;
  study_id: string | null;
  stage_key: string | null;
  kind: "manual";
  title: string;
  description: string;
  status: "open";
  due_at: string;
  assigned_to_user_id: string | null;
  assigned_to_role_id: string | null;
  assigned_to_team_id: string | null;
  created_by: string;
  position: number;
  /** 0047 — the completed handoff task this receipt answers (dedupe key). */
  receipt_of_task_id: string | null;
};

/** Pure: build the receipt task for a completed handoff (null when the task
 *  isn't a targeted handoff). Team handoff -> shared team queue at the target
 *  stage. Role handoff -> single holder auto-assigns, multiple stay on the role
 *  queue (same rule the spawn engine uses). Exported for tests. */
export function buildHandoffReceipt(
  task: Pick<
    TaskRow,
    "id" | "org_id" | "study_id" | "stage_key" | "kind" | "title" | "position"
      | "handoff_to_role_id" | "handoff_to_team_id" | "handoff_to_stage_key"
  >,
  opts: { holderIds: string[]; actorUserId: string; now?: Date }
): HandoffReceiptInsert | null {
  if (task.kind !== "handoff") return null;
  const toTeam = task.handoff_to_team_id ?? null;
  const toRole = task.handoff_to_role_id ?? null;
  if (!toTeam && !toRole) return null;
  const now = opts.now ?? new Date();
  return {
    org_id: task.org_id,
    study_id: task.study_id,
    // Team handoffs land at the chosen stage; role handoffs stay on the task's stage.
    stage_key: toTeam ? (task.handoff_to_stage_key ?? task.stage_key) : task.stage_key,
    kind: "manual",
    title: `${HANDOFF_RECEIPT_PREFIX}${task.title}`,
    description: toTeam
      ? "Created automatically when the sending team completed its handoff — open to the receiving team."
      : "Created automatically when the sending role completed its handoff.",
    status: "open",
    due_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
    assigned_to_user_id: toTeam ? null : (opts.holderIds.length === 1 ? opts.holderIds[0] : null),
    assigned_to_role_id: toTeam ? null : toRole,
    assigned_to_team_id: toTeam,
    created_by: opts.actorUserId,
    position: task.position ?? 0,
    receipt_of_task_id: task.id ?? null,
  };
}

/** Spawn the receipt task for a just-completed handoff, if it names a
 *  receiving role. Duplicate-safe: skips when an open receipt already exists. */
export async function maybeSpawnHandoffReceipt(opts: {
  task: TaskRow;
  orgId: string;
  actorUserId: string;
  actorEmail: string | null;
}): Promise<{ spawned: boolean; toRoleTitle: string | null; toTeamName: string | null }> {
  const t = opts.task;
  const toTeam = t.handoff_to_team_id ?? null;
  const toRole = t.handoff_to_role_id ?? null;
  if (t.kind !== "handoff" || (!toTeam && !toRole)) {
    return { spawned: false, toRoleTitle: null, toTeamName: null };
  }

  // Duplicate guard (0047): keyed on the SOURCE TASK, not the title — two
  // same-titled handoffs each get their own receipt.
  const { data: existingById } = await supabase
    .from("tasks")
    .select("id")
    .eq("org_id", opts.orgId)
    .eq("receipt_of_task_id", t.id)
    .limit(1);
  if (existingById && existingById.length > 0) {
    return { spawned: false, toRoleTitle: null, toTeamName: null };
  }
  // Legacy fallback: receipts spawned pre-0047 carry no source link.
  const title = `${HANDOFF_RECEIPT_PREFIX}${t.title}`;
  let dupQuery = supabase
    .from("tasks")
    .select("id")
    .eq("org_id", opts.orgId)
    .eq("title", title)
    .is("receipt_of_task_id", null)
    .in("status", ["open", "in_progress"])
    .limit(1);
  dupQuery = t.study_id ? dupQuery.eq("study_id", t.study_id) : dupQuery.is("study_id", null);
  const { data: existing } = await dupQuery;
  if (existing && existing.length > 0) return { spawned: false, toRoleTitle: null, toTeamName: null };

  // Resolve who receives: a team queue, or a role's holders.
  let holderIds: string[] = [];
  let roleTitle: string | null = null;
  let teamName: string | null = null;
  if (toTeam) {
    const { data: team } = await supabase.from("teams").select("name").eq("id", toTeam).single();
    teamName = (team as any)?.name ?? null;
  } else if (toRole) {
    const [{ data: holders }, { data: role }] = await Promise.all([
      supabase.from("team_role_holders").select("user_id").eq("team_role_id", toRole),
      supabase.from("team_roles").select("title").eq("id", toRole).single(),
    ]);
    holderIds = ((holders ?? []) as { user_id: string }[]).map((h) => h.user_id);
    roleTitle = (role as any)?.title ?? null;
  }

  const receipt = buildHandoffReceipt(t, { holderIds, actorUserId: opts.actorUserId });
  if (!receipt) return { spawned: false, toRoleTitle: null, toTeamName: null };

  const { data: created, error } = await supabase
    .from("tasks")
    .insert(receipt as any)
    .select("id")
    .single();
  if (error) throw error;

  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "task",
    entityId: t.id,
    action: "task_handoff_passed",
    payload: {
      title: t.title,
      study_id: t.study_id,
      to_role: roleTitle,
      to_team: teamName,
      receipt_task_id: (created as any)?.id ?? null,
    },
  });
  // 0047: the receipt task gets its own audit root — the receiving side of
  // the baton is part of the chain too, not just the throw.
  if ((created as any)?.id) {
    void writeAuditEvent({
      orgId: opts.orgId,
      actorId: opts.actorUserId,
      actorEmail: opts.actorEmail,
      entityType: "task",
      entityId: (created as any).id,
      action: "handoff_receipt_spawned",
      payload: {
        from_task_id: t.id,
        from_title: t.title,
        study_id: t.study_id,
        to_role: roleTitle,
        to_team: teamName,
      },
    });
  }

  return { spawned: true, toRoleTitle: roleTitle, toTeamName: teamName };
}
