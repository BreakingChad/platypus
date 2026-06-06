import { supabase } from "./supabase";

/** Work Stream execution engine.
 *
 *  When a study advances into a stage, this function looks up the enabled
 *  workflow_modules for that org+stage_key, expands each module's
 *  workflow_task_templates into rows in `tasks`, resolves role-based
 *  assignments via team_role_holders (picks the first holder; falls back to
 *  unassigned if none), and sets due_at = stage_entry_ts + due_offset_days.
 *
 *  Idempotency: every spawned task carries a deterministic created_by-set +
 *  stage_key + study_id so we don't double-spawn on repeat fires of the
 *  same stage entry. Callers should only call this when they detect a NEW
 *  stage entry (i.e. stage_key actually changed).
 *
 *  Returns the spawned tasks (or { spawned: 0 } when no modules matched).
 */

export type SpawnResult = {
  spawned: number;
  skipped: number;
  modules: number;
};

export async function spawnTasksForStageEntry(opts: {
  orgId: string;
  studyId: string;
  stageKey: string;
  actorUserId: string;
  /** The study's work stream — only its modules spawn tasks. */
  workstreamId?: string | null;
  enteredAt?: Date;
}): Promise<SpawnResult> {
  const enteredAt = opts.enteredAt ?? new Date();

  // 1. Look up enabled modules for this stage_key, scoped to the study's work stream.
  let modQuery = supabase
    .from("workflow_modules")
    .select("*")
    .eq("org_id", opts.orgId)
    .eq("stage_key", opts.stageKey)
    .eq("enabled", true);
  if (opts.workstreamId) modQuery = modQuery.eq("workstream_id", opts.workstreamId);
  const { data: mods, error: modsErr } = await modQuery
    .order("position", { ascending: true });
  if (modsErr) throw modsErr;
  if (!mods || mods.length === 0) {
    return { spawned: 0, skipped: 0, modules: 0 };
  }

  const moduleIds = mods.map((m: any) => m.id);

  // 2. Load templates for those modules.
  const { data: templates, error: tplsErr } = await supabase
    .from("workflow_task_templates")
    .select("*")
    .in("module_id", moduleIds)
    .order("position", { ascending: true });
  if (tplsErr) throw tplsErr;
  if (!templates || templates.length === 0) {
    return { spawned: 0, skipped: 0, modules: mods.length };
  }

  // 3. Collect distinct role ids → preload holders.
  const roleIds = Array.from(
    new Set(
      (templates as any[])
        .map((t) => t.assigned_to_role_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  let holdersByRole: Record<string, string[]> = {};
  if (roleIds.length > 0) {
    const { data: holders } = await supabase
      .from("team_role_holders")
      .select("team_role_id, user_id")
      .in("team_role_id", roleIds);
    holdersByRole = (holders ?? []).reduce<Record<string, string[]>>((acc, h: any) => {
      (acc[h.team_role_id] = acc[h.team_role_id] ?? []).push(h.user_id);
      return acc;
    }, {});
  }

  // Out-of-office coverage: if an auto-assignee is OOO with a delegate,
  // route the task to the delegate instead (Carol -> Steve). Best-effort —
  // the columns arrive with migration 0013; absence degrades gracefully.
  let oooByUser: Record<string, { until: string; delegate: string | null }> = {};
  try {
    const { data: oooRows } = await supabase
      .from("org_members")
      .select("user_id, ooo_until, ooo_delegate_user_id")
      .eq("org_id", opts.orgId)
      .not("ooo_until", "is", null);
    const now = Date.now();
    for (const r of (oooRows ?? []) as any[]) {
      if (r.ooo_until && new Date(r.ooo_until).getTime() > now) {
        oooByUser[r.user_id] = { until: r.ooo_until, delegate: r.ooo_delegate_user_id ?? null };
      }
    }
  } catch {
    /* pre-0013 — no OOO routing */
  }
  const routeAroundOoo = (userId: string | null): { user: string | null; covered: string | null } => {
    if (!userId) return { user: null, covered: null };
    const o = oooByUser[userId];
    if (!o) return { user: userId, covered: null };
    if (o.delegate && !oooByUser[o.delegate]) return { user: o.delegate, covered: userId };
    return { user: null, covered: userId }; // OOO without usable delegate -> role queue
  };

  // 4. Idempotency: figure out which (study, stage_key, title) tuples already
  //    have an OPEN task spawned from this configuration. We avoid duplicates
  //    when an admin re-enters the same stage manually.
  const { data: existing } = await supabase
    .from("tasks")
    .select("title")
    .eq("study_id", opts.studyId)
    .eq("stage_key", opts.stageKey)
    .in("status", ["open", "in_progress"]);
  const existingTitles = new Set<string>(
    (existing ?? []).map((r: any) => (r.title as string).toLowerCase())
  );

  // 5. Build the inserts.
  type Insert = {
    org_id: string;
    study_id: string;
    stage_key: string;
    kind: string;
    title: string;
    description: string | null;
    status: "open";
    due_at: string | null;
    assigned_to_user_id: string | null;
    assigned_to_role_id: string | null;
    handoff_to_role_id: string | null;
    created_by: string;
    position: number;
  };
  const inserts: Insert[] = [];
  let skipped = 0;
  for (const tpl of templates as any[]) {
    if (existingTitles.has((tpl.title as string).toLowerCase())) {
      skipped += 1;
      continue;
    }
    const due =
      typeof tpl.due_offset_days === "number"
        ? new Date(enteredAt.getTime() + tpl.due_offset_days * 86400000).toISOString()
        : null;
    // Assignment rule (per product spec): exactly ONE person holds the role
    // -> auto-assign to them. Multiple holders -> leave unassigned on the
    // role; a manager picks the person from the Inbox role queue.
    let assignedUser: string | null = null;
    const roleHolders = tpl.assigned_to_role_id ? holdersByRole[tpl.assigned_to_role_id] ?? [] : [];
    if (roleHolders.length === 1) {
      assignedUser = roleHolders[0];
    }
    const routed = routeAroundOoo(assignedUser);
    assignedUser = routed.user;
    const coveredFor = routed.covered;
    inserts.push({
      org_id: opts.orgId,
      study_id: opts.studyId,
      stage_key: opts.stageKey,
      kind: tpl.kind ?? "manual",
      title: tpl.title,
      status: "open",
      due_at: due,
      assigned_to_user_id: assignedUser,
      assigned_to_role_id: tpl.assigned_to_role_id ?? null,
      handoff_to_role_id: tpl.handoff_to_role_id ?? null,
      created_by: opts.actorUserId,
      description: coveredFor && !tpl.description
        ? "Covering while the assigned holder is out of office."
        : (tpl.description ?? null),
      position: tpl.position ?? 0,
    });
  }

  if (inserts.length === 0) {
    return { spawned: 0, skipped, modules: mods.length };
  }

  const { error: insErr } = await supabase.from("tasks").insert(inserts as any);
  if (insErr) throw insErr;
  return { spawned: inserts.length, skipped, modules: mods.length };
}
