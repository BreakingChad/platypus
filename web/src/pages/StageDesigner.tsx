import { friendlyError } from "../lib/errors";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineRow, PipelineStageRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { flowColumns, mergeWithPrevious, canMergeWithPrevious } from "../lib/flow";
import { Card } from "../components/ui/Card";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** Pipelines — the org's stage backbones. Each pipeline is the spine a family
 *  of studies runs on: the stages (top to bottom), which run in parallel, the
 *  target days each should take, and which are terminal. An org can run several
 *  (e.g. Industry-sponsored, Investigator-initiated); task flows hang tasks +
 *  teams off these stages but can't change the stages — that keeps cross-study
 *  timing comparable.
 *
 *  "Intake" is a single universal triage stage shared by every pipeline, so it
 *  isn't edited here. Drag a row by its grip to reorder; drop one row ONTO
 *  another to run them in parallel (the target highlights as a forming group),
 *  or drop in a gap to set the sequence. The "Run parallel" / "Split" control
 *  on each row does the same explicitly.
 */

const SWATCHES = [
  "#6366F1", "#7C3AED", "#3B82F6", "#06B6D4", "#0EA5E9",
  "#10B981", "#F59E0B", "#EF4444", "#64748B", "#EC4899",
];

const PIPELINE_TEMPLATE: { label: string; color: string; target_days: number; terminal: boolean }[] = [
  { label: "Feasibility", color: "#7C3AED", target_days: 14, terminal: false },
  { label: "Site selection", color: "#3B82F6", target_days: 10, terminal: false },
  { label: "Regulatory", color: "#10B981", target_days: 30, terminal: false },
  { label: "Budget & contract", color: "#F59E0B", target_days: 30, terminal: false },
  { label: "Activation", color: "#EC4899", target_days: 21, terminal: false },
  { label: "Closeout", color: "#64748B", target_days: 0, terminal: true },
];

const safeKey = (label: string) =>
  `stage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 20)}`;

