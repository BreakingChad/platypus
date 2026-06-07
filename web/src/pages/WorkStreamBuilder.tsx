import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useMemo, useState } from "react";
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
  rectSortingStrategy,
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
import { useModalA11y } from "../lib/useModalA11y";
import type {
  PipelineStageRow,
  TeamRow,
  TeamRoleRow,
  WorkflowModuleRow,
  WorkflowTaskTemplateRow,
  TaskKind,
  WorkstreamRow,
} from "../lib/types";

import { Card } from "../components/ui/Card";
import { flowColumns, mergeWithPrevious, canMergeWithPrevious } from "../lib/flow";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { InfoTip } from "../components/ui/Tip";
import { EmptyState } from "../components/ui/EmptyState";

/** WorkStreamBuilder — one visual canvas for the operating model.
 *
 *  Stages run left-to-right (sequential, or stacked into a parallel lane).
 *  Each stage holds modules; each module spawns tasks when a study reaches
 *  the stage. Everything is direct-manipulation:
 *    • drag a stage by its grip to reorder the pipeline
 *    • drag a module within a stage, or across to another stage
 *    • click a module to open its editor drawer (owner team + task templates)
 *
 *  Persists to public.pipeline_stages, public.workflow_modules, and
 *  public.workflow_task_templates via Supabase. RLS gates writes to admins.
 */

const TASK_KINDS: TaskKind[] = ["manual", "date", "handoff", "escalation", "external_handoff"];
const KIND_LABELS: Record<TaskKind, string> = {
  manual: "Manual task",
  date: "Date completed",
  handoff: "Handoff",
  escalation: "Escalation",
  external_handoff: "External handoff",
};
const STAGE_COLORS = ["#6366F1", "#0284C7", "#059669", "#b45309", "#7C3AED", "#BE185D", "#4F46E5", "#10B981", "#EF4444", "#64748B"];

type DragMeta = { type: "stage" | "module"; stageKey?: string };

