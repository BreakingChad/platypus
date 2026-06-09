import { friendlyError } from "../lib/errors";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import type {
  PipelineStageRow,
  TeamRoleRow,
  WorkflowModuleRow,
  WorkflowTaskTemplateRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";

/** WorkStreamPanel — read-only visualization of the task flow modules
 *  configured for a study's current stage. Lists each module + its task
 *  templates so non-admin coordinators can see what will (or did) fire
 *  when the study entered this stage.
 *
 *  Admin-only fields are still hidden behind the same RLS the rest of the
 *  app uses; this component just renders what the user can already SELECT.
 *  An "Edit task flows" button surfaces for admins so they can jump to
 *  the builder pre-filtered to this stage.
 */
export function WorkStreamPanel({
  studyId,
  stageKey,
  stage,
  workstreamId,
  onNavigate,
}: {
  /** Optional — when provided + admin, enables the 'Run task flow' button
   *  that fires spawnTasksForStageEntry for THIS study at the current stage. */
  studyId?: string;
  stageKey: string | null;
  /** The study's task flow — modules are scoped to it. */
  workstreamId?: string | null;
  stage: PipelineStageRow | null;
  onNavigate?: (h: string) => void;
}) {
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const [running, setRunning] = useState(false);
  const [modules, setModules] = useState<WorkflowModuleRow[] | null>(null);
  const [templatesByModule, setTemplatesByModule] = useState<
    Record<string, WorkflowTaskTemplateRow[]>
  >({});
  const [roles, setRoles] = useState<Record<string, TeamRoleRow>>({});

  // Load modules + their templates + the roles they reference.
  useEffect(() => {
    if (!orgId || !stageKey) {
      setModules(null);
      setTemplatesByModule({});
      return;
    }
    let cancelled = false;
    (async () => {
      let modQuery = supabase
        .from("workflow_modules")
        .select("*")
        .eq("org_id", orgId)
        .eq("stage_key", stageKey);
      if (workstreamId) modQuery = modQuery.eq("workstream_id", workstreamId);
      const { data: mods } = await modQuery.order("position", { ascending: true });
      if (cancelled) return;
      const allMods = (mods ?? []) as WorkflowModuleRow[];
      setModules(allMods);

      if (allMods.length === 0) {
        setTemplatesByModule({});
        return;
      }
      const moduleIds = allMods.map((m) => m.id);
      const { data: tpls } = await supabase
        .from("workflow_task_templates")
        .select("*")
        .in("module_id", moduleIds)
        .order("position", { ascending: true });
      if (cancelled) return;
      const grouped: Record<string, WorkflowTaskTemplateRow[]> = {};
      for (const t of (tpls ?? []) as WorkflowTaskTemplateRow[]) {
        (grouped[t.module_id] = grouped[t.module_id] ?? []).push(t);
      }
      setTemplatesByModule(grouped);

      // Look up the roles referenced so we can render their titles.
      const roleIds = Array.from(
        new Set(
          (tpls ?? [])
            .map((t: any) => t.assigned_to_role_id)
            .filter((x: any) => Boolean(x))
        )
      );
      if (roleIds.length > 0) {
        const { data: roleRows } = await supabase
          .from("team_roles")
          .select("*")
          .in("id", roleIds);
        if (cancelled) return;
        const byId: Record<string, TeamRoleRow> = {};
        (roleRows ?? []).forEach((r: any) => (byId[r.id] = r));
        setRoles(byId);
      } else {
        setRoles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, stageKey, workstreamId]);

  const runWorkStream = async () => {
    if (!orgId || !studyId || !stageKey || !userId) return;
    setRunning(true);
    try {
      const res = await spawnTasksForStageEntry({
        orgId,
        studyId,
        stageKey,
        workstreamId,
        actorUserId: userId,
      });
      if (res.spawned > 0) {
        toast.success(`Spawned ${res.spawned} task${res.spawned === 1 ? "" : "s"}${res.skipped > 0 ? ` (skipped ${res.skipped} already-open)` : ""}`);
        // Log a deliberate manual re-run as an audit event so the trail is complete.
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: studyId,
          action: "work_stream_rerun",
          payload: {
            stage_key: stageKey,
            stage_label: stage?.label ?? null,
            spawned: res.spawned,
            skipped: res.skipped,
            modules: res.modules,
          },
        });
      } else {
        toast.info(
          res.modules === 0
            ? "No modules configured for this stage."
            : res.skipped > 0
            ? `Nothing new to spawn — ${res.skipped} task${res.skipped === 1 ? "" : "s"} already open.`
            : "No task templates to spawn."
        );
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Run failed"));
    } finally {
      setRunning(false);
    }
  };

  if (!stageKey || !stage) return null;
  if (modules === null) {
    return (
      <Card className="mt-6">
        <div className="text-sm text-slate-500">Loading task flow…</div>
      </Card>
    );
  }

  const totalTemplates = Object.values(templatesByModule).reduce(
    (sum, arr) => sum + arr.length,
    0
  );
  const enabledModules = modules.filter((m) => m.enabled).length;

  // Empty: a single compact line, not a big nested card competing with the
  // tasks empty-state below it.
  if (modules.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 flex-wrap">
        <Icon name="workflow" size={14} className="text-slate-400 flex-shrink-0" />
        <span className="text-xs text-slate-500">
          No work-stream modules fire at <span className="font-semibold text-slate-700">{stage.label}</span> yet.
        </span>
        {isAdmin && onNavigate && (
          <button
            onClick={() => onNavigate("#/settings/work-streams")}
            className="text-xs font-semibold text-brand-700 hover:underline ml-auto"
          >
            Configure
          </button>
        )}
      </div>
    );
  }

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <div className="text-xs font-semibold text-slate-500">
            Task flow for{" "}
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ml-1"
              style={{ backgroundColor: stage.color }}
            >
              {stage.label}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {`${enabledModules} of ${modules.length} module${modules.length === 1 ? "" : "s"} active · ${totalTemplates} task template${totalTemplates === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && studyId && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void runWorkStream()}
              disabled={running}
              title="Fire the engine now — spawn any task templates that aren't already open"
            >
              <Icon name="check" size={12} /> {running ? "Running…" : "Run task flow"}
            </Button>
          )}
          {isAdmin && onNavigate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("#/settings/work-streams")}
              title="Open Task flows"
            >
              <Icon name="workflow" size={12} /> Edit task flows
            </Button>
          )}
        </div>
      </div>

      {modules.length > 0 && (
        <div className="space-y-2">
          {modules.map((mod) => {
            const tpls = templatesByModule[mod.id] ?? [];
            return (
              <div
                key={mod.id}
                className={
                  "rounded-lg border p-3 " +
                  (mod.enabled
                    ? "border-slate-200 bg-white"
                    : "border-slate-200 bg-slate-50/50 opacity-70")
                }
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon
                    name="workflow"
                    size={14}
                    className={mod.enabled ? "text-brand-600" : "text-slate-400"}
                  />
                  <span className="font-display font-bold text-sm text-slate-900">
                    {mod.name}
                  </span>
                  {!mod.enabled && <Pill tone="neutral">disabled</Pill>}
                  <span className="text-[10px] font-mono text-slate-400">
                    {tpls.length} task{tpls.length === 1 ? "" : "s"}
                  </span>
                </div>
                {mod.description && (
                  <p className="text-[11px] text-slate-500 mb-2 italic">
                    {mod.description}
                  </p>
                )}
                {tpls.length === 0 ? (
                  <div className="text-[11px] text-slate-400 italic px-2 py-1">
                    No task templates in this module yet.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {tpls.map((t) => {
                      const role = t.assigned_to_role_id
                        ? roles[t.assigned_to_role_id]
                        : null;
                      return (
                        <li
                          key={t.id}
                          className="grid grid-cols-[1fr_90px_140px] gap-2 items-center px-2 py-1 rounded bg-slate-50/60 border border-slate-100"
                        >
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {t.title}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 truncate">
                            {t.kind}
                            {t.due_offset_days != null && (
                              <span className="ml-1 text-slate-400">
                                · +{t.due_offset_days}d
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-slate-600 truncate text-right">
                            {role ? (
                              <>
                                <Icon name="users" size={10} className="inline -mt-0.5 mr-0.5 text-slate-400" />
                                {role.title}
                              </>
                            ) : (
                              <span className="text-slate-400 italic">unassigned</span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
