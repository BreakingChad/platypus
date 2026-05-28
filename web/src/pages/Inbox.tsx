import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import type {
  TaskRow,
  TaskStatus,
  StudyRow,
  PipelineStageRow,
  TeamRoleRow,
  TeamRoleHolderRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** Inbox — every task assigned to the current user, plus role-tasks for roles
 *  they hold. Triage in one place: filter, complete, skip, jump into the
 *  study, or add a quick manual task (admin only).
 */

type Tab = "mine" | "team" | "all";

export function Inbox({ onNavigate }: { onNavigate: (h: string) => void }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;

  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const roles = useOrgTable<TeamRoleRow>("team_roles");
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders");

  const [tab, setTab] = useState<Tab>("mine");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "open_only">("open_only");
  const [addingTask, setAddingTask] = useState(false);

  // Which roles does the current user hold?
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

  const roleById = useMemo(() => {
    const m: Record<string, TeamRoleRow> = {};
    for (const r of roles.rows) m[r.id] = r;
    return m;
  }, [roles.rows]);

  const filtered = useMemo(() => {
    let xs = tasks.rows;
    // Tab scope
    if (tab === "mine") {
      xs = xs.filter((t) => t.assigned_to_user_id === userId);
    } else if (tab === "team") {
      xs = xs.filter(
        (t) => t.assigned_to_role_id != null && myRoleIds.has(t.assigned_to_role_id)
      );
    }
    // Status filter
    if (statusFilter === "open_only") {
      xs = xs.filter((t) => t.status === "open" || t.status === "in_progress");
    } else {
      xs = xs.filter((t) => t.status === statusFilter);
    }
    // Sort: overdue first by due_at, then no-due, then by created_at
    const now = Date.now();
    return [...xs].sort((a, b) => {
      const aDue = a.due_at ? new Date(a.due_at).getTime() : null;
      const bDue = b.due_at ? new Date(b.due_at).getTime() : null;
      const aOver = aDue !== null && aDue < now;
      const bOver = bDue !== null && bDue < now;
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (aDue !== bDue) {
        if (aDue === null) return 1;
        if (bDue === null) return -1;
        return aDue - bDue;
      }
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [tasks.rows, tab, statusFilter, userId, myRoleIds]);

  const counts = useMemo(() => {
    const mine = tasks.rows.filter(
      (t) =>
        t.assigned_to_user_id === userId &&
        (t.status === "open" || t.status === "in_progress")
    ).length;
    const team = tasks.rows.filter(
      (t) =>
        t.assigned_to_role_id != null &&
        myRoleIds.has(t.assigned_to_role_id) &&
        (t.status === "open" || t.status === "in_progress")
    ).length;
    const all = tasks.rows.filter((t) => t.status === "open" || t.status === "in_progress")
      .length;
    return { mine, team, all };
  }, [tasks.rows, userId, myRoleIds]);

  const completeTask = async (t: TaskRow) => {
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
      toast.success(`Completed: ${t.title}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't complete task");
    }
  };

  const skipTask = async (t: TaskRow) => {
    if (!window.confirm(`Skip "${t.title}"? Mark it as not-applicable.`)) return;
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "skipped" })
        .eq("id", t.id);
      if (error) throw error;
      toast.success(`Skipped: ${t.title}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't skip task");
    }
  };

  const reopenTask = async (t: TaskRow) => {
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "open", completed_at: null, completed_by: null })
        .eq("id", t.id);
      if (error) throw error;
      toast.success(`Reopened: ${t.title}`);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't reopen");
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Inbox"
        subtitle="Tasks routed to you and to the roles you hold. Triage in one place — complete, skip, or open the study to dig in."
        actions={
          isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setAddingTask(true)}>
              <Icon name="plus" size={12} /> New task
            </Button>
          )
        }
      />

      {/* Tabs */}
      <div className="mt-6 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([
          ["mine", "Mine", counts.mine],
          ["team", "My team's roles", counts.team],
          ...(isAdmin ? [["all", "All open", counts.all] as const] : []),
        ] as [Tab, string, number][]).map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={
              "px-3 py-1.5 rounded-md text-sm font-semibold transition flex items-center gap-1.5 " +
              (tab === k
                ? "bg-brand-gradient text-white shadow"
                : "text-slate-600 hover:text-slate-900")
            }
          >
            {label}
            <span
              className={
                "text-[10px] font-mono " + (tab === k ? "text-white/80" : "text-slate-400")
              }
            >
              {n}
            </span>
          </button>
        ))}

        <div className="ml-3 pl-3 border-l border-slate-200 flex items-center gap-2">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-xs py-1 px-2"
          >
            <option value="open_only">Open + in progress</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="skipped">Skipped</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </div>

      {/* List */}
      <Card flush className="mt-4 overflow-hidden">
        {tasks.error && (
          <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <strong>Error:</strong> {tasks.error}
          </div>
        )}

        {filtered.length === 0 && !tasks.loading && (
          <EmptyState
            iconName="inbox"
            title={tab === "mine" ? "Nothing in your inbox" : "No tasks match"}
            sub={
              tab === "mine"
                ? "When tasks are assigned to you they'll appear here. Quiet inboxes are a feature."
                : "Adjust the filters above or check back later."
            }
            action={
              isAdmin && (
                <Button variant="primary" onClick={() => setAddingTask(true)}>
                  <Icon name="plus" size={12} /> Add a task
                </Button>
              )
            }
          />
        )}

        {tasks.loading && filtered.length === 0 && (
          <div className="p-6 text-sm text-slate-500">Loading tasks…</div>
        )}

        {filtered.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {filtered.map((t) => {
              const study = t.study_id ? studyById[t.study_id] : null;
              const stage = t.stage_key ? stageByKey[t.stage_key] : null;
              const role = t.assigned_to_role_id ? roleById[t.assigned_to_role_id] : null;
              const due = t.due_at ? new Date(t.due_at) : null;
              const overdue = due ? due.getTime() < Date.now() && t.status !== "done" : false;
              return (
                <li
                  key={t.id}
                  className={
                    "px-4 py-3 grid grid-cols-[24px_1fr_140px_140px_180px] gap-3 items-center group " +
                    (t.status === "done" || t.status === "skipped"
                      ? "opacity-60"
                      : "")
                  }
                >
                  {/* Checkbox / status */}
                  <div className="flex items-center justify-center">
                    {t.status === "open" || t.status === "in_progress" ? (
                      <input
                        type="checkbox"
                        onChange={() => completeTask(t)}
                        className="accent-brand-500 w-4 h-4 cursor-pointer"
                        title="Complete"
                      />
                    ) : t.status === "done" ? (
                      <Icon name="check" size={14} className="text-emerald-600" />
                    ) : (
                      <Icon name="x" size={14} className="text-slate-400" />
                    )}
                  </div>
                  {/* Title + description */}
                  <div className="min-w-0">
                    <div
                      className={
                        "text-sm font-semibold text-slate-900 truncate " +
                        (t.status === "done" || t.status === "skipped" ? "line-through" : "")
                      }
                    >
                      {t.title}
                    </div>
                    {(study || stage) && (
                      <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
                        {study && (
                          <button
                            onClick={() => onNavigate(`#/studies/${study.id}`)}
                            className="hover:text-brand-700 transition font-mono"
                            title={study.title}
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
                        {role && (
                          <span className="text-slate-400">· role: {role.title}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Kind */}
                  <div>
                    <Pill tone={t.kind === "escalation" ? "danger" : "neutral"}>{t.kind}</Pill>
                  </div>
                  {/* Due */}
                  <div className="text-xs">
                    {due ? (
                      <span
                        className={
                          "font-mono " +
                          (overdue ? "text-red-700 font-bold" : "text-slate-600")
                        }
                      >
                        {overdue ? "Overdue " : "Due "}
                        {due.toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">No due date</span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1.5 justify-end opacity-50 group-hover:opacity-100 transition">
                    {(t.status === "open" || t.status === "in_progress") && (
                      <>
                        <Button size="sm" variant="primary" onClick={() => completeTask(t)}>
                          Complete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => skipTask(t)}>
                          Skip
                        </Button>
                      </>
                    )}
                    {(t.status === "done" || t.status === "skipped") && isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => reopenTask(t)}>
                        Reopen
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {addingTask && orgId && userId && (
        <NewTaskModal
          orgId={orgId}
          userId={userId}
          studies={studies.rows}
          stages={stages.rows}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            toast.success("Task added");
            setAddingTask(false);
          }}
        />
      )}
    </div>
  );
}

/* ---------- New Task modal (admin) ---------- */

function NewTaskModal({
  orgId,
  userId,
  studies,
  stages,
  onClose,
  onCreated,
}: {
  orgId: string;
  userId: string;
  studies: StudyRow[];
  stages: PipelineStageRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [studyId, setStudyId] = useState<string>("");
  const [stageKey, setStageKey] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // When a study is picked, default the stage to that study's current stage.
  useEffect(() => {
    if (!studyId) return;
    const s = studies.find((x) => x.id === studyId);
    if (s && s.stage_key && !stageKey) setStageKey(s.stage_key);
  }, [studyId, studies, stageKey]);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("tasks").insert({
        org_id: orgId,
        study_id: studyId || null,
        stage_key: stageKey || null,
        kind: "manual",
        title: title.trim(),
        status: "open",
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        assigned_to_user_id: userId,
        created_by: userId,
      } as any);
      if (error) throw error;
      onCreated();
    } catch (e: any) {
      alert(e?.message || "Couldn't create task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">New task</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Assigned to you. Wire to a study + stage to surface it in context.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Title
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with sponsor on budget"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) void submit();
              }}
            />
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Study (optional)
            </span>
            <Select value={studyId} onChange={(e) => setStudyId(e.target.value)}>
              <option value="">— None —</option>
              {studies
                .filter((s) => !s.closed)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.title}
                  </option>
                ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Stage (optional)
            </span>
            <Select value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
              <option value="">— None —</option>
              {stages.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Due date (optional)
            </span>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim() || saving}>
            {saving ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
    </div>
  );
}
