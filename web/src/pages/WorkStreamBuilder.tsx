import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import type {
  PipelineRow,
  PipelineStageRow,
  TeamRow,
  TeamRoleRow,
  TeamRoleHolderRow,
  WorkflowModuleRow,
  WorkflowTaskTemplateRow,
  TaskKind,
  WorkstreamRow,
} from "../lib/types";

import { Card } from "../components/ui/Card";
import { flowColumns } from "../lib/flow";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Icon } from "../components/ui/Icon";
import { DraftInput } from "../components/ui/DraftInput";
import { PageHeader } from "../components/ui/PageHeader";
import { InfoTip } from "../components/ui/Tip";
import { EmptyState } from "../components/ui/EmptyState";

/** WorkStreamBuilder — build the tasks and teams for a pipeline's stages.
 *
 *  Pick a pipeline up top, then a task flow within it. The pipeline's stages
 *  render as read-only columns (their structure is owned by Settings →
 *  Pipelines); here you add modules, and inside each module the task templates
 *  that fire when a study reaches that stage. A task flow may also lengthen a
 *  stage's target days for its own pathway — everything else about the stage is
 *  inherited from the pipeline.
 *
 *  Persists to public.workflow_modules + public.workflow_task_templates, and
 *  per-stage target overrides to public.workstream_stages. RLS gates writes.
 */

/** One option per task type. "Task" persists as 'manual'; legacy 'date' rows
 *  display as Task too (they behave identically at runtime). Handoff and
 *  Escalation actually change behavior, so they stay distinct. */
type HandoffTplLite = {
  module_id: string;
  kind: string;
  title: string;
  handoff_to_team_id: string | null;
  handoff_to_stage_key: string | null;
};

/** A handoff that lands in a stage with NO module for the receiving team yet. */
type ReceiptGhost = { title: string; teamId: string; teamName: string; fromModule: string };

const TASK_KIND_OPTIONS: { value: TaskKind; label: string }[] = [
  { value: "manual", label: "Task" },
  { value: "handoff", label: "Handoff" },
  { value: "escalation", label: "Escalation" },
];
// Legacy rows: date → Task, external_handoff → Handoff (no longer offered).
const displayKind = (k: TaskKind): TaskKind =>
  k === "date" ? "manual" : k === "external_handoff" ? "handoff" : k;

type DragMeta = { type: "module"; stageKey?: string };

