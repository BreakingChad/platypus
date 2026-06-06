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
  PipelineStageRow,
  TeamRow,
  TeamRoleRow,
  WorkflowModuleRow,
  WorkflowTaskTemplateRow,
  TaskKind,
} from "../lib/types";

import { Card } from "../components/ui/Card";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { flowColumns, mergeWithPrevious, canMergeWithPrevious } from "../lib/flow";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { InfoTip } from "../components/ui/Tip";
import { EmptyState } from "../components/ui/EmptyState";

/** WorkStreamBuilder — admin-driven canvas for designing the operating model
 *  that fires automatically when studies enter stages.
 *
 *  Layout:
 *    LEFT  — stage rail. Click a stage to load its modules.
 *    RIGHT — module list for the selected stage. Each module is drag-drop
 *            reorderable, has a name, owner team, enabled flag, and a
 *            nested drag-drop list of task templates (kind, title,
 *            due_offset_days, assigned role).
 *
 *  Persists to public.workflow_modules + public.workflow_task_templates
 *  via Supabase. RLS gates writes to org admins.
 */

const TASK_KINDS: TaskKind[] = ["manual", "date", "handoff", "escalation", "external_handoff"];

export function WorkStreamBuilder() {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();

  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", {
    orderBy: "position",
    realtime: true,
  });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position", realtime: true });
  const roles = useOrgTable<TeamRoleRow>("team_roles", { realtime: true });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", {
    orderBy: "position",
    realtime: true,
  });

  const [selectedStageKey, setSelectedStageKey] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "edit">("flow");
  const [moduleNameDraft, setModuleNameDraft] = useState("");
  const [addingModule, setAddingModule] = useState(false);

  // Pick the first stage when stages load.
  useEffect(() => {
    if (selectedStageKey || stages.rows.length === 0) return;
    setSelectedStageKey(stages.rows[0].key);
  }, [stages.rows, selectedStageKey]);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const stageModules = useMemo(
    () =>
      modules.rows
        .filter((m) => m.stage_key === selectedStageKey)
        .sort((a, b) => a.position - b.position),
    [modules.rows, selectedStageKey]
  );

  /* ---------- mutators ---------- */

  const addModule = async () => {
    const name = moduleNameDraft.trim();
    if (!orgId || !selectedStageKey || !name) return;
    const nextPos = stageModules.reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { error } = await supabase.from("workflow_modules").insert({
        org_id: orgId,
        stage_key: selectedStageKey,
        name,
        enabled: true,
        position: nextPos,
      } as any);
      if (error) throw error;
      toast.success(stamped(`Module "${name}" added`));
      setModuleNameDraft("");
      setAddingModule(false);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add module"));
    }
  };

  const updateModule = async (id: string, patch: Partial<WorkflowModuleRow>) => {
    try {
      const { error } = await supabase
        .from("workflow_modules")
        .update(patch as any)
        .eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      toast.error(friendlyError(e, "Update failed"));
    }
  };

  const removeModule = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: "Remove module", message: `Remove module "${name}"? Its task templates go with it.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      const { error } = await supabase.from("workflow_modules").delete().eq("id", id);
      if (error) throw error;
      toast.success(stamped("Module removed"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Remove failed"));
    }
  };

  const reorderModules = async (orderedIds: string[]) => {
    // Optimistic isn't worth the complexity; just renumber positions.
    try {
      await Promise.all(
        orderedIds.map((id, i) =>
          supabase
            .from("workflow_modules")
            .update({ position: (i + 1) * 10 } as any)
            .eq("id", id)
        )
      );
    } catch (e: any) {
      toast.error(friendlyError(e, "Reorder failed"));
    }
  };

  /* ---------- copy tools — clients iterate; they don't author from scratch ---------- */

  const [copyBusy, setCopyBusy] = useState(false);

  const STAGE_COLORS = ["#6366F1","#0284C7","#059669","#b45309","#7C3AED","#BE185D","#4F46E5","#10B981","#EF4444","#64748B"];
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
  const moveStage = async (s: PipelineStageRow, dir: "left" | "right") => {
    const sorted = [...stages.rows].sort((a, b) => a.position - b.position);
    const i = sorted.findIndex((x) => x.id === s.id);
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= sorted.length) return;
    const other = sorted[j];
    await Promise.all([stages.update(s.id, { position: other.position }), stages.update(other.id, { position: s.position })])
      .catch((e: any) => toast.error(friendlyError(e, "Reorder failed")));
  };
  const addModuleTo = async (stageKey: string, name: string) => {
    if (!orgId || !name.trim()) return;
    const pos = modules.rows.filter((m) => m.stage_key === stageKey).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { error } = await supabase.from("workflow_modules").insert({ org_id: orgId, stage_key: stageKey, name: name.trim(), enabled: true, position: pos } as any);
      if (error) throw error;
      toast.success(stamped(`Module "${name.trim()}" added`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add module")); }
  };

  const setStageParallel = async (patches: { id: string; parallel_group: number | null }[]) => {
    try {
      await Promise.all(
        patches.map((p) =>
          supabase.from("pipeline_stages").update({ parallel_group: p.parallel_group } as any).eq("id", p.id)
        )
      );
      await stages.refresh();
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't change the lane"));
    }
  };

  /** Deep-copy one module (+ its task templates) onto a stage. */
  const deepCopyModule = async (
    src: WorkflowModuleRow,
    toStageKey: string,
    position: number,
    name?: string
  ): Promise<{ taskCount: number }> => {
    const { data: created, error } = await supabase
      .from("workflow_modules")
      .insert({
        org_id: src.org_id,
        stage_key: toStageKey,
        owner_team_id: src.owner_team_id,
        name: name ?? src.name,
        description: src.description,
        enabled: src.enabled,
        position,
      } as any)
      .select("id")
      .single();
    if (error) throw error;
    const newId = (created as any).id as string;
    const { data: tpls, error: tplErr } = await supabase
      .from("workflow_task_templates")
      .select("*")
      .eq("module_id", src.id)
      .order("position", { ascending: true });
    if (tplErr) throw tplErr;
    if (tpls && tpls.length > 0) {
      const { error: insErr } = await supabase.from("workflow_task_templates").insert(
        (tpls as any[]).map((t) => ({
          module_id: newId,
          kind: t.kind,
          title: t.title,
          description: t.description,
          due_offset_days: t.due_offset_days,
          assigned_to_role_id: t.assigned_to_role_id,
          handoff_to_role_id: t.handoff_to_role_id ?? null,
          position: t.position,
        })) as any
      );
      if (insErr) throw insErr;
    }
    return { taskCount: tpls?.length ?? 0 };
  };

  const duplicateModule = async (src: WorkflowModuleRow) => {
    const nextPos = stageModules.reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { taskCount } = await deepCopyModule(src, src.stage_key, nextPos, `${src.name} (copy)`);
      toast.success(stamped(`Duplicated "${src.name}" — ${taskCount} task${taskCount === 1 ? "" : "s"} copied`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't duplicate the module"));
    }
  };

  const copyFromStage = async (srcStageKey: string) => {
    if (!selectedStageKey || copyBusy) return;
    const srcMods = modules.rows
      .filter((m) => m.stage_key === srcStageKey)
      .sort((a, b) => a.position - b.position);
    if (srcMods.length === 0) return;
    const srcLabel = stages.rows.find((s) => s.key === srcStageKey)?.label ?? srcStageKey;
    if (
      !(await confirmDialog({
        title: "Copy modules from a stage",
        message: `Copy ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} (with their task templates) from "${srcLabel}" onto this stage? They arrive enabled and fully editable — adjust them instead of authoring from scratch.`,
        confirmLabel: "Copy modules",
      }))
    )
      return;
    setCopyBusy(true);
    try {
      let pos = stageModules.reduce((m, x) => Math.max(m, x.position), 0);
      let tasks = 0;
      for (const m of srcMods) {
        pos += 10;
        const { taskCount } = await deepCopyModule(m, selectedStageKey, pos);
        tasks += taskCount;
      }
      toast.success(stamped(`Copied ${srcMods.length} module${srcMods.length === 1 ? "" : "s"} · ${tasks} task${tasks === 1 ? "" : "s"} from ${srcLabel}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Copy failed part-way — review the modules below"));
    } finally {
      setCopyBusy(false);
    }
  };

  /* ---------- dnd ---------- */

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = stageModules.findIndex((m) => m.id === active.id);
    const to = stageModules.findIndex((m) => m.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(stageModules, from, to);
    void reorderModules(next.map((m) => m.id));
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
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can design work streams."
          />
        </Card>
      </div>
    );
  }

  const selectedStage = stages.rows.find((s) => s.key === selectedStageKey) ?? null;

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Pipeline & work streams"
        subtitle="Design the operating model as one flow: stages left-to-right (sequential or parallel), each with the modules that spawn tasks when a study reaches it. Edit stages and modules right here."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="View">
              {([["flow", "Flow"], ["edit", "Edit"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setView(k)}
                  className={
                    "px-3 py-1.5 rounded-md text-xs font-semibold transition " +
                    (view === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
                  }
                  aria-pressed={view === k}
                >
                  {label}
                </button>
              ))}
            </div>
            <Pill tone="brand">live · admin-driven</Pill>
          </div>
        }
      />
      <AutoSaveNote />

      {view === "flow" && (
        <FlowView
          stages={stages.rows}
          modules={modules.rows}
          teams={teams.rows}
          isAdmin={isAdmin}
          onOpenStage={(key) => { setSelectedStageKey(key); setView("edit"); }}
          onMerge={(id) => void setStageParallel(mergeWithPrevious(stages.rows, id))}
          onSplit={(id) => void setStageParallel([{ id, parallel_group: null }])}
          canMerge={(id) => canMergeWithPrevious(stages.rows, id)}
          onAddStage={() => void addStage()}
          onRenameStage={(id, label) => void updateStage(id, { label })}
          onTargetStage={(id, days) => void updateStage(id, { target_days: days })}
          onToggleTerminal={(id, v) => void updateStage(id, { terminal: v })}
          onMoveStage={(s, dir) => void moveStage(s, dir)}
          onRemoveStage={(s) => void removeStage(s)}
          onAddModule={(key, name) => void addModuleTo(key, name)}
          onRemoveModule={(id, name) => void removeModule(id, name)}
        />
      )}

      {view === "edit" && (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 mt-6">
        {/* LEFT — stage rail */}
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">
            Stages
          </div>
          <Card flush>
            {stages.rows.length === 0 && (
              <div className="px-4 py-3 text-[11px] text-slate-500 italic">
                No stages configured yet. Add some in Pipeline stages first.
              </div>
            )}
            <ul>
              {stages.rows.map((s) => {
                const count = modules.rows.filter((m) => m.stage_key === s.key).length;
                const active = s.key === selectedStageKey;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedStageKey(s.key)}
                      className={
                        "w-full text-left px-3 py-2.5 flex items-center gap-2 transition border-b border-slate-100 last:border-b-0 " +
                        (active ? "bg-brand-50" : "hover:bg-slate-50")
                      }
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-sm font-semibold text-slate-900 truncate flex-1">
                        {s.label}
                      </span>
                      <span
                        className={
                          "text-[10px] font-mono " +
                          (count > 0 ? "text-brand-700" : "text-slate-400")
                        }
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* RIGHT — modules for selected stage */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs font-semibold text-slate-500">
                Modules
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {selectedStage ? (
                  <>
                    Fires when a study enters{" "}
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                      style={{ backgroundColor: selectedStage.color }}
                    >
                      {selectedStage.label}
                    </span>
                  </>
                ) : (
                  "Select a stage on the left."
                )}
              </div>
            </div>
            {selectedStage && (
              <div className="flex items-center gap-2">
                <Select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void copyFromStage(v);
                  }}
                  className="text-xs py-1.5 w-48"
                  aria-label="Copy modules from another stage"
                  title="Start from a stage that already works — copies its modules and tasks here"
                  disabled={copyBusy}
                >
                  <option value="">{copyBusy ? "Copying…" : "Copy from stage…"}</option>
                  {stages.rows
                    .filter((s) => s.key !== selectedStageKey)
                    .map((s) => ({ s, n: modules.rows.filter((m) => m.stage_key === s.key).length }))
                    .filter((x) => x.n > 0)
                    .map(({ s, n }) => (
                      <option key={s.id} value={s.key}>
                        {s.label} ({n} module{n === 1 ? "" : "s"})
                      </option>
                    ))}
                </Select>
                {addingModule ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={moduleNameDraft}
                      onChange={(e) => setModuleNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && moduleNameDraft.trim()) void addModule();
                        if (e.key === "Escape") { setAddingModule(false); setModuleNameDraft(""); }
                      }}
                      placeholder="Module name…"
                      autoFocus
                      className="text-sm w-44"
                    />
                    <Button variant="primary" size="sm" onClick={addModule} disabled={!moduleNameDraft.trim()}>
                      Add
                    </Button>
                  </div>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => setAddingModule(true)}>
                    <Icon name="plus" size={12} /> Add module
                  </Button>
                )}
              </div>
            )}
          </div>

          {selectedStage && stageModules.length === 0 && (
            <Card>
              <EmptyState
                iconName="layers"
                title={`No modules on ${selectedStage.label} yet`}
                sub="Add a module above. Each module groups related tasks that fire together when a study lands on this stage."
                action={
                  <Button variant="primary" onClick={() => setAddingModule(true)}>
                    <Icon name="plus" size={12} /> Add module
                  </Button>
                }
              />
            </Card>
          )}

          {selectedStage && stageModules.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={stageModules.map((m) => m.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {stageModules.map((mod) => (
                    <ModuleCard
                      key={mod.id}
                      module={mod}
                      teams={teams.rows}
                      roles={roles.rows}
                      onUpdate={(patch) => updateModule(mod.id, patch)}
                      onDuplicate={() => void duplicateModule(mod)}
                      onRemove={() => removeModule(mod.id, mod.name)}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeDragId
                  ? (() => {
                      const m = stageModules.find((x) => x.id === activeDragId);
                      if (!m) return null;
                      return (
                        <div className="rounded-xl border border-brand-300 bg-white shadow-lg px-3 py-2 text-sm font-semibold text-slate-900 flex items-center gap-2">
                          <GripIcon />
                          {m.name}
                        </div>
                      );
                    })()
                  : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Flow view — left-to-right pipeline, parallel stages stacked in one lane
 * ========================================================================== */

function StageCardEditable({
  s, mods, teams, isAdmin, inLane, canMerge,
  onOpenStage, onRename, onTarget, onTerminal, onMove, onRemove, onMerge, onSplit, onAddModule, onRemoveModule,
}: any) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(s.label);
  const [addingMod, setAddingMod] = useState(false);
  const [modName, setModName] = useState("");
  const teamColor = (id: string | null) => teams.find((t: TeamRow) => t.id === id)?.color ?? "#94a3b8";
  return (
    <div className="w-64 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden" style={{ borderTopWidth: 3, borderTopColor: s.color }}>
      <div className="px-3 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
          {renaming && isAdmin ? (
            <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { const t = draft.trim(); if (t && t !== s.label) onRename(s.id, t); setRenaming(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(s.label); setRenaming(false); } }}
              className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1 py-0.5 outline-none flex-1 min-w-0" />
          ) : (
            <button onClick={() => isAdmin && setRenaming(true)} className="text-sm font-semibold text-slate-900 truncate flex-1 text-left hover:text-brand-700" title={isAdmin ? "Rename" : s.label}>{s.label}</button>
          )}
          {isAdmin && (
            <span className="flex items-center text-slate-300">
              <button onClick={() => onMove(s, "left")} className="hover:text-slate-600 px-0.5" title="Move left" aria-label="Move left">‹</button>
              <button onClick={() => onMove(s, "right")} className="hover:text-slate-600 px-0.5" title="Move right" aria-label="Move right">›</button>
              {!s.is_core && <button onClick={() => onRemove(s)} className="hover:text-red-600 px-0.5" title="Remove stage" aria-label="Remove">×</button>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {isAdmin ? (
            <label className="flex items-center gap-1 text-[11px] text-slate-400">
              target
              <input type="number" value={s.target_days} onChange={(e) => onTarget(s.id, Number(e.target.value))} className="w-12 text-[11px] font-mono border border-slate-200 rounded px-1 py-0.5" />d
            </label>
          ) : (
            <span className="text-[11px] text-slate-400 font-mono">{s.target_days > 0 ? `target ${s.target_days}d` : "no target"}</span>
          )}
          {isAdmin && (
            <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer ml-auto">
              <input type="checkbox" checked={s.terminal} onChange={(e) => onTerminal(s.id, e.target.checked)} className="accent-brand-500 w-3 h-3" />terminal
            </label>
          )}
          {!isAdmin && s.terminal && <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 ml-auto">terminal</span>}
        </div>
      </div>
      <div className="p-2 space-y-1">
        {mods.length === 0 && !addingMod && <p className="text-[11px] text-slate-400 italic px-1 py-1">No modules</p>}
        {mods.map((m: WorkflowModuleRow) => (
          <div key={m.id} className="group flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: teamColor(m.owner_team_id) }} />
            <button onClick={() => onOpenStage(s.key)} className="text-[11px] text-slate-700 truncate flex-1 text-left hover:text-brand-700" title="Open to edit tasks">{m.name}</button>
            {isAdmin && <button onClick={() => onRemoveModule(m.id, m.name)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100" aria-label="Remove module">×</button>}
          </div>
        ))}
        {isAdmin && (addingMod ? (
          <div className="flex items-center gap-1">
            <input autoFocus value={modName} onChange={(e) => setModName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && modName.trim()) { onAddModule(s.key, modName); setModName(""); setAddingMod(false); } if (e.key === "Escape") { setAddingMod(false); setModName(""); } }}
              placeholder="Module name…" className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1 outline-none" />
            <button onClick={() => { if (modName.trim()) { onAddModule(s.key, modName); setModName(""); setAddingMod(false); } }} className="text-[11px] font-semibold text-brand-700">add</button>
          </div>
        ) : (
          <button onClick={() => setAddingMod(true)} className="text-[11px] font-semibold text-brand-700 hover:underline px-1">+ module</button>
        ))}
      </div>
      {isAdmin && (
        <div className="px-2 pb-2 flex justify-end">
          {inLane ? (
            <button onClick={() => onSplit(s.id)} className="text-[10px] font-semibold text-slate-400 hover:text-brand-700">split out</button>
          ) : canMerge ? (
            <button onClick={() => onMerge(s.id)} className="text-[10px] font-semibold text-slate-400 hover:text-brand-700" title="Run in parallel with the previous stage">∥ parallel w/ previous</button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function FlowView({
  stages, modules, teams, isAdmin,
  onOpenStage, onMerge, onSplit, canMerge,
  onAddStage, onRenameStage, onTargetStage, onToggleTerminal, onMoveStage, onRemoveStage, onAddModule, onRemoveModule,
}: {
  stages: PipelineStageRow[];
  modules: WorkflowModuleRow[];
  teams: TeamRow[];
  isAdmin: boolean;
  onOpenStage: (key: string) => void;
  onMerge: (id: string) => void;
  onSplit: (id: string) => void;
  canMerge: (id: string) => boolean;
  onAddStage: () => void;
  onRenameStage: (id: string, label: string) => void;
  onTargetStage: (id: string, days: number) => void;
  onToggleTerminal: (id: string, v: boolean) => void;
  onMoveStage: (s: PipelineStageRow, dir: "left" | "right") => void;
  onRemoveStage: (s: PipelineStageRow) => void;
  onAddModule: (stageKey: string, name: string) => void;
  onRemoveModule: (id: string, name: string) => void;
}) {
  const cols = flowColumns(stages);
  return (
    <div className="mt-6 overflow-x-auto pb-4">
      <div className="flex items-stretch gap-0 min-w-max">
        {cols.map((col, ci) => (
          <div key={ci} className="flex items-center">
            <div className="flex flex-col gap-2 justify-center">
              {col.stages.length > 1 && (
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">parallel</div>
              )}
              {col.stages.map((s) => (
                <StageCardEditable
                  key={s.id}
                  s={s}
                  mods={modules.filter((m) => m.stage_key === s.key).sort((a, b) => a.position - b.position)}
                  teams={teams}
                  isAdmin={isAdmin}
                  inLane={col.stages.length > 1}
                  canMerge={canMerge(s.id)}
                  onOpenStage={onOpenStage}
                  onRename={onRenameStage}
                  onTarget={onTargetStage}
                  onTerminal={onToggleTerminal}
                  onMove={onMoveStage}
                  onRemove={onRemoveStage}
                  onMerge={onMerge}
                  onSplit={onSplit}
                  onAddModule={onAddModule}
                  onRemoveModule={onRemoveModule}
                />
              ))}
            </div>
            <div className="px-1 text-slate-300 flex items-center" aria-hidden="true">
              <Icon name="arrow-right" size={18} />
            </div>
          </div>
        ))}
        {isAdmin && (
          <button onClick={onAddStage} className="w-40 self-stretch rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-brand-300 hover:text-brand-700 transition flex items-center justify-center gap-1.5 text-sm font-semibold min-h-[120px]">
            <Icon name="plus" size={14} /> Stage
          </button>
        )}
        {stages.length === 0 && !isAdmin && (
          <div className="text-sm text-slate-500 px-2 py-8">No stages configured yet.</div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * Module card — drag-handle, inline fields, expandable task templates
 * ========================================================================== */

function ModuleCard({
  module: mod,
  teams,
  roles,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  module: WorkflowModuleRow;
  teams: TeamRow[];
  roles: TeamRoleRow[];
  onUpdate: (patch: Partial<WorkflowModuleRow>) => Promise<void>;
  onDuplicate: () => void;
  onRemove: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: mod.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(mod.name);

  const commitName = () => {
    const next = nameDraft.trim();
    if (!next) { setNameDraft(mod.name); setRenaming(false); return; }
    if (next !== mod.name) void onUpdate({ name: next });
    setRenaming(false);
  };

  // Templates: load + manage scoped to this module.
  const [templates, setTemplates] = useState<WorkflowTaskTemplateRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("workflow_task_templates")
        .select("*")
        .eq("module_id", mod.id)
        .order("position", { ascending: true });
      if (!cancelled) setTemplates((data ?? []) as WorkflowTaskTemplateRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mod.id]);

  // Filter roles to ones that belong to this module's owner team (if set);
  // otherwise show all org roles so admins can mix-and-match.
  const availableRoles = useMemo(() => {
    if (!mod.owner_team_id) return roles;
    return roles.filter((r) => r.team_id === mod.owner_team_id);
  }, [roles, mod.owner_team_id]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "bg-white rounded-xl border shadow-sm overflow-hidden " +
        (mod.enabled ? "border-slate-200" : "border-slate-200 opacity-70")
      }
    >
      <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          title="Drag module"
          aria-label="Drag module"
        >
          <GripIcon />
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-900"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>

        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameDraft(mod.name);
                setRenaming(false);
              }
            }}
            className="font-display font-bold text-base text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500 flex-1 min-w-0"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="font-display font-bold text-base text-slate-900 hover:text-brand-700 transition flex-1 min-w-0 truncate text-left"
            title="Click to rename"
          >
            {mod.name}
          </button>
        )}

        <span className="text-[10px] font-mono text-slate-400">
          {templates === null ? "…" : `${templates.length} task${templates.length === 1 ? "" : "s"}`}
        </span>

        <label
          className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer"
          title={mod.enabled ? "Module is active" : "Module is disabled"}
        >
          <input
            type="checkbox"
            checked={mod.enabled}
            onChange={(e) => void onUpdate({ enabled: e.target.checked })}
            className="accent-brand-500 w-3.5 h-3.5"
          />
          {mod.enabled ? "enabled" : "disabled"}
        </label>

        <button
          onClick={onDuplicate}
          className="text-slate-400 hover:text-brand-700 transition px-1"
          title="Duplicate this module (with its tasks)"
          aria-label="Duplicate module"
        >
          <Icon name="copy" size={13} />
        </button>
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-600 transition text-lg leading-none px-1"
          title="Remove module"
          aria-label="Remove module"
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          {/* Module metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                Owner team
              </label>
              <Select
                value={mod.owner_team_id ?? ""}
                onChange={(e) =>
                  void onUpdate({ owner_team_id: e.target.value || null })
                }
              >
                <option value="">— Unassigned —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                Description (optional)
              </label>
              <Input
                value={mod.description ?? ""}
                onChange={(e) => void onUpdate({ description: e.target.value || null })}
                placeholder="What does this module produce?"
              />
            </div>
          </div>

          {/* Templates */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1">
              Task templates ({templates?.length ?? 0})
            </div>
            <TemplatesList
              moduleId={mod.id}
              templates={templates}
              setTemplates={setTemplates}
              availableRoles={availableRoles}
              allRoles={roles}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * Task templates list — drag-drop reorder, inline edit, +Add
 * ========================================================================== */

function TemplatesList({
  moduleId,
  templates,
  setTemplates,
  availableRoles,
  allRoles,
}: {
  moduleId: string;
  templates: WorkflowTaskTemplateRow[] | null;
  setTemplates: (rows: WorkflowTaskTemplateRow[]) => void;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
}) {
  const toast = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const addTemplate = async () => {
    const nextPos = (templates ?? []).reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { data, error } = await supabase
        .from("workflow_task_templates")
        .insert({
          module_id: moduleId,
          kind: "manual",
          title: "New task",
          position: nextPos,
        } as any)
        .select("*")
        .single();
      if (error) throw error;
      setTemplates([...(templates ?? []), data as unknown as WorkflowTaskTemplateRow]);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add task"));
    }
  };

  const updateTemplate = async (id: string, patch: Partial<WorkflowTaskTemplateRow>) => {
    setTemplates(
      (templates ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
    try {
      const { error } = await supabase
        .from("workflow_task_templates")
        .update(patch as any)
        .eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      toast.error(friendlyError(e, "Update failed"));
    }
  };

  const removeTemplate = async (id: string) => {
    setTemplates((templates ?? []).filter((t) => t.id !== id));
    try {
      const { error } = await supabase.from("workflow_task_templates").delete().eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      toast.error(friendlyError(e, "Remove failed"));
    }
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
    void Promise.all(
      next.map((t, i) =>
        supabase
          .from("workflow_task_templates")
          .update({ position: (i + 1) * 10 } as any)
          .eq("id", t.id)
      )
    );
  };

  if (templates === null) {
    return <div className="text-[11px] text-slate-500">Loading task templates…</div>;
  }

  return (
    <>
      {templates.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 italic">
          No tasks yet. Add one below.
        </div>
      )}
      {templates.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={templates.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {templates.map((t) => (
                <TemplateRow
                  key={t.id}
                  template={t}
                  availableRoles={availableRoles}
                  allRoles={allRoles}
                  onUpdate={(patch) => updateTemplate(t.id, patch)}
                  onRemove={() => removeTemplate(t.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <button
        onClick={addTemplate}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
      >
        <Icon name="plus" size={11} /> Add task template
      </button>
    </>
  );
}

function TemplateRow({
  template,
  availableRoles,
  allRoles,
  onUpdate,
  onRemove,
}: {
  template: WorkflowTaskTemplateRow;
  availableRoles: TeamRoleRow[];
  allRoles: TeamRoleRow[];
  onUpdate: (patch: Partial<WorkflowTaskTemplateRow>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: template.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(template.title);

  const commit = () => {
    const next = titleDraft.trim();
    if (next && next !== template.title) void onUpdate({ title: next });
    setRenaming(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="px-2 py-1.5 rounded-md border border-slate-200 bg-white"
    >
    <div className="grid grid-cols-[20px_1fr_110px_90px_180px_24px] gap-2 items-center">
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        aria-label="Drag task template"
      >
        <GripIcon />
      </button>

      {renaming ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setTitleDraft(template.title);
              setRenaming(false);
            }
          }}
          className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500"
        />
      ) : (
        <button
          onClick={() => setRenaming(true)}
          className="text-sm font-semibold text-slate-900 hover:text-brand-700 transition truncate text-left"
          title="Click to rename"
        >
          {template.title}
        </button>
      )}

      {/* Kind */}
      <Select
        value={template.kind}
        onChange={(e) => void onUpdate({ kind: e.target.value as TaskKind })}
        className="text-xs py-1 px-2"
      >
        {TASK_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </Select>

      {/* due offset days */}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={template.due_offset_days ?? ""}
          onChange={(e) =>
            void onUpdate({
              due_offset_days: e.target.value === "" ? null : Number(e.target.value),
            })
          }
          placeholder="due"
          title="Days after stage entry the task is due"
          className="text-xs py-1 px-2"
        />
        <span className="text-[10px] font-mono text-slate-400">d</span>
      </div>

      {/* role */}
      <Select
        value={template.assigned_to_role_id ?? ""}
        onChange={(e) => void onUpdate({ assigned_to_role_id: e.target.value || null })}
        className="text-xs py-1 px-2"
        title="Role this task is assigned to. Resolves to a user via team_role_holders at spawn time."
      >
        <option value="">— Unassigned —</option>
        {availableRoles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </Select>

      <button
        onClick={onRemove}
        className="text-slate-400 hover:text-red-600 transition text-base leading-none"
        title="Remove task template"
        aria-label="Remove task template"
      >
        ×
      </button>
    </div>
    {template.kind === "handoff" && (
      <div className="mt-1.5 ml-7 flex items-center gap-2 text-[11px] text-slate-600">
        <Icon name="arrow-right" size={11} className="text-slate-400 flex-shrink-0" />
        <span className="font-semibold whitespace-nowrap">Hands off to</span>
        <InfoTip side="top" label="When the sending role completes this task, a receipt task is created for the role picked here — the handoff is measurable on both sides." />
        <Select
          value={template.handoff_to_role_id ?? ""}
          onChange={(e) => void onUpdate({ handoff_to_role_id: e.target.value || null })}
          className="text-xs py-0.5 px-2 w-52"
          aria-label="Role that receives this handoff"
          title="When the sending role completes this task, a receipt task is created for this role — measurable on both sides"
        >
          <option value="">— Pick the receiving role —</option>
          {allRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
        {!template.handoff_to_role_id && (
          <span className="text-amber-600 font-semibold">
            pick a role so the receipt task can fire
          </span>
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
