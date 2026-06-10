import { supabase } from "./supabase";
import { writeAuditEvent } from "./auditLog";
import type { TeamRoleRow } from "./types";

/** Escalation flow v1 (review item #5) — "the system noticing things."
 *
 *  A client-side sweep (no cron infra): once per session, an admin's app
 *  load finds tasks overdue past the grace window and spawns an ESCALATION
 *  task one level UP the owning team's hierarchy (level 1 = top). The
 *  escalation links to its source via receipt_of_task_id, so the sweep is
 *  idempotent — one escalation per task, ever. Both sides are audited.
 *
 *  Known v1 limits, accepted deliberately:
 *  - fires on app load, not on a clock (the next admin in = the sweep);
 *  - tasks assigned to a top-level role have nowhere to go → skipped;
 *  - tasks with no role assignment are skipped (nothing to climb).
 */

export const ESCALATION_GRACE_DAYS = 2;
export const ESCALATION_TITLE_PREFIX = "Escalation: ";

type RoleLite = Pick<TeamRoleRow, "id" | "team_id" | "level">;

/** Pure: the role one level up in the same team (nearest smaller level).
 *  Exported for tests. */
export function pickEscalationTargetRole(
  sourceRoleId: string | null,
  roles: RoleLite[]
): string | null {
  if (!sourceRoleId) return null;
  const src = roles.find((r) => r.id === sourceRoleId);
  if (!src) return null;
  const above = roles.filter((r) => r.team_id === src.team_id && r.level < src.level);
  if (above.length === 0) return null;
  const nearest = Math.max(...above.map((r) => r.level));
  return above.find((r) => r.level === nearest)?.id ?? null;
}

/** Pure: days a task is overdue (whole days, floor). Exported for tests. */
export function daysOverdue(dueAt: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(dueAt).getTime()) / 86400000);
}

export type SweepResult = { checked: number; spawned: number };

/** Find overdue tasks and escalate them one level up. Idempotent. */
export async function sweepEscalations(opts: {
  orgId: string;
  actorUserId: string;
  actorEmail: string | null;
}): Promise<SweepResult> {
  const cutoff = new Date(Date.now() - ESCALATION_GRACE_DAYS * 86400000).toISOString();
  const { data: overdue } = await supabase
    .from("tasks")
    .select("id, study_id, stage_key, title, due_at, assigned_to_role_id, position")
    .eq("org_id", opts.orgId)
    .in("status", ["open", "in_progress"])
    .neq("kind", "escalation")
    .lt("due_at", cutoff)
    .limit(50);
  const rows = (overdue ?? []) as any[];
  if (rows.length === 0) return { checked: 0, spawned: 0 };

  // Already-escalated guard: one escalation per source task, ever.
  const ids = rows.map((r) => r.id);
  const { data: existing } = await supabase
    .from("tasks")
    .select("receipt_of_task_id")
    .eq("org_id", opts.orgId)
    .eq("kind", "escalation")
    .in("receipt_of_task_id", ids);
  const escalated = new Set(((existing ?? []) as any[]).map((e) => e.receipt_of_task_id));

  const candidates = rows.filter((r) => !escalated.has(r.id) && r.assigned_to_role_id);
  if (candidates.length === 0) return { checked: rows.length, spawned: 0 };

  const { data: rolesData } = await supabase
    .from("team_roles")
    .select("id, team_id, level, title");
  const roles = ((rolesData ?? []) as any[]) as (RoleLite & { title: string })[];

  // Holder lookup for single-holder auto-assign on the escalation itself.
  const targetByCandidate = new Map<string, string>();
  for (const c of candidates) {
    const target = pickEscalationTargetRole(c.assigned_to_role_id, roles);
    if (target) targetByCandidate.set(c.id, target);
  }
  const targetRoleIds = [...new Set(targetByCandidate.values())];
  if (targetRoleIds.length === 0) return { checked: rows.length, spawned: 0 };
  const { data: holdersData } = await supabase
    .from("team_role_holders")
    .select("team_role_id, user_id")
    .in("team_role_id", targetRoleIds);
  const holdersByRole: Record<string, string[]> = {};
  for (const h of (holdersData ?? []) as any[]) {
    (holdersByRole[h.team_role_id] ??= []).push(h.user_id);
  }

  let spawned = 0;
  const now = new Date();
  for (const c of candidates) {
    const targetRoleId = targetByCandidate.get(c.id);
    if (!targetRoleId) continue; // top of the hierarchy — nowhere to climb
    const od = daysOverdue(c.due_at, now);
    const holders = holdersByRole[targetRoleId] ?? [];
    const { data: created, error } = await supabase
      .from("tasks")
      .insert({
        org_id: opts.orgId,
        study_id: c.study_id,
        stage_key: c.stage_key,
        kind: "escalation",
        title: `${ESCALATION_TITLE_PREFIX}"${c.title}" is ${od} day${od === 1 ? "" : "s"} overdue`,
        description:
          "Raised automatically: the task below it in the hierarchy blew past its due date. Unblock it, reassign it, or descope it — then close this.",
        status: "open",
        due_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
        assigned_to_role_id: targetRoleId,
        assigned_to_user_id: holders.length === 1 ? holders[0] : null,
        receipt_of_task_id: c.id,
        created_by: opts.actorUserId,
        position: c.position ?? 0,
      } as any)
      .select("id")
      .single();
    if (error || !created) continue;
    spawned += 1;
    const targetTitle = roles.find((r) => r.id === targetRoleId)?.title ?? null;
    void writeAuditEvent({
      orgId: opts.orgId,
      actorId: opts.actorUserId,
      actorEmail: opts.actorEmail,
      entityType: "task",
      entityId: c.id,
      action: "task_escalated",
      payload: { title: c.title, days_overdue: od, to_role: targetTitle, escalation_task_id: (created as any).id },
    });
    void writeAuditEvent({
      orgId: opts.orgId,
      actorId: opts.actorUserId,
      actorEmail: opts.actorEmail,
      entityType: "task",
      entityId: (created as any).id,
      action: "escalation_spawned",
      payload: { from_task_id: c.id, from_title: c.title, to_role: targetTitle },
    });
  }

  return { checked: rows.length, spawned };
}