export function WorkStreamBuilder({
  pipelineId,
  onPipelineChange,
  embedded = false,
}: {
  /** Controlled pipeline selection (Workstreams page lifts it across tabs). */
  pipelineId?: string | null;
  onPipelineChange?: (id: string | null) => void;
  /** Embedded in the Workstreams page — its header/frame is provided there. */
  embedded?: boolean;
} = {}) {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();

  const pipelines = useOrgTable<PipelineRow>("pipelines", { orderBy: "position", realtime: true });
  const stagesTbl = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const workstreams = useOrgTable<WorkstreamRow>("workstreams", { orderBy: "created_at", realtime: true });
  const roles = useOrgTable<TeamRoleRow>("team_roles", { realtime: true });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position", realtime: true });

  /* ---------- pipeline selection (controllable from the Workstreams page) ---------- */
  const activePipelines = pipelines.rows.filter((p) => p.status === "active");
  const controlled = pipelineId !== undefined;
  const [internalPipelineId, setInternalPipelineId] = useState<string | null>(null);
  const selectedPipelineId = controlled ? pipelineId : internalPipelineId;
  const setSelectedPipelineId = (id: string | null) => {
    if (controlled) onPipelineChange?.(id);
    else setInternalPipelineId(id);
  };
  useEffect(() => {
    if (selectedPipelineId && activePipelines.some((p) => p.id === selectedPipelineId)) return;
    setSelectedPipelineId(activePipelines[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePipelines, selectedPipelineId]);
  const selectedPipeline = activePipelines.find((p) => p.id === selectedPipelineId) ?? null;

  /** The pipeline's stages — read-only structure (order, parallel, names). */
  const pipelineStages = useMemo(
    () => stagesTbl.rows.filter((s) => s.pipeline_id === selectedPipelineId).sort((a, b) => a.position - b.position),
    [stagesTbl.rows, selectedPipelineId]
  );

  /* ---------- task flow selection (within the pipeline) ---------- */
  const [editorModuleId, setEditorModuleId] = useState<string | null>(null);
  const editorModule = modules.rows.find((m) => m.id === editorModuleId) ?? null;

  const pipelineWorkstreams = workstreams.rows.filter((w) => w.status === "active" && w.pipeline_id === selectedPipelineId);
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedWsId && pipelineWorkstreams.some((w) => w.id === selectedWsId)) return;
    setSelectedWsId(pipelineWorkstreams[0]?.id ?? null);
  }, [pipelineWorkstreams, selectedWsId]);
  const selectedWs = pipelineWorkstreams.find((w) => w.id === selectedWsId) ?? null;
  const selectedWsModuleCount = modules.rows.filter((m) => m.workstream_id === selectedWsId).length;

  /** Task-template counts per module (flow chips) + handoff targets, so the
   *  canvas can show where batons LAND, not just where they're thrown. */
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [handoffTpls, setHandoffTpls] = useState<HandoffTplLite[]>([]);
  const [countsNonce, setCountsNonce] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("workflow_task_templates")
        .select("module_id, kind, title, handoff_to_team_id, handoff_to_stage_key");
      if (cancelled || !data) return;
      const counts: Record<string, number> = {};
      for (const r of data as HandoffTplLite[]) counts[r.module_id] = (counts[r.module_id] ?? 0) + 1;
      setTaskCounts(counts);
      setHandoffTpls(
        (data as HandoffTplLite[]).filter(
          (r) => r.kind === "handoff" && r.handoff_to_team_id && r.handoff_to_stage_key
        )
      );
    })();
    return () => { cancelled = true; };
  }, [orgId, countsNonce, modules.rows.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDrag, setActiveDrag] = useState<string | null>(null);

  const stageLabel = (key: string) => pipelineStages.find((s) => s.key === key)?.label ?? key;

  /* ---------- module mutators ---------- */

  const addModuleTo = async (stageKey: string, name: string) => {
    if (!orgId || !name.trim()) return;
    if (!selectedWsId) { toast.error("Pick or create a task flow first"); return; }
    const pos = modules.rows.filter((m) => m.stage_key === stageKey && m.workstream_id === selectedWsId).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { data, error } = await supabase
        .from("workflow_modules")
        .insert({ org_id: orgId, stage_key: stageKey, workstream_id: selectedWsId, name: name.trim(), enabled: true, position: pos } as any)
        .select("id").single();
      if (error) throw error;
      toast.success(stamped(`Module "${name.trim()}" added`));
      if (data) setEditorModuleId((data as any).id as string);
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add module")); }
  };
  /** A handoff names a receiving (stage, team) — make sure that team has a
   *  module THERE to receive it, so the baton lands somewhere visible and
   *  configurable. Created once; renaming/deleting it afterwards is respected. */
  const ensureReceiverModule = async (stageKey: string, teamId: string, fromTitle: string) => {
    if (!orgId || !selectedWsId) return;
    // Existence check against the DATABASE, not the realtime cache — the
    // cache lags inserts, which duplicated receiver modules on rapid edits.
    const { data: existing } = await supabase
      .from("workflow_modules")
      .select("id")
      .eq("workstream_id", selectedWsId)
      .eq("stage_key", stageKey)
      .eq("owner_team_id", teamId)
      .limit(1);
    if (existing && existing.length > 0) return;
    const teamName = teams.rows.find((t) => t.id === teamId)?.name ?? "receiving team";
    const pos = modules.rows.filter((m) => m.stage_key === stageKey && m.workstream_id === selectedWsId)
      .reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { error } = await supabase.from("workflow_modules").insert({
        org_id: orgId, stage_key: stageKey, workstream_id: selectedWsId,
        name: `${teamName} — handoff`,
        owner_team_id: teamId, enabled: true, position: pos,
        description: `Receives the "${fromTitle.trim()}" handoff — rename and add ${teamName}'s tasks.`,
      } as any);
      if (error) throw error;
      toast.success(stamped(`Receiving module created in ${stageLabel(stageKey)} for ${teamName} — open it to name & configure`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create the receiving module"));
    }
  };

  const updateModule = async (id: string, patch: Partial<WorkflowModuleRow>) => {
    try {
      const { error } = await supabase.from("workflow_modules").update(patch as any).eq("id", id);
      if (error) throw error;
    } catch (e: any) { toast.error(friendlyError(e, "Update failed")); }
  };
  const removeModule = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: "Remove module", message: `Remove module "${name}"? Its task templates go with it.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      const { error } = await supabase.from("workflow_modules").delete().eq("id", id);
      if (error) throw error;
      if (editorModuleId === id) setEditorModuleId(null);
      toast.success(stamped("Module removed"));
      setCountsNonce((n) => n + 1);
    } catch (e: any) { toast.error(friendlyError(e, "Remove failed")); }
  };

  const persistModuleMove = async (moduleId: string, targetKey: string, orderedTargetIds: string[]) => {
    const mod = modules.rows.find((m) => m.id === moduleId);
    if (!mod) return;
    try {
      const ops: PromiseLike<unknown>[] = [];
      if (mod.stage_key !== targetKey) ops.push(supabase.from("workflow_modules").update({ stage_key: targetKey } as any).eq("id", moduleId));
      orderedTargetIds.forEach((id, i) => ops.push(supabase.from("workflow_modules").update({ position: (i + 1) * 10 } as any).eq("id", id)));
      await Promise.all(ops);
      if (mod.stage_key !== targetKey) toast.success(stamped(`Moved "${mod.name}" → ${stageLabel(targetKey)}`));
    } catch (e: any) { toast.error(friendlyError(e, "Move failed")); }
  };

  const deepCopyModule = async (src: WorkflowModuleRow, toStageKey: string, position: number, name?: string, toWorkstreamId?: string | null): Promise<{ taskCount: number }> => {
    const { data: created, error } = await supabase
      .from("workflow_modules")
      .insert({
        org_id: src.org_id, stage_key: toStageKey, workstream_id: toWorkstreamId ?? src.workstream_id, owner_team_id: src.owner_team_id,
        name: name ?? src.name, description: src.description, enabled: src.enabled, position,
      } as any).select("id").single();
    if (error) throw error;
    const newId = (created as any).id as string;
    const { data: tpls, error: tplErr } = await supabase
      .from("workflow_task_templates").select("*").eq("module_id", src.id).order("position", { ascending: true });
    if (tplErr) throw tplErr;
    if (tpls && tpls.length > 0) {
      const { error: insErr } = await supabase.from("workflow_task_templates").insert(
        (tpls as any[]).map((t) => ({
          module_id: newId, kind: t.kind, title: t.title, description: t.description,
          due_offset_days: t.due_offset_days, assigned_to_role_id: t.assigned_to_role_id,
          handoff_to_role_id: t.handoff_to_role_id ?? null,
          handoff_to_team_id: t.handoff_to_team_id ?? null, handoff_to_stage_key: t.handoff_to_stage_key ?? null,
          position: t.position,
        })) as any
      );
      if (insErr) throw insErr;
    }
    return { taskCount: tpls?.length ?? 0 };
  };

  const duplicateModule = async (src: WorkflowModuleRow) => {
    const nextPos = modules.rows.filter((m) => m.stage_key === src.stage_key && m.workstream_id === src.workstream_id).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { taskCount } = await deepCopyModule(src, src.stage_key, nextPos, `${src.name} (copy)`);
      toast.success(stamped(`Duplicated "${src.name}" — ${taskCount} task${taskCount === 1 ? "" : "s"} copied`));
      setCountsNonce((n) => n + 1);
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't duplicate the module")); }
  };

  const copyFromStage = async (srcStageKey: string, destStageKey: string) => {
    const srcMods = modules.rows.filter((m) => m.stage_key === srcStageKey && m.workstream_id === selectedWsId).sort((a, b) => a.position - b.position);
    if (srcMods.length === 0) return;
    const srcLabel = stageLabel(srcStageKey);
    if (!(await confirmDialog({
      title: "Copy modules from a stage",
      message: `Copy ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} (with their task templates) from "${srcLabel}" onto this stage? They arrive enabled and fully editable.`,
      confirmLabel: "Copy modules",
    }))) return;
    try {
      let pos = modules.rows.filter((m) => m.stage_key === destStageKey && m.workstream_id === selectedWsId).reduce((m, x) => Math.max(m, x.position), 0);
      let tasks = 0;
      for (const m of srcMods) { pos += 10; const { taskCount } = await deepCopyModule(m, destStageKey, pos); tasks += taskCount; }
      toast.success(stamped(`Copied ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} · ${tasks} task${tasks === 1 ? "" : "s"} from ${srcLabel}`));
      setCountsNonce((n) => n + 1);
    } catch (e: any) { toast.error(friendlyError(e, "Copy failed part-way — review the modules below")); }
  };

  /* ---------- task flow mutators ---------- */
  const createWorkstream = async (name: string) => {
    if (!orgId || !name.trim() || !selectedPipelineId) { toast.error("Pick a pipeline first"); return; }
    try {
      await workstreams.insert({ name: name.trim(), status: "active", pipeline_id: selectedPipelineId, is_default: false } as any);
      toast.success(stamped(`Task flow "${name.trim()}" added`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't save the task flow")); }
  };
  const renameWorkstream = (id: string, name: string) =>
    workstreams.update(id, { name }).catch((e: any) => toast.error(friendlyError(e, "Rename failed")));
  const duplicateWorkstream = async (src: WorkstreamRow) => {
    if (!orgId) return;
    try {
      const created = await workstreams.insert({ name: `${src.name} (copy)`, description: src.description, status: "active", pipeline_id: src.pipeline_id, is_default: false } as any);
      if (!created) return;
      const srcMods = modules.rows.filter((m) => m.workstream_id === src.id).sort((a, b) => a.position - b.position);
      let tasks = 0;
      for (const m of srcMods) { const r = await deepCopyModule(m, m.stage_key, m.position, undefined, created.id); tasks += r.taskCount; }
      setSelectedWsId(created.id);
      toast.success(stamped(`Copied "${src.name}" — ${srcMods.length} module${srcMods.length === 1 ? "" : "s"}, ${tasks} task${tasks === 1 ? "" : "s"}`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't copy")); }
  };
  const archiveWorkstream = async (src: WorkstreamRow) => {
    if (!(await confirmDialog({ title: "Archive task flow", message: `Archive "${src.name}"? Studies already on it keep it; it won't appear when creating new studies.`, confirmLabel: "Archive" }))) return;
    try { await workstreams.update(src.id, { status: "archived" }); toast.success(stamped(`Archived "${src.name}"`)); }
    catch (e: any) { toast.error(friendlyError(e, "Couldn't archive")); }
  };

  /* ---------- module drag-and-drop ---------- */
  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const overMeta = over.data.current as DragMeta | { type: "stage-drop"; stageKey: string } | undefined;
    const mod = modules.rows.find((m) => m.id === active.id);
    if (!mod) return;
    let targetKey: string | null = null;
    let overModuleId: string | null = null;
    if (overMeta?.type === "module") { overModuleId = String(over.id); targetKey = (overMeta as DragMeta).stageKey ?? null; }
    else if ((overMeta as any)?.type === "stage-drop") targetKey = (overMeta as any).stageKey;
    if (!targetKey) return;
    if (targetKey === mod.stage_key && (active.id === over.id || overModuleId === mod.id)) return;
    const targetMods = modules.rows
      .filter((m) => m.stage_key === targetKey && m.workstream_id === selectedWsId && m.id !== mod.id)
      .sort((a, b) => a.position - b.position);
    let insertIndex = targetMods.length;
    if (overModuleId) {
      const idx = targetMods.findIndex((m) => m.id === overModuleId);
      if (idx >= 0) insertIndex = idx;
    }
    const newOrder = [...targetMods];
    newOrder.splice(insertIndex, 0, mod);
    void persistModuleMove(mod.id, targetKey, newOrder.map((m) => m.id));
  };

  /* ---------- gating ---------- */
  if (memberLoading) {
    return <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Task flows" />
        <Card className="mt-6"><EmptyState iconName="lock" title="Admin-only surface" sub="Only org admins design task flows." /></Card>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8"}>
      {!embedded && (
        <PageHeader
          kicker="Configure"
          title="Task flows"
          subtitle="Build the tasks and teams for a pipeline's stages. Pick a pipeline, then a task flow within it; the pipeline's stages are read-only here — add the modules and tasks that run on them."
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-700 px-2.5 py-1.5 text-xs font-semibold" title="There's no save button — every change is written instantly">
              <Icon name="check" size={13} /> Auto-saved
            </span>
          }
        />
      )}

      {/* PIPELINE PICKER */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-2 flex-wrap">
        <Icon name="workflow" size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-700">Pipeline</span>
        {activePipelines.length === 0 ? (
          <span className="text-[11px] text-slate-400 italic">No pipelines yet — create one in Workstreams → Stage pipelines.</span>
        ) : (
          <Select value={selectedPipelineId ?? ""} onChange={(e) => setSelectedPipelineId(e.target.value || null)} className="text-sm w-64">
            {activePipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <span className="text-[11px] text-slate-400">— its task flows are below</span>
        <div className="flex-1" />
        <span className="text-[11px] text-slate-400">Edit stages in <span className="font-semibold">Workstreams → Stage pipelines</span></span>
      </div>

      {/* WORK STREAM SELECTOR */}
      <WorkstreamManager
        workstreams={pipelineWorkstreams}
        disabled={!selectedPipelineId}
        selectedId={selectedWsId}
        onSelect={(id) => setSelectedWsId(id)}
        onCreate={(name) => void createWorkstream(name)}
        onRename={(id, name) => void renameWorkstream(id, name)}
        onDuplicate={(ws) => void duplicateWorkstream(ws)}
        onArchive={(ws) => void archiveWorkstream(ws)}
      />

      {!selectedPipeline ? (
        <Card className="mt-6"><EmptyState iconName="workflow" title="No pipeline selected" sub="Create a pipeline in Workstreams → Stage pipelines, then build its task flows here." /></Card>
      ) : pipelineStages.length === 0 ? (
        <Card className="mt-6"><EmptyState iconName="workflow" title="This pipeline has no stages" sub="Add stages to this pipeline in Workstreams → Stage pipelines, then build task flows on them." /></Card>
      ) : !selectedWs ? (
        <Card className="mt-6"><EmptyState iconName="workflow" title="No task flow selected" sub="Create a task flow above to start adding modules and tasks to this pipeline's stages." /></Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="mt-6 mb-1 flex items-center gap-2 flex-wrap">
            <Icon name="workflow" size={14} className="text-brand-500" />
            <span className="text-sm font-semibold text-slate-800">Editing <span className="text-brand-700">{selectedWs.name}</span></span>
            <span className="text-[11px] text-slate-400">— click a module to edit its tasks</span>
          </div>
          <div className="mb-3 flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
            <Icon name="info" size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <span>Stages come from the <span className="font-semibold">{selectedPipeline.name}</span> pipeline and are read-only here. Add <span className="font-semibold">modules and tasks</span> per stage; you can also lengthen a stage's target for this task flow.</span>
          </div>
          {selectedWsModuleCount === 0 && (
            <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
              <Icon name="info" size={14} className="text-brand-500 flex-shrink-0" />
              <span><span className="font-semibold text-slate-800">{selectedWs.name}</span> has no modules yet. Add one under any stage with <span className="font-semibold">+ module</span> — modules spawn tasks when a study reaches that stage.</span>
            </div>
          )}
          <FlowCanvas
            stages={pipelineStages}
            modules={modules.rows.filter((m) => m.workstream_id === selectedWsId)}
            teams={teams.rows}
            taskCounts={taskCounts}
            {...(() => {
              // Where do this flow's handoffs LAND? Badge matching modules;
              // ghost-card the targets that have no receiving module yet.
              const wsMods = modules.rows.filter((m) => m.workstream_id === selectedWsId);
              const wsModIds = new Set(wsMods.map((m) => m.id));
              const receiptsByModule: Record<string, string[]> = {};
              const ghostsByStage: Record<string, ReceiptGhost[]> = {};
              const links: { from: string; to: string; title: string }[] = [];
              for (const t of handoffTpls) {
                if (!wsModIds.has(t.module_id) || !t.handoff_to_stage_key || !t.handoff_to_team_id) continue;
                const src = wsMods.find((m) => m.id === t.module_id)!;
                const receiver = wsMods.find(
                  (m) => m.stage_key === t.handoff_to_stage_key && m.owner_team_id === t.handoff_to_team_id
                );
                if (receiver) {
                  (receiptsByModule[receiver.id] ??= []).push(`“${t.title}” from ${src.name}`);
                  links.push({ from: src.id, to: receiver.id, title: t.title });
                } else {
                  (ghostsByStage[t.handoff_to_stage_key] ??= []).push({
                    title: t.title,
                    teamId: t.handoff_to_team_id,
                    teamName: teams.rows.find((x) => x.id === t.handoff_to_team_id)?.name ?? "team",
                    fromModule: src.name,
                  });
                }
              }
              return { receiptsByModule, ghostsByStage, links };
            })()}
            onCreateReceiver={(stageKey, teamId, title) => void ensureReceiverModule(stageKey, teamId, title)}
            onAddModule={(key, name) => void addModuleTo(key, name)}
            onOpenModule={(id) => setEditorModuleId(id)}
            onCopyFrom={(src, dest) => void copyFromStage(src, dest)}
          />
          <DragOverlay>
            {activeDrag ? (() => {
              const m = modules.rows.find((x) => x.id === activeDrag);
              return m ? <ModuleGhost name={m.name} /> : null;
            })() : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Spacer so the docked editor never permanently hides canvas content. */}
      {editorModule && <div style={{ height: "46vh" }} aria-hidden="true" />}
      {editorModule && (
        <ModuleDrawer
          module={editorModule}
          stageLabel={stageLabel(editorModule.stage_key)}
          stageColor={pipelineStages.find((s) => s.key === editorModule.stage_key)?.color ?? "#64748b"}
          teams={teams.rows}
          roles={roles.rows}
          stages={pipelineStages}
          onClose={() => { setEditorModuleId(null); setCountsNonce((n) => n + 1); }}
          onUpdate={(patch) => updateModule(editorModule.id, patch)}
          onDuplicate={() => void duplicateModule(editorModule)}
          onRemove={() => void removeModule(editorModule.id, editorModule.name)}
          onTemplatesChanged={() => setCountsNonce((n) => n + 1)}
          onEnsureReceiver={(sk, tid, title) => void ensureReceiverModule(sk, tid, title)}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * Task flow selector — pathways within the selected pipeline
 * ========================================================================== */

function WorkstreamManager({
  workstreams, disabled, selectedId, onSelect, onCreate, onRename, onDuplicate, onArchive,
}: {
  workstreams: WorkstreamRow[];
  disabled: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (ws: WorkstreamRow) => void;
  onArchive: (ws: WorkstreamRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="layers" size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-700">Task flows</span>
        <span className="text-[11px] text-slate-400">— click one to edit; a study is assigned one at intake</span>
        <div className="flex-1" />
        {adding ? (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name); setName(""); setAdding(false); } if (e.key === "Escape") { setAdding(false); setName(""); } }}
              placeholder="e.g. Oncology" className="text-sm w-52" />
            <Button size="sm" variant="primary" onClick={() => { if (name.trim()) { onCreate(name); setName(""); setAdding(false); } }} disabled={!name.trim()}>Save</Button>
          </div>
        ) : (
          <Button size="sm" variant="primary" disabled={disabled} onClick={() => setAdding(true)}><Icon name="plus" size={12} /> New task flow</Button>
        )}
      </div>
      {workstreams.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic">None yet — create your first task flow for this pipeline above.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {workstreams.map((ws) => {
            const selected = ws.id === selectedId;
            return (
              <div key={ws.id} onClick={() => onSelect(ws.id)}
                className={"group flex items-center gap-2 rounded-lg border pl-3 pr-2 py-2 text-sm cursor-pointer transition " +
                  (selected ? "border-brand-400 bg-brand-50 ring-1 ring-brand-500/20" : "border-slate-200 bg-white hover:border-slate-300")}>
                {editId === ws.id ? (
                  <input autoFocus value={editName} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { const t = editName.trim(); if (t && t !== ws.name) onRename(ws.id, t); setEditId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditId(null); }}
                    className="text-sm font-semibold border border-brand-200 rounded px-1 py-0.5 outline-none" />
                ) : (
                  <span className={"font-semibold " + (selected ? "text-brand-800" : "text-slate-700")}>{ws.name}</span>
                )}
                {selected && <span className="rounded-full bg-brand-100 text-brand-700 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5">Editing</span>}
                <span className="flex items-center gap-1 text-slate-400 ml-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={(e) => { e.stopPropagation(); setEditId(ws.id); setEditName(ws.name); }} className="hover:text-brand-700 p-0.5" title="Rename" aria-label="Rename"><Icon name="edit" size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onDuplicate(ws); }} className="hover:text-brand-700 p-0.5" title="Duplicate" aria-label="Duplicate"><Icon name="copy" size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onArchive(ws); }} className="hover:text-red-600 p-0.5" title="Archive" aria-label="Archive"><Icon name="trash" size={13} /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Flow canvas — read-only stage columns + editable module lists
 * ========================================================================== */

function FlowCanvas({
  stages, modules, teams, taskCounts, receiptsByModule, ghostsByStage, links, onCreateReceiver, onAddModule, onOpenModule, onCopyFrom,
}: {
  stages: PipelineStageRow[];
  modules: WorkflowModuleRow[];
  teams: TeamRow[];
  taskCounts: Record<string, number>;
  receiptsByModule: Record<string, string[]>;
  ghostsByStage: Record<string, ReceiptGhost[]>;
  /** Handoff connections: source module → receiving module (the batons). */
  links?: { from: string; to: string; title: string }[];
  onCreateReceiver: (stageKey: string, teamId: string, title: string) => void;
  onAddModule: (stageKey: string, name: string) => void;
  onOpenModule: (id: string) => void;
  onCopyFrom: (srcStageKey: string, destStageKey: string) => void;
}) {
  const cols = flowColumns(stages);

  // Connectors are HOVER-ONLY (Chad: the always-on green lines were noise):
  // hover a module and just ITS handoff connections light up.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [hoverMod, setHoverMod] = useState<string | null>(null);
  const activeLinks = useMemo(
    () => (hoverMod && links ? links.filter((l) => l.from === hoverMod || l.to === hoverMod) : []),
    [hoverMod, links]
  );
  const [paths, setPaths] = useState<{ d: string; title: string }[]>([]);
  useEffect(() => {
    const el = canvasRef.current;
    const links = activeLinks;
    if (!el || links.length === 0) {
      setPaths([]);
      return;
    }
    let raf = 0;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const next: { d: string; title: string }[] = [];
      for (const l of links) {
        const a = el.querySelector(`[data-mod-id="${l.from}"]`)?.getBoundingClientRect();
        const b = el.querySelector(`[data-mod-id="${l.to}"]`)?.getBoundingClientRect();
        if (!a || !b) continue;
        const leftToRight = b.left >= a.right;
        const sx = (leftToRight ? a.right : a.left) - base.left;
        const sy = a.top + a.height / 2 - base.top;
        const tx = (leftToRight ? b.left : b.right) - base.left;
        const ty = b.top + b.height / 2 - base.top;
        const mx = (sx + tx) / 2;
        next.push({ d: `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ty} L ${tx} ${ty}`, title: l.title });
      }
      setPaths(next);
    };
    raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeLinks, modules, stages]);

  return (
    <div className="mt-6 overflow-x-auto pb-4">
      <div
        ref={canvasRef}
        className="relative flex items-start gap-0 min-w-max"
        onMouseOver={(e) => {
          const id = (e.target as HTMLElement).closest?.("[data-mod-id]")?.getAttribute("data-mod-id") ?? null;
          if (id !== hoverMod) setHoverMod(id);
        }}
        onMouseLeave={() => setHoverMod(null)}
      >
        {paths.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" aria-hidden="true">
            <defs>
              <marker id="handoff-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-violet-500" />
              </marker>
            </defs>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                markerEnd="url(#handoff-arrow)"
                className="stroke-violet-400"
              >
                <title>{p.title}</title>
              </path>
            ))}
          </svg>
        )}
        {cols.map((col, ci) => (
          <div key={ci} className="flex items-start">
            <div className={col.stages.length > 1
              ? "flex flex-col gap-2 rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 p-2"
              : "flex flex-col gap-3"}>
              {col.stages.length > 1 && (
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Parallel</span>
                  <span className="text-[10px] text-slate-400">· run at the same time</span>
                </div>
              )}
              {col.stages.map((s) => (
                <StageColumn
                  key={s.id} s={s}
                  mods={modules.filter((m) => m.stage_key === s.key).sort((a, b) => a.position - b.position)}
                  allStages={stages} modules={modules} teams={teams} taskCounts={taskCounts}
                  receiptsByModule={receiptsByModule}
                  ghosts={ghostsByStage[s.key] ?? []}
                  onCreateReceiver={onCreateReceiver}
                  onAddModule={onAddModule} onOpenModule={onOpenModule} onCopyFrom={onCopyFrom}
                />
              ))}
            </div>
            {ci < cols.length - 1 && (
              <div className="px-1 self-center flex items-center justify-center min-w-[24px]">
                <Icon name="arrow-right" size={18} className="text-slate-300" aria-hidden="true" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
 * Stage column — read-only header (from pipeline) + module list + target o/r
 * ========================================================================== */

function StageColumn({
  s, mods, allStages, modules, teams, taskCounts, receiptsByModule, ghosts, onCreateReceiver, onAddModule, onOpenModule, onCopyFrom,
}: {
  s: PipelineStageRow;
  mods: WorkflowModuleRow[];
  allStages: PipelineStageRow[];
  modules: WorkflowModuleRow[];
  teams: TeamRow[];
  taskCounts: Record<string, number>;
  receiptsByModule: Record<string, string[]>;
  ghosts: ReceiptGhost[];
  onCreateReceiver: (stageKey: string, teamId: string, title: string) => void;
  onAddModule: (stageKey: string, name: string) => void;
  onOpenModule: (id: string) => void;
  onCopyFrom: (srcStageKey: string, destStageKey: string) => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${s.key}`, data: { type: "stage-drop", stageKey: s.key } });
  const [addingMod, setAddingMod] = useState(false);
  const [modName, setModName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const copySources = allStages
    .filter((x) => x.key !== s.key)
    .map((x) => ({ x, n: modules.filter((m) => m.stage_key === x.key).length }))
    .filter((c) => c.n > 0);

  return (
    <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
      <div style={{ height: 3, backgroundColor: s.color }} />
      <div className="px-2.5 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
          <span className="text-sm font-semibold text-slate-900 truncate flex-1" title={s.label}>{s.label}</span>
          {(copySources.length > 0) && (
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} className="text-slate-300 hover:text-slate-600 px-0.5" aria-label="Stage options" title="Copy modules from another stage"><Icon name="settings" size={13} /></button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-6 z-20 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1 text-xs">
                    <div className="px-3 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Copy modules from</div>
                      {copySources.map(({ x, n }) => (
                        <button key={x.id} onClick={() => { onCopyFrom(x.key, s.key); setMenuOpen(false); }} className="w-full text-left py-1 hover:text-brand-700 truncate">{x.label} <span className="text-slate-400">({n})</span></button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div ref={setDropRef} className={"p-2 space-y-1.5 flex-1 min-h-[64px] transition-colors " + (isOver ? "bg-brand-50/60" : "")}>
        <SortableContext items={mods.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          {mods.length === 0 && !addingMod && (
            <p className="text-[11px] text-slate-400 italic px-1 py-3 text-center">{isOver ? "Drop module here" : "No modules — add one below"}</p>
          )}
          {mods.map((m) => (
            <ModuleChip key={m.id} m={m} teams={teams} taskCount={taskCounts[m.id] ?? 0} receives={receiptsByModule[m.id]} onOpen={() => onOpenModule(m.id)} />
          ))}
        </SortableContext>

        {/* Handoffs that land here but have no receiving module yet */}
        {ghosts.map((g, i) => (
          <div key={`ghost-${i}`} className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
              <Icon name="arrow-right" size={10} /> Handoff lands here
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={`“${g.title}” from ${g.fromModule} → ${g.teamName}`}>
              “{g.title}” → {g.teamName}
            </div>
            <button
              onClick={() => onCreateReceiver(s.key, g.teamId, g.title)}
              className="mt-1 text-[10px] font-bold text-emerald-700 hover:underline"
            >
              + Create receiving module to name &amp; configure
            </button>
          </div>
        ))}

        {addingMod ? (
          <div className="flex items-center gap-1">
            <input autoFocus value={modName} onChange={(e) => setModName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && modName.trim()) { onAddModule(s.key, modName); setModName(""); setAddingMod(false); } if (e.key === "Escape") { setAddingMod(false); setModName(""); } }}
              placeholder="Module name…" className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1 outline-none" />
            <button onClick={() => { if (modName.trim()) { onAddModule(s.key, modName); setModName(""); setAddingMod(false); } }} className="text-[11px] font-semibold text-brand-700">add</button>
          </div>
        ) : (
          <button onClick={() => setAddingMod(true)} className="w-full text-[11px] font-semibold text-brand-700 hover:bg-brand-50 rounded px-1 py-1 text-left flex items-center gap-1">
            <Icon name="plus" size={11} /> module
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * Module chip — sortable; grip drags, body opens the editor drawer
 * ========================================================================== */

function ModuleChip({ m, teams, taskCount, receives, onOpen }: {
  m: WorkflowModuleRow;
  teams: TeamRow[];
  taskCount: number;
  /** Incoming handoffs that land on this module ("title from module"). */
  receives?: string[];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: m.id, data: { type: "module", stageKey: m.stage_key } as DragMeta });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const team = teams.find((t) => t.id === m.owner_team_id);
  return (
    <div ref={setNodeRef} style={style} data-mod-id={m.id}
      className={"group rounded-lg border bg-white hover:border-brand-300 hover:shadow-sm transition " + (m.enabled ? "border-slate-200" : "border-slate-200 opacity-60")}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1.5">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500" title="Drag module" aria-label="Drag module">
          <GripIcon />
        </button>
        <button onClick={onOpen} className="flex-1 min-w-0 text-left" title="Open to edit tasks">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: team?.color ?? "#cbd5e1" }} />
            <span className="text-[12px] font-semibold text-slate-800 truncate">{m.name}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 pl-3 text-[10px] text-slate-400">
            <span className="truncate">{team?.name ?? "unassigned"}</span>
            <span>·</span>
            <span className={taskCount > 0 ? "text-brand-600 font-semibold" : ""}>{taskCount} task{taskCount === 1 ? "" : "s"}</span>
          </div>
          {/* To-do hint only: once the module has tasks, the label retires
              (hover still draws its connections). */}
          {receives && receives.length > 0 && taskCount === 0 && (
            <div
              className="flex items-center gap-1 mt-0.5 pl-3 text-[10px] font-semibold text-violet-600"
              title={receives.join("\n")}
            >
              <Icon name="arrow-right" size={9} />
              receives {receives.length} handoff{receives.length === 1 ? "" : "s"} — add this team's tasks
            </div>
          )}
        </button>
        <Icon name="chevron-right" size={13} className="text-slate-300 group-hover:text-brand-500 flex-shrink-0" />
      </div>
    </div>
  );
}

/* ============================================================================
 * Module drawer — click-into editor for owner team + task templates
 * ========================================================================== */

function ModuleDrawer({
  module: mod, stageLabel, stageColor, teams, roles, stages, onClose, onUpdate, onDuplicate, onRemove, onTemplatesChanged, onEnsureReceiver,
}: {
  module: WorkflowModuleRow;
  stageLabel: string;
  stageColor: string;
  teams: TeamRow[];
  roles: TeamRoleRow[];
  stages: PipelineStageRow[];
  onClose: () => void;
  onUpdate: (patch: Partial<WorkflowModuleRow>) => Promise<void>;
  onDuplicate: () => void;
  onRemove: () => void;
  onTemplatesChanged: () => void;
  /** Fires when a handoff template gains a complete (stage, team) target. */
  onEnsureReceiver?: (stageKey: string, teamId: string, title: string) => void;
}) {
  // Plain ref — no focus trap: the dock coexists with a live canvas above.
  const dialogRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(mod.name);
  useEffect(() => { setNameDraft(mod.name); }, [mod.id, mod.name]);

  const commitName = () => {
    const next = nameDraft.trim();
    if (!next) { setNameDraft(mod.name); setRenaming(false); return; }
    if (next !== mod.name) void onUpdate({ name: next });
    setRenaming(false);
  };

  const [templates, setTemplates] = useState<WorkflowTaskTemplateRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    (async () => {
      const { data } = await supabase.from("workflow_task_templates").select("*").eq("module_id", mod.id).order("position", { ascending: true });
      if (!cancelled) setTemplates((data ?? []) as WorkflowTaskTemplateRow[]);
    })();
    return () => { cancelled = true; };
  }, [mod.id]);

  // Docked editor (not a modal): Esc closes, but the canvas above stays
  // live — clicking another module switches what you're editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const availableRoles = useMemo(() => {
    if (!mod.owner_team_id) return roles;
    return roles.filter((r) => r.team_id === mod.owner_team_id);
  }, [roles, mod.owner_team_id]);

  // 0047 review fix #9: warn at design time when a role has no holders —
  // its spawned tasks would queue unowned.
  const holders = useOrgTable<TeamRoleHolderRow>("team_role_holders");
  const emptyRoleIds = useMemo(() => {
    const held = new Set(holders.rows.map((h) => h.team_role_id));
    return new Set(availableRoles.filter((r) => !held.has(r.id)).map((r) => r.id));
  }, [holders.rows, availableRoles]);

  // Bottom-docked workbench (Chad, 2026-06-09: "don't love the right panel").
  // The canvas stays visible and LIVE above — click another module to switch.
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Edit module ${mod.name}`}
      className="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200 shadow-[0_-16px_48px_-16px_rgba(15,23,42,0.35)] flex flex-col"
      style={{ maxHeight: "46vh" }}
    >
      <div style={{ height: 3, backgroundColor: stageColor }} />
      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-shrink-0">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stageColor }} />
          <span className="uppercase tracking-wide font-semibold">{stageLabel}</span>
          <span>· module</span>
        </div>
        {renaming ? (
          <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameDraft(mod.name); setRenaming(false); } }}
            className="font-display font-bold text-base text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none flex-1 min-w-0 max-w-md" />
        ) : (
          <button onClick={() => setRenaming(true)} className="font-display font-bold text-base text-slate-900 hover:text-brand-700 text-left truncate" title="Rename">{mod.name}</button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onDuplicate}><Icon name="copy" size={13} /> Duplicate</Button>
        <button onClick={onRemove} className="text-xs font-semibold text-red-600 hover:bg-red-50 rounded px-2 py-1.5 inline-flex items-center gap-1"><Icon name="trash" size={13} /> Remove</button>
        <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 -mr-1" aria-label="Close editor"><Icon name="x" size={16} /></button>
      </div>

      <div className="px-5 py-4 overflow-y-auto grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-x-8 gap-y-4">
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Owner team</label>
            <Select value={mod.owner_team_id ?? ""} onChange={(e) => void onUpdate({ owner_team_id: e.target.value || null })}>
              <option value="">— Unassigned —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <p className="text-[10px] text-slate-400 mt-1">Its roles are who tasks assign to.</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Status</label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200 px-3 py-2">
              <input type="checkbox" checked={mod.enabled} onChange={(e) => void onUpdate({ enabled: e.target.checked })} className="accent-brand-500 w-3.5 h-3.5" />
              {mod.enabled ? "Enabled" : "Disabled"}
            </label>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description (optional)</label>
            <DraftInput value={mod.description ?? ""} onCommit={(v) => void onUpdate({ description: v || null })} placeholder="What does this module produce?" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5 gap-2">
            <div className="text-xs font-semibold text-slate-700">Tasks <span className="text-slate-400 font-normal">({templates?.length ?? 0})</span></div>
            <p className="text-[11px] text-slate-500">Fire when a study reaches <span className="font-semibold">{stageLabel}</span> · drag to reorder</p>
          </div>
          <TemplatesList moduleId={mod.id} templates={templates} setTemplates={setTemplates} availableRoles={availableRoles} allRoles={roles} teams={teams} stages={stages} onChanged={onTemplatesChanged} onHandoffTarget={onEnsureReceiver} emptyRoleIds={emptyRoleIds} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Task templates list — drag-drop reorder, inline edit, +Add
 * ========================================================================== */

function TemplatesList({
  moduleId, templates, setTemplates, availableRoles, allRoles, teams, stages, onChanged, onHandoffTarget, emptyRoleIds,
}: {
  moduleId: string;
  templates: WorkflowTaskTemplateRow[] | null;
  setTemplates: (rows: WorkflowTaskTemplateRow[]) => void;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
  teams: TeamRow[];
  stages: PipelineStageRow[];
  onChanged?: () => void;
  onHandoffTarget?: (stageKey: string, teamId: string, title: string) => void;
  emptyRoleIds?: Set<string>;
}) {
  const toast = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addTemplate = async () => {
    const nextPos = (templates ?? []).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { data, error } = await supabase.from("workflow_task_templates")
        .insert({ module_id: moduleId, kind: "manual", title: "New task", position: nextPos } as any)
        .select("*").single();
      if (error) throw error;
      setTemplates([...(templates ?? []), data as unknown as WorkflowTaskTemplateRow]);
      onChanged?.();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add task")); }
  };

  const updateTemplate = async (id: string, patch: Partial<WorkflowTaskTemplateRow>) => {
    const prev = templates ?? [];
    setTemplates(prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const { error } = await supabase.from("workflow_task_templates").update(patch as any).eq("id", id);
      if (error) throw error;
      // Handoff target became complete OR moved to a NEW (stage, team) pair →
      // materialize the receiving module. Fires only on actual pair changes,
      // not on every unrelated edit (that re-fired and duplicated receivers).
      if ("handoff_to_stage_key" in patch || "handoff_to_team_id" in patch) {
        const base = prev.find((t) => t.id === id);
        const merged = base ? { ...base, ...patch } : null;
        const pairOf = (t: { handoff_to_stage_key?: string | null; handoff_to_team_id?: string | null } | null) =>
          t?.handoff_to_stage_key && t?.handoff_to_team_id
            ? `${t.handoff_to_stage_key}|${t.handoff_to_team_id}`
            : null;
        const before = pairOf(base ?? null);
        const after = pairOf(merged);
        if (merged && merged.kind === "handoff" && after && after !== before) {
          onHandoffTarget?.(merged.handoff_to_stage_key!, merged.handoff_to_team_id!, merged.title);
        }
      }
    } catch (e: any) {
      setTemplates(prev); // roll back the optimistic edit so the UI matches the DB
      toast.error(e?.message ? `Couldn't save task: ${e.message}` : friendlyError(e, "Update failed"));
    }
  };

  const removeTemplate = async (id: string) => {
    setTemplates((templates ?? []).filter((t) => t.id !== id));
    try {
      const { error } = await supabase.from("workflow_task_templates").delete().eq("id", id);
      if (error) throw error;
      onChanged?.();
    } catch (e: any) { toast.error(friendlyError(e, "Remove failed")); }
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!templates) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = templates.findIndex((t) => t.id === active.id);
    const to = templates.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(templates, from, to);
    setTemplates(next);
    void Promise.all(next.map((t, i) => supabase.from("workflow_task_templates").update({ position: (i + 1) * 10 } as any).eq("id", t.id)));
  };

  if (templates === null) return <div className="text-[11px] text-slate-500">Loading tasks…</div>;

  return (
    <>
      {templates.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 italic">No tasks yet — add one below.</div>
      )}
      {templates.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={templates.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {templates.map((t) => (
                <TemplateRow key={t.id} template={t} availableRoles={availableRoles} allRoles={allRoles} teams={teams} stages={stages}
                  emptyRoleIds={emptyRoleIds}
                  onUpdate={(patch) => updateTemplate(t.id, patch)} onRemove={() => removeTemplate(t.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <button onClick={addTemplate} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline">
        <Icon name="plus" size={11} /> Add task
      </button>
    </>
  );
}

function TemplateRow({
  template, availableRoles, allRoles, teams, stages, emptyRoleIds, onUpdate, onRemove,
}: {
  template: WorkflowTaskTemplateRow;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
  teams: TeamRow[];
  stages: PipelineStageRow[];
  /** Roles with zero holders — tasks assigned to them queue unowned. */
  emptyRoleIds?: Set<string>;
  onUpdate: (patch: Partial<WorkflowTaskTemplateRow>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(template.title);

  const commit = () => {
    const next = titleDraft.trim();
    if (next && next !== template.title) void onUpdate({ title: next });
    setRenaming(false);
  };

  return (
    <div ref={setNodeRef} style={style} className="px-2 py-1.5 rounded-md border border-slate-200 bg-white">
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners} className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing flex-shrink-0" aria-label="Drag task template">
          <GripIcon />
        </button>
        {renaming ? (
          <input autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setTitleDraft(template.title); setRenaming(false); } }}
            className="flex-1 text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500" />
        ) : (
          <button onClick={() => setRenaming(true)} className="flex-1 text-sm font-semibold text-slate-900 hover:text-brand-700 transition truncate text-left" title="Click to rename">{template.title}</button>
        )}
        <button onClick={onRemove} className="text-slate-400 hover:text-red-600 transition text-base leading-none flex-shrink-0" title="Remove task template" aria-label="Remove task template">×</button>
      </div>
      <div className="grid grid-cols-[1fr_84px_1fr] gap-2 items-center mt-1.5 pl-7">
        <Select value={displayKind(template.kind)} onChange={(e) => void onUpdate({ kind: e.target.value as TaskKind })} className="text-xs py-1 px-2" title="Task type">
          {TASK_KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
        <div className="flex items-center gap-1">
          <Input type="number" value={template.due_offset_days ?? ""} onChange={(e) => void onUpdate({ due_offset_days: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="due" title="Days after stage entry the task is due" className="text-xs py-1 px-2" />
          <span className="text-[10px] font-mono text-slate-400">d</span>
        </div>
        <Select value={template.assigned_to_role_id ?? ""} onChange={(e) => void onUpdate({ assigned_to_role_id: e.target.value || null })}
          className="text-xs py-1 px-2" title="Role this task is assigned to. Resolves to a user via team_role_holders at spawn time.">
          <option value="">— Role —</option>
          {availableRoles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </Select>
      </div>
      {template.assigned_to_role_id && emptyRoleIds?.has(template.assigned_to_role_id) && (
        <div className="mt-1 ml-7 text-[10px] font-semibold text-amber-600">
          Nobody holds this role yet — spawned tasks will sit unassigned on the role queue. Add a holder in Team Builder.
        </div>
      )}
      {template.kind === "handoff" && (
        <div className="mt-1.5 ml-7 flex items-center gap-2 text-[11px] text-slate-600 flex-wrap">
          <Icon name="arrow-right" size={11} className="text-slate-400 flex-shrink-0" />
          <span className="font-semibold whitespace-nowrap">Hand off to</span>
          <InfoTip side="top" label="When this task completes, a receipt task opens at the chosen stage in the receiving team's shared queue — any member can pick it up. The handoff is measurable on both sides." />
          <Select value={template.handoff_to_stage_key ?? ""} onChange={(e) => void onUpdate({ handoff_to_stage_key: e.target.value || null })}
            className="text-xs py-0.5 px-2 w-36" aria-label="Stage the handoff lands at">
            <option value="">— Stage —</option>
            {stages.map((s) => <option key={s.id} value={s.key}>{s.label}</option>)}
          </Select>
          <Select value={template.handoff_to_team_id ?? ""} onChange={(e) => void onUpdate({ handoff_to_team_id: e.target.value || null })}
            className="text-xs py-0.5 px-2 w-40" aria-label="Team that receives this handoff">
            <option value="">— Team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {(!template.handoff_to_team_id || !template.handoff_to_stage_key) && (
            <span className="text-amber-600 font-semibold">pick a stage and team so the receipt can fire</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- drag ghost + grip ---------- */

function ModuleGhost({ name }: { name: string }) {
  return (
    <div className="rounded-lg border border-brand-300 bg-white shadow-lg px-2.5 py-2 text-[12px] font-semibold text-slate-900 flex items-center gap-1.5">
      <GripIcon /> {name}
    </div>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}
