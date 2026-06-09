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
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { AccessRoleRow } from "../lib/types";
import {
  DEFAULT_NAV,
  NAV_REGISTRY,
  navEntry,
  resolveNav,
  type NavGroupConfig,
  type NavItemConfig,
} from "../lib/navConfig";

import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** NavDesigner — admin-only drag-drop editor for the sidebar nav per access
 *  role. The page is split into:
 *
 *    LEFT (editor)
 *      - Role picker (which access_role we're editing)
 *      - Group list with sortable items
 *      - "+ Add group" affordance
 *      - Per-group: rename, delete (or "+ Add item from library")
 *      - Per-item: rename, hide, override icon, remove
 *      - "Reset to default" + "Save" controls
 *
 *    RIGHT (live preview)
 *      - Renders the working nav as it'll appear in the actual sidebar.
 *      - Shows what an admin user sees vs what a non-admin sees.
 *
 *  All writes go to access_roles.nav (jsonb). Realtime is on access_roles so
 *  any signed-in user with that access role sees the change instantly. */

export function NavDesigner() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const roles = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [working, setWorking] = useState<NavGroupConfig[]>([]);
  const [originalSerialized, setOriginalSerialized] = useState<string>("[]");
  const [saving, setSaving] = useState(false);
  const [previewAsAdmin, setPreviewAsAdmin] = useState(true);

  // dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Pick the first non-builtin or first role on load.
  useEffect(() => {
    if (selectedRoleId || roles.rows.length === 0) return;
    const preferred =
      roles.rows.find((r) => r.builtin && r.name === "Director") ||
      roles.rows[0];
    setSelectedRoleId(preferred.id);
  }, [roles.rows, selectedRoleId]);

  // Load working state when role changes.
  useEffect(() => {
    if (!selectedRoleId) {
      setWorking([]);
      setOriginalSerialized("[]");
      return;
    }
    const role = roles.rows.find((r) => r.id === selectedRoleId);
    if (!role) return;
    const cfg = ((role.nav as NavGroupConfig[]) ?? []).length > 0
      ? (role.nav as NavGroupConfig[])
      : DEFAULT_NAV;
    const clone = JSON.parse(JSON.stringify(cfg));
    setWorking(clone);
    setOriginalSerialized(JSON.stringify(clone));
  }, [selectedRoleId, roles.rows]);

  const dirty = useMemo(
    () => JSON.stringify(working) !== originalSerialized,
    [working, originalSerialized]
  );

  const selectedRole = roles.rows.find((r) => r.id === selectedRoleId) ?? null;

  /* ---------- mutators ---------- */

  const updateGroup = (idx: number, patch: Partial<NavGroupConfig>) =>
    setWorking((g) => g.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const removeGroup = (idx: number) =>
    setWorking((g) => g.filter((_, i) => i !== idx));

  const addGroup = () =>
    setWorking((g) => [...g, { group: "New group", items: [] }]);

  const moveGroup = (from: number, to: number) =>
    setWorking((g) => arrayMove(g, from, to));

  const updateItem = (
    groupIdx: number,
    itemIdx: number,
    patch: Partial<NavItemConfig>
  ) =>
    setWorking((g) =>
      g.map((gr, i) =>
        i === groupIdx
          ? {
              ...gr,
              items: gr.items.map((it, j) =>
                j === itemIdx ? { ...it, ...patch } : it
              ),
            }
          : gr
      )
    );

  const removeItem = (groupIdx: number, itemIdx: number) =>
    setWorking((g) =>
      g.map((gr, i) =>
        i === groupIdx
          ? { ...gr, items: gr.items.filter((_, j) => j !== itemIdx) }
          : gr
      )
    );

  const addItemToGroup = (groupIdx: number, key: string) =>
    setWorking((g) =>
      g.map((gr, i) =>
        i === groupIdx ? { ...gr, items: [...gr.items, { key }] } : gr
      )
    );

  // dnd-kit handles a single SortableContext per group. To move between groups
  // we listen for cross-container drags via id encoding: "g{groupIdx}:i{itemIdx}:{key}".
  const itemDragId = (gi: number, ii: number, k: string) => `i:${gi}:${ii}:${k}`;
  const groupDragId = (gi: number) => `g:${gi}`;

  const parseItem = (id: string) => {
    const m = id.match(/^i:(\d+):(\d+):(.+)$/);
    if (!m) return null;
    return { groupIdx: Number(m[1]), itemIdx: Number(m[2]), key: m[3] };
  };
  const parseGroup = (id: string) => {
    const m = id.match(/^g:(\d+)$/);
    if (!m) return null;
    return { groupIdx: Number(m[1]) };
  };

  const onDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    // Group reorder
    const ag = parseGroup(activeStr);
    const og = parseGroup(overStr);
    if (ag && og) {
      moveGroup(ag.groupIdx, og.groupIdx);
      return;
    }

    // Item reorder (within or across groups)
    const ai = parseItem(activeStr);
    if (!ai) return;
    let target: { groupIdx: number; itemIdx: number } | null = null;
    const oi = parseItem(overStr);
    if (oi) target = { groupIdx: oi.groupIdx, itemIdx: oi.itemIdx };
    else {
      // Dropped onto a group container header — append to that group.
      const ogTarget = parseGroup(overStr);
      if (ogTarget) target = { groupIdx: ogTarget.groupIdx, itemIdx: 0 };
    }
    if (!target) return;

    setWorking((groups) => {
      const next = groups.map((g) => ({ ...g, items: [...g.items] }));
      const item = next[ai.groupIdx].items[ai.itemIdx];
      if (!item) return groups;
      next[ai.groupIdx].items.splice(ai.itemIdx, 1);
      // If we removed from before the target within the same group, shift index back one.
      let insertAt = target.itemIdx;
      if (ai.groupIdx === target.groupIdx && ai.itemIdx < target.itemIdx) {
        insertAt = Math.max(0, target.itemIdx - 1);
      }
      next[target.groupIdx].items.splice(insertAt, 0, item);
      return next;
    });
  };

  /* ---------- persistence ---------- */

  const save = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("access_roles")
        .update({ nav: working as any })
        .eq("id", selectedRoleId);
      if (error) throw error;
      setOriginalSerialized(JSON.stringify(working));
      toast.success(stamped(`Saved nav for ${selectedRole?.name ?? "role"}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!(await confirmDialog({ title: "Reset nav", message: "Reset this role's nav to the system default? Unsaved changes will be lost.", confirmLabel: "Reset" }))) return;
    const clone = JSON.parse(JSON.stringify(DEFAULT_NAV));
    setWorking(clone);
  };

  /* ---------- gating ---------- */

  if (memberLoading) {
    return <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8 text-sm text-slate-500"><Loader label="Checking permissions…" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Nav designer" />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change navigation structure."
          />
        </Card>
      </div>
    );
  }

  /* ---------- view ---------- */

  // Items already in use (any group) — hide from the "add item" library for this group.
  const inUseKeys = new Set<string>(working.flatMap((g) => g.items.map((i) => i.key)));
  const libraryRest = NAV_REGISTRY.filter((r) => !inUseKeys.has(r.key));

  const resolvedPreview = resolveNav(working, { isAdmin: previewAsAdmin });

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Nav designer"
        subtitle="Decide what sidebar items each access role sees, where they're grouped, what labels they use, and what order they appear in. Drag to reorder. Hides apply per role."
      />

      {/* Toolbar */}
      <Card primary className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">
              Editing role
            </label>
            <select
              value={selectedRoleId ?? ""}
              onChange={(e) => setSelectedRoleId(e.target.value || null)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            >
              {roles.rows.length === 0 && <option>Loading…</option>}
              {roles.rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.builtin ? " (built-in)" : ""}
                </option>
              ))}
            </select>
            {selectedRole?.builtin && <Pill tone="neutral">built-in</Pill>}
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={addGroup}>
              <Icon name="plus" size={12} /> Add group
            </Button>
            <Button variant="ghost" size="sm" onClick={resetToDefault}>
              Reset to default
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Editor + preview side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 mt-4">
        {/* LEFT — editor */}
        <div className="space-y-3">
          {working.length === 0 && (
            <Card>
              <EmptyState
                iconName="layers"
                title="No groups yet"
                sub="Add a group to start building this role's sidebar."
                action={
                  <Button variant="primary" onClick={addGroup}>
                    <Icon name="plus" size={12} /> Add group
                  </Button>
                }
              />
            </Card>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={working.map((_, i) => groupDragId(i))}
              strategy={verticalListSortingStrategy}
            >
              {working.map((group, gi) => (
                <SortableGroup
                  key={`group-${gi}`}
                  id={groupDragId(gi)}
                  group={group}
                  groupIdx={gi}
                  itemDragId={itemDragId}
                  onRenameGroup={(name) => updateGroup(gi, { group: name })}
                  onToggleGroupHidden={() =>
                    updateGroup(gi, { hidden: !group.hidden })
                  }
                  onRemoveGroup={() => removeGroup(gi)}
                  onAddItem={(key) => addItemToGroup(gi, key)}
                  onUpdateItem={(ii, patch) => updateItem(gi, ii, patch)}
                  onRemoveItem={(ii) => removeItem(gi, ii)}
                  library={libraryRest}
                />
              ))}
            </SortableContext>

            <DragOverlay>
              {activeDragId ? <DragGhost id={activeDragId} working={working} /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* RIGHT — live preview */}
        <div>
          <div className="sticky top-20">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-500">
                Preview
              </div>
              <div className="flex items-center gap-1.5 text-[10px]">
                <button
                  onClick={() => setPreviewAsAdmin(true)}
                  aria-label="Preview the sidebar as an admin"
                  className={
                    "rounded px-2 py-0.5 font-semibold transition " +
                    (previewAsAdmin
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200")
                  }
                >
                  Admin
                </button>
                <button
                  onClick={() => setPreviewAsAdmin(false)}
                  aria-label="Preview the sidebar as a member"
                  className={
                    "rounded px-2 py-0.5 font-semibold transition " +
                    (!previewAsAdmin
                      ? "bg-slate-700 text-white"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200")
                  }
                >
                  Member
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-3 pt-3 pb-2 flex items-center gap-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-brand-gradient text-white flex items-center justify-center text-[11px] font-bold">
                  P
                </div>
                <span className="text-sm font-display font-extrabold tracking-tight">
                  Platypus
                </span>
              </div>
              <div className="px-2 py-2">
                {resolvedPreview.length === 0 && (
                  <div className="text-[11px] text-slate-400 italic px-2 py-3 text-center">
                    Nothing visible to this role yet.
                  </div>
                )}
                {resolvedPreview.map((group) => (
                  <div key={group.group} className="mb-3">
                    <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      {group.group}
                    </div>
                    <ul className="space-y-0.5">
                      {group.items.map((it) => (
                        <li
                          key={it.key}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-slate-700"
                        >
                          <Icon name={it.icon} size={12} className="text-slate-400" />
                          {it.label}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Toggle <strong>Admin</strong> / <strong>Member</strong> to preview how this role
              looks for each tier. Admin-only items always hide for non-admins, whatever you set here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * Sortable group
 * ========================================================================== */

function SortableGroup({
  id,
  group,
  groupIdx,
  itemDragId,
  onRenameGroup,
  onToggleGroupHidden,
  onRemoveGroup,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  library,
}: {
  id: string;
  group: NavGroupConfig;
  groupIdx: number;
  itemDragId: (gi: number, ii: number, key: string) => string;
  onRenameGroup: (name: string) => void;
  onToggleGroupHidden: () => void;
  onRemoveGroup: () => void;
  onAddItem: (key: string) => void;
  onUpdateItem: (ii: number, patch: Partial<NavItemConfig>) => void;
  onRemoveItem: (ii: number) => void;
  library: { key: string; label: string; icon: string }[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.group);
  const [showLib, setShowLib] = useState(false);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
    >
      <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
          title="Drag group"
          aria-label="Drag to reorder this group"
        >
          <GripIcon />
        </button>

        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft.trim()) onRenameGroup(nameDraft.trim());
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (nameDraft.trim()) onRenameGroup(nameDraft.trim());
                setRenaming(false);
              } else if (e.key === "Escape") {
                setNameDraft(group.group);
                setRenaming(false);
              }
            }}
            className="text-sm font-semibold text-slate-700 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="text-sm font-semibold text-slate-700 hover:text-brand-700 transition"
            title="Rename group"
            aria-label={`Rename group ${group.group}`}
          >
            {group.group}
          </button>
        )}

        {group.hidden && <Pill tone="warning">hidden</Pill>}

        <span className="text-[10px] font-mono text-slate-400">
          {group.items.length} item{group.items.length === 1 ? "" : "s"}
        </span>

        <div className="flex-1" />

        <button
          onClick={onToggleGroupHidden}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition px-1.5 py-0.5 rounded hover:bg-slate-100"
          title={group.hidden ? "Show group" : "Hide group"}
          aria-label={group.hidden ? "Show this group in the sidebar" : "Hide this group from the sidebar"}
        >
          {group.hidden ? "Show" : "Hide"}
        </button>
        <button
          onClick={onRemoveGroup}
          title="Remove group"
          aria-label="Remove this group"
          className="text-slate-400 hover:text-red-600 transition text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      <SortableContext
        items={group.items.map((it, i) => itemDragId(groupIdx, i, it.key))}
        strategy={verticalListSortingStrategy}
      >
        <div className="p-2 space-y-1 min-h-[40px]">
          {group.items.length === 0 && (
            <div className="text-[11px] text-slate-400 italic px-2 py-3 text-center">
              No items in this group yet. Drag here or add from the library.
            </div>
          )}
          {group.items.map((it, ii) => (
            <SortableItem
              key={`${groupIdx}-${ii}-${it.key}`}
              dragId={itemDragId(groupIdx, ii, it.key)}
              item={it}
              onUpdate={(patch) => onUpdateItem(ii, patch)}
              onRemove={() => onRemoveItem(ii)}
            />
          ))}
        </div>
      </SortableContext>

      {/* Add from library */}
      <div className="border-t border-slate-100 px-3 py-2 bg-slate-50/40">
        <button
          onClick={() => setShowLib((o) => !o)}
          className="text-[11px] font-semibold text-brand-700 hover:underline flex items-center gap-1"
        >
          <Icon name="plus" size={11} /> Add item from library
          {showLib ? <Icon name="chevron-up" size={11} /> : <Icon name="chevron-down" size={11} />}
        </button>
        {showLib && (
          <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-1.5">
            {library.length === 0 && (
              <div className="text-[11px] text-slate-400 italic px-2 py-2 col-span-3">
                Every available item is already placed.
              </div>
            )}
            {library.map((lib) => (
              <button
                key={lib.key}
                onClick={() => {
                  onAddItem(lib.key);
                  setShowLib(false);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 hover:border-brand-300 hover:bg-brand-50/30 transition flex items-center gap-1.5 text-left"
                title={navEntry(lib.key)?.description}
              >
                <Icon name={lib.icon} size={12} className="text-slate-400" />
                <span className="truncate">{lib.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
 * Sortable item row
 * ========================================================================== */

function SortableItem({
  dragId,
  item,
  onUpdate,
  onRemove,
}: {
  dragId: string;
  item: NavItemConfig;
  onUpdate: (patch: Partial<NavItemConfig>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dragId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const reg = navEntry(item.key);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.label ?? reg?.label ?? "");

  if (!reg) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="px-2 py-2 rounded-md border border-red-200 bg-red-50 text-xs text-red-700"
      >
        Unknown nav key: <code className="font-mono">{item.key}</code>
        <button onClick={onRemove} className="ml-2 underline">remove</button>
      </div>
    );
  }

  const effectiveLabel = item.label || reg.label;
  const effectiveIcon = item.icon || reg.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "flex items-center gap-2 px-2 py-1.5 rounded-md border " +
        (item.hidden
          ? "border-amber-200 bg-amber-50/60 opacity-70"
          : "border-slate-200 bg-white")
      }
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        title="Drag item"
        aria-label="Drag to reorder this item"
      >
        <GripIcon />
      </button>
      <Icon name={effectiveIcon} size={14} className="text-slate-400 flex-shrink-0" />

      {renaming ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const trimmed = draft.trim();
            // Empty = clear override (use registry default)
            onUpdate({ label: trimmed && trimmed !== reg.label ? trimmed : undefined });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const trimmed = draft.trim();
              onUpdate({ label: trimmed && trimmed !== reg.label ? trimmed : undefined });
              setRenaming(false);
            } else if (e.key === "Escape") {
              setDraft(item.label ?? reg.label);
              setRenaming(false);
            }
          }}
          className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500 flex-1 min-w-0"
        />
      ) : (
        <button
          onClick={() => setRenaming(true)}
          className="text-sm font-semibold text-slate-900 hover:text-brand-700 transition flex-1 min-w-0 truncate text-left"
          title="Click to rename"
        aria-label={`Rename ${effectiveLabel}`}
        >
          {effectiveLabel}
        </button>
      )}

      {item.label && item.label !== reg.label && (
        <Pill tone="brand">renamed</Pill>
      )}
      {reg.adminOnly && <Pill tone="neutral">admin</Pill>}

      <code className="text-[10px] font-mono text-slate-400 truncate hidden md:inline">
        {reg.hash}
      </code>

      <button
        onClick={() => onUpdate({ hidden: !item.hidden })}
        title={item.hidden ? "Show item" : "Hide item"}
        aria-label={item.hidden ? "Show this item in the sidebar" : "Hide this item from the sidebar"}
        className={
          "text-[11px] font-semibold px-1.5 py-0.5 rounded transition " +
          (item.hidden
            ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200")
        }
      >
        {item.hidden ? "hidden" : "shown"}
      </button>
      <button
        onClick={onRemove}
        title="Remove item"
        aria-label="Remove this item"
        className="text-slate-400 hover:text-red-600 transition text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

/* ---------- drag overlay ghost ---------- */

function DragGhost({ id, working }: { id: string; working: NavGroupConfig[] }) {
  const itemMatch = id.match(/^i:(\d+):(\d+):(.+)$/);
  if (itemMatch) {
    const gi = Number(itemMatch[1]);
    const ii = Number(itemMatch[2]);
    const item = working[gi]?.items[ii];
    if (!item) return null;
    const reg = navEntry(item.key);
    return (
      <div className="bg-white rounded-md border border-brand-300 shadow-lg px-3 py-1.5 text-sm font-semibold text-slate-900 flex items-center gap-2">
        <GripIcon />
        <Icon name={reg?.icon || "folder"} size={14} className="text-slate-400" />
        {item.label || reg?.label || item.key}
      </div>
    );
  }
  const groupMatch = id.match(/^g:(\d+)$/);
  if (groupMatch) {
    const group = working[Number(groupMatch[1])];
    if (!group) return null;
    return (
      <div className="bg-white rounded-xl border border-brand-300 shadow-lg px-3 py-2 text-sm font-semibold text-slate-800">
        {group.group}
      </div>
    );
  }
  return null;
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
