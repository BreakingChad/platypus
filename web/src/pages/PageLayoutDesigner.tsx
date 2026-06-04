import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";
import { setPreviewRole } from "../lib/previewRole";
import { InfoTip } from "../components/ui/Tip";
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
  PAGE_REGISTRY,
  pageEntry,
  newBlockId,
  resolvePageConfig,
  type PageBlockConfig,
  type PageLayoutsConfig,
  type PageTabConfig,
} from "../lib/navConfig";
import { BLOCK_REGISTRY, blockEntry } from "../blocks/registry";

import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** PageLayoutDesigner — drag-drop block editor per page per access role.
 *
 *  Layout state is stored in access_roles.page_layouts as:
 *    { [pageKey]: PageBlockConfig[] }
 *
 *  Each block instance carries an id, block-type key, hidden flag, and a
 *  per-instance settings object the block component knows how to consume.
 */

export function PageLayoutDesigner() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const roles = useOrgTable<AccessRoleRow>("access_roles", { realtime: true });

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState<string>(() => {
    // Deep link: #/settings/pages?page=<key> (from the header gear menu).
    try {
      const q = window.location.hash.split("?")[1];
      const want = q ? new URLSearchParams(q).get("page") : null;
      if (want && PAGE_REGISTRY.some((p) => p.key === want)) return want;
    } catch {
      /* fall through to default */
    }
    return PAGE_REGISTRY[0]?.key ?? "home";
  });
  const [working, setWorking] = useState<PageBlockConfig[]>([]);
  const [workingTabs, setWorkingTabs] = useState<PageTabConfig[]>([]);
  const [workingOptions, setWorkingOptions] = useState<Record<string, unknown>>({});
  const [originalSerialized, setOriginalSerialized] = useState<string>("[]");
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [dragId, setDragId] = useState<string | null>(null);

  // Pick a default role.
  useEffect(() => {
    if (selectedRoleId || roles.rows.length === 0) return;
    const preferred =
      roles.rows.find((r) => r.builtin && r.name === "Director") || roles.rows[0];
    setSelectedRoleId(preferred.id);
  }, [roles.rows, selectedRoleId]);

  // Sync working state when role or page changes.
  useEffect(() => {
    if (!selectedRoleId) {
      setWorking([]);
      setOriginalSerialized("[]");
      return;
    }
    const role = roles.rows.find((r) => r.id === selectedRoleId);
    if (!role) return;
    const cfg = resolvePageConfig(selectedPageKey, (role.page_layouts as PageLayoutsConfig) ?? {});
    const clone = JSON.parse(JSON.stringify(cfg));
    setWorking(clone.blocks);
    setWorkingTabs(clone.tabs ?? []);
    setWorkingOptions(clone.options ?? {});
    setOriginalSerialized(JSON.stringify(clone));
    setSelectedBlockId(null);
    setActiveBlockId(null);
  }, [selectedRoleId, selectedPageKey, roles.rows]);

  const dirty = useMemo(
    () =>
      JSON.stringify({ blocks: working, tabs: workingTabs, options: workingOptions }) !==
      originalSerialized,
    [working, workingTabs, workingOptions, originalSerialized]
  );
  const selectedRole = roles.rows.find((r) => r.id === selectedRoleId) ?? null;
  const pageMeta = pageEntry(selectedPageKey);

  /* ---------- mutators ---------- */

  const addBlock = (blockKey: string, region: "top" | "bottom" = "top") => {
    const entry = blockEntry(blockKey);
    if (!entry) return;
    const block: PageBlockConfig = {
      id: newBlockId(blockKey),
      block: blockKey,
      region,
      settings: { ...(entry.defaultSettings ?? {}) },
    };
    setWorking((bs) => [...bs, block]);
    setSelectedBlockId(block.id);
  };

  const setRegion = (id: string, region: "top" | "bottom") => {
    setWorking((bs) => bs.map((b) => (b.id === id ? { ...b, region } : b)));
  };

  const copyFromRole = async (fromRoleId: string) => {
    const from = roles.rows.find((r) => r.id === fromRoleId);
    if (!from) return;
    const cfg = resolvePageConfig(selectedPageKey, (from.page_layouts as PageLayoutsConfig) ?? {});
    if (
      !(await confirmDialog({
        title: "Copy layout",
        message: `Replace this working layout with ${from.name}'s ${pageMeta?.label ?? selectedPageKey} layout? You still review and save.`,
        confirmLabel: "Copy",
      }))
    )
      return;
    const clone = JSON.parse(JSON.stringify(cfg));
    setWorking(clone.blocks);
    setWorkingTabs(clone.tabs ?? []);
    setWorkingOptions(clone.options ?? {});
    setSelectedBlockId(null);
  };

  const removeBlock = (id: string) => {
    setWorking((bs) => bs.filter((b) => b.id !== id));
    if (selectedBlockId === id) setSelectedBlockId(null);
  };

  const toggleHidden = (id: string) => {
    setWorking((bs) =>
      bs.map((b) => (b.id === id ? { ...b, hidden: !b.hidden } : b))
    );
  };

  const updateSettings = (id: string, key: string, value: unknown) => {
    setWorking((bs) =>
      bs.map((b) =>
        b.id === id ? { ...b, settings: { ...(b.settings ?? {}), [key]: value } } : b
      )
    );
  };

  const resetToDefault = async () => {
    if (!(await confirmDialog({ title: "Reset layout", message: "Reset this page to its default layout? Unsaved changes will be lost.", confirmLabel: "Reset" }))) return;
    const entry = pageEntry(selectedPageKey);
    setWorking(JSON.parse(JSON.stringify(entry?.defaultLayout ?? [])));
    setWorkingTabs((entry?.tabs ?? []).map((t) => ({ key: t.key })));
    setWorkingOptions({});
    setSelectedBlockId(null);
  };

  /* ---------- dnd-kit ---------- */

  const onDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id));
    setActiveBlockId(String(e.active.id));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = working.findIndex((b) => b.id === active.id);
    const to = working.findIndex((b) => b.id === over.id);
    if (from < 0 || to < 0) return;
    setWorking((bs) => {
      const overRegion = bs[to]?.region ?? "top";
      const moved = arrayMove(bs, from, to);
      return moved.map((b) => (b.id === active.id ? { ...b, region: overRegion } : b));
    });
  };

  /* ---------- persistence ---------- */

  const save = async () => {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      // Merge into the role's existing page_layouts JSONB.
      const role = roles.rows.find((r) => r.id === selectedRoleId);
      const prev = (role?.page_layouts as PageLayoutsConfig) ?? {};
      const next = {
        ...prev,
        [selectedPageKey]: { blocks: working, tabs: workingTabs, options: workingOptions },
      };
      const { error } = await supabase
        .from("access_roles")
        .update({ page_layouts: next as any })
        .eq("id", selectedRoleId);
      if (error) throw error;
      setOriginalSerialized(
        JSON.stringify({ blocks: working, tabs: workingTabs, options: workingOptions })
      );
      toast.success(stamped(`Saved ${pageMeta?.label} layout for ${selectedRole?.name}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  /* ---------- gating ---------- */

  if (memberLoading) {
    return <div className="max-w-7xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <PageHeader kicker="Configure" title="Page designer" />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can edit page layouts."
          />
        </Card>
      </div>
    );
  }

  /* ---------- view ---------- */

  const inUseKeys = new Set(working.map((b) => b.block));
  const allowedBlocks = pageMeta?.allowedBlocks ?? [];
  const libraryUnused = allowedBlocks
    .filter((k) => !inUseKeys.has(k))
    .map((k) => blockEntry(k))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  const selectedBlock = working.find((b) => b.id === selectedBlockId) ?? null;
  const selectedBlockMeta = selectedBlock ? blockEntry(selectedBlock.block) : null;
  const topBlocks = working.filter((b) => (b.region ?? "top") === "top");
  const bottomBlocks = working.filter((b) => (b.region ?? "top") === "bottom");

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Page designer"
        subtitle="Every page in the workspace, shaped per access role. Place any block above or below a page's built-in content, reorder by drag, tune each block's settings — what you save here is exactly what that role sees, live."
        actions={<Pill tone="brand">live · admin-driven</Pill>}
      />

      {/* Toolbar */}
      <Card primary className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">
              Page
            </label>
            <select
              value={selectedPageKey}
              onChange={(e) => setSelectedPageKey(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            >
              {PAGE_REGISTRY.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500">
              For role
            </label>
            <select
              value={selectedRoleId ?? ""}
              onChange={(e) => setSelectedRoleId(e.target.value || null)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            >
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
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) void copyFromRole(e.target.value);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 outline-none focus:border-brand-500"
              aria-label="Copy layout from another role"
            >
              <option value="">Copy from role…</option>
              {roles.rows
                .filter((r) => r.id !== selectedRoleId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!selectedRole) return;
                setPreviewRole({ id: selectedRole.id, name: selectedRole.name });
                const HASH: Record<string, string> = {
                  home: "#/", intake: "#/intake", studies: "#/studies",
                  pipeline: "#/pipeline", sites: "#/sites", inbox: "#/inbox",
                  "study-detail": "#/studies",
                };
                window.location.hash = HASH[selectedPageKey] ?? "#/";
              }}
              title="See the app exactly as this role does (last saved layout — save first to preview changes)"
            >
              Preview as role
            </Button>
            <Button variant="ghost" size="sm" onClick={resetToDefault}>
              Reset page
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
        {pageMeta?.description && (
          <p className="text-xs text-slate-500 mt-3 leading-relaxed">{pageMeta.description}</p>
        )}
      </Card>

      {/* Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px_300px] gap-4 mt-4">
        {/* CENTER — the page, top to bottom, core content locked in place */}
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
            This page, top to bottom
            <InfoTip side="bottom" label="The canvas mirrors the real page. Blocks above the grey anchor render before the page's built-in content; blocks below render after. Drag across the divider or use a row's above/below chip." />
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={working.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2 min-h-[200px]">
                {topBlocks.map((b) => (
                  <SortableBlockRow
                    key={b.id}
                    block={b}
                    selected={b.id === selectedBlockId}
                    onSelect={() => setSelectedBlockId(b.id)}
                    onToggleHidden={() => toggleHidden(b.id)}
                    onRemove={() => removeBlock(b.id)}
                    onRegion={(r) => setRegion(b.id, r)}
                  />
                ))}

                {pageMeta?.coreLabel ? (
                  <div className="rounded-lg border-2 border-slate-300 bg-slate-100/80 px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <Icon name="lock" size={14} className="text-slate-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-700">{pageMeta.coreLabel}</div>
                        <div className="text-[11px] font-semibold text-slate-400">
                          built-in page content · always shown
                        </div>
                      </div>
                    </div>

                    {(pageMeta.tabs ?? []).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                          Its tabs — reorder, rename, hide
                        </div>
                        <div className="space-y-1">
                          {workingTabs.map((t, idx) => {
                            const reg = (pageMeta.tabs ?? []).find((r) => r.key === t.key);
                            return (
                              <div
                                key={t.key}
                                className={
                                  "flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 " +
                                  (t.hidden ? "opacity-60 border-slate-200" : "border-slate-200")
                                }
                              >
                                <div className="flex flex-col">
                                  <button
                                    onClick={() =>
                                      idx > 0 &&
                                      setWorkingTabs((ts) => {
                                        const n = [...ts];
                                        [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
                                        return n;
                                      })
                                    }
                                    disabled={idx === 0}
                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-30"
                                    aria-label={`Move ${reg?.label ?? t.key} up`}
                                  >
                                    <Icon name="chevron-up" size={11} />
                                  </button>
                                  <button
                                    onClick={() =>
                                      idx < workingTabs.length - 1 &&
                                      setWorkingTabs((ts) => {
                                        const n = [...ts];
                                        [n[idx + 1], n[idx]] = [n[idx], n[idx + 1]];
                                        return n;
                                      })
                                    }
                                    disabled={idx === workingTabs.length - 1}
                                    className="text-slate-300 hover:text-slate-600 disabled:opacity-30"
                                    aria-label={`Move ${reg?.label ?? t.key} down`}
                                  >
                                    <Icon name="chevron-down" size={11} />
                                  </button>
                                </div>
                                <input
                                  value={t.label ?? ""}
                                  onChange={(e) =>
                                    setWorkingTabs((ts) =>
                                      ts.map((x) =>
                                        x.key === t.key ? { ...x, label: e.target.value || undefined } : x
                                      )
                                    )
                                  }
                                  placeholder={reg?.label ?? t.key}
                                  className="flex-1 min-w-0 text-sm text-slate-800 bg-transparent outline-none border-b border-transparent focus:border-brand-300 placeholder:text-slate-400"
                                  aria-label={`Rename ${reg?.label ?? t.key} tab`}
                                />
                                <button
                                  onClick={() => {
                                    const visible = workingTabs.filter((x) => !x.hidden);
                                    if (!t.hidden && visible.length <= 1) return;
                                    setWorkingTabs((ts) =>
                                      ts.map((x) =>
                                        x.key === t.key ? { ...x, hidden: !x.hidden } : x
                                      )
                                    );
                                  }}
                                  className={
                                    "text-[11px] font-semibold px-1.5 py-0.5 rounded transition " +
                                    (t.hidden
                                      ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                                      : "bg-slate-100 text-slate-500 hover:bg-slate-200")
                                  }
                                  title={
                                    !t.hidden && workingTabs.filter((x) => !x.hidden).length <= 1
                                      ? "At least one tab must stay visible"
                                      : t.hidden
                                      ? "Show this tab"
                                      : "Hide this tab"
                                  }
                                >
                                  {t.hidden ? "hidden" : "shown"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {selectedPageKey === "study-detail" && (
                      <div className="mt-3 pt-3 border-t border-slate-200 text-[11px] text-slate-500">
                        The Overview tab's field sections (order, grouping, required fields) are
                        arranged org-wide in the{" "}
                        <a href="#/settings/fields" className="font-semibold text-brand-700 hover:underline">
                          Field designer →
                        </a>
                      </div>
                    )}

                    {(pageMeta.optionsSchema ?? []).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                          Page defaults for this role
                        </div>
                        <div className="space-y-2">
                          {(pageMeta.optionsSchema ?? []).map((opt) => (
                            <div key={opt.key} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-700">{opt.label}</div>
                                {opt.description && (
                                  <div className="text-[10px] text-slate-500">{opt.description}</div>
                                )}
                              </div>
                              {opt.kind === "boolean" ? (
                                <input
                                  type="checkbox"
                                  checked={
                                    workingOptions[opt.key] === undefined
                                      ? opt.defaultValue ?? false
                                      : Boolean(workingOptions[opt.key])
                                  }
                                  onChange={(e) =>
                                    setWorkingOptions((o) => ({ ...o, [opt.key]: e.target.checked }))
                                  }
                                  className="accent-brand-500 w-4 h-4"
                                  aria-label={opt.label}
                                />
                              ) : (
                                <select
                                  value={(workingOptions[opt.key] as string) ?? ""}
                                  onChange={(e) =>
                                    setWorkingOptions((o) => {
                                      const n = { ...o };
                                      if (e.target.value) n[opt.key] = e.target.value;
                                      else delete n[opt.key];
                                      return n;
                                    })
                                  }
                                  className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1 outline-none focus:border-brand-500"
                                  aria-label={opt.label}
                                >
                                  <option value="">App default</option>
                                  {(opt.choices ?? []).map((c) => (
                                    <option key={c.value} value={c.value}>
                                      {c.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : working.length === 0 ? (
                  <Card>
                    <EmptyState
                      iconName="layers"
                      title="Nothing on this page yet"
                      sub="Add a block from the library on the right."
                    />
                  </Card>
                ) : null}

                {bottomBlocks.map((b) => (
                  <SortableBlockRow
                    key={b.id}
                    block={b}
                    selected={b.id === selectedBlockId}
                    onSelect={() => setSelectedBlockId(b.id)}
                    onToggleHidden={() => toggleHidden(b.id)}
                    onRemove={() => removeBlock(b.id)}
                    onRegion={(r) => setRegion(b.id, r)}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay>
              {dragId ? <BlockGhost id={dragId} working={working} /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* RIGHT — block library */}
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">
            Block library
          </div>
          <div className="space-y-2 sticky top-20">
            {libraryUnused.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-500 italic">
                Every block this page supports is already placed.
              </div>
            )}
            {libraryUnused.map((entry) => (
              <div
                key={entry.key}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 flex items-start gap-2.5"
              >
                <div className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
                  <Icon name={entry.icon} size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900">{entry.label}</div>
                  <div className="text-[11px] text-slate-500 leading-snug">{entry.description}</div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      onClick={() => addBlock(entry.key, "top")}
                      className="text-[11px] font-semibold rounded border border-brand-200 bg-brand-50 text-brand-700 px-1.5 py-0.5 hover:bg-brand-100 transition"
                    >
                      {pageMeta?.coreLabel ? "+ Above" : "+ Add"}
                    </button>
                    {pageMeta?.coreLabel && (
                      <button
                        onClick={() => addBlock(entry.key, "bottom")}
                        className="text-[11px] font-semibold rounded border border-slate-200 bg-white text-slate-600 px-1.5 py-0.5 hover:border-slate-300 transition"
                      >
                        + Below
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHTMOST — selected block settings */}
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">
            {selectedBlock ? "Block settings" : "Settings"}
          </div>
          {!selectedBlock && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-[11px] text-slate-500 italic">
              Click a block on the left to edit its settings.
            </div>
          )}
          {selectedBlock && selectedBlockMeta && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Icon name={selectedBlockMeta.icon} size={14} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-900">
                  {selectedBlockMeta.label}
                </span>
              </div>
              <div className="p-3 space-y-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {selectedBlockMeta.description}
                </p>
                {(selectedBlockMeta.settingsSchema ?? []).length === 0 && (
                  <div className="text-[11px] italic text-slate-400">
                    This block has no per-instance settings.
                  </div>
                )}
                {(selectedBlockMeta.settingsSchema ?? []).map((field) => {
                  const v = (selectedBlock.settings ?? {})[field.key];
                  return (
                    <div key={field.key}>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        {field.label}
                      </label>
                      {field.kind === "number" && (
                        <Input
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={typeof v === "number" ? v : ""}
                          onChange={(e) =>
                            updateSettings(selectedBlock.id, field.key, Number(e.target.value))
                          }
                        />
                      )}
                      {field.kind === "text" && (
                        <Input
                          value={typeof v === "string" ? v : ""}
                          onChange={(e) =>
                            updateSettings(selectedBlock.id, field.key, e.target.value)
                          }
                        />
                      )}
                      {field.kind === "boolean" && (
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(v)}
                            onChange={(e) =>
                              updateSettings(selectedBlock.id, field.key, e.target.checked)
                            }
                            className="accent-brand-500 w-4 h-4"
                          />
                          Yes
                        </label>
                      )}
                      {field.description && (
                        <p className="text-[10px] text-slate-500 mt-1">{field.description}</p>
                      )}
                    </div>
                  );
                })}

                {/* Footer actions */}
                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleHidden(selectedBlock.id)}
                  >
                    {selectedBlock.hidden ? "Show on page" : "Hide on page"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => removeBlock(selectedBlock.id)}
                  >
                    Remove block
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- sortable block row ---------- */

function SortableBlockRow({
  block,
  selected,
  onSelect,
  onToggleHidden,
  onRemove,
  onRegion,
}: {
  block: PageBlockConfig;
  selected: boolean;
  onSelect: () => void;
  onToggleHidden: () => void;
  onRemove: () => void;
  onRegion?: (r: "top" | "bottom") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const entry = blockEntry(block.block);

  if (!entry) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2"
      >
        Unknown block <code className="font-mono">{block.block}</code>
        <button onClick={onRemove} className="ml-auto underline">remove</button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={
        "rounded-lg border bg-white shadow-sm transition cursor-pointer flex items-center gap-2 px-3 py-2.5 " +
        (selected
          ? "border-brand-400 ring-2 ring-brand-200"
          : "border-slate-200 hover:border-slate-300") +
        (block.hidden ? " opacity-60" : "")
      }
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        title="Drag block"
      >
        <GripIcon />
      </button>
      <div className="w-8 h-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center flex-shrink-0">
        <Icon name={entry.icon} size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          {entry.label}
          {block.hidden && <Pill tone="warning">hidden</Pill>}
        </div>
        <div className="text-[11px] text-slate-500 truncate">{entry.description}</div>
      </div>
      {onRegion && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRegion((block.region ?? "top") === "top" ? "bottom" : "top");
          }}
          title="Move to the other side of the page content"
          className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 transition"
        >
          {(block.region ?? "top") === "top" ? "above" : "below"}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden();
        }}
        title={block.hidden ? "Show on page" : "Hide on page"}
        className={
          "text-[11px] font-semibold px-1.5 py-0.5 rounded transition " +
          (block.hidden
            ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200")
        }
      >
        {block.hidden ? "hidden" : "shown"}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove block"
        className="text-slate-400 hover:text-red-600 transition text-lg leading-none px-1"
      >
        ×
      </button>
    </div>
  );
}

function BlockGhost({ id, working }: { id: string; working: PageBlockConfig[] }) {
  const b = working.find((x) => x.id === id);
  if (!b) return null;
  const entry = blockEntry(b.block);
  return (
    <div className="rounded-lg border border-brand-300 bg-white shadow-lg px-3 py-2 text-sm font-semibold text-slate-900 flex items-center gap-2">
      <GripIcon />
      <Icon name={entry?.icon || "folder"} size={14} className="text-slate-400" />
      {entry?.label || b.block}
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
