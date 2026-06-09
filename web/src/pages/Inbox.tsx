import { friendlyError } from "../lib/errors";
import { fmtDate, fmtDay } from "../lib/dates";
import { PageBlocks } from "../blocks/PageBlocks";
import { useModalA11y } from "../lib/useModalA11y";
import { dueBucket, BUCKET_LABELS, type DueBucket } from "../lib/inboxBuckets";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { actionTypeByKey, recordDocumentSignature } from "../lib/documents";
import { escalateTask } from "../lib/escalation";
import { maybeSpawnHandoffReceipt } from "../lib/handoff";
import { useStickyState, useStickyStateWithRoleDefault } from "../lib/useStickyState";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import type {
  TaskRow,
  TaskStatus,
  StudyRow,
  PipelineStageRow,
  TeamRoleRow,
  TeamRoleHolderRow,
  DocumentRow,
  SiteRow,
  StudySiteRow,
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

export function Inbox({
  onNavigate,
  fixedTab,
}: {
  onNavigate: (h: string) => void;
  /** Lock the queue to one tab and hide the tab bar (Team tasks page). */
  fixedTab?: Tab;
}) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const roles = useOrgTable<TeamRoleRow>("team_roles");
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders");
  const documents = useOrgTable<DocumentRow>("documents", { realtime: true });

  const { configFor } = useResolvedConfig();
  const [tabSticky, setTab] = useStickyStateWithRoleDefault<Tab>(
    "inbox/tab", "mine", (configFor("inbox").options ?? {}).defaultTab as Tab | undefined
  );
  const tab: Tab = fixedTab ?? tabSticky;
  const [statusFilter, setStatusFilter] = useStickyState<TaskStatus | "open_only">("inbox/statusFilter", "open_only");
  const [q, setQ] = useState("");                                                      // search resets per session
  const [kindFilter, setKindFilter] = useStickyState<string>("inbox/kindFilter", "all");
  const [overdueOnly, setOverdueOnly] = useStickyState<boolean>("inbox/overdueOnly", false);
  const [sortMode, setSortMode] = useStickyState<"due" | "created" | "title" | "study">("inbox/sortMode", "due");
  const [addingTask, setAddingTask] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // ≥xl the reading pane is DOCKED (Outlook model); below xl it's an overlay.
  const isXl = useMediaQuery("(min-width: 1280px)");
  const [signing, setSigning] = useState<{ task: TaskRow; doc: DocumentRow } | null>(null);
  const [coveringFor, setCoveringFor] = useState<string[]>([]);

  // Am I covering for anyone? (their OOO delegate, still active)
  useEffect(() => {
    if (!orgId || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("org_members")
          .select("user_id, ooo_until")
          .eq("org_id", orgId)
          .eq("ooo_delegate_user_id", userId)
          .not("ooo_until", "is", null);
        if (cancelled || error) return;
        const active = (data ?? []).filter(
          (r: any) => new Date(r.ooo_until).getTime() > Date.now()
        );
        if (active.length === 0) {
          setCoveringFor([]);
          return;
        }
        const ids = active.map((r: any) => r.user_id);
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", ids);
        if (!cancelled) {
          setCoveringFor(
            ids.map((id: string) => {
              const p = (profs ?? []).find((x: any) => x.id === id);
              return p?.full_name || p?.email || "a teammate";
            })
          );
        }
      } catch {
        /* pre-0013 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  const escalate = async (t: TaskRow) => {
    if (!orgId || !userId) return;
    if (t.kind === "escalation") {
      toast.error("This is already an escalation");
      return;
    }
    if (!(await confirmDialog({ title: "Escalate task", message: `Escalate "${t.title}" up the role hierarchy? A new escalation task is created and routed to the team's senior role; this task stays open.`, confirmLabel: "Escalate", danger: true }))) return;
    try {
      const res = await escalateTask({
        orgId, task: t, reason: "Escalated from Inbox",
        actorUserId: userId, actorEmail: userEmail,
        roles: roles.rows, holders: holders.rows,
      });
      toast.success(stamped(res.targetRole ? `Escalated to ${res.targetRole.title}` : "Escalated to admin queue"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn\u2019t escalate"));
    }
  };

  // Which roles does the current user hold?
  const myRoleIds = useMemo(() => {
    if (!userId) return new Set<string>();
    return new Set(holders.rows.filter((h) => h.user_id === userId).map((h) => h.team_role_id));
  }, [holders.rows, userId]);

  // Teams I belong to (via the roles I hold) — for team-queue handoffs (0041).
  const myTeamIds = useMemo(() => {
    if (!userId) return new Set<string>();
    return new Set(roles.rows.filter((r) => myRoleIds.has(r.id)).map((r) => r.team_id));
  }, [roles.rows, myRoleIds, userId]);

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

  const docById = useMemo(() => {
    const m: Record<string, DocumentRow> = {};
    for (const d of documents.rows) m[d.id] = d;
    return m;
  }, [documents.rows]);

  const filtered = useMemo(() => {
    let xs = tasks.rows;
    // Tab scope
    if (tab === "mine") {
      xs = xs.filter((t) => t.assigned_to_user_id === userId);
    } else if (tab === "team") {
      xs = xs.filter(
        (t) =>
          (t.assigned_to_role_id != null && myRoleIds.has(t.assigned_to_role_id)) ||
          (t.assigned_to_team_id != null && myTeamIds.has(t.assigned_to_team_id))
      );
    }
    // Status filter
    if (statusFilter === "open_only") {
      xs = xs.filter((t) => t.status === "open" || t.status === "in_progress");
    } else {
      xs = xs.filter((t) => t.status === statusFilter);
    }
    // Kind filter ("action" = document send-for-action tasks)
    if (kindFilter === "action") {
      xs = xs.filter((t) => t.action_type != null);
    } else if (kindFilter === "manual") {
      // "Tasks" covers plain manual + legacy date milestones (identical at runtime)
      xs = xs.filter((t) => (t.kind === "manual" || t.kind === "date") && t.action_type == null);
    } else if (kindFilter !== "all") {
      xs = xs.filter((t) => t.kind === kindFilter && t.action_type == null);
    }
    // Overdue only
    const now = Date.now();
    if (overdueOnly) {
      xs = xs.filter(
        (t) => t.due_at && new Date(t.due_at).getTime() < now && t.status !== "done" && t.status !== "skipped"
      );
    }
    // Search — title, description, study code/title
    const needle = q.trim().toLowerCase();
    if (needle) {
      xs = xs.filter((t) => {
        const study = t.study_id ? studyById[t.study_id] : null;
        return (
          t.title.toLowerCase().includes(needle) ||
          (t.description ?? "").toLowerCase().includes(needle) ||
          (study?.code ?? "").toLowerCase().includes(needle) ||
          (study?.title ?? "").toLowerCase().includes(needle)
        );
      });
    }
    // Sort
    return [...xs].sort((a, b) => {
      if (sortMode === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      if (sortMode === "title") return a.title.localeCompare(b.title);
      if (sortMode === "study") {
        const ac = a.study_id ? studyById[a.study_id]?.code ?? "" : "";
        const bc = b.study_id ? studyById[b.study_id]?.code ?? "" : "";
        if (ac !== bc) return ac.localeCompare(bc);
        return (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
      }
      // "due" — overdue first by due_at, then no-due, then newest
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
  }, [tasks.rows, tab, statusFilter, userId, myRoleIds, myTeamIds, kindFilter, overdueOnly, q, sortMode, studyById]);

  // Outlook-style due-date grouping — only in the default sort, only for
  // open work (a Done list grouped by due date reads as noise).
  type ListItem = { type: "header"; label: string } | { type: "task"; task: TaskRow };
  const withGroupHeaders = useMemo<ListItem[]>(() => {
    if (sortMode !== "due" || statusFilter !== "open_only") {
      return filtered.map((t) => ({ type: "task" as const, task: t }));
    }
    const out: ListItem[] = [];
    let current: DueBucket | null = null;
    for (const t of filtered) {
      const b = dueBucket(t.due_at);
      if (b !== current) {
        current = b;
        out.push({ type: "header", label: BUCKET_LABELS[b] });
      }
      out.push({ type: "task", task: t });
    }
    return out;
  }, [filtered, sortMode, statusFilter]);

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
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "task", entityId: t.id,
          action: "task_completed",
          payload: { title: t.title, study_id: t.study_id, stage_key: t.stage_key },
        });
      }
      toast.success(stamped(`Completed: ${t.title}`));
      if (orgId && userId) {
        const handoff = await maybeSpawnHandoffReceipt({ task: t, orgId, actorUserId: userId, actorEmail: userEmail ?? null });
        if (handoff.spawned) toast.success(stamped(`Handoff sent to ${handoff.toTeamName ?? handoff.toRoleTitle ?? "the receiving team"}`));
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't complete task"));
    }
  };

  const skipTask = async (t: TaskRow) => {
    if (!(await confirmDialog({ title: "Skip task", message: `Skip "${t.title}"? It will be marked not-applicable.`, confirmLabel: "Skip" }))) return;
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "skipped" })
        .eq("id", t.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "task", entityId: t.id,
          action: "task_skipped",
          payload: { title: t.title, study_id: t.study_id },
        });
      }
      toast.success(stamped(`Skipped: ${t.title}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't skip task"));
    }
  };

  const reopenTask = async (t: TaskRow) => {
    try {
      const { error } = await supabase
        .from("tasks")
        .update({ status: "open", completed_at: null, completed_by: null })
        .eq("id", t.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "task", entityId: t.id,
          action: "task_reopened",
          payload: { title: t.title },
        });
      }
      toast.success(stamped(`Reopened: ${t.title}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't reopen"));
    }
  };

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="Inbox"
        subtitle="Tasks routed to you and to the roles you hold. Triage in one place — complete, skip, or open the study to dig in."
        actions={
          isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setAddingTask(true)}>
              <Icon name="plus" size={12} /> Send task
            </Button>
          )
        }
      />

      <PageBlocks pageKey="inbox" region="top" navigate={onNavigate} />

      {coveringFor.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2 text-sm text-amber-800">
          <Icon name="users" size={14} className="flex-shrink-0" />
          <span>
            You're covering for <strong>{coveringFor.join(", ")}</strong> while they're out — their
            newly assigned work routes here.
          </span>
        </div>
      )}

      {/* TOOLBAR — one line: scope · search · type · status · sort · overdue */}
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className={(fixedTab ? "hidden " : "") + "inline-flex rounded-lg border border-slate-200 bg-white p-0.5"}>
          {([
            ["mine", "Mine", counts.mine],
            ["team", "My team", counts.team],
            ...(isAdmin ? [["all", "All open", counts.all] as const] : []),
          ] as [Tab, string, number][]).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "px-3 py-2 rounded-md text-sm font-semibold transition flex items-center gap-1.5 " +
                (tab === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
              }
            >
              {label}
              <span className={"text-[10px] font-mono " + (tab === k ? "text-white/80" : "text-slate-400")}>{n}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, studies…"
            aria-label="Search tasks"
          />
        </div>
        <div className="w-48">
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Task type">
            <option value="all">All types ({tasks.rows.length})</option>
            <option value="action">Sign-offs & reviews ({tasks.rows.filter((t) => t.action_type != null).length})</option>
            <option value="handoff">Handoffs ({tasks.rows.filter((t) => t.kind === "handoff" && t.action_type == null).length})</option>
            <option value="escalation">Escalations ({tasks.rows.filter((t) => t.kind === "escalation" && t.action_type == null).length})</option>
            <option value="manual">Tasks ({tasks.rows.filter((t) => (t.kind === "manual" || t.kind === "date") && t.action_type == null).length})</option>
          </Select>
        </div>
        <div className="w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} aria-label="Status filter">
            <option value="open_only">Open + in progress</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="skipped">Skipped</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as any)}
            aria-label="Sort tasks"
            title="Due (smart) groups by due date; the others are flat sorts"
          >
            <option value="due">Sort: Due (smart)</option>
            <option value="created">Sort: Newest</option>
            <option value="title">Sort: Title A–Z</option>
            <option value="study">Sort: Study</option>
          </Select>
        </div>
        <button
          onClick={() => setOverdueOnly(!overdueOnly)}
          className={
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition " +
            (overdueOnly
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
          }
          aria-pressed={overdueOnly}
          title="Only overdue open work"
        >
          <span className={"w-1.5 h-1.5 rounded-full " + (overdueOnly ? "bg-red-500" : "bg-slate-300")} />
          Overdue
        </button>
      </div>

      {/* List */}
      {/* SPLIT VIEW (≥ xl): comfort-width list + docked reading pane */}
      <div className="mt-4 xl:grid xl:grid-cols-[minmax(420px,640px)_minmax(0,1fr)] xl:gap-4 xl:items-start">
      <Card flush className="overflow-hidden">
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
          <div className="p-6"><Loader label="Loading tasks…" /></div>
        )}

        {filtered.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {withGroupHeaders.map((item) => {
              if (item.type === "header") {
                return (
                  <li
                    key={`h-${item.label}`}
                    className={
                      "px-4 py-1.5 text-[11px] font-semibold border-b border-slate-100 " +
                      (item.label === "Overdue" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-500")
                    }
                  >
                    {item.label}
                  </li>
                );
              }
              const t = item.task;
              const study = t.study_id ? studyById[t.study_id] : null;
              const stage = t.stage_key ? stageByKey[t.stage_key] : null;
              const role = t.assigned_to_role_id ? roleById[t.assigned_to_role_id] : null;
              const doc = t.document_id ? docById[t.document_id] : null;
              const at = actionTypeByKey(t.action_type);
              const due = t.due_at ? new Date(t.due_at) : null;
              const overdue = due ? due.getTime() < Date.now() && t.status !== "done" : false;
              return (
                <li
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open task ${t.title}`}
                  onClick={() => setOpenTaskId(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenTaskId(t.id);
                    }
                  }}
                  className={
                    "px-4 py-3 grid grid-cols-[24px_1fr_110px_105px_90px] xl:grid-cols-[24px_1fr_72px] gap-3 items-center group cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-brand-500/30 " +
                    (t.id === openTaskId
                      ? "bg-brand-50/70 border-l-2 border-l-brand-500 "
                      : "hover:bg-brand-50/30 border-l-2 border-l-transparent ") +
                    (t.status === "done" || t.status === "skipped"
                      ? "opacity-60"
                      : "")
                  }
                >
                  {/* Checkbox / status */}
                  <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    {t.status === "open" || t.status === "in_progress" ? (
                      <input
                        type="checkbox"
                        onChange={() => (doc && at ? setSigning({ task: t, doc }) : completeTask(t))}
                        className="accent-brand-500 w-4 h-4 cursor-pointer"
                        title={doc && at ? at.label : "Complete"}
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
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigate(`#/studies/${study.id}`);
                            }}
                            className="hover:text-brand-700 transition font-mono"
                            title={study.title}
                          >
                            {study.code}
                          </button>
                        )}
                        {role && (
                          <span className="text-slate-400">· role: {role.title}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Kind — pane carries it at xl */}
                  <div className="xl:hidden">
                    {at ? (
                      <Pill tone="info">{at.label}</Pill>
                    ) : (
                      <KindPill kind={t.kind} />
                    )}
                  </div>
                  {/* Due — never wraps; compact day at xl */}
                  <div className="text-xs whitespace-nowrap text-right xl:text-right">
                    {t.status === "done" && t.completed_at ? (
                      <span className="font-mono text-emerald-700">
                        <span className="xl:hidden">Done </span>{fmtDay(t.completed_at)}
                      </span>
                    ) : due ? (
                      <span
                        className={
                          "font-mono " +
                          (overdue ? "text-red-700 font-bold" : "text-slate-600")
                        }
                      >
                        <span className="xl:hidden">{overdue ? "Overdue " : "Due "}</span>
                        {fmtDay(due)}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </div>
                  {/* Actions — primary verb on hover; hidden at xl (pane owns them) */}
                  <div
                    className="xl:hidden flex items-center justify-end opacity-0 group-hover:opacity-100 transition"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(t.status === "open" || t.status === "in_progress") &&
                      (doc && at ? (
                        <Button size="sm" variant="primary" onClick={() => setSigning({ task: t, doc })}>
                          {at.verb}
                        </Button>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => completeTask(t)}>
                          Complete
                        </Button>
                      ))}
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

      {/* Docked reading pane — Outlook model; overlay drawer below xl */}
      <div className="hidden xl:flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden sticky top-20 max-h-[calc(100vh-110px)] min-h-[340px]">
        {(() => {
          const sel = filtered.find((x) => x.id === openTaskId) ?? filtered[0] ?? null;
          if (!sel) {
            return (
              <div className="flex-1 flex items-center justify-center p-10 text-center">
                <div>
                  <Icon name="inbox" size={24} className="mx-auto text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600 mt-3">Nothing to read</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-[220px]">
                    Your queue is clear — or the filters above are hiding it.
                  </p>
                </div>
              </div>
            );
          }
          const d = sel.document_id ? docById[sel.document_id] ?? null : null;
          const a = actionTypeByKey(sel.action_type);
          return (
            <TaskDetail
              key={sel.id}
              task={sel}
              study={sel.study_id ? studyById[sel.study_id] ?? null : null}
              stage={sel.stage_key ? stageByKey[sel.stage_key] ?? null : null}
              role={sel.assigned_to_role_id ? roleById[sel.assigned_to_role_id] ?? null : null}
              doc={d}
              isAdmin={isAdmin}
              onNavigate={onNavigate}
              onComplete={() => {
                if (d && a) setSigning({ task: sel, doc: d });
                else void completeTask(sel);
              }}
              onSkip={() => void skipTask(sel)}
              onEscalate={() => void escalate(sel)}
              onReopen={() => void reopenTask(sel)}
            />
          );
        })()}
      </div>
      </div>

      <PageBlocks pageKey="inbox" region="bottom" navigate={onNavigate} />

      {openTaskId && !isXl && (() => {
        const t = tasks.rows.find((x) => x.id === openTaskId);
        if (!t) return null;
        return (
          <TaskDrawer
            task={t}
            study={t.study_id ? studyById[t.study_id] ?? null : null}
            stage={t.stage_key ? stageByKey[t.stage_key] ?? null : null}
            role={t.assigned_to_role_id ? roleById[t.assigned_to_role_id] ?? null : null}
            doc={t.document_id ? docById[t.document_id] ?? null : null}
            isAdmin={isAdmin}
            onNavigate={onNavigate}
            onClose={() => setOpenTaskId(null)}
            onComplete={() => {
              const d = t.document_id ? docById[t.document_id] : null;
              const a = actionTypeByKey(t.action_type);
              setOpenTaskId(null);
              if (d && a) setSigning({ task: t, doc: d });
              else void completeTask(t);
            }}
            onSkip={() => {
              setOpenTaskId(null);
              void skipTask(t);
            }}
            onEscalate={() => {
              setOpenTaskId(null);
              void escalate(t);
            }}
            onReopen={() => void reopenTask(t)}
          />
        );
      })()}

      {addingTask && orgId && userId && (
        <NewTaskModal
          orgId={orgId}
          userId={userId}
          studies={studies.rows}
          stages={stages.rows}
          roles={roles.rows}
          holders={holders.rows}
          userEmail={userEmail}
          onClose={() => setAddingTask(false)}
          onCreated={() => {
            toast.success(stamped("Task sent"));
            setAddingTask(false);
          }}
        />
      )}

      {signing && orgId && userId && (
        <AttestationModal
          signing={signing}
          orgId={orgId}
          signerUserId={userId}
          signerEmail={userEmail}
          onClose={() => setSigning(null)}
          onDone={() => {
            setSigning(null);
            toast.success(stamped("Signature recorded"));
          }}
        />
      )}
    </div>
  );
}

/* ---------- New Task modal (admin) ---------- */

/** TaskDrawer — the Inbox reading pane. Click a row, read the message,
 *  act from the top, see the task's own audit history. Study-down link in
 *  the footer per principle #1. */
export function TaskDetail({
  task: t,
  study,
  stage,
  role,
  doc,
  isAdmin,
  onNavigate,
  onClose,
  onComplete,
  onSkip,
  onEscalate,
  onReopen,
}: {
  task: TaskRow;
  study: StudyRow | null;
  stage: PipelineStageRow | null;
  role: TeamRoleRow | null;
  doc: DocumentRow | null;
  isAdmin: boolean;
  onNavigate: (h: string) => void;
  onClose?: () => void;
  onComplete: () => void;
  /** Omit to hide — read-focused surfaces (Approvals) act inside the study. */
  onSkip?: () => void;
  onEscalate?: () => void;
  onReopen: () => void;
}) {
  const at = actionTypeByKey(t.action_type);
  const due = t.due_at ? new Date(t.due_at) : null;
  const overdue = due ? due.getTime() < Date.now() && t.status !== "done" : false;
  const open = t.status === "open" || t.status === "in_progress";

  const [people, setPeople] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ id: string; action: string; actor_email: string | null; created_at: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = [t.created_by, t.assigned_to_user_id, t.completed_by].filter(Boolean) as string[];
      if (ids.length > 0) {
        const { data } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
        if (!cancelled && data) {
          const m: Record<string, string> = {};
          (data as any[]).forEach((p) => (m[p.id] = p.full_name || p.email));
          setPeople(m);
        }
      }
      const { data: ev } = await supabase
        .from("audit_events")
        .select("id, action, actor_email, created_at")
        .eq("entity_type", "task")
        .eq("entity_id", t.id)
        .order("created_at", { ascending: true })
        .limit(20);
      if (!cancelled) setHistory((ev ?? []) as any[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [t.id, t.status]);

  const who = (id: string | null) => (id ? people[id] ?? "…" : null);

  return (
    <>
        {/* Actions live at the TOP. */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          {open ? (
            <>
              <Button size="sm" variant="primary" onClick={onComplete}>
                {doc && at ? at.verb : "Complete"}
              </Button>
              {onSkip && (
                <Button size="sm" variant="ghost" onClick={onSkip}>
                  Skip
                </Button>
              )}
              {onEscalate && t.kind !== "escalation" && (
                <Button size="sm" variant="ghost" onClick={onEscalate} title="Escalate up the role hierarchy">
                  <Icon name="alert" size={11} /> Escalate
                </Button>
              )}
            </>
          ) : (
            <>
              {t.status === "done" ? <Pill tone="success">done</Pill> : <Pill tone="neutral">{t.status}</Pill>}
              {isAdmin && (
                <Button size="sm" variant="ghost" onClick={onReopen}>
                  Reopen
                </Button>
              )}
            </>
          )}
          <div className="flex-1" />
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-900 transition text-lg leading-none px-1"
              aria-label="Close task"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h2 className={"text-base font-display font-bold text-slate-900 " + (t.status === "done" || t.status === "skipped" ? "line-through" : "")}>
            {t.title}
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {study && (
              <button
                onClick={() => {
                  onClose?.();
                  onNavigate(`#/studies/${study.id}`);
                }}
                className="font-mono text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full px-2 py-0.5 hover:border-emerald-300 transition"
                title={study.title}
              >
                {study.code}
              </button>
            )}
            {stage && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: stage.color }}
              >
                {stage.label}
              </span>
            )}
            {at ? <Pill tone="info">{at.label}</Pill> : <KindPill kind={t.kind} />}
            {t.status === "done" && t.completed_at ? (
              <span className="text-[11px] font-mono text-emerald-700">Done {fmtDate(t.completed_at)}</span>
            ) : due ? (
              <span className={"text-[11px] font-mono " + (overdue ? "text-red-700 font-bold" : "text-slate-500")}>
                {overdue ? "Overdue " : "Due "}
                {fmtDate(due)}
              </span>
            ) : null}
          </div>

          {/* The message */}
          <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            {t.description ? (
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{t.description}</p>
            ) : (
              <p className="text-xs text-slate-400 italic">No details on this task.</p>
            )}
          </div>

          {/* From / To */}
          <dl className="mt-4 space-y-1.5">
            <div className="grid grid-cols-[72px_1fr] gap-2 text-xs">
              <dt className="text-slate-500 font-semibold">From</dt>
              <dd className="text-slate-900">{who(t.created_by) ?? <span className="text-slate-400 italic">workflow</span>}</dd>
            </div>
            <div className="grid grid-cols-[72px_1fr] gap-2 text-xs">
              <dt className="text-slate-500 font-semibold">To</dt>
              <dd className="text-slate-900">
                {who(t.assigned_to_user_id) ?? (role ? `${role.title} (role queue)` : t.assigned_to_team_id ? "Team queue" : <span className="text-slate-400 italic">unassigned</span>)}
                {t.assigned_to_user_id && role ? <span className="text-slate-400"> · via {role.title}</span> : null}
              </dd>
            </div>
            {doc && (
              <div className="grid grid-cols-[72px_1fr] gap-2 text-xs">
                <dt className="text-slate-500 font-semibold">Document</dt>
                <dd className="text-slate-900 truncate">{doc.title}</dd>
              </div>
            )}
            <div className="grid grid-cols-[72px_1fr] gap-2 text-xs">
              <dt className="text-slate-500 font-semibold">Created</dt>
              <dd className="font-mono text-slate-600">{fmtDate(t.created_at)}</dd>
            </div>
          </dl>

          {/* History — the task's own audit slice */}
          <div className="mt-5">
            <div className="text-[11px] font-semibold text-slate-500 mb-1.5">History</div>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No recorded events yet.</p>
            ) : (
              <div className="border-l-2 border-slate-100 pl-3 space-y-1.5">
                {history.map((ev) => (
                  <p key={ev.id} className="text-[11px] text-slate-600">
                    <span className="font-mono text-slate-400">{fmtDate(ev.created_at)}</span>
                    {" · "}
                    {ev.action.replace(/_/g, " ")}
                    {ev.actor_email ? <span className="text-slate-400"> — {ev.actor_email}</span> : null}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {study && (
          <div className="px-4 py-3 border-t border-slate-200">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onClose?.();
                onNavigate(`#/studies/${study.id}`);
              }}
            >
              Open {study.code} — work in the study →
            </Button>
          </div>
        )}
    </>
  );
}

/** Overlay shell for narrow widths — same TaskDetail, focus-trapped. */
function TaskDrawer(props: Parameters<typeof TaskDetail>[0] & { onClose: () => void }) {
  const dlgRef = useModalA11y<HTMLDivElement>(props.onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={props.onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Task — ${props.task.title}`}
        className="h-full w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col"
      >
        <TaskDetail {...props} />
      </div>
    </div>
  );
}

function NewTaskModal({
  orgId,
  userId,
  studies,
  stages,
  roles,
  holders,
  userEmail,
  onClose,
  onCreated,
}: {
  orgId: string;
  userId: string;
  studies: StudyRow[];
  stages: PipelineStageRow[];
  roles: TeamRoleRow[];
  holders: TeamRoleHolderRow[];
  userEmail: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recipient, setRecipient] = useState<"me" | "person" | "role">("me");
  const [personId, setPersonId] = useState<string>("");
  const [personQ, setPersonQ] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [studyId, setStudyId] = useState<string>("");
  const [studyQ, setStudyQ] = useState("");
  const [stageKey, setStageKey] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("");
  const sitesTbl = useOrgTable<SiteRow>("sites", { orderBy: "name" });
  const studySitesTbl = useOrgTable<StudySiteRow>("study_sites", {});
  const [dueAt, setDueAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // People — loaded once, searched client-side (built for big orgs).
  const [people, setPeople] = useState<{ id: string; email: string; name: string | null }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: mems } = await supabase.from("org_members").select("user_id").eq("org_id", orgId);
      const ids = (mems ?? []).map((m: any) => m.user_id);
      if (ids.length === 0 || cancelled) return;
      const { data: profs } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
      if (cancelled) return;
      setPeople(
        ((profs ?? []) as any[]).map((p) => ({ id: p.id, email: p.email, name: p.full_name ?? null }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // When a study is picked, default the stage to that study's current stage.
  useEffect(() => {
    if (!studyId) return;
    const s = studies.find((x) => x.id === studyId);
    if (s && s.stage_key) setStageKey(s.stage_key);
  }, [studyId, studies]);

  const selectedStudy = studies.find((s) => s.id === studyId) ?? null;
  const studyMatches = useMemo(() => {
    const q = studyQ.trim().toLowerCase();
    const open = studies.filter((s) => !s.closed);
    if (!q) return open.slice(0, 8);
    return open
      .filter((s) => s.title.toLowerCase().includes(q) || (s.code ?? "").toLowerCase().includes(q))
      .slice(0, 8);
  }, [studies, studyQ]);

  const personMatches = useMemo(() => {
    const q = personQ.trim().toLowerCase();
    const others = people.filter((p) => p.id !== userId);
    if (!q) return others.slice(0, 6);
    return others
      .filter((p) => p.email.toLowerCase().includes(q) || (p.name ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, personQ, userId]);

  const selectedPerson = people.find((p) => p.id === personId) ?? null;

  const recipientValid =
    recipient === "me" || (recipient === "person" && !!personId) || (recipient === "role" && !!roleId);

  // Sites available for the chosen study (its assigned sites), else all sites.
  const studySiteIds = studySitesTbl.rows.filter((r) => r.study_id === studyId).map((r) => r.site_id);
  const siteOptions = studyId && studySiteIds.length > 0
    ? sitesTbl.rows.filter((s) => studySiteIds.includes(s.id))
    : sitesTbl.rows;

  const submit = async () => {
    if (!title.trim() || !recipientValid || !studyId || saving) return;
    setSaving(true);
    try {
      let assignedUser: string | null = null;
      let assignedRole: string | null = null;
      if (recipient === "me") assignedUser = userId;
      if (recipient === "person") assignedUser = personId;
      if (recipient === "role") {
        assignedRole = roleId;
        // Product rule: exactly one holder -> auto-assign; otherwise role queue.
        const hs = holders.filter((h) => h.team_role_id === roleId);
        if (hs.length === 1) assignedUser = hs[0].user_id;
      }
      const { data: created, error } = await supabase
        .from("tasks")
        .insert({
          org_id: orgId,
          study_id: studyId || null,
          site_id: siteId || null,
          stage_key: stageKey || null,
          kind: "manual",
          title: title.trim(),
          description: description.trim() || null,
          status: "open",
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          assigned_to_user_id: assignedUser,
          assigned_to_role_id: assignedRole,
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "task", entityId: (created as any)?.id ?? "",
        action: "task_created",
        payload: {
          title: title.trim(),
          study_id: studyId || null,
          to_user: recipient !== "role" ? (selectedPerson?.email ?? (recipient === "me" ? "self" : null)) : null,
          to_role: recipient === "role" ? roles.find((r) => r.id === roleId)?.title ?? null : null,
        },
      });
      onCreated();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't send the task"));
    } finally {
      setSaving(false);
    }
  };

  const initials = (p: { email: string; name: string | null }) => {
    const base = p.name || p.email;
    const parts = base.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send a task"
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">Send a task</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            To yourself, a teammate, or a role's queue — link a study so it lives on the record.
          </p>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Confirm pharmacy delegation log"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim() && recipientValid && studyId) void submit();
              }}
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Details <span className="font-normal text-slate-400">— optional</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Context the recipient needs — it travels with the task."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition resize-none"
            />
          </label>

          {/* TO — me / teammate / role queue */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1.5">To</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-2" role="group" aria-label="Recipient kind">
              {([
                ["me", "Me"],
                ["person", "Teammate"],
                ["role", "Role queue"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setRecipient(k)}
                  className={
                    "px-3 py-1.5 rounded-md text-xs font-semibold transition " +
                    (recipient === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
                  }
                  aria-pressed={recipient === k}
                >
                  {label}
                </button>
              ))}
            </div>

            {recipient === "person" && (
              <div>
                {selectedPerson ? (
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                      {initials(selectedPerson)}
                    </span>
                    <span className="text-sm text-slate-900 truncate">{selectedPerson.name || selectedPerson.email}</span>
                    {selectedPerson.name && <span className="text-[11px] text-slate-400 truncate">{selectedPerson.email}</span>}
                    <button
                      onClick={() => setPersonId("")}
                      className="ml-auto text-slate-300 hover:text-red-500 leading-none"
                      aria-label="Clear recipient"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <Input
                      value={personQ}
                      onChange={(e) => setPersonQ(e.target.value)}
                      placeholder={`Search ${people.length > 1 ? people.length - 1 : ""} teammates…`}
                      aria-label="Search teammates"
                    />
                    <div className="mt-1 rounded-lg border border-slate-200 overflow-hidden">
                      {personMatches.length === 0 && (
                        <div className="px-3 py-2 text-xs text-slate-400 italic">No matches.</div>
                      )}
                      {personMatches.map((pp) => (
                        <button
                          key={pp.id}
                          onClick={() => setPersonId(pp.id)}
                          className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-brand-50/40 transition border-b border-slate-100 last:border-b-0"
                        >
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                            {initials(pp)}
                          </span>
                          <span className="text-sm text-slate-900 truncate">{pp.name || pp.email}</span>
                          <span className="ml-auto text-[11px] text-slate-400 truncate">{pp.name ? pp.email : ""}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {recipient === "role" && (
              <div>
                <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} aria-label="Role queue">
                  <option value="">— Pick a role —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </Select>
                <p className="text-[11px] text-slate-400 mt-1">
                  One person holds the role → it assigns to them. Several → it lands in the role's queue.
                </p>
              </div>
            )}
          </div>

          {/* STUDY — searchable, collapses to a chip */}
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Study <span className="font-normal text-red-500">*</span>
            </span>
            {selectedStudy ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <span className="font-mono text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-full px-2 py-0.5 flex-shrink-0">
                  {selectedStudy.code}
                </span>
                <span className="text-sm text-slate-900 truncate">{selectedStudy.title}</span>
                <button
                  onClick={() => {
                    setStudyId("");
                    setStageKey("");
                    setSiteId("");
                  }}
                  className="ml-auto text-slate-300 hover:text-red-500 leading-none"
                  aria-label="Unlink study"
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={studyQ}
                  onChange={(e) => setStudyQ(e.target.value)}
                  placeholder="Search by code or title…"
                  aria-label="Search studies"
                />
                {(studyQ.trim() !== "" || studyMatches.length > 0) && (
                  <div className="mt-1 rounded-lg border border-slate-200 overflow-hidden max-h-44 overflow-y-auto">
                    {studyMatches.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setStudyId(s.id)}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-brand-50/40 transition border-b border-slate-100 last:border-b-0"
                      >
                        <span className="font-mono text-[11px] text-slate-500 flex-shrink-0">{s.code}</span>
                        <span className="text-sm text-slate-900 truncate">{s.title}</span>
                      </button>
                    ))}
                    {studyMatches.length === 0 && (
                      <div className="px-3 py-2 text-xs text-slate-400 italic">No open studies match.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {selectedStudy && (
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Site location <span className="font-normal text-slate-400">— optional</span>
              </span>
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">— Any / none —</option>
                {siteOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Stage <span className="font-normal text-slate-400">{selectedStudy ? "— from study" : "— optional"}</span>
              </span>
              <Select value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
                <option value="">— None —</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.key}>{s.label}</option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">
                Due <span className="font-normal text-slate-400">— optional</span>
              </span>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">records {fmtDate(new Date())}</span>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim() || !recipientValid || !studyId || saving}>
            {saving ? "Sending…" : recipient === "me" ? "Add task" : "Send task"}
          </Button>
        </div>
      </div>
    </div>
  );
}
function AttestationModal({
  signing,
  orgId,
  signerUserId,
  signerEmail,
  onClose,
  onDone,
}: {
  signing: { task: TaskRow; doc: DocumentRow };
  orgId: string;
  signerUserId: string;
  signerEmail: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const at = actionTypeByKey(signing.task.action_type);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Type your full name to sign.");
      return;
    }
    if (!agree) {
      setError("Check the attestation box to continue.");
      return;
    }
    if (!at) {
      setError("Unknown action type.");
      return;
    }
    setBusy(true);
    try {
      await recordDocumentSignature({
        orgId,
        document: signing.doc,
        task: signing.task,
        actionType: at.key,
        signerName: name.trim(),
        signerUserId,
        signerEmail,
      });
      onDone();
    } catch (e: any) {
      setError(e?.message || "Couldn't record signature");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Electronic signature"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <Icon name="shield" size={16} className="text-brand-600" />
          <div className="min-w-0">
            <h2 className="text-lg font-display font-bold text-slate-900">
              {at?.label ?? "Sign"}
            </h2>
            <div className="text-[11px] font-semibold text-slate-400 truncate">
              {signing.doc.title}
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm text-slate-700 leading-relaxed">
            {at?.statement}
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Your full legal name
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your name to sign"
              autoFocus
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="accent-brand-500 w-4 h-4 mt-0.5"
            />
            <span>
              I, {name.trim() || "the signer"}, attest to the statement above. This electronic
              signature is recorded with my identity, the date, and time on the document&rsquo;s
              audit trail.
            </span>
          </label>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-slate-400 truncate max-w-[160px]">
            {signerEmail ?? ""}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !name.trim() || !agree}>
              {busy ? "Recording…" : at?.verb ?? "Sign"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Task-kind pill — handoffs and escalations get distinct, legible treatment
 *  so the "system noticed" moments read at a glance. */
export function KindPill({ kind }: { kind: string }) {
  if (kind === "handoff" || kind === "external_handoff") {
    return (
      <Pill tone="info">
        <Icon name="chevron-right" size={9} />
        {kind === "external_handoff" ? "external handoff" : "handoff"}
      </Pill>
    );
  }
  if (kind === "escalation") {
    return (
      <Pill tone="danger">
        <Icon name="alert" size={9} />
        escalation
      </Pill>
    );
  }
  return <Pill tone="neutral">{kind}</Pill>;
}