export function WorkStreamBuilder() {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();

  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const workstreams = useOrgTable<WorkstreamRow>("workstreams", { orderBy: "created_at", realtime: true });
  const roles = useOrgTable<TeamRoleRow>("team_roles", { realtime: true });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position", realtime: true });

  /** Which module's editor drawer is open. */
  const [editorModuleId, setEditorModuleId] = useState<string | null>(null);
  const editorModule = modules.rows.find((m) => m.id === editorModuleId) ?? null;

  /** Which saved work stream is being edited (selection follows the default). */
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);
  const activeWorkstreams = workstreams.rows.filter((w) => w.status === "active");
  useEffect(() => {
    if (selectedWsId && activeWorkstreams.some((w) => w.id === selectedWsId)) return;
    const fallback = activeWorkstreams.find((w) => w.is_default) ?? activeWorkstreams[0] ?? null;
    setSelectedWsId(fallback?.id ?? null);
  }, [activeWorkstreams, selectedWsId]);
  const selectedWs = activeWorkstreams.find((w) => w.id === selectedWsId) ?? null;
  const selectedWsModuleCount = modules.rows.filter((m) => m.workstream_id === selectedWsId).length;

  /** Task-template counts per module, shown on the flow chips. */
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [countsNonce, setCountsNonce] = useState(0);
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("workflow_task_templates")
        .select("module_id");
      if (cancelled || !data) return;
      const counts: Record<string, number> = {};
      for (const r of data as { module_id: string }[]) counts[r.module_id] = (counts[r.module_id] ?? 0) + 1;
      setTaskCounts(counts);
    })();
    return () => { cancelled = true; };
  }, [orgId, countsNonce, modules.rows.length]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDrag, setActiveDrag] = useState<{ id: string; meta: DragMeta } | null>(null);

  /* ---------- stage mutators ---------- */

  const addStage = async () => {
    if (!orgId) return;
    const nextPos = stages.rows.reduce((m, s) => Math.max(m, s.position), 0) + 10;
    try {
      await stages.insert({
        key: `stage_${Date.now().toString(36)}`,
        label: "New stage",
        color: STAGE_COLORS[stages.rows.length % STAGE_COLORS.length],
        target_days: 14,
        terminal: false,
        is_core: false,
        position: nextPos,
      } as any);
      toast.success(stamped("Stage added — name it"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add stage")); }
  };
  const updateStage = (id: string, patch: Partial<PipelineStageRow>) =>
    stages.update(id, patch).catch((e: any) => toast.error(friendlyError(e, "Update failed")));
  const removeStage = async (s: PipelineStageRow) => {
    if (s.is_core) { toast.error("Core stages can't be removed"); return; }
    if (!(await confirmDialog({ title: "Remove stage", message: `Remove "${s.label}"? Its modules go with it.`, confirmLabel: "Remove", danger: true }))) return;
    try { await stages.remove(s.id); toast.success(stamped(`Removed "${s.label}"`)); }
    catch (e: any) { toast.error(friendlyError(e, "Remove failed")); }
  };
  const reorderStages = async (orderedIds: string[]) => {
    try {
      await Promise.all(orderedIds.map((id, i) => stages.update(id, { position: (i + 1) * 10 } as any)));
    } catch (e: any) { toast.error(friendlyError(e, "Reorder failed")); }
  };
  /** Insert a new sequential stage right after a given stage (not just at the end). */
  const addStageAfter = async (afterStage: PipelineStageRow) => {
    if (!orgId) return;
    try {
      const created = await stages.insert({
        key: `stage_${Date.now().toString(36)}`,
        label: "New stage",
        color: STAGE_COLORS[stages.rows.length % STAGE_COLORS.length],
        target_days: 14,
        terminal: false,
        is_core: false,
        parallel_group: null,
        position: afterStage.position + 1,
      } as any);
      if (!created) return;
      const sorted = [...stages.rows].sort((a, b) => a.position - b.position).filter((s) => s.id !== created.id);
      const idx = sorted.findIndex((s) => s.id === afterStage.id);
      const order = [...sorted];
      order.splice(idx + 1, 0, created);
      await reorderStages(order.map((s) => s.id));
      toast.success(stamped("Stage added — name it"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add stage")); }
  };

  const setStageParallel = async (patches: { id: string; parallel_group: number | null }[]) => {
    try {
      await Promise.all(patches.map((p) =>
        supabase.from("pipeline_stages").update({ parallel_group: p.parallel_group } as any).eq("id", p.id)
      ));
      await stages.refresh();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't change the lane")); }
  };

  /** Parallelize: drop one stage onto another → they run at the same time.
   *  Joins the target's lane (or starts a new one). Unlimited width — keep
   *  dragging stages onto the lane. */
  const parallelizeStages = async (draggedId: string, targetId: string) => {
    const dragged = stages.rows.find((s) => s.id === draggedId);
    const target = stages.rows.find((s) => s.id === targetId);
    if (!dragged || !target || draggedId === targetId) return;
    const group = target.parallel_group ?? target.position;
    // Order: place dragged immediately after target (keeps the lane contiguous).
    const sorted = [...stages.rows].sort((a, b) => a.position - b.position).filter((s) => s.id !== draggedId);
    const idx = sorted.findIndex((s) => s.id === targetId);
    const order = [...sorted];
    order.splice(idx + 1, 0, dragged);
    try {
      await Promise.all([
        supabase.from("pipeline_stages").update({ parallel_group: group } as any).eq("id", target.id),
        supabase.from("pipeline_stages").update({ parallel_group: group } as any).eq("id", dragged.id),
        ...order.map((s, i) => supabase.from("pipeline_stages").update({ position: (i + 1) * 10 } as any).eq("id", s.id)),
      ]);
      await stages.refresh();
      toast.success(stamped(`${dragged.label} now runs in parallel with ${target.label}`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't parallelize")); }
  };

  /** Move a stage to a sequential position (its own column), splitting it out
   *  of any lane it was in. afterStageId null = move to the front. */
  const reorderStageSequential = async (draggedId: string, afterStageId: string | null) => {
    const dragged = stages.rows.find((s) => s.id === draggedId);
    if (!dragged) return;
    const sorted = [...stages.rows].sort((a, b) => a.position - b.position).filter((s) => s.id !== draggedId);
    const insertAt = afterStageId ? sorted.findIndex((s) => s.id === afterStageId) + 1 : 0;
    const order = [...sorted];
    order.splice(insertAt, 0, dragged);
    try {
      await Promise.all([
        supabase.from("pipeline_stages").update({ parallel_group: null } as any).eq("id", dragged.id),
        ...order.map((s, i) => supabase.from("pipeline_stages").update({ position: (i + 1) * 10 } as any).eq("id", s.id)),
      ]);
      await stages.refresh();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't move the stage")); }
  };

  /* ---------- module mutators ---------- */

  const addModuleTo = async (stageKey: string, name: string) => {
    if (!orgId || !name.trim()) return;
    if (!selectedWsId) { toast.error("Pick or create a work stream first"); return; }
    const pos = modules.rows.filter((m) => m.stage_key === stageKey && m.workstream_id === selectedWsId).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { data, error } = await supabase
        .from("workflow_modules")
        .insert({ org_id: orgId, stage_key: stageKey, workstream_id: selectedWsId, name: name.trim(), enabled: true, position: pos } as any)
        .select("id")
        .single();
      if (error) throw error;
      toast.success(stamped(`Module "${name.trim()}" added`));
      if (data) setEditorModuleId((data as any).id as string); // open it so they can add tasks
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add module")); }
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

  /** Move/reorder a module: set its stage, renumber the target stage. */
  const persistModuleMove = async (moduleId: string, targetKey: string, orderedTargetIds: string[]) => {
    const mod = modules.rows.find((m) => m.id === moduleId);
    if (!mod) return;
    try {
      const ops: PromiseLike<unknown>[] = [];
      if (mod.stage_key !== targetKey) {
        ops.push(supabase.from("workflow_modules").update({ stage_key: targetKey } as any).eq("id", moduleId));
      }
      orderedTargetIds.forEach((id, i) => {
        ops.push(supabase.from("workflow_modules").update({ position: (i + 1) * 10 } as any).eq("id", id));
      });
      await Promise.all(ops);
      if (mod.stage_key !== targetKey) toast.success(stamped(`Moved "${mod.name}" → ${stageLabel(targetKey)}`));
    } catch (e: any) { toast.error(friendlyError(e, "Move failed")); }
  };

  const stageLabel = (key: string) => stages.rows.find((s) => s.key === key)?.label ?? key;

  /** Deep-copy a module (+ its task templates) onto a stage. */
  const deepCopyModule = async (src: WorkflowModuleRow, toStageKey: string, position: number, name?: string, toWorkstreamId?: string | null): Promise<{ taskCount: number }> => {
    const { data: created, error } = await supabase
      .from("workflow_modules")
      .insert({
        org_id: src.org_id, stage_key: toStageKey, workstream_id: toWorkstreamId ?? src.workstream_id, owner_team_id: src.owner_team_id,
        name: name ?? src.name, description: src.description, enabled: src.enabled, position,
      } as any)
      .select("id")
      .single();
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
          handoff_to_role_id: t.handoff_to_role_id ?? null, position: t.position,
        })) as any
      );
      if (insErr) throw insErr;
    }
    return { taskCount: tpls?.length ?? 0 };
  };

  const duplicateModule = async (src: WorkflowModuleRow) => {
    const nextPos = modules.rows.filter((m) => m.stage_key === src.stage_key).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { taskCount } = await deepCopyModule(src, src.stage_key, nextPos, `${src.name} (copy)`);
      toast.success(stamped(`Duplicated "${src.name}" — ${taskCount} task${taskCount === 1 ? "" : "s"} copied`));
      setCountsNonce((n) => n + 1);
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't duplicate the module")); }
  };

  const copyFromStage = async (srcStageKey: string, destStageKey: string) => {
    const srcMods = modules.rows.filter((m) => m.stage_key === srcStageKey).sort((a, b) => a.position - b.position);
    if (srcMods.length === 0) return;
    const srcLabel = stageLabel(srcStageKey);
    if (!(await confirmDialog({
      title: "Copy modules from a stage",
      message: `Copy ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} (with their task templates) from "${srcLabel}" onto this stage? They arrive enabled and fully editable.`,
      confirmLabel: "Copy modules",
    }))) return;
    try {
      let pos = modules.rows.filter((m) => m.stage_key === destStageKey).reduce((m, x) => Math.max(m, x.position), 0);
      let tasks = 0;
      for (const m of srcMods) { pos += 10; const { taskCount } = await deepCopyModule(m, destStageKey, pos); tasks += taskCount; }
      toast.success(stamped(`Copied ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} · ${tasks} task${tasks === 1 ? "" : "s"} from ${srcLabel}`));
      setCountsNonce((n) => n + 1);
    } catch (e: any) { toast.error(friendlyError(e, "Copy failed part-way — review the modules below")); }
  };

  /* ---------- saved work streams ---------- */
  const createWorkstream = async (name: string) => {
    if (!orgId || !name.trim()) return;
    try {
      const isFirst = workstreams.rows.length === 0;
      await workstreams.insert({ name: name.trim(), status: "active", is_default: isFirst } as any);
      toast.success(stamped(`Work stream "${name.trim()}" saved`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't save the work stream")); }
  };
  const renameWorkstream = (id: string, name: string) =>
    workstreams.update(id, { name }).catch((e: any) => toast.error(friendlyError(e, "Rename failed")));
  const setDefaultWorkstream = async (id: string) => {
    try {
      await Promise.all(workstreams.rows.map((x) => workstreams.update(x.id, { is_default: x.id === id })));
      toast.success(stamped("Default work stream set"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't set default")); }
  };
  const duplicateWorkstream = async (src: WorkstreamRow) => {
    if (!orgId) return;
    try {
      const created = await workstreams.insert({ name: `${src.name} (copy)`, description: src.description, status: "active", is_default: false } as any);
      if (!created) return;
      // Deep-copy the whole flow: every module on this work stream + its tasks.
      const srcMods = modules.rows.filter((m) => m.workstream_id === src.id).sort((a, b) => a.position - b.position);
      let tasks = 0;
      for (const m of srcMods) {
        const r = await deepCopyModule(m, m.stage_key, m.position, undefined, created.id);
        tasks += r.taskCount;
      }
      setSelectedWsId(created.id);
      toast.success(stamped(`Copied "${src.name}" — ${srcMods.length} module${srcMods.length === 1 ? "" : "s"}, ${tasks} task${tasks === 1 ? "" : "s"}`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't copy")); }
  };
  const archiveWorkstream = async (src: WorkstreamRow) => {
    if (!(await confirmDialog({ title: "Archive work stream", message: `Archive "${src.name}"? Studies already on it keep it; it won't appear when creating new studies.`, confirmLabel: "Archive" }))) return;
    try { await workstreams.update(src.id, { status: "archived" }); toast.success(stamped(`Archived "${src.name}"`)); }
    catch (e: any) { toast.error(friendlyError(e, "Couldn't archive")); }
  };

  /* ---------- drag-and-drop ---------- */

  const onDragStart = (e: DragStartEvent) =>
    setActiveDrag({ id: String(e.active.id), meta: (e.active.data.current as DragMeta) ?? { type: "module" } });

  const onDragEnd = (e: DragEndEvent) => {
    const meta = activeDrag?.meta;
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const overMeta = over.data.current as DragMeta | { type: "stage-drop"; stageKey: string } | undefined;

    /* ---- stage: drop on a GAP = reorder sequentially; drop on a CARD = parallelize ---- */
    if (meta?.type === "stage") {
      if (active.id === over.id) return;
      // Dropped on a between-columns gap → sequential move (split out of any lane).
      if ((overMeta as any)?.type === "stage-gap") {
        void reorderStageSequential(String(active.id), (overMeta as any).afterStageId ?? null);
        return;
      }
      // Otherwise resolve which stage we dropped onto → parallelize with it.
      let overStageId: string | null = null;
      if (overMeta?.type === "stage") overStageId = String(over.id);
      else if (overMeta?.type === "module") overStageId = stages.rows.find((s) => s.key === (overMeta as DragMeta).stageKey)?.id ?? null;
      else if ((overMeta as any)?.type === "stage-drop") overStageId = stages.rows.find((s) => s.key === (overMeta as any).stageKey)?.id ?? null;
      if (!overStageId || overStageId === active.id) return;
      void parallelizeStages(String(active.id), overStageId);
      return;
    }

    /* ---- module reorder / cross-stage move ---- */
    const mod = modules.rows.find((m) => m.id === active.id);
    if (!mod) return;
    let targetKey: string | null = null;
    let overModuleId: string | null = null;
    if (overMeta?.type === "module") { overModuleId = String(over.id); targetKey = (overMeta as DragMeta).stageKey ?? null; }
    else if ((overMeta as any)?.type === "stage-drop") targetKey = (overMeta as any).stageKey;
    else if (overMeta?.type === "stage") targetKey = stages.rows.find((s) => s.id === String(over.id))?.key ?? null;
    if (!targetKey) return;
    if (targetKey === mod.stage_key && (active.id === over.id || overModuleId === mod.id)) return;

    const targetMods = modules.rows
      .filter((m) => m.stage_key === targetKey && m.id !== mod.id)
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
    return <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Work streams" />
        <Card className="mt-6">
          <EmptyState iconName="lock" title="Admin-only surface" sub="Only org admins can design the pipeline and work streams." />
        </Card>
      </div>
    );
  }

  const flatStageIds = [...stages.rows].sort((a, b) => a.position - b.position).map((s) => s.id);

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Work streams"
        subtitle="Define the pathways studies follow. Pick a work stream below to edit it, then drag stages and modules on the canvas. A study is put on one work stream at intake."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-700 px-2.5 py-1.5 text-xs font-semibold" title="There's no save button — every change is written instantly">
            <Icon name="check" size={13} /> Auto-saved
          </span>
        }
      />

      <WorkstreamManager
        workstreams={activeWorkstreams}
        selectedId={selectedWsId}
        onSelect={(id) => setSelectedWsId(id)}
        onCreate={(name) => void createWorkstream(name)}
        onRename={(id, name) => void renameWorkstream(id, name)}
        onSetDefault={(id) => void setDefaultWorkstream(id)}
        onDuplicate={(ws) => void duplicateWorkstream(ws)}
        onArchive={(ws) => void archiveWorkstream(ws)}
      />

      {stages.rows.length === 0 ? (
        <Card className="mt-6">
          <EmptyState
            iconName="workflow"
            title="No stages yet"
            sub="Add your first pipeline stage to start designing the flow."
            action={<Button variant="primary" onClick={() => void addStage()}><Icon name="plus" size={12} /> Add stage</Button>}
          />
        </Card>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="mt-6 mb-1 flex items-center gap-2 flex-wrap">
            <Icon name="workflow" size={14} className="text-brand-500" />
            <span className="text-sm font-semibold text-slate-800">
              {selectedWs ? <>Editing <span className="text-brand-700">{selectedWs.name}</span></> : "Pipeline & modules"}
            </span>
            <span className="text-[11px] text-slate-400">— click a module to edit its tasks</span>
          </div>
          <div className="mb-3 flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            <Icon name="info" size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <span><span className="font-semibold">Modules</span> save to this work stream. <span className="font-semibold">Stage order, parallel grouping, names &amp; targets are the shared pipeline</span> — editing them here changes every work stream.</span>
          </div>
          {selectedWs && selectedWsModuleCount === 0 && (
            <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
              <Icon name="info" size={14} className="text-brand-500 flex-shrink-0" />
              <span><span className="font-semibold text-slate-800">{selectedWs.name}</span> has no modules yet. Add one under any stage with <span className="font-semibold">+ module</span> — modules spawn tasks when a study reaches that stage.</span>
            </div>
          )}
          <SortableContext items={flatStageIds} strategy={rectSortingStrategy}>
            <FlowCanvas
              stages={stages.rows}
              modules={modules.rows.filter((m) => m.workstream_id === selectedWsId)}
              teams={teams.rows}
              taskCounts={taskCounts}
              isStageDragging={activeDrag?.meta.type === "stage"}
              onAddStage={() => void addStage()}
              onAddStageAfter={(s) => void addStageAfter(s)}
              onRenameStage={(id, label) => void updateStage(id, { label })}
              onTargetStage={(id, days) => void updateStage(id, { target_days: days })}
              onToggleTerminal={(id, v) => void updateStage(id, { terminal: v })}
              onRemoveStage={(s) => void removeStage(s)}
              onMerge={(id) => void setStageParallel(mergeWithPrevious(stages.rows, id))}
              onSplit={(id) => void setStageParallel([{ id, parallel_group: null }])}
              canMerge={(id) => canMergeWithPrevious(stages.rows, id)}
              onAddModule={(key, name) => void addModuleTo(key, name)}
              onOpenModule={(id) => setEditorModuleId(id)}
              onCopyFrom={(src, dest) => void copyFromStage(src, dest)}
            />
          </SortableContext>
          <DragOverlay>
            {activeDrag?.meta.type === "stage" ? (() => {
              const s = stages.rows.find((x) => x.id === activeDrag.id);
              return s ? <StageGhost label={s.label} color={s.color} /> : null;
            })() : activeDrag ? (() => {
              const m = modules.rows.find((x) => x.id === activeDrag.id);
              return m ? <ModuleGhost name={m.name} /> : null;
            })() : null}
          </DragOverlay>
        </DndContext>
      )}

      {editorModule && (
        <ModuleDrawer
          module={editorModule}
          stageLabel={stageLabel(editorModule.stage_key)}
          stageColor={stages.rows.find((s) => s.key === editorModule.stage_key)?.color ?? "#64748b"}
          teams={teams.rows}
          roles={roles.rows}
          onClose={() => { setEditorModuleId(null); setCountsNonce((n) => n + 1); }}
          onUpdate={(patch) => updateModule(editorModule.id, patch)}
          onDuplicate={() => void duplicateModule(editorModule)}
          onRemove={() => void removeModule(editorModule.id, editorModule.name)}
          onTemplatesChanged={() => setCountsNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * Saved work streams — selectable pathways assigned at intake
 * ========================================================================== */

function WorkstreamManager({
  workstreams, selectedId, onSelect, onCreate, onRename, onSetDefault, onDuplicate, onArchive,
}: {
  workstreams: WorkstreamRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onSetDefault: (id: string) => void;
  onDuplicate: (ws: WorkstreamRow) => void;
  onArchive: (ws: WorkstreamRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="workflow" size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-700">Saved work streams</span>
        <span className="text-[11px] text-slate-400">— click one to edit it; a study is assigned one at intake</span>
        <div className="flex-1" />
        {adding ? (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name); setName(""); setAdding(false); } if (e.key === "Escape") { setAdding(false); setName(""); } }}
              placeholder="e.g. Industry interventional" className="text-sm w-52" />
            <Button size="sm" variant="primary" onClick={() => { if (name.trim()) { onCreate(name); setName(""); setAdding(false); } }} disabled={!name.trim()}>Save</Button>
          </div>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> New work stream</Button>
        )}
      </div>
      {workstreams.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic">None yet — create your first pathway above. New studies pick a work stream at intake.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {workstreams.map((ws) => {
            const selected = ws.id === selectedId;
            return (
              <div
                key={ws.id}
                onClick={() => onSelect(ws.id)}
                className={
                  "group flex items-center gap-2 rounded-lg border pl-3 pr-2 py-2 text-sm cursor-pointer transition " +
                  (selected ? "border-brand-400 bg-brand-50 ring-1 ring-brand-500/20" : "border-slate-200 bg-white hover:border-slate-300")
                }
              >
                {editId === ws.id ? (
                  <input autoFocus value={editName} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { const t = editName.trim(); if (t && t !== ws.name) onRename(ws.id, t); setEditId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditId(null); }}
                    className="text-sm font-semibold border border-brand-200 rounded px-1 py-0.5 outline-none" />
                ) : (
                  <span className={"font-semibold " + (selected ? "text-brand-800" : "text-slate-700")}>{ws.name}</span>
                )}
                {ws.is_default && <span className="rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5" title="New studies are assigned this work stream at intake">Default</span>}
                {selected && <span className="rounded-full bg-brand-100 text-brand-700 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5">Editing</span>}
                <span className="flex items-center gap-1 text-slate-400 ml-1 opacity-0 group-hover:opacity-100 transition">
                  {!ws.is_default && <button onClick={(e) => { e.stopPropagation(); onSetDefault(ws.id); }} className="hover:text-amber-500 p-0.5" title="Set as default for new studies" aria-label="Set as default">★</button>}
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
 * Flow canvas — left-to-right columns, parallel stages stacked in one column
 * ========================================================================== */

function FlowCanvas({
  stages, modules, teams, taskCounts, isStageDragging,
  onAddStage, onAddStageAfter, onRenameStage, onTargetStage, onToggleTerminal, onRemoveStage,
  onMerge, onSplit, canMerge, onAddModule, onOpenModule, onCopyFrom,
}: {
  stages: PipelineStageRow[];
  modules: WorkflowModuleRow[];
  teams: TeamRow[];
  taskCounts: Record<string, number>;
  isStageDragging: boolean;
  onAddStage: () => void;
  onAddStageAfter: (afterStage: PipelineStageRow) => void;
  onRenameStage: (id: string, label: string) => void;
  onTargetStage: (id: string, days: number) => void;
  onToggleTerminal: (id: string, v: boolean) => void;
  onRemoveStage: (s: PipelineStageRow) => void;
  onMerge: (id: string) => void;
  onSplit: (id: string) => void;
  canMerge: (id: string) => boolean;
  onAddModule: (stageKey: string, name: string) => void;
  onOpenModule: (id: string) => void;
  onCopyFrom: (srcStageKey: string, destStageKey: string) => void;
}) {
  const cols = flowColumns(stages);
  return (
    <div className="mt-6 overflow-x-auto pb-4">
      {isStageDragging && (
        <div className="mb-2 text-[11px] text-brand-600 font-semibold">
          Drop on another stage to run them in parallel · drop in a gap to set the sequence
        </div>
      )}
      <div className="flex items-start gap-0 min-w-max">
        <GapDrop index={0} afterStageId={null} active={isStageDragging} showArrow={false} />
        {cols.map((col, ci) => {
          const lastOfCol = col.stages[col.stages.length - 1];
          return (
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
                  <StageCard
                    key={s.id}
                    s={s}
                    mods={modules.filter((m) => m.stage_key === s.key).sort((a, b) => a.position - b.position)}
                    allStages={stages}
                    modules={modules}
                    teams={teams}
                    taskCounts={taskCounts}
                    inLane={col.stages.length > 1}
                    canMerge={canMerge(s.id)}
                    onRename={onRenameStage}
                    onTarget={onTargetStage}
                    onTerminal={onToggleTerminal}
                    onRemove={onRemoveStage}
                    onMerge={onMerge}
                    onSplit={onSplit}
                    onAddModule={onAddModule}
                    onOpenModule={onOpenModule}
                    onCopyFrom={onCopyFrom}
                  />
                ))}
              </div>
              <GapDrop index={ci + 1} afterStageId={lastOfCol.id} active={isStageDragging} showArrow onInsert={() => onAddStageAfter(lastOfCol)} />
            </div>
          );
        })}
        <button
          onClick={onAddStage}
          className="w-40 self-start mt-0 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-brand-300 hover:text-brand-700 transition flex items-center justify-center gap-1.5 text-sm font-semibold min-h-[140px]"
        >
          <Icon name="plus" size={14} /> Stage
        </button>
      </div>
    </div>
  );
}

/** Between-columns drop zone: reorder a dragged stage here (sequential), and —
 *  when not dragging — hover to insert a new stage at this position. */
function GapDrop({ index, afterStageId, active, showArrow, onInsert }: {
  index: number;
  afterStageId: string | null;
  active: boolean;
  showArrow: boolean;
  onInsert?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${index}`, data: { type: "stage-gap", afterStageId } });
  if (active) {
    return (
      <div ref={setNodeRef} className="self-stretch flex items-center justify-center px-1 min-w-[36px]" title="Drop here to set the sequence">
        <div className={"rounded-full transition-all " + (isOver ? "w-1.5 h-40 bg-brand-500" : "w-1 h-28 bg-brand-200")} />
      </div>
    );
  }
  return (
    <div ref={setNodeRef} className="group/conn px-1 self-center flex flex-col items-center justify-center min-w-[24px]">
      {onInsert && (
        <button onClick={onInsert} className="opacity-0 group-hover/conn:opacity-100 transition text-slate-300 hover:text-brand-600 mb-0.5" title="Insert a stage here" aria-label="Insert stage here">
          <Icon name="plus" size={14} />
        </button>
      )}
      {showArrow && <Icon name="arrow-right" size={18} className="text-slate-300" aria-hidden="true" />}
    </div>
  );
}

/* ============================================================================
 * Stage card — sortable; holds a droppable, sortable list of module chips
 * ========================================================================== */

function StageCard({
  s, mods, allStages, modules, teams, taskCounts, inLane, canMerge,
  onRename, onTarget, onTerminal, onRemove, onMerge, onSplit, onAddModule, onOpenModule, onCopyFrom,
}: {
  s: PipelineStageRow;
  mods: WorkflowModuleRow[];
  allStages: PipelineStageRow[];
  modules: WorkflowModuleRow[];
  teams: TeamRow[];
  taskCounts: Record<string, number>;
  inLane: boolean;
  canMerge: boolean;
  onRename: (id: string, label: string) => void;
  onTarget: (id: string, days: number) => void;
  onTerminal: (id: string, v: boolean) => void;
  onRemove: (s: PipelineStageRow) => void;
  onMerge: (id: string) => void;
  onSplit: (id: string) => void;
  onAddModule: (stageKey: string, name: string) => void;
  onOpenModule: (id: string) => void;
  onCopyFrom: (srcStageKey: string, destStageKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: s.id, data: { type: "stage" } as DragMeta });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${s.key}`, data: { type: "stage-drop", stageKey: s.key } });

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(s.label);
  const [addingMod, setAddingMod] = useState(false);
  const [modName, setModName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const copySources = allStages
    .filter((x) => x.key !== s.key)
    .map((x) => ({ x, n: modules.filter((m) => m.stage_key === x.key).length }))
    .filter((c) => c.n > 0);

  return (
    <div ref={setNodeRef} style={style}
      className="w-64 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col"
    >
      {/* tinted top border by stage color */}
      <div style={{ height: 3, backgroundColor: s.color }} />

      {/* header */}
      <div className="px-2.5 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <button
            {...attributes} {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 -ml-0.5"
            title="Drag to reorder stage" aria-label="Drag stage"
          >
            <GripIcon />
          </button>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
          {renaming ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { const t = draft.trim(); if (t && t !== s.label) onRename(s.id, t); setRenaming(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(s.label); setRenaming(false); } }}
              className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1 py-0.5 outline-none flex-1 min-w-0" />
          ) : (
            <button onClick={() => setRenaming(true)} className="text-sm font-semibold text-slate-900 truncate flex-1 text-left hover:text-brand-700" title="Rename">{s.label}</button>
          )}
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="text-slate-300 hover:text-slate-600 px-0.5" aria-label="Stage menu" title="Stage options">
              <Icon name="settings" size={13} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-6 z-20 w-52 rounded-lg border border-slate-200 bg-white shadow-lg py-1 text-xs">
                  {inLane ? (
                    <button onClick={() => { onSplit(s.id); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">Split out of parallel lane</button>
                  ) : canMerge ? (
                    <button onClick={() => { onMerge(s.id); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">∥ Run parallel with previous</button>
                  ) : null}
                  {copySources.length > 0 && (
                    <div className="px-3 py-1.5 border-t border-slate-100">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Copy modules from</div>
                      {copySources.map(({ x, n }) => (
                        <button key={x.id} onClick={() => { onCopyFrom(x.key, s.key); setMenuOpen(false); }} className="w-full text-left py-1 hover:text-brand-700 truncate">{x.label} <span className="text-slate-400">({n})</span></button>
                      ))}
                    </div>
                  )}
                  {!s.is_core && (
                    <button onClick={() => { onRemove(s); setMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 border-t border-slate-100">Remove stage</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5 pl-5">
          <label className="flex items-center gap-1 text-[11px] text-slate-400">
            target
            <input type="number" value={s.target_days} onChange={(e) => onTarget(s.id, Number(e.target.value))} className="w-12 text-[11px] font-mono border border-slate-200 rounded px-1 py-0.5" />d
          </label>
          <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer ml-auto">
            <input type="checkbox" checked={s.terminal} onChange={(e) => onTerminal(s.id, e.target.checked)} className="accent-brand-500 w-3 h-3" />terminal
          </label>
        </div>
      </div>

      {/* module list — droppable + sortable */}
      <div
        ref={setDropRef}
        className={"p-2 space-y-1.5 flex-1 min-h-[64px] transition-colors " + (isOver ? "bg-brand-50/60" : "")}
      >
        <SortableContext items={mods.map((m) => m.id)} strategy={verticalListSortingStrategy}>
          {mods.length === 0 && !addingMod && (
            <p className="text-[11px] text-slate-400 italic px-1 py-3 text-center">
              {isOver ? "Drop module here" : "No modules — add one below"}
            </p>
          )}
          {mods.map((m) => (
            <ModuleChip key={m.id} m={m} teams={teams} taskCount={taskCounts[m.id] ?? 0} onOpen={() => onOpenModule(m.id)} />
          ))}
        </SortableContext>

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

function ModuleChip({ m, teams, taskCount, onOpen }: {
  m: WorkflowModuleRow;
  teams: TeamRow[];
  taskCount: number;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: m.id, data: { type: "module", stageKey: m.stage_key } as DragMeta });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const team = teams.find((t) => t.id === m.owner_team_id);
  return (
    <div ref={setNodeRef} style={style}
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
  module: mod, stageLabel, stageColor, teams, roles, onClose, onUpdate, onDuplicate, onRemove, onTemplatesChanged,
}: {
  module: WorkflowModuleRow;
  stageLabel: string;
  stageColor: string;
  teams: TeamRow[];
  roles: TeamRoleRow[];
  onClose: () => void;
  onUpdate: (patch: Partial<WorkflowModuleRow>) => Promise<void>;
  onDuplicate: () => void;
  onRemove: () => void;
  onTemplatesChanged: () => void;
}) {
  const dialogRef = useModalA11y<HTMLDivElement>(onClose);
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

  const availableRoles = useMemo(() => {
    if (!mod.owner_team_id) return roles;
    return roles.filter((r) => r.team_id === mod.owner_team_id);
  }, [roles, mod.owner_team_id]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit module ${mod.name}`}
        className="relative w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto flex flex-col"
      >
        <div style={{ height: 3, backgroundColor: stageColor }} />
        <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stageColor }} />
              <span className="uppercase tracking-wide font-semibold">{stageLabel}</span>
              <span>· module</span>
            </div>
            {renaming ? (
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={commitName}
                onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameDraft(mod.name); setRenaming(false); } }}
                className="font-display font-bold text-lg text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none w-full" />
            ) : (
              <button onClick={() => setRenaming(true)} className="font-display font-bold text-lg text-slate-900 hover:text-brand-700 text-left truncate w-full" title="Rename">{mod.name}</button>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 -mr-1" aria-label="Close"><Icon name="x" size={18} /></button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-3">
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
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-200 px-3 py-2.5">
                <input type="checkbox" checked={mod.enabled} onChange={(e) => void onUpdate({ enabled: e.target.checked })} className="accent-brand-500 w-3.5 h-3.5" />
                {mod.enabled ? "Enabled" : "Disabled"}
              </label>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description (optional)</label>
            <Input value={mod.description ?? ""} onChange={(e) => void onUpdate({ description: e.target.value || null })} placeholder="What does this module produce?" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs font-semibold text-slate-700">Task templates <span className="text-slate-400 font-normal">({templates?.length ?? 0})</span></div>
            </div>
            <p className="text-[11px] text-slate-500 mb-2">These fire as tasks when a study reaches <span className="font-semibold">{stageLabel}</span>. Drag to reorder.</p>
            <TemplatesList
              moduleId={mod.id}
              templates={templates}
              setTemplates={setTemplates}
              availableRoles={availableRoles}
              allRoles={roles}
              onChanged={onTemplatesChanged}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDuplicate}><Icon name="copy" size={13} /> Duplicate</Button>
          <button onClick={onRemove} className="text-xs font-semibold text-red-600 hover:bg-red-50 rounded px-2 py-1.5 inline-flex items-center gap-1"><Icon name="trash" size={13} /> Remove</button>
          <div className="flex-1" />
          <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Task templates list — drag-drop reorder, inline edit, +Add
 * ========================================================================== */

function TemplatesList({
  moduleId, templates, setTemplates, availableRoles, allRoles, onChanged,
}: {
  moduleId: string;
  templates: WorkflowTaskTemplateRow[] | null;
  setTemplates: (rows: WorkflowTaskTemplateRow[]) => void;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
  onChanged?: () => void;
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
    setTemplates((templates ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)));
    try {
      const { error } = await supabase.from("workflow_task_templates").update(patch as any).eq("id", id);
      if (error) throw error;
    } catch (e: any) { toast.error(friendlyError(e, "Update failed")); }
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
    void Promise.all(next.map((t, i) =>
      supabase.from("workflow_task_templates").update({ position: (i + 1) * 10 } as any).eq("id", t.id)
    ));
  };

  if (templates === null) return <div className="text-[11px] text-slate-500">Loading task templates…</div>;

  return (
    <>
      {templates.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 italic">
          No tasks yet. Add one below.
        </div>
      )}
      {templates.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={templates.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {templates.map((t) => (
                <TemplateRow key={t.id} template={t} availableRoles={availableRoles} allRoles={allRoles}
                  onUpdate={(patch) => updateTemplate(t.id, patch)} onRemove={() => removeTemplate(t.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <button onClick={addTemplate} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline">
        <Icon name="plus" size={11} /> Add task template
      </button>
    </>
  );
}

function TemplateRow({
  template, availableRoles, allRoles, onUpdate, onRemove,
}: {
  template: WorkflowTaskTemplateRow;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
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
        <Select value={template.kind} onChange={(e) => void onUpdate({ kind: e.target.value as TaskKind })} className="text-xs py-1 px-2" title="Task type">
          {TASK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
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
      {template.kind === "handoff" && (
        <div className="mt-1.5 ml-7 flex items-center gap-2 text-[11px] text-slate-600 flex-wrap">
          <Icon name="arrow-right" size={11} className="text-slate-400 flex-shrink-0" />
          <span className="font-semibold whitespace-nowrap">Hands off to</span>
          <InfoTip side="top" label="When the sending role completes this task, a receipt task is created for the role picked here — the handoff is measurable on both sides." />
          <Select value={template.handoff_to_role_id ?? ""} onChange={(e) => void onUpdate({ handoff_to_role_id: e.target.value || null })}
            className="text-xs py-0.5 px-2 w-44" aria-label="Role that receives this handoff">
            <option value="">— Pick the receiving role —</option>
            {allRoles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select>
          {!template.handoff_to_role_id && <span className="text-amber-600 font-semibold">pick a role so the receipt task can fire</span>}
        </div>
      )}
    </div>
  );
}

/* ---------- drag ghosts + grip ---------- */

function StageGhost({ label, color }: { label: string; color: string }) {
  return (
    <div className="w-64 rounded-xl border border-brand-300 bg-white shadow-xl overflow-hidden">
      <div style={{ height: 3, backgroundColor: color }} />
      <div className="px-3 py-2 flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-sm font-semibold text-slate-900">{label}</span>
      </div>
    </div>
  );
}

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
