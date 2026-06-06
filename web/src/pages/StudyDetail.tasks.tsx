import { friendlyError } from "../lib/errors";
import { fmtDate } from "../lib/dates";
import { KindPill } from "./Inbox";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { uniqueChannelName } from "../lib/uniqueChannel";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import type { TaskRow, PipelineStageRow, TeamRoleRow, TeamRoleHolderRow } from "../lib/types";
import { useOrgTable } from "../lib/useOrgTable";
import { escalateTask } from "../lib/escalation";
import { maybeSpawnHandoffReceipt } from "../lib/handoff";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";

import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/EmptyState";
import { WorkStreamPanel } from "./StudyDetail.workstream";

/** TasksTab — per-study task list inside StudyDetail. Shares semantics with
 *  Inbox (complete, skip, reopen, manual add) but filtered to this study. */
export function TasksTab({
  studyId,
  stages,
  stageKey,
  onNavigate,
}: {
  studyId: string;
  stages: PipelineStageRow[];
  stageKey: string | null;
  onNavigate?: (h: string) => void;
}) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const rolesTbl = useOrgTable<TeamRoleRow>("team_roles");
  const holdersTbl = useOrgTable<TeamRoleHolderRow>("team_role_holders");

  const escalate = async (t: TaskRow) => {
    if (!orgId || !userId || t.kind === "escalation") return;
    if (!(await confirmDialog({ title: "Escalate task", message: `Escalate "${t.title}"? A new escalation task routes to the team's senior role; this task stays open.`, confirmLabel: "Escalate", danger: true }))) return;
    try {
      const res = await escalateTask({
        orgId, task: t, reason: "Escalated from study tasks",
        actorUserId: userId, actorEmail: userEmail,
        roles: rolesTbl.rows, holders: holdersTbl.rows,
      });
      toast.success(stamped(res.targetRole ? `Escalated to ${res.targetRole.title}` : "Escalated to admin queue"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn\u2019t escalate"));
    }
  };

  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStage, setNewStage] = useState<string>(stageKey ?? "");
  const [newDue, setNewDue] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("study_id", studyId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) setError(error.message);
      else setTasks((data ?? []) as TaskRow[]);
    })();

    const ch = supabase
      .channel(uniqueChannelName(`tasks-${studyId}`))
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "tasks", filter: `study_id=eq.${studyId}` },
        (payload: any) => {
          if (cancelled) return;
          setTasks((prev) => {
            if (!prev) return prev;
            if (payload.eventType === "INSERT") return [payload.new as TaskRow, ...prev];
            if (payload.eventType === "UPDATE")
              return prev.map((t) => (t.id === payload.new.id ? (payload.new as TaskRow) : t));
            if (payload.eventType === "DELETE")
              return prev.filter((t) => t.id !== payload.old.id);
            return prev;
          });
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [studyId]);

  const visibleTasks = useMemo(() => {
    if (!tasks) return null;
    let xs = tasks;
    if (!showDone) xs = xs.filter((t) => t.status === "open" || t.status === "in_progress");
    const now = Date.now();
    return [...xs].sort((a, b) => {
      const aDue = a.due_at ? new Date(a.due_at).getTime() : null;
      const bDue = b.due_at ? new Date(b.due_at).getTime() : null;
      const aOver = aDue !== null && aDue < now && (a.status === "open" || a.status === "in_progress");
      const bOver = bDue !== null && bDue < now && (b.status === "open" || b.status === "in_progress");
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (aDue !== bDue) {
        if (aDue === null) return 1;
        if (bDue === null) return -1;
        return aDue - bDue;
      }
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [tasks, showDone]);

  const addTask = async () => {
    if (!newTitle.trim() || !orgId || !userId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          org_id: orgId,
          study_id: studyId,
          stage_key: newStage || null,
          kind: "manual",
          title: newTitle.trim(),
          status: "open",
          due_at: newDue ? new Date(newDue).toISOString() : null,
          assigned_to_user_id: userId,
          created_by: userId,
        } as any)
        .select("*")
        .single();
      if (error) throw error;
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "task", entityId: (data as any).id,
        action: "task_created",
        payload: { title: newTitle.trim(), study_id: studyId, stage_key: newStage || null },
      });
      toast.success(stamped("Task added"));
      setNewTitle("");
      setNewDue("");
      setAdding(false);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add task"));
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (t: TaskRow, status: TaskRow["status"], audit: string) => {
    try {
      const patch: Partial<TaskRow> = { status };
      if (status === "done") {
        patch.completed_at = new Date().toISOString();
        patch.completed_by = userId;
      }
      if (status === "open") {
        patch.completed_at = null;
        patch.completed_by = null;
      }
      const { error } = await supabase.from("tasks").update(patch as any).eq("id", t.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "task", entityId: t.id,
          action: audit,
          payload: { title: t.title, study_id: studyId },
        });
      }
      if (status === "done" && orgId && userId) {
        const handoff = await maybeSpawnHandoffReceipt({ task: t, orgId, actorUserId: userId, actorEmail: userEmail ?? null });
        if (handoff.spawned) toast.success(stamped(`Handoff sent to ${handoff.toRoleTitle ?? "the receiving role"}`));
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Update failed"));
    }
  };

  if (error) {
    return (
      <Card>
        <EmptyState iconName="alert" title="Couldn't load tasks" sub={error} />
      </Card>
    );
  }

  if (tasks === null) {
    return <div className="text-sm text-slate-500">Loading tasks…</div>;
  }

  return (
    <div>
      {/* What's configured for this stage */}
      <WorkStreamPanel
        studyId={studyId}
        stageKey={stageKey}
        stage={stages.find((s) => s.key === stageKey) ?? null}
        onNavigate={onNavigate}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="accent-brand-500 w-4 h-4"
          />
          Show completed
        </label>
        <Button
          size="sm"
          variant={adding ? "ghost" : "primary"}
          onClick={() => {
            setAdding((o) => !o);
            setNewStage(stageKey ?? "");
          }}
        >
          {adding ? "Cancel" : (<><Icon name="plus" size={12} /> Add task</>)}
        </Button>
      </div>

      {/* Inline composer */}
      {adding && (
        <Card primary className="mb-3">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center">
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) void addTask();
              }}
              placeholder="What needs to happen?"
            />
            <Select value={newStage} onChange={(e) => setNewStage(e.target.value)}>
              <option value="">— No stage —</option>
              {stages.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              placeholder="Due"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={addTask}
              disabled={!newTitle.trim() || saving}
            >
              {saving ? "Adding…" : "Add"}
            </Button>
          </div>
        </Card>
      )}

      {visibleTasks && visibleTasks.length === 0 && (
        <Card>
          <EmptyState
            iconName="inbox"
            title={showDone ? "No tasks on this study" : "No open tasks"}
            sub={
              isAdmin
                ? "Add a manual task above, or wire workflow modules to spawn tasks on stage advance (coming)."
                : "When a task is created for this study, it'll appear here."
            }
          />
        </Card>
      )}

      {tasks && tasks.length > 0 && (() => {
        const total = tasks.length;
        const done = tasks.filter((t) => t.status === "done").length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return (
          <div className="mb-3 flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-brand-gradient rounded-full transition-all" style={{ width: pct + "%" }} />
            </div>
            <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{done} of {total} done</span>
          </div>
        );
      })()}

      {visibleTasks && visibleTasks.length > 0 && (() => {
        // Group into a checklist by stage, in pipeline order; no-stage last.
        const order = new Map(stages.map((s, i) => [s.key, i]));
        const groups: { key: string | null; label: string; color: string | null; items: typeof visibleTasks }[] = [];
        const byKey = new Map<string, typeof visibleTasks>();
        for (const t of visibleTasks) {
          const k = t.stage_key ?? "__none__";
          if (!byKey.has(k)) byKey.set(k, [] as any);
          byKey.get(k)!.push(t);
        }
        const keys = [...byKey.keys()].sort((a, b) => {
          if (a === "__none__") return 1;
          if (b === "__none__") return -1;
          return (order.get(a) ?? 999) - (order.get(b) ?? 999);
        });
        for (const k of keys) {
          const st = k === "__none__" ? null : stages.find((s) => s.key === k) ?? null;
          groups.push({ key: k === "__none__" ? null : k, label: st?.label ?? "No stage", color: st?.color ?? null, items: byKey.get(k)! });
        }
        return (
          <div className="space-y-3">
            {groups.map((g) => {
              const gDone = g.items.filter((t) => t.status === "done" || t.status === "skipped").length;
              return (
                <Card key={g.key ?? "none"} flush>
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
                    {g.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />}
                    <span className="text-xs font-semibold text-slate-700">{g.label}</span>
                    <span className="ml-auto text-[11px] font-mono text-slate-400">{gDone}/{g.items.length}</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
            {g.items.map((t) => {
              const stage = t.stage_key ? stages.find((s) => s.key === t.stage_key) : null;
              const due = t.due_at ? new Date(t.due_at) : null;
              const overdue =
                due ? due.getTime() < Date.now() && (t.status === "open" || t.status === "in_progress") : false;
              const isOpen = t.status === "open" || t.status === "in_progress";
              return (
                <li
                  key={t.id}
                  className={
                    "px-4 py-3 flex items-center gap-3 group " +
                    (isOpen ? "" : "opacity-60")
                  }
                >
                  {isOpen ? (
                    <input
                      type="checkbox"
                      onChange={() => updateStatus(t, "done", "task_completed")}
                      className="accent-brand-500 w-4 h-4 cursor-pointer flex-shrink-0"
                      title="Complete"
                    />
                  ) : t.status === "done" ? (
                    <Icon name="check" size={14} className="text-emerald-600 flex-shrink-0" />
                  ) : (
                    <Icon name="x" size={14} className="text-slate-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className={
                        "text-sm font-semibold text-slate-900 truncate " +
                        (isOpen ? "" : "line-through")
                      }
                    >
                      {t.title}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                      {t.kind !== "manual" && <KindPill kind={t.kind} />}
                      {due && (
                        <span
                          className={
                            "font-mono " + (overdue ? "text-red-700 font-bold" : "text-slate-500")
                          }
                        >
                          {overdue ? "Overdue " : "Due "}
                          {fmtDate(due)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition">
                    {isOpen && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(t, "skipped", "task_skipped")}>
                          Skip
                        </Button>
                        {t.kind !== "escalation" && (
                          <Button size="sm" variant="ghost" onClick={() => escalate(t)} title="Escalate up the role hierarchy">
                            <Icon name="alert" size={11} />
                          </Button>
                        )}
                      </>
                    )}
                    {!isOpen && isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => updateStatus(t, "open", "task_reopened")}>
                        Reopen
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
                  </ul>
                </Card>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
