import { friendlyError } from "../lib/errors";
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
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
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
    if (!orgId || !selectedStageKey) return;
    const nextPos = stageModules.reduce((m, x) => Math.max(m, x.position), 0) + 10;
    try {
      const { error } = await supabase.from("workflow_modules").insert({
        org_id: orgId,
        stage_key: selectedStageKey,
        name: "New module",
        enabled: true,
        position: nextPos,
      } as any);
      if (error) throw error;
      toast.success("Module added");
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
      toast.success("Module removed");
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
    return <div className="max-w-7xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <PageHeader kicker="Configure" title="Work Stream Builder" />
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
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Work Stream Builder"
        subtitle="Design the operating model. When a study enters a stage, the modules configured here fire and spawn tasks automatically — assigned to the right roles, with the right due dates."
        actions={<Pill tone="brand">live · admin-driven</Pill>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 mt-6">
        {/* LEFT — stage rail */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
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
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
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
              <Button variant="primary" size="sm" onClick={addModule}>
                <Icon name="plus" size={12} /> Add module
              </Button>
            )}
          </div>

          {selectedStage && stageModules.length === 0 && (
            <Card>
              <EmptyState
                iconName="layers"
                title={`No modules on ${selectedStage.label} yet`}
                sub="Add a module above. Each module groups related tasks that fire together when a study lands on this stage."
                action={
                  <Button variant="primary" onClick={addModule}>
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
  onRemove,
}: {
  module: WorkflowModuleRow;
  teams: TeamRow[];
  roles: TeamRoleRow[];
  onUpdate: (patch: Partial<WorkflowModuleRow>) => Promise<void>;
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
    if (next && next !== mod.name) void onUpdate({ name: next });
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
          className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-600 cursor-pointer"
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
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
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
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
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
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Task templates ({templates?.length ?? 0})
            </div>
            <TemplatesList
              moduleId={mod.id}
              templates={templates}
              setTemplates={setTemplates}
              availableRoles={availableRoles}
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
}: {
  moduleId: string;
  templates: WorkflowTaskTemplateRow[] | null;
  setTemplates: (rows: WorkflowTaskTemplateRow[]) => void;
  availableRoles: TeamRoleRow[];
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
  onUpdate,
  onRemove,
}: {
  template: WorkflowTaskTemplateRow;
  availableRoles: TeamRoleRow[];
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
      className="grid grid-cols-[20px_1fr_110px_90px_180px_24px] gap-2 items-center px-2 py-1.5 rounded-md border border-slate-200 bg-white"
    >
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