/** Faint tint from a stage's hex colour, for per-row background variation. */
function tint(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return "transparent";
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function StageDesigner() {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const pipelines = useOrgTable<PipelineRow>("pipelines", { orderBy: "position", realtime: true });
  const stagesTbl = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });

  const activePipelines = pipelines.rows.filter((p) => p.status === "active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedId && activePipelines.some((p) => p.id === selectedId)) return;
    setSelectedId(activePipelines[0]?.id ?? null);
  }, [activePipelines, selectedId]);

  const stages = useMemo(
    () => stagesTbl.rows.filter((s) => s.pipeline_id === selectedId).sort((a, b) => a.position - b.position),
    [stagesTbl.rows, selectedId]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDrag, setActiveDrag] = useState<string | null>(null);

  /* ---------- pipeline mutators ---------- */

  const createPipeline = async (name: string) => {
    if (!orgId || !name.trim()) return;
    try {
      const pos = pipelines.rows.reduce((m, p) => Math.max(m, p.position), 0) + 10;
      const created = await pipelines.insert({ name: name.trim(), status: "active", position: pos } as any);
      if (!created) return;
      const rows = PIPELINE_TEMPLATE.map((t, i) => ({
        org_id: orgId, pipeline_id: created.id, key: safeKey(t.label), label: t.label,
        color: t.color, icon_key: "layers", target_days: t.target_days, terminal: t.terminal,
        is_core: false, position: (i + 1) * 10,
      }));
      await supabase.from("pipeline_stages").insert(rows as any);
      await stagesTbl.refresh();
      setSelectedId(created.id);
      toast.success(stamped(`Pipeline "${name.trim()}" created`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't create the pipeline")); }
  };

  const renamePipeline = (id: string, name: string) =>
    pipelines.update(id, { name } as any).catch((e: any) => toast.error(friendlyError(e, "Rename failed")));

  const duplicatePipeline = async (src: PipelineRow) => {
    if (!orgId) return;
    try {
      const pos = pipelines.rows.reduce((m, p) => Math.max(m, p.position), 0) + 10;
      const created = await pipelines.insert({ name: `${src.name} (copy)`, description: src.description, status: "active", position: pos } as any);
      if (!created) return;
      const srcStages = stagesTbl.rows.filter((s) => s.pipeline_id === src.id).sort((a, b) => a.position - b.position);
      if (srcStages.length > 0) {
        const rows = srcStages.map((s) => ({
          org_id: orgId, pipeline_id: created.id, key: safeKey(s.label), label: s.label,
          color: s.color, icon_key: s.icon_key, target_days: s.target_days, terminal: s.terminal,
          is_core: false, position: s.position, parallel_group: s.parallel_group ?? null,
        }));
        await supabase.from("pipeline_stages").insert(rows as any);
      }
      await stagesTbl.refresh();
      setSelectedId(created.id);
      toast.success(stamped(`Copied "${src.name}" — ${srcStages.length} stage${srcStages.length === 1 ? "" : "s"}`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't duplicate the pipeline")); }
  };

  const archivePipeline = async (src: PipelineRow) => {
    if (activePipelines.length <= 1) { toast.error("Keep at least one active pipeline"); return; }
    if (!(await confirmDialog({ title: "Archive pipeline", message: `Archive "${src.name}"? Studies and task flows on it keep it, but it won't be offered for new ones.`, confirmLabel: "Archive" }))) return;
    try { await pipelines.update(src.id, { status: "archived" } as any); toast.success(stamped(`Archived "${src.name}"`)); }
    catch (e: any) { toast.error(friendlyError(e, "Couldn't archive")); }
  };

  /* ---------- stage mutators (scoped to the selected pipeline) ---------- */

  const addStage = async () => {
    if (!orgId || !selectedId) { toast.error("Create or select a pipeline first"); return; }
    const nextPos = stages.reduce((m, s) => Math.max(m, s.position), 0) + 10;
    try {
      await supabase.from("pipeline_stages").insert({
        org_id: orgId, pipeline_id: selectedId, key: safeKey("new stage"), label: "New stage",
        color: SWATCHES[stages.length % SWATCHES.length], icon_key: "layers",
        target_days: 14, terminal: false, is_core: false, position: nextPos,
      } as any);
      await stagesTbl.refresh();
      toast.success(stamped("Stage added — name it"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add stage")); }
  };

  const patchStage = (id: string, patch: Partial<PipelineStageRow>) =>
    stagesTbl.update(id, patch as any).catch((e: any) => toast.error(friendlyError(e, "Update failed")));

  const removeStage = async (s: PipelineStageRow) => {
    if (!(await confirmDialog({
      title: "Remove stage",
      message: `Remove "${s.label}"? Studies already in it keep the value, but no new study will enter it — and every task flow on this pipeline loses the modules built on it.`,
      confirmLabel: "Remove", danger: true,
    }))) return;
    try { await stagesTbl.remove(s.id); toast.success(stamped(`Removed "${s.label}"`)); }
    catch (e: any) { toast.error(friendlyError(e, "Remove failed")); }
  };

  const setStageParallel = async (patches: { id: string; parallel_group: number | null }[]) => {
    try {
      await Promise.all(patches.map((p) =>
        supabase.from("pipeline_stages").update({ parallel_group: p.parallel_group } as any).eq("id", p.id)));
      await stagesTbl.refresh();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't change the lane")); }
  };

  /** Drop one row onto another → they run in parallel; the dragged row joins
   *  the target's lane and sits right after it. */
  const parallelizeStages = async (draggedId: string, targetId: string) => {
    const dragged = stages.find((s) => s.id === draggedId);
    const target = stages.find((s) => s.id === targetId);
    if (!dragged || !target || draggedId === targetId) return;
    const group = target.parallel_group ?? target.position;
    const order = stages.filter((s) => s.id !== draggedId);
    const idx = order.findIndex((s) => s.id === targetId);
    order.splice(idx + 1, 0, dragged);
    try {
      await Promise.all([
        supabase.from("pipeline_stages").update({ parallel_group: group } as any).eq("id", target.id),
        supabase.from("pipeline_stages").update({ parallel_group: group } as any).eq("id", dragged.id),
        ...order.map((s, i) => supabase.from("pipeline_stages").update({ position: (i + 1) * 10 } as any).eq("id", s.id)),
      ]);
      await stagesTbl.refresh();
      toast.success(stamped(`${dragged.label} now runs in parallel with ${target.label}`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't parallelize")); }
  };

  /** Drop in a gap → move to that sequential position, out of any lane. */
  const reorderStageSequential = async (draggedId: string, afterStageId: string | null) => {
    const dragged = stages.find((s) => s.id === draggedId);
    if (!dragged) return;
    const order = stages.filter((s) => s.id !== draggedId);
    const insertAt = afterStageId ? order.findIndex((s) => s.id === afterStageId) + 1 : 0;
    order.splice(insertAt, 0, dragged);
    try {
      await Promise.all([
        supabase.from("pipeline_stages").update({ parallel_group: null } as any).eq("id", dragged.id),
        ...order.map((s, i) => supabase.from("pipeline_stages").update({ position: (i + 1) * 10 } as any).eq("id", s.id)),
      ]);
      await stagesTbl.refresh();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't move the stage")); }
  };

  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const d = over.data.current as { type?: string; afterStageId?: string | null; stageId?: string } | undefined;
    if (d?.type === "gap") { void reorderStageSequential(String(active.id), d.afterStageId ?? null); return; }
    const targetId = d?.type === "prow" ? d.stageId : String(over.id);
    if (targetId) void parallelizeStages(String(active.id), targetId);
  };

  /* ---------- gating ---------- */

  if (memberLoading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Stage pipelines" subtitle="The stage backbones every study moves through." />
        <Card className="mt-6">
          <EmptyState iconName="lock" title="Admin-only surface" sub="Only org admins reshape pipelines. Once they change the stages, every study and task flow on that pipeline reflects the new backbone." />
        </Card>
      </div>
    );
  }

  const selected = activePipelines.find((p) => p.id === selectedId) ?? null;
  const cols = flowColumns(stages);
  const totalDays = cols.reduce((sum, col) =>
    sum + (col.stages.length > 1
      ? Math.max(...col.stages.map((s) => s.target_days || 0))
      : (col.stages[0].target_days || 0)), 0);

  const rowProps = (s: PipelineStageRow, inLane: boolean) => ({
    s, inLane, dragging: !!activeDrag, isDragged: activeDrag === s.id,
    canMerge: canMergeWithPrevious(stages, s.id),
    onRename: (id: string, label: string) => void patchStage(id, { label }),
    onColor: (id: string, color: string) => void patchStage(id, { color }),
    onTarget: (id: string, target_days: number) => void patchStage(id, { target_days }),
    onTerminal: (id: string, terminal: boolean) => void patchStage(id, { terminal }),
    onRemove: () => void removeStage(s),
    onMerge: (id: string) => void setStageParallel(mergeWithPrevious(stages, id)),
    onSplit: (id: string) => void setStageParallel([{ id, parallel_group: null }]),
  });

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Stage pipelines"
        subtitle="Each pipeline is a stage backbone a family of studies runs on — the stages, their order, which run in parallel, and the target days each should take. Task flows add the tasks and teams for these stages."
      />
      <AutoSaveNote />

      <PipelineSelector
        pipelines={activePipelines}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={(name) => void createPipeline(name)}
        onRename={(id, name) => void renamePipeline(id, name)}
        onDuplicate={(p) => void duplicatePipeline(p)}
        onArchive={(p) => void archivePipeline(p)}
      />

      <div className="mt-4 mb-3 flex items-start gap-1.5 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
        <Icon name="info" size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <span><span className="font-semibold">Intake</span> is shared by every pipeline, so it isn't shown here. Drag a row onto another to run them in parallel, or drop in a gap to reorder. Task flows add the <span className="font-semibold">tasks and teams</span> for each stage.</span>
      </div>

      {!selected ? (
        <Card className="mt-2"><EmptyState iconName="workflow" title="No pipeline selected" sub="Create your first pipeline above to start laying out its stages." /></Card>
      ) : stagesTbl.loading && stages.length === 0 ? (
        <Card className="mt-2"><Loader label="Loading stages…" /></Card>
      ) : stages.length === 0 ? (
        <Card className="mt-2">
          <EmptyState iconName="workflow" title="No stages in this pipeline"
            sub="Add the first stage. Studies enter here once they're committed out of intake."
            action={<Button variant="primary" onClick={() => void addStage()}><Icon name="plus" size={12} /> Add stage</Button>} />
        </Card>
      ) : (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div>
                <GapDrop afterStageId={null} active={!!activeDrag} />
                {cols.map((col, ci) => {
                  const last = col.stages[col.stages.length - 1];
                  return (
                    <div key={ci}>
                      {col.stages.length > 1 ? (
                        <div className="rounded-xl border border-brand-300 bg-gradient-to-br from-brand-50 to-violet-50 shadow-sm p-2 space-y-2">
                          <div className="flex items-center gap-1.5 px-1">
                            <Icon name="layers" size={12} className="text-brand-600" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-brand-700">Parallel</span>
                            <span className="text-[10px] text-brand-400">· these run at the same time</span>
                          </div>
                          {col.stages.map((s) => <StageRow key={s.id} {...rowProps(s, true)} />)}
                        </div>
                      ) : (
                        <StageRow key={col.stages[0].id} {...rowProps(col.stages[0], false)} />
                      )}
                      <GapDrop afterStageId={last.id} active={!!activeDrag} />
                    </div>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          <div className="mt-1 mb-2 flex items-center justify-end gap-1.5 text-xs text-slate-500">
            <Icon name="calendar" size={13} className="text-slate-400" />
            <span>Pipeline target: <strong className="text-slate-700">~{totalDays} days</strong></span>
            <span className="text-[11px] text-slate-400">· parallel stages count the longest lane</span>
          </div>

          <button onClick={() => void addStage()}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-brand-300 hover:text-brand-700 transition flex items-center justify-center gap-1.5 text-sm font-semibold py-3">
            <Icon name="plus" size={14} /> Add stage
          </button>
        </>
      )}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        Stages tagged <strong>Default</strong> are the starter set we load for a new pipeline — rename, recolour, reorder, or remove them like any other. A study's stage shown across the app comes from the pipeline its task flow belongs to.
      </p>
    </div>
  );
}

/* ============================================================================
 * Gap drop — between rows; drop here to set the sequence (out of any lane)
 * ========================================================================== */

function GapDrop({ afterStageId, active }: { afterStageId: string | null; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${afterStageId ?? "head"}`, data: { type: "gap", afterStageId } });
  return (
    <div ref={setNodeRef} className={"transition-all " + (active ? (isOver ? "py-2" : "py-1.5") : "py-1")}
      title={active ? "Drop here to set the sequence" : undefined}>
      <div className={"mx-1 rounded-full transition-all " + (active ? (isOver ? "h-1.5 bg-brand-500" : "h-0.5 bg-brand-200") : "h-0")} />
    </div>
  );
}

/* ============================================================================
 * Pipeline selector — the org's pipelines; pick one to lay out its stages
 * ========================================================================== */

function PipelineSelector({
  pipelines, selectedId, onSelect, onCreate, onRename, onDuplicate, onArchive,
}: {
  pipelines: PipelineRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (p: PipelineRow) => void;
  onArchive: (p: PipelineRow) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="workflow" size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-700">Stage pipelines</span>
        <span className="text-[11px] text-slate-400">— pick one to lay out its stages</span>
        <div className="flex-1" />
        {adding ? (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name); setName(""); setAdding(false); } if (e.key === "Escape") { setAdding(false); setName(""); } }}
              placeholder="e.g. Investigator-initiated" className="text-sm w-56" />
            <Button size="sm" variant="primary" onClick={() => { if (name.trim()) { onCreate(name); setName(""); setAdding(false); } }} disabled={!name.trim()}>Create</Button>
          </div>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> New pipeline</Button>
        )}
      </div>
      {pipelines.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic">None yet — create your first pipeline above.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {pipelines.map((p) => {
            const sel = p.id === selectedId;
            return (
              <div key={p.id} onClick={() => onSelect(p.id)}
                className={"group flex items-center gap-2 rounded-lg border pl-3 pr-2 py-2 text-sm cursor-pointer transition " +
                  (sel ? "border-brand-400 bg-brand-50 ring-1 ring-brand-500/20" : "border-slate-200 bg-white hover:border-slate-300")}>
                {editId === p.id ? (
                  <input autoFocus value={editName} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => { const t = editName.trim(); if (t && t !== p.name) onRename(p.id, t); setEditId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditId(null); }}
                    className="text-sm font-semibold border border-brand-200 rounded px-1 py-0.5 outline-none" />
                ) : (
                  <span className={"font-semibold " + (sel ? "text-brand-800" : "text-slate-700")}>{p.name}</span>
                )}
                {sel && <span className="rounded-full bg-brand-100 text-brand-700 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5">Editing</span>}
                <span className="flex items-center gap-1 text-slate-400 ml-1 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={(e) => { e.stopPropagation(); setEditId(p.id); setEditName(p.name); }} className="hover:text-brand-700 p-0.5" title="Rename" aria-label="Rename"><Icon name="edit" size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onDuplicate(p); }} className="hover:text-brand-700 p-0.5" title="Duplicate" aria-label="Duplicate"><Icon name="copy" size={13} /></button>
                  <button onClick={(e) => { e.stopPropagation(); onArchive(p); }} className="hover:text-red-600 p-0.5" title="Archive" aria-label="Archive"><Icon name="trash" size={13} /></button>
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
 * Stage row — sortable + a parallelize drop target; two levels:
 *   line 1: grip · colour · name · target · terminal · trash
 *   line 2: the parallel control (run parallel with step above / split out)
 * ========================================================================== */

function StageRow({
  s, inLane, dragging, isDragged, canMerge, onRename, onColor, onTarget, onTerminal, onRemove, onMerge, onSplit,
}: {
  s: PipelineStageRow;
  inLane: boolean;
  dragging: boolean;
  isDragged: boolean;
  canMerge: boolean;
  onRename: (id: string, label: string) => void;
  onColor: (id: string, color: string) => void;
  onTarget: (id: string, days: number) => void;
  onTerminal: (id: string, v: boolean) => void;
  onRemove: () => void;
  onMerge: (id: string) => void;
  onSplit: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `prow:${s.id}`, data: { type: "prow", stageId: s.id } });
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(s.label);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // "Will group" cue: another row is being dragged and is hovering this one.
  const groupHint = dragging && isOver && !isDragged;
  const showParallelControl = inLane || canMerge;
  const style: Record<string, unknown> = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  if (inLane && !groupHint) style.backgroundColor = tint(s.color, 0.07);

  return (
    <div ref={(n) => { setNodeRef(n); setDropRef(n); }} style={style as any}
      className={
        "rounded-xl border shadow-sm transition " +
        (groupHint
          ? "border-brand-400 border-dashed ring-2 ring-brand-300 bg-brand-50"
          : inLane ? "border-brand-200" : "border-slate-200 bg-white")
      }
    >
      <div className="flex items-center gap-2 pl-2 pr-2 py-2 group">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500" title="Drag to reorder, or drop onto another stage to run in parallel" aria-label="Drag stage">
          <GripIcon />
        </button>

        {/* colour swatch + palette */}
        <div className="relative">
          <button onClick={() => setPaletteOpen((v) => !v)} className="w-4 h-4 rounded-full flex-shrink-0 border border-white shadow-sm hover:scale-110 transition" style={{ backgroundColor: s.color }} title="Change colour" aria-label="Change colour" />
          {paletteOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPaletteOpen(false)} />
              <div className="absolute left-0 top-6 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1">
                {SWATCHES.map((c) => (
                  <button key={c} onClick={() => { onColor(s.id, c); setPaletteOpen(false); }} className="w-6 h-6 rounded-md border-2 border-white hover:border-slate-200 transition" style={{ backgroundColor: c }} aria-label={"Use " + c} />
                ))}
              </div>
            </>
          )}
        </div>

        {/* name */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {renaming ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { const t = draft.trim(); if (t && t !== s.label) onRename(s.id, t); setRenaming(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(s.label); setRenaming(false); } }}
              className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none flex-1 min-w-0" />
          ) : (
            <button onClick={() => setRenaming(true)} className="text-sm font-semibold text-slate-900 truncate text-left hover:text-brand-700" title="Rename">{s.label}</button>
          )}
          {s.is_core && <Pill tone="neutral">Default</Pill>}
          {groupHint && <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 flex items-center gap-0.5"><Icon name="layers" size={10} /> will run parallel</span>}
        </div>

        {/* target days */}
        <label className="flex items-center gap-1 text-[11px] text-slate-400 flex-shrink-0" title="How long a study should spend in this stage. Powers the Health signal.">
          target
          <input type="number" min={0} value={s.target_days} onChange={(e) => onTarget(s.id, Number(e.target.value) || 0)} className="w-14 text-xs font-mono border border-slate-200 rounded px-1.5 py-0.5 text-center" />d
        </label>

        {/* terminal */}
        <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer flex-shrink-0">
          <input type="checkbox" checked={s.terminal} onChange={(e) => onTerminal(s.id, e.target.checked)} className="accent-brand-500 w-3.5 h-3.5" />terminal
        </label>

        {/* trash */}
        <button onClick={onRemove} className="text-slate-300 hover:text-red-600 transition p-1 flex-shrink-0" title="Remove stage" aria-label="Remove stage">
          <Icon name="trash" size={14} />
        </button>
      </div>

      {/* line 2 — parallel control on its own level */}
      {showParallelControl && (
        <div className="px-2 pb-1.5 -mt-0.5 pl-9">
          {inLane ? (
            <button onClick={() => onSplit(s.id)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
              <Icon name="x" size={10} /> Split out of parallel lane
            </button>
          ) : (
            <button onClick={() => onMerge(s.id)} className="text-[11px] font-semibold text-brand-600 hover:text-brand-800 inline-flex items-center gap-1">
              <Icon name="layers" size={11} /> Run parallel with the step above
            </button>
          )}
        </div>
      )}
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
