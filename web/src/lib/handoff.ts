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
  assigned_to_role_id: string;
  created_by: string;
  position: number;
};

/** Pure: build the receipt task for a completed handoff (null when the task
 *  isn't a targeted handoff). Single holder -> auto-assign; multiple -> the
 *  role queue, same rule the spawn engine uses. Exported for tests. */
export function buildHandoffReceipt(
  task: Pick<
    TaskRow,
    "org_id" | "study_id" | "stage_key" | "kind" | "title" | "position" | "handoff_to_role_id"
  >,
  opts: { holderIds: string[]; actorUserId: string; now?: Date }
): HandoffReceiptInsert | null {
  if (task.kind !== "handoff" || !task.handoff_to_role_id) return null;
  const now = opts.now ?? new Date();
  return {
    org_id: task.org_id,
    study_id: task.study_id,
    stage_key: task.stage_key,
    kind: "manual",
    title: `${HANDOFF_RECEIPT_PREFIX}${task.title}`,
    description: "Created automatically when the sending role completed its handoff.",
    status: "open",
    due_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
    assigned_to_user_id: opts.holderIds.length === 1 ? opts.holderIds[0] : null,
    assigned_to_role_id: task.handoff_to_role_id,
    created_by: opts.actorUserId,
    position: task.position ?? 0,
  };
}

/** Spawn the receipt task for a just-completed handoff, if it names a
 *  receiving role. Duplicate-safe: skips when an open receipt already exists. */
export async function maybeSpawnHandoffReceipt(opts: {
  task: TaskRow;
  orgId: string;
  actorUserId: string;
  actorEmail: string | null;
}): Promise<{ spawned: boolean; toRoleTitle: string | null }> {
  const t = opts.task;
  if (t.kind !== "handoff" || !t.handoff_to_role_id) {
    return { spawned: false, toRoleTitle: null };
  }

  // Duplicate guard — an open receipt for this handoff already exists.
  const title = `${HANDOFF_RECEIPT_PREFIX}${t.title}`;
  let dupQuery = supabase
    .from("tasks")
    .select("id")
    .eq("org_id", opts.orgId)
    .eq("title", title)
    .in("status", ["open", "in_progress"])
    .limit(1);
  dupQuery = t.study_id ? dupQuery.eq("study_id", t.study_id) : dupQuery.is("study_id", null);
  const { data: existing } = await dupQuery;
  if (existing && existing.length > 0) return { spawned: false, toRoleTitle: null };

  const [{ data: holders }, { data: role }] = await Promise.all([
    supabase.from("team_role_holders").select("user_id").eq("team_role_id", t.handoff_to_role_id),
    supabase.from("team_roles").select("title").eq("id", t.handoff_to_role_id).single(),
  ]);

  const receipt = buildHandoffReceipt(t, {
    holderIds: ((holders ?? []) as { user_id: string }[]).map((h) => h.user_id),
    actorUserId: opts.actorUserId,
  });
  if (!receipt) return { spawned: false, toRoleTitle: null };

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
      to_role: (role as any)?.title ?? null,
      receipt_task_id: (created as any)?.id ?? null,
    },
  });

  return { spawned: true, toRoleTitle: (role as any)?.title ?? null };
}
