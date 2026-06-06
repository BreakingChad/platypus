import { friendlyError } from "../lib/errors";
import { fmtDate } from "../lib/dates";
import { PageBlocks } from "../blocks/PageBlocks";
import { confirmDialog } from "../lib/confirm";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { useEffect, useMemo, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type {
  SiteRow, StudyRow, PipelineStageRow } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { HealthDot } from "../components/ui/HealthDot";
import { useModalA11y } from "../lib/useModalA11y";
import { useDismissable } from "../lib/useDismissable";
import {
  EMPTY_ADV_FILTERS,
  advFilterCount,
  matchesAdvFilters,
  describeAdvFilters,
  optionCounts,
  type AdvFilters,
} from "../lib/portfolioFilters";
import { computeHealth, healthSortWeight, type HealthLevel } from "../lib/studyHealth";
import { useStickyState, useStickyStateWithRoleDefault } from "../lib/useStickyState";
import { isHistorical } from "../lib/amendments";
import { InfoTip } from "../components/ui/Tip";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import { useStarredStudies } from "../lib/useStarred";
import { toCsv, downloadCsv } from "../lib/csv";
import { useAuth } from "../auth/useAuth";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";

/** Studies List — the full portfolio. Click into a study (coming next phase).
 *  Live on the studies table. Admin can create; everyone can read. */
export function StudiesList({
  onNavigate,
  initialViewMode,
}: {
  onNavigate: (h: string) => void;
  /** Route-driven view (e.g. #/pipeline opens the board). Applied once. */
  initialViewMode?: "list" | "table" | "board";
}) {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const { orgId } = useCurrentOrg();
  const starred = useStarredStudies(userEmail);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toast = useToast();
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const sitesTbl = useOrgTable<SiteRow>("sites", { orderBy: "name" });
  const siteNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sitesTbl.rows) m[s.id] = s.name;
    return m;
  }, [sitesTbl.rows]);
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });

  const { configFor } = useResolvedConfig();
  const pageOpts = configFor("studies").options ?? {};
  // Per-role column visibility (Page designer). Unset = shown.
  const showHealthCol = pageOpts.showHealthColumn !== false;
  const showPiCol = pageOpts.showPiColumn !== false;
  const showCreatedCol = pageOpts.showCreatedColumn !== false;
  // Two grid templates: base, and ≥xl where Sponsor + Phase become real
  // columns (they live in the subtitle below xl). Wired via CSS vars so the
  // role-driven column toggles keep working.
  const gridTemplate =
    "32px 120px 1fr 160px" +
    (showHealthCol ? " 140px" : "") +
    (showPiCol ? " 140px" : "") +
    (showCreatedCol ? " 110px" : "");
  const gridTemplateXl =
    "32px 120px 1.6fr 150px 70px 160px" +
    (showHealthCol ? " 140px" : "") +
    (showPiCol ? " 140px" : "") +
    (showCreatedCol ? " 110px" : "");
  const [search, setSearch] = useState("");                                                // search resets per session
  const [stageFilter, setStageFilter] = useStickyState<string>("studies/stageFilter", "all");
  const [healthFilter, setHealthFilter] = useStickyStateWithRoleDefault<"all" | HealthLevel>(
    "studies/healthFilter", "all", pageOpts.healthFilter as "all" | HealthLevel | undefined
  );
  const [showClosed, setShowClosed] = useStickyStateWithRoleDefault<boolean>(
    "studies/showClosed", false, pageOpts.showClosed as boolean | undefined
  );
  // Lifecycle tabs (June notes): how orgs actually think about the portfolio.
  // Pipeline = committed, still in startup · Active = reached Activation ·
  // Closed = done. Prospective (uncommitted) studies live on the Intake page.
  type LifeTab = "pipeline" | "active" | "closed";
  const [lifeTab, setLifeTab] = useStickyState<LifeTab>("studies/lifeTab", "pipeline");
  const [staleOnly, setStaleOnly] = useStickyState<boolean>("studies/staleOnly", false);
  const [showHistorical, setShowHistorical] = useStickyState<boolean>("studies/showHistorical", false);
  // Column sort: "smart" (pinned → health → newest) is the default; clicking
  // a header sorts by it, again flips direction, a third click restores smart.
  const [sortBy, setSortBy] = useStickyState<string>("studies/sortBy", "smart");
  const [viewMode, setViewMode] = useStickyState<"list" | "table" | "board">("studies/viewMode", "list");
  useEffect(() => {
    if (initialViewMode) setViewMode(initialViewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialViewMode]);
  const [advRaw, setAdvFilters] = useStickyState<AdvFilters>("studies/advFilters", EMPTY_ADV_FILTERS);
  // Merge over defaults so older stored shapes never break.
  const advFilters: AdvFilters = { ...EMPTY_ADV_FILTERS, ...advRaw };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortDir, setSortDir] = useStickyState<"asc" | "desc">("studies/sortDir", "asc");
  const onSort = (col: string) => {
    if (sortBy !== col) {
      setSortBy(col);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortBy("smart");
    }
  };

  const toggleSel = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSel = () => setSelected(new Set());

  /** Board drag-advance: one study, full ceremony (audit + engine). */
  const moveToStage = async (id: string, nextStageKey: string) => {
    if (!isAdmin || !orgId || !userId) return;
    const study = studies.rows.find((s) => s.id === id);
    if (!study || study.stage_key === nextStageKey) return;
    try {
      const patch: Partial<StudyRow> = { stage_key: nextStageKey };
      if (study.stage_key === "intake" && nextStageKey !== "intake" && !study.committed_at) {
        patch.committed_at = new Date().toISOString();
      }
      const { error } = await supabase.from("studies").update(patch as any).eq("id", id);
      if (error) throw error;
      void supabase.from("studies").update({ stage_entered_at: new Date().toISOString() } as any).eq("id", id);
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "study", entityId: id,
        action: "stage_changed",
        payload: {
          from: study.stage_key ?? null,
          to: nextStageKey,
          from_label: stages.rows.find((s) => s.key === study.stage_key)?.label ?? null,
          to_label: stages.rows.find((s) => s.key === nextStageKey)?.label ?? nextStageKey,
          source: "board_dnd",
        },
      });
      try {
        await spawnTasksForStageEntry({ orgId, studyId: id, stageKey: nextStageKey, workstreamId: study.workstream_id, actorUserId: userId });
      } catch {
        /* stage moved + audited; spawn can be retried from the study */
      }
      toast.success(stamped(`${study.code} → ${stages.rows.find((s) => s.key === nextStageKey)?.label ?? nextStageKey}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't move the study"));
    }
  };

  const bulkAdvance = async (nextStageKey: string) => {
    if (!isAdmin || !orgId || !userId) return;
    if (selected.size === 0) return;
    const moveLabel = stages.rows.find((s) => s.key === nextStageKey)?.label ?? nextStageKey;
    if (!(await confirmDialog({ title: "Move studies", message: `Move ${selected.size} stud${selected.size === 1 ? "y" : "ies"} to ${moveLabel}? Each study advances and may spawn workflow tasks.`, confirmLabel: "Move" }))) return;
    const ids = Array.from(selected);
    const studyMap = new Map(studies.rows.map((s) => [s.id, s]));
    setBulkBusy(true);
    try {
      // For each study, build a patch that also stamps committed_at on first
      // exit from intake. We do these as parallel single-row updates to keep
      // audit logging consistent.
      await Promise.all(
        ids.map(async (id) => {
          const study = studyMap.get(id);
          if (!study) return;
          if (study.stage_key === nextStageKey) return;
          const patch: Partial<StudyRow> = { stage_key: nextStageKey };
          if (study.stage_key === "intake" && nextStageKey !== "intake" && !study.committed_at) {
            patch.committed_at = new Date().toISOString();
          }
          const { error } = await supabase
            .from("studies")
            .update(patch as any)
            .eq("id", id);
          if (error) throw error;
          // Stamp stage-entry time (best-effort; no-op until migration 0010 runs).
          void supabase.from("studies").update({ stage_entered_at: new Date().toISOString() } as any).eq("id", id);
          void writeAuditEvent({
            orgId, actorId: userId, actorEmail: userEmail,
            entityType: "study", entityId: id,
            action: "stage_changed",
            payload: {
              from: study.stage_key ?? null,
              to: nextStageKey,
              from_label: stages.rows.find((s) => s.key === study.stage_key)?.label ?? null,
              to_label: stages.rows.find((s) => s.key === nextStageKey)?.label ?? nextStageKey,
              bulk: true,
            },
          });
          // Fire the work stream engine for each study independently.
          try {
            await spawnTasksForStageEntry({
              orgId,
              studyId: id,
              stageKey: nextStageKey,
              workstreamId: study.workstream_id,
              actorUserId: userId,
            });
          } catch {
            // Audit + study update succeeded — don't let a per-row spawn
            // failure halt the bulk run. The user can re-trigger manually.
          }
        })
      );
      toast.success(stamped(`Moved ${ids.length} stud${ids.length === 1 ? "y" : "ies"} to ${stages.rows.find((s) => s.key === nextStageKey)?.label ?? nextStageKey}`));
      clearSel();
    } catch (e: any) {
      toast.error(friendlyError(e, "Bulk advance failed"));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSetClosed = async (closed: boolean) => {
    if (!isAdmin || !orgId || !userId) return;
    if (selected.size === 0) return;
    if (closed && !(await confirmDialog({ title: "Close studies", message: `Close ${selected.size} stud${selected.size === 1 ? "y" : "ies"}? They drop out of active views.`, confirmLabel: "Close", danger: true }))) return;
    const ids = Array.from(selected);
    const studyMap = new Map(studies.rows.map((s) => [s.id, s]));
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map(async (id) => {
          const study = studyMap.get(id);
          if (!study) return;
          if (study.closed === closed) return;
          const { error } = await supabase
            .from("studies")
            .update({
              closed,
              closed_at: closed ? new Date().toISOString() : null,
            } as any)
            .eq("id", id);
          if (error) throw error;
          void writeAuditEvent({
            orgId, actorId: userId, actorEmail: userEmail,
            entityType: "study", entityId: id,
            action: closed ? "closed" : "reopened",
            payload: { bulk: true },
          });
        })
      );
      toast.success(stamped(`${closed ? "Closed" : "Reopened"} ${ids.length} stud${ids.length === 1 ? "y" : "ies"}`));
      clearSel();
    } catch (e: any) {
      toast.error(friendlyError(e, "Bulk update failed"));
    } finally {
      setBulkBusy(false);
    }
  };

  const stageByKey = useMemo(() => {
    const m: Record<string, PipelineStageRow> = {};
    for (const s of stages.rows) m[s.key] = s;
    return m;
  }, [stages.rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const withHealth = studies.rows.map((r) => ({
      row: r,
      health: computeHealth(r, stages.rows),
    }));
    return withHealth
      .filter(({ row }) => {
        if (lifeTab === "closed") return row.closed;
        if (row.closed) return showClosed;
        if (!row.committed_at) return false; // prospective — lives in Intake
        const isActive = row.stage_key === "activation";
        return lifeTab === "active" ? isActive : !isActive;
      })
      .filter(({ row }) => (showHistorical ? true : !isHistorical(row)))
      .filter(({ row }) => (stageFilter === "all" ? true : row.stage_key === stageFilter))
      .filter(({ health }) => (healthFilter === "all" ? true : health.level === healthFilter))
      .filter(({ row }) => matchesAdvFilters(row, advFilters))
      .filter(({ row }) => {
        if (!staleOnly) return true;
        if (!row.updated_at) return false;
        const days = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86400000);
        return days > 14 && !row.closed;
      })
      .filter(({ row: r }) => {
        if (!q) return true;
        return (
          r.title.toLowerCase().includes(q) ||
          (r.code ?? "").toLowerCase().includes(q) ||
          (r.sponsor ?? "").toLowerCase().includes(q) ||
          (r.pi_name ?? "").toLowerCase().includes(q) ||
          (r.nct ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === "smart") {
          const aStar = starred.isStarred(a.row.id);
          const bStar = starred.isStarred(b.row.id);
          if (aStar !== bStar) return aStar ? -1 : 1;
          const hw = healthSortWeight(a.health) - healthSortWeight(b.health);
          if (hw !== 0) return hw;
          return (b.row.created_at ?? "").localeCompare(a.row.created_at ?? "");
        }
        const dir = sortDir === "asc" ? 1 : -1;
        const val = (x: typeof a): string | number => {
          switch (sortBy) {
            case "code": return x.row.code ?? "";
            case "title": return x.row.title.toLowerCase();
            case "sponsor": return (x.row.sponsor ?? "").toLowerCase();
            case "phase": return x.row.phase ?? "";
            case "stage": return stageByKey[x.row.stage_key ?? ""]?.position ?? 999;
            case "health": return healthSortWeight(x.health);
            case "pi": return (x.row.pi_name ?? "").toLowerCase();
            case "nct": return x.row.nct ?? "";
            case "ta": return (x.row.therapeutic_area ?? "").toLowerCase();
            case "updated": return x.row.updated_at ?? "";
            case "created": return x.row.created_at ?? "";
            default: return 0;
          }
        };
        const av = val(a);
        const bv = val(b);
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return (b.row.created_at ?? "").localeCompare(a.row.created_at ?? "");
      });
  }, [studies.rows, stages.rows, search, stageFilter, healthFilter, showClosed, lifeTab, staleOnly, sortBy, sortDir, stageByKey, starred, advRaw, showHistorical]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of studies.rows) {
      if (s.closed) continue;
      const k = s.stage_key ?? "—";
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [studies.rows]);

  if (memberLoading) {
    return <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="All studies"
        subtitle="Every study you're running. Sorted newest first. Click into a study to see its full record."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const rows: (string | number | null | undefined)[][] = [
                  ["code", "title", "sponsor", "nct", "therapeutic_area", "phase", "pi", "stage", "priority", "health", "days_in_stage", "days_to_target", "created_at", "updated_at", "closed"],
                  ...filtered.map(({ row: s, health }) => [
                    s.code,
                    s.title,
                    s.sponsor ?? "",
                    s.nct ?? "",
                    s.therapeutic_area ?? "",
                    s.phase ?? "",
                    s.pi_name ?? "",
                    health.stageLabel ?? "",
                    s.priority ?? "",
                    health.level,
                    health.daysInStage,
                    health.daysToTarget,
                    s.created_at ?? "",
                    s.updated_at ?? "",
                    s.closed ? "yes" : "no",
                  ]),
                ];
                downloadCsv(`platypus-studies-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
              }}
              disabled={filtered.length === 0}
              title={`Export ${filtered.length} stud${filtered.length === 1 ? "y" : "ies"} (current filter) to CSV`}
            >
              <Icon name="external" size={12} /> Export CSV
            </Button>
            {isAdmin ? (
              <Button variant="primary" onClick={() => onNavigate("#/intake")}>
                <Icon name="plus" size={14} /> New study
              </Button>
            ) : (
              <Pill tone="neutral">read-only</Pill>
            )}
          </div>
        }
      />

      <PageBlocks pageKey="studies" region="top" navigate={onNavigate} />

      {/* TOOLBAR row 1 — lifecycle tabs · search · view toggles (Wave L) */}
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([
          ["pipeline", "Pipeline"],
          ["active", "Active"],
          ["closed", "Closed"],
        ] as ["pipeline" | "active" | "closed", string][]).map(([k, label]) => {
          const n = studies.rows.filter((r) => {
            if (k === "closed") return r.closed;
            if (r.closed || !r.committed_at) return false;
            return k === "active" ? r.stage_key === "activation" : r.stage_key !== "activation";
          }).length;
          return (
            <button
              key={k}
              onClick={() => setLifeTab(k)}
              className={
                "px-3 py-2 rounded-md text-sm font-semibold transition flex items-center gap-1.5 " +
                (lifeTab === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
              }
            >
              {label}
              <span className={"text-[10px] font-mono " + (lifeTab === k ? "text-white/80" : "text-slate-400")}>{n}</span>
            </button>
          );
        })}
      </div>
      <StageDropdown
        stages={stages.rows}
        counts={stageCounts}
        totalOpen={studies.rows.filter((s) => !s.closed).length}
        value={stageFilter}
        onChange={setStageFilter}
      />
      <div className="flex-1 min-w-[240px]">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, code, sponsor, PI, NCT…"
        />
      </div>
      <button
        onClick={() => setFiltersOpen(true)}
        className={
          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-semibold transition " +
          (advFilterCount(advFilters) > 0 || staleOnly || healthFilter !== "all"
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
        }
        title="Every filter — sponsor, phase, therapeutic area, PI, kind, priority, dates, NCT"
        aria-label="Open filters"
      >
        <Icon name="filter" size={13} />
        Filters
        {advFilterCount(advFilters) + (staleOnly ? 1 : 0) + (healthFilter !== "all" ? 1 : 0) > 0 && (
          <span className="rounded-full bg-brand-600 text-white text-[10px] font-bold px-1.5">
            {advFilterCount(advFilters) + (staleOnly ? 1 : 0) + (healthFilter !== "all" ? 1 : 0)}
          </span>
        )}
      </button>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="View mode">
        {([
          ["list", "menu", "List view — rich rows"],
          ["table", "layout", "Table view — dense, every column"],
          ["board", "layers", "Board view — by stage; drag a card to advance it"],
        ] as const).map(([mode, icon, tip]) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={
              "px-2.5 py-2 rounded-md transition " +
              (viewMode === mode ? "bg-brand-gradient text-white shadow" : "text-slate-500 hover:text-slate-800")
            }
            title={tip}
            aria-label={tip}
            aria-pressed={viewMode === mode}
          >
            <Icon name={icon} size={15} />
          </button>
        ))}
      </div>
      </div>

      {/* Active advanced-filter chips — each removable on its own */}
      {(advFilterCount(advFilters) > 0 || staleOnly || healthFilter !== "all" || sortBy !== "smart") && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {healthFilter !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
              Health: {healthFilter === "red" ? "Overdue" : healthFilter === "yellow" ? "At risk" : healthFilter === "green" ? "Healthy" : "Unknown"}
              <button
                onClick={() => setHealthFilter("all")}
                className="text-brand-400 hover:text-red-600 leading-none"
                aria-label="Remove health filter"
              >
                ×
              </button>
            </span>
          )}
          {sortBy !== "smart" && (
            <button
              onClick={() => setSortBy("smart")}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 transition"
              title="Back to smart order: pinned first, then health, then newest"
            >
              ↺ Smart order
            </button>
          )}
          {staleOnly && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              Stale only (&gt;14d)
              <button
                onClick={() => setStaleOnly(false)}
                className="text-amber-400 hover:text-red-600 leading-none"
                aria-label="Remove stale-only filter"
              >
                ×
              </button>
            </span>
          )}
          {describeAdvFilters(advFilters, { site: (id) => siteNameById[id] ?? "(removed site)" }).map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700"
            >
              {chip.label}
              <button
                onClick={() => setAdvFilters(chip.without)}
                className="text-brand-400 hover:text-red-600 leading-none"
                aria-label={`Remove filter ${chip.label}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={() => {
              setAdvFilters(EMPTY_ADV_FILTERS);
              setStaleOnly(false);
              setHealthFilter("all");
            }}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          className="sticky top-14 z-10 mt-4 rounded-xl border-2 border-brand-200 bg-brand-50/95 backdrop-blur px-4 py-2.5 flex items-center gap-3 shadow-sm"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="text-sm font-semibold text-brand-700">
            {selected.size} selected
          </span>
          <span className="flex-1" />
          {isAdmin && (
            <>
              <Select
                value=""
                onChange={(e) => {
                  if (e.target.value) void bulkAdvance(e.target.value);
                }}
                disabled={bulkBusy}
                className="text-xs py-1 px-2 max-w-[180px]"
                aria-label="Move selected studies to stage"
              >
                <option value="">Move to stage…</option>
                {stages.rows.map((st) => (
                  <option key={st.key} value={st.key}>{st.label}</option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => bulkSetClosed(true)} disabled={bulkBusy}>
                Close
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulkSetClosed(false)} disabled={bulkBusy}>
                Reopen
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={clearSel} disabled={bulkBusy}>
            Clear selection
          </Button>
        </div>
      )}

      {/* List */}
      <Card flush className="mt-4 overflow-hidden">
        {studies.error && (
          <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <strong>Error:</strong> {studies.error}
          </div>
        )}

        {studies.loading && studies.rows.length === 0 && (
          <div className="p-6"><Loader label="Loading studies…" /></div>
        )}

        {!studies.loading && studies.rows.length === 0 && (
          <EmptyState
            iconName="folder"
            title="No studies yet"
            sub={
              isAdmin
                ? "Create your first study to start moving things through the pipeline."
                : "When an admin adds the first study, it'll show up here."
            }
            action={
              isAdmin && (
                <Button variant="primary" onClick={() => onNavigate("#/intake")}>
                  <Icon name="plus" size={14} /> New study
                </Button>
              )
            }
          />
        )}

        {viewMode === "list" && filtered.length > 0 && (
          <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div
              className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid gap-3 items-center text-[11px] uppercase tracking-wider text-slate-500 font-bold [grid-template-columns:var(--gt)] xl:[grid-template-columns:var(--gt-xl)]"
              style={{ "--gt": gridTemplate, "--gt-xl": gridTemplateXl } as any}
            >
              <span className="flex items-center justify-center">
                <input
                  type="checkbox"
                  aria-label="Select all visible studies"
                  checked={filtered.length > 0 && filtered.every(({ row }) => selected.has(row.id))}
                  ref={(el) => {
                    if (el) {
                      const some = filtered.some(({ row }) => selected.has(row.id));
                      const all = filtered.length > 0 && filtered.every(({ row }) => selected.has(row.id));
                      el.indeterminate = some && !all;
                    }
                  }}
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? new Set(filtered.map(({ row }) => row.id))
                        : new Set()
                    );
                  }}
                  className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                />
              </span>
              <SortHeader label="Code" col="code" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Study" col="title" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <span className="hidden xl:block">
                <SortHeader label="Sponsor" col="sponsor" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              </span>
              <span className="hidden xl:block">
                <SortHeader label="Phase" col="phase" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              </span>
              <SortHeader label="Stage" col="stage" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              {showHealthCol && (
                <span className="flex items-center gap-1">
                  <SortHeader label="Health" col="health" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
                  <InfoTip side="bottom" label="How long the study has been in its current stage vs that stage's target days. Green = on pace, amber = approaching target, red = past it." />
                </span>
              )}
              {showPiCol && <SortHeader label="PI" col="pi" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />}
              {showCreatedCol && <SortHeader label="Created" col="created" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />}
            </div>
            {filtered.map(({ row: s, health }) => {
              const stage = s.stage_key ? stageByKey[s.stage_key] : null;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${s.code}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigate(`#/studies/${s.id}`);
                    }
                  }}
                  className={
                    "w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 transition grid gap-3 items-center group cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:bg-brand-50/40 [grid-template-columns:var(--gt)] xl:[grid-template-columns:var(--gt-xl)] " +
                    (selected.has(s.id) ? "bg-brand-50/60" : "hover:bg-brand-50/30")
                  }
                  style={{ "--gt": gridTemplate, "--gt-xl": gridTemplateXl } as any}
                >
                  <span className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.code}`}
                      checked={selected.has(s.id)}
                      onChange={() => toggleSel(s.id)}
                      className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                    />
                  </span>
                  <span
                    className="font-mono text-xs text-slate-600 flex items-center gap-1.5 cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); starred.toggle(s.id); }}
                      className={
                        "transition flex-shrink-0 " +
                        (starred.isStarred(s.id)
                          ? "text-amber-500 hover:text-amber-600"
                          : "text-slate-300 hover:text-amber-500")
                      }
                      title={starred.isStarred(s.id) ? "Unpin study" : "Pin study"}
                      aria-label={starred.isStarred(s.id) ? "Unpin study" : "Pin study"}
                    >
                      <StarIcon filled={starred.isStarred(s.id)} />
                    </button>
                    <HealthDot health={health} variant="dot" />
                    {s.code}
                  </span>
                  <span
                    className="min-w-0 cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    <div className="font-semibold text-slate-900 truncate">{s.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      <span className="xl:hidden">
                        {[s.sponsor, s.nct, s.therapeutic_area, s.phase].filter(Boolean).join(" · ")}
                      </span>
                      <span className="hidden xl:inline">
                        {[s.nct, s.therapeutic_area].filter(Boolean).join(" · ")}
                      </span>
                      {s.closed && (
                        <span className="ml-2 inline-flex">
                          <Pill tone="neutral">closed</Pill>
                        </span>
                      )}
                      {!s.closed && s.updated_at && (() => {
                        const days = Math.floor((Date.now() - new Date(s.updated_at).getTime()) / 86400000);
                        if (days <= 14) return null;
                        return (
                          <span className="ml-2 inline-flex">
                            <Pill tone="warning">stale {days}d</Pill>
                          </span>
                        );
                      })()}
                    </div>
                  </span>
                  <span
                    className="hidden xl:block text-xs text-slate-700 truncate cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    {s.sponsor || <span className="text-slate-400 italic">—</span>}
                  </span>
                  <span
                    className="hidden xl:block text-xs font-mono text-slate-600 truncate cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    {s.phase || <span className="text-slate-400 italic">—</span>}
                  </span>
                  <span className="cursor-pointer" onClick={() => onNavigate(`#/studies/${s.id}`)}>
                    {stage ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                        style={{ backgroundColor: stage.color }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white/80" />
                        {stage.label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 italic">unassigned</span>
                    )}
                  </span>
                  {showHealthCol && (
                    <span
                      className="text-xs text-slate-600 truncate cursor-pointer"
                      title={health.summary}
                      onClick={() => onNavigate(`#/studies/${s.id}`)}
                    >
                      <HealthDot health={health} variant="pill" />
                    </span>
                  )}
                  {showPiCol && (
                    <span
                      className="text-xs text-slate-700 truncate cursor-pointer"
                      onClick={() => onNavigate(`#/studies/${s.id}`)}
                    >
                      {s.pi_name || <span className="text-slate-400 italic">—</span>}
                    </span>
                  )}
                  {showCreatedCol && (
                    <span
                      className="text-xs text-slate-500 font-mono cursor-pointer"
                      onClick={() => onNavigate(`#/studies/${s.id}`)}
                    >
                      {s.created_at ? fmtDate(s.created_at) : "—"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        )}

        {viewMode === "board" && filtered.length > 0 && (
          <BoardView
            rows={filtered}
            stages={stages.rows}
            isAdmin={isAdmin}
            onNavigate={onNavigate}
            onMove={(id, key) => void moveToStage(id, key)}
          />
        )}

        {viewMode === "table" && filtered.length > 0 && (
          <DenseTable
            rows={filtered}
            stageByKey={stageByKey}
            selected={selected}
            toggleSel={toggleSel}
            onToggleAll={(checked) =>
              setSelected(checked ? new Set(filtered.map(({ row }) => row.id)) : new Set())
            }
            starred={starred}
            onNavigate={onNavigate}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
          />
        )}

        {studies.rows.length > 0 && filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <div className="text-sm text-slate-500">
              No studies match the current filters.
            </div>
            <button
              onClick={() => {
                setSearch("");
                setStageFilter("all");
                setHealthFilter("all");
                setShowClosed(false);
                setStaleOnly(false);
              }}
              className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

      <PageBlocks pageKey="studies" region="bottom" navigate={onNavigate} />

      {filtersOpen && (
        <FilterModal
          filters={advFilters}
          rows={studies.rows}
          siteNameById={siteNameById}
          onChange={setAdvFilters}
          staleOnly={staleOnly}
          onStaleOnly={setStaleOnly}
          health={healthFilter}
          onHealth={setHealthFilter}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  );
}

/** Tiny star icon (inline so we don't bloat the shared Icon component). */
/* ---------- board view (Plan B — the old By-stage page, with filters) ---------- */

function BoardView({
  rows,
  stages,
  isAdmin,
  onNavigate,
  onMove,
}: {
  rows: { row: StudyRow; health: ReturnType<typeof computeHealth> }[];
  stages: PipelineStageRow[];
  isAdmin: boolean;
  onNavigate: (h: string) => void;
  onMove: (id: string, stageKey: string) => void;
}) {
  const [overCol, setOverCol] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto p-3">
      <div className="flex gap-3 items-start min-w-max">
        {stages.map((st) => {
          const cards = rows.filter(({ row }) => row.stage_key === st.key);
          return (
            <div
              key={st.key}
              className={
                "w-72 flex-shrink-0 rounded-xl border bg-slate-50/60 transition " +
                (overCol === st.key ? "border-brand-400 ring-2 ring-brand-500/20" : "border-slate-200")
              }
              onDragOver={(e) => {
                if (!isAdmin) return;
                e.preventDefault();
                setOverCol(st.key);
              }}
              onDragLeave={() => setOverCol((c) => (c === st.key ? null : c))}
              onDrop={(e) => {
                setOverCol(null);
                if (!isAdmin) return;
                const id = e.dataTransfer.getData("text/study-id");
                if (id) onMove(id, st.key);
              }}
            >
              <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: st.color }} />
                <span className="text-xs font-semibold text-slate-700 truncate">{st.label}</span>
                <span className="ml-auto text-[10px] font-mono text-slate-400">{cards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[64px]">
                {cards.map(({ row: s, health }) => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    draggable={isAdmin}
                    onDragStart={(e) => e.dataTransfer.setData("text/study-id", s.id)}
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onNavigate(`#/studies/${s.id}`);
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm hover:border-brand-300 hover:shadow transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    style={{ borderTopWidth: 3, borderTopColor: st.color }}
                    aria-label={`Open ${s.code}`}
                    title={isAdmin ? "Click to open · drag to another column to advance" : "Click to open"}
                  >
                    <div className="flex items-center gap-1.5">
                      <HealthDot health={health} variant="dot" />
                      <span className="font-mono text-[11px] text-slate-600">{s.code}</span>
                      <span className="ml-auto text-[10px] font-mono text-slate-400">
                        {s.created_at ? fmtDate(s.created_at) : ""}
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 mt-1 leading-snug line-clamp-2">
                      {s.title}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">
                      {[s.pi_name, s.sponsor].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-slate-400 italic px-1 py-3 text-center">
                    {isAdmin ? "Drop a card here" : "Nothing in this stage"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- scale-ready option picker (thousands of sites/PIs) ---------- */

function OptionPicker({
  label,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (v: string) => void;
  labelFor?: (v: string) => string;
}) {
  const [q, setQ] = useState("");
  const name = (v: string) => (labelFor ? labelFor(v) : v);
  const needle = q.trim().toLowerCase();
  const selectedSet = new Set(selected);
  const pinned = options.filter((o) => selectedSet.has(o.value));
  const matches = (needle
    ? options.filter((o) => name(o.value).toLowerCase().includes(needle))
    : options
  ).filter((o) => !selectedSet.has(o.value));
  const LIMIT = 12;
  const shown = matches.slice(0, LIMIT);
  const hidden = matches.length - shown.length;

  const chip = (value: string, count: number, isSel: boolean) => (
    <button
      key={value}
      onClick={() => onToggle(value)}
      className={
        "text-xs rounded-full border px-2.5 py-1 transition flex items-center gap-1.5 " +
        (isSel
          ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
      }
    >
      {isSel ? "✓ " : ""}
      <span className="truncate max-w-[220px]">{name(value)}</span>
      <span className="text-[10px] font-mono text-slate-400">{count}</span>
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs font-semibold text-slate-500">
          {label}
          {selected.length > 0 && <span className="ml-1.5 text-brand-700">· {selected.length} selected</span>}
        </div>
        {options.length > 10 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${options.length.toLocaleString()}…`}
            className="text-xs border border-slate-200 rounded-md px-2.5 py-1.5 w-48 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 transition"
            aria-label={`Search ${label}`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
        {pinned.map((o) => chip(o.value, o.count, true))}
        {shown.map((o) => chip(o.value, o.count, false))}
        {hidden > 0 && (
          <span className="text-[11px] text-slate-400 self-center">
            +{hidden.toLocaleString()} more — type to narrow
          </span>
        )}
        {needle && shown.length === 0 && pinned.length === 0 && (
          <span className="text-[11px] text-slate-400 italic self-center">No matches</span>
        )}
      </div>
    </div>
  );
}

/* ---------- stage dropdown (toolbar) ---------- */

function StageDropdown({
  stages,
  counts,
  totalOpen,
  value,
  onChange,
}: {
  stages: PipelineStageRow[];
  counts: Record<string, number>;
  totalOpen: number;
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useDismissable("[data-stage-dd]", () => setOpen(false), open);
  const current = value === "all" ? null : stages.find((s) => s.key === value) ?? null;
  return (
    <div className="relative" data-stage-dd>
      <button
        onClick={() => setOpen((o) => !o)}
        className={
          "inline-flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition " +
          (current
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Filter by stage"
      >
        {current && (
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: current.color }} />
        )}
        {current ? current.label : "All stages"}
        <span className="text-[10px] font-mono text-slate-400">
          {current ? counts[current.key] ?? 0 : totalOpen}
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={12} className="text-slate-400" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full mt-1 z-20 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-80 overflow-y-auto"
        >
          <button
            role="option"
            aria-selected={value === "all"}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
            className={
              "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition " +
              (value === "all" ? "font-semibold text-brand-700" : "text-slate-700")
            }
          >
            All stages
            <span className="ml-auto text-[10px] font-mono text-slate-400">{totalOpen}</span>
          </button>
          {stages.map((s) => (
            <button
              key={s.id}
              role="option"
              aria-selected={value === s.key}
              onClick={() => {
                onChange(s.key);
                setOpen(false);
              }}
              className={
                "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-slate-50 transition " +
                (value === s.key ? "font-semibold text-brand-700" : "text-slate-700")
              }
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="ml-auto text-[10px] font-mono text-slate-400">{counts[s.key] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- dense table view (Wave L2) ---------- */

const DENSE_GT =
  "32px 110px minmax(220px,1.4fr) 130px 110px 120px 70px 130px 150px 120px 95px 95px";

function DenseTable({
  rows,
  stageByKey,
  selected,
  toggleSel,
  onToggleAll,
  starred,
  onNavigate,
  sortBy,
  sortDir,
  onSort,
}: {
  rows: { row: StudyRow; health: ReturnType<typeof computeHealth> }[];
  stageByKey: Record<string, PipelineStageRow>;
  selected: Set<string>;
  toggleSel: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  starred: { isStarred: (id: string) => boolean; toggle: (id: string) => void };
  onNavigate: (h: string) => void;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const all = rows.length > 0 && rows.every(({ row }) => selected.has(row.id));
  const some = rows.some(({ row }) => selected.has(row.id));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1180px]">
        <div
          className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid gap-2.5 items-center text-[11px] uppercase tracking-wider text-slate-500 font-bold"
          style={{ gridTemplateColumns: DENSE_GT }}
        >
          <span className="flex items-center justify-center">
            <input
              type="checkbox"
              aria-label="Select all visible studies"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = some && !all;
              }}
              onChange={(e) => onToggleAll(e.target.checked)}
              className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
            />
          </span>
          <SortHeader label="Code" col="code" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Study" col="title" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Sponsor" col="sponsor" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="NCT" col="nct" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="TA" col="ta" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Phase" col="phase" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="PI" col="pi" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Stage" col="stage" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Health" col="health" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Created" col="created" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortHeader label="Updated" col="updated" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
        </div>
        {rows.map(({ row: s, health }) => {
          const stage = s.stage_key ? stageByKey[s.stage_key] : null;
          const nav = () => onNavigate(`#/studies/${s.id}`);
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${s.code}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  nav();
                }
              }}
              onClick={nav}
              className={
                "px-4 py-1.5 border-b border-slate-100 last:border-b-0 grid gap-2.5 items-center text-xs cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-brand-500/30 " +
                (selected.has(s.id) ? "bg-brand-50/60" : "hover:bg-brand-50/30")
              }
              style={{ gridTemplateColumns: DENSE_GT }}
            >
              <span className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${s.code}`}
                  checked={selected.has(s.id)}
                  onChange={() => toggleSel(s.id)}
                  className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                />
              </span>
              <span className="font-mono text-slate-600 flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    starred.toggle(s.id);
                  }}
                  className={
                    "flex-shrink-0 transition " +
                    (starred.isStarred(s.id) ? "text-amber-500" : "text-slate-300 hover:text-amber-500")
                  }
                  aria-label={starred.isStarred(s.id) ? "Unpin study" : "Pin study"}
                >
                  <StarIcon filled={starred.isStarred(s.id)} />
                </button>
                {s.code}
              </span>
              <span className="font-semibold text-slate-900 truncate">{s.title}</span>
              <span className="text-slate-700 truncate">{s.sponsor || "—"}</span>
              <span className="font-mono text-slate-500 truncate">{s.nct || "—"}</span>
              <span className="text-slate-700 truncate">{s.therapeutic_area || "—"}</span>
              <span className="font-mono text-slate-600">{s.phase || "—"}</span>
              <span className="text-slate-700 truncate">{s.pi_name || "—"}</span>
              <span className="flex items-center gap-1.5 truncate">
                {stage ? (
                  <>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                    <span className="truncate text-slate-700">{stage.label}</span>
                  </>
                ) : (
                  <span className="text-slate-400 italic">unassigned</span>
                )}
              </span>
              <span title={health.summary}>
                <HealthDot health={health} variant="pill" />
              </span>
              <span className="font-mono text-slate-500">{s.created_at ? fmtDate(s.created_at) : "—"}</span>
              <span className="font-mono text-slate-500">{s.updated_at ? fmtDate(s.updated_at) : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- filter modal (Wave L2) ---------- */

function FilterModal({
  filters,
  rows,
  siteNameById,
  onChange,
  staleOnly,
  onStaleOnly,
  health,
  onHealth,
  onClose,
}: {
  filters: AdvFilters;
  rows: StudyRow[];
  siteNameById: Record<string, string>;
  onChange: (f: AdvFilters) => void;
  staleOnly: boolean;
  onStaleOnly: (v: boolean) => void;
  health: string;
  onHealth: (v: any) => void;
  onClose: () => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const open = rows.filter((r) => !r.closed);

  const section = (
    label: string,
    key: keyof Pick<AdvFilters, "sponsors" | "sites" | "phases" | "tas" | "pis" | "kinds" | "priorities">,
    get: (r: StudyRow) => string | null | undefined,
    labelFor?: (v: string) => string
  ) => {
    const opts = optionCounts(open, get);
    if (opts.length === 0) return null;
    const active = filters[key];
    const toggle = (v: string) =>
      onChange({
        ...filters,
        [key]: active.includes(v) ? active.filter((x) => x !== v) : [...active, v],
      });
    return <OptionPicker key={key} label={label} options={opts} selected={active} onToggle={toggle} labelFor={labelFor} />;
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
        aria-label="Portfolio filters"
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[85vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Icon name="filter" size={14} className="text-slate-500" />
          <h2 className="text-base font-display font-bold text-slate-900 flex-1">Filters</h2>
          <span className="text-[11px] text-slate-500">Changes apply immediately</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(EMPTY_ADV_FILTERS);
              onStaleOnly(false);
              onHealth("all");
            }}
            disabled={advFilterCount(filters) === 0 && !staleOnly && health === "all"}
          >
            Clear all
          </Button>
          <Button size="sm" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
        <div className="p-6 overflow-y-auto space-y-6">
          {section("Sponsor", "sponsors", (r) => r.sponsor)}
          {section("Site", "sites", (r) => r.site_id, (id) => siteNameById[id] ?? "(removed site)")}
          {section("Principal investigator", "pis", (r) => r.pi_name)}
          {section("Therapeutic area", "tas", (r) => r.therapeutic_area)}
          {section("Phase", "phases", (r) => r.phase)}
          {section("Study kind", "kinds", (r) => r.study_kind)}
          {section("Priority", "priorities", (r) => r.priority)}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 pt-2 border-t border-slate-100">
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1.5">Created between</div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={filters.createdFrom ?? ""}
                  onChange={(e) => onChange({ ...filters, createdFrom: e.target.value || undefined })}
                  aria-label="Created from"
                />
                <span className="text-slate-400 text-xs">to</span>
                <Input
                  type="date"
                  value={filters.createdTo ?? ""}
                  onChange={(e) => onChange({ ...filters, createdTo: e.target.value || undefined })}
                  aria-label="Created to"
                />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1.5">Health</div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["all", "All", "bg-slate-300"],
                  ["red", "Overdue", "bg-red-500"],
                  ["yellow", "At risk", "bg-amber-500"],
                  ["green", "Healthy", "bg-emerald-500"],
                  ["unknown", "Unknown", "bg-slate-400"],
                ] as const).map(([v, label, dot]) => (
                  <button
                    key={v}
                    onClick={() => onHealth(v)}
                    className={
                      "text-xs rounded-full border px-2.5 py-1 transition flex items-center gap-1.5 " +
                      (health === v
                        ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                    }
                    aria-pressed={health === v}
                  >
                    {v !== "all" && <span className={"w-1.5 h-1.5 rounded-full " + dot} />}
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1.5">Activity</div>
              <button
                onClick={() => onStaleOnly(!staleOnly)}
                className={
                  "text-xs rounded-full border px-2.5 py-1 transition " +
                  (staleOnly
                    ? "border-amber-300 bg-amber-50 text-amber-800 font-semibold"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                }
                aria-pressed={staleOnly}
                title="Only studies untouched for more than 14 days"
              >
                {staleOnly ? "✓ " : ""}Stale only (&gt;14 days untouched)
              </button>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1.5">NCT registration</div>
              <div className="flex items-center gap-2">
                {([
                  ["any", "Any"],
                  ["yes", "Has NCT"],
                  ["no", "No NCT"],
                ] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => onChange({ ...filters, nct: v })}
                    className={
                      "text-xs rounded-full border px-2.5 py-1 transition " +
                      (filters.nct === v
                        ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Filters combine: within a group any selected value matches; across groups all must
            match. Stage and Health stay on the toolbar. Counts show open studies. Your filters
            stick per browser — the CSV export always respects them.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Click-to-sort column header. Third click returns to smart order. */
function SortHeader({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  col: string;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const active = sortBy === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={
        "flex items-center gap-1 uppercase tracking-wider font-bold text-[11px] text-left transition " +
        (active ? "text-brand-700" : "text-slate-500 hover:text-slate-800")
      }
      title="Click to sort · click again to flip · third click restores smart order"
      aria-label={`Sort by ${label}`}
    >
      {label}
      {active && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
