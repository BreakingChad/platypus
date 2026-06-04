import { PageBlocks } from "../blocks/PageBlocks";
import { confirmDialog } from "../lib/confirm";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { useEffect, useMemo, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { StudyRow, PipelineStageRow } from "../lib/types";
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
import { computeHealth, healthSortWeight, type HealthLevel } from "../lib/studyHealth";
import { useStickyState } from "../lib/useStickyState";
import { useStarredStudies } from "../lib/useStarred";
import { toCsv, downloadCsv } from "../lib/csv";
import { useAuth } from "../auth/useAuth";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { NewStudyModal } from "../components/NewStudyModal";

/** Studies List — the full portfolio. Click into a study (coming next phase).
 *  Live on the studies table. Admin can create; everyone can read. */
export function StudiesList({ onNavigate }: { onNavigate: (h: string) => void }) {
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
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });

  const [search, setSearch] = useState("");                                                // search resets per session
  const [stageFilter, setStageFilter] = useStickyState<string>("studies/stageFilter", "all");
  const [healthFilter, setHealthFilter] = useStickyState<"all" | HealthLevel>("studies/healthFilter", "all");
  const [showClosed, setShowClosed] = useStickyState<boolean>("studies/showClosed", false);
  const [staleOnly, setStaleOnly] = useStickyState<boolean>("studies/staleOnly", false);
  const [creating, setCreating] = useState(false);

  const toggleSel = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSel = () => setSelected(new Set());

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
      toast.error(e?.message || "Bulk advance failed");
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
      toast.error(e?.message || "Bulk update failed");
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
      .filter(({ row }) => (showClosed ? true : !row.closed))
      .filter(({ row }) => (stageFilter === "all" ? true : row.stage_key === stageFilter))
      .filter(({ health }) => (healthFilter === "all" ? true : health.level === healthFilter))
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
        const aStar = starred.isStarred(a.row.id);
        const bStar = starred.isStarred(b.row.id);
        if (aStar !== bStar) return aStar ? -1 : 1;
        const hw = healthSortWeight(a.health) - healthSortWeight(b.health);
        if (hw !== 0) return hw;
        return (b.row.created_at ?? "").localeCompare(a.row.created_at ?? "");
      });
  }, [studies.rows, stages.rows, search, stageFilter, healthFilter, showClosed]);

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
    return <div className="max-w-6xl mx-auto px-6 py-8"><Loader label="Checking permissions…" /></div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Studies"
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
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={14} /> New study
              </Button>
            ) : (
              <Pill tone="neutral">read-only</Pill>
            )}
          </div>
        }
      />

      <PageBlocks pageKey="studies" region="top" navigate={onNavigate} />

      {/* Stage chips strip — shows the live count per stage */}
      {stages.rows.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStageFilter("all")}
            className={
              "rounded-full border px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 " +
              (stageFilter === "all"
                ? "bg-brand-50 border-brand-200 text-brand-700"
                : "bg-white border-slate-200 text-slate-700 hover:border-slate-300")
            }
          >
            All
            <span className="text-[10px] font-mono text-slate-400">
              {studies.rows.filter((s) => !s.closed).length}
            </span>
          </button>
          {stages.rows.map((stage) => (
            <button
              key={stage.id}
              onClick={() => setStageFilter(stage.key)}
              className={
                "rounded-full border px-3 py-1 text-xs font-semibold transition flex items-center gap-1.5 " +
                (stageFilter === stage.key
                  ? "border-transparent text-white"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300")
              }
              style={
                stageFilter === stage.key
                  ? { backgroundColor: stage.color }
                  : undefined
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              {stage.label}
              <span
                className={
                  "text-[10px] font-mono " +
                  (stageFilter === stage.key ? "text-white/80" : "text-slate-400")
                }
              >
                {stageCounts[stage.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Health filter chips */}
      {studies.rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mr-1 cursor-help"
            title="Health = time in the current stage vs that stage's target days. Healthy: under 75% of target. At risk: approaching target. Overdue: past target."
          >
            Health
          </span>
          {([
            ["all",    "All",       "bg-white border-slate-200 text-slate-700"],
            ["red",    "Overdue",   "bg-red-50 border-red-200 text-red-700"],
            ["yellow", "At risk",   "bg-amber-50 border-amber-200 text-amber-800"],
            ["green",  "Healthy",   "bg-emerald-50 border-emerald-200 text-emerald-700"],
            ["unknown", "Unknown",  "bg-slate-100 border-slate-200 text-slate-600"],
          ] as const).map(([key, label, cls]) => (
            <button
              key={key}
              onClick={() => setHealthFilter(key as any)}
              className={
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition flex items-center gap-1.5 " +
                (healthFilter === key
                  ? "border-slate-900 shadow-sm scale-[1.02] " + cls
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300")
              }
            >
              {key !== "all" && (
                <span className={
                  "w-1.5 h-1.5 rounded-full " +
                  (key === "red" ? "bg-red-500" :
                   key === "yellow" ? "bg-amber-500" :
                   key === "green" ? "bg-emerald-500" : "bg-slate-400")
                } />
              )}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Search + closed toggle */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, code, sponsor, PI, NCT…"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap px-2">
            <input
              type="checkbox"
              checked={staleOnly}
              onChange={(e) => setStaleOnly(e.target.checked)}
              className="accent-brand-500 w-4 h-4"
            />
            Stale only (&gt;14d)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap px-2">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="accent-brand-500 w-4 h-4"
            />
            Show closed
          </label>
        </div>
      </div>

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
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={14} /> New study
                </Button>
              )
            }
          />
        )}

        {filtered.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[32px_120px_1fr_160px_140px_140px_110px] gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500 font-bold">
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
              <span>Code</span>
              <span>Study</span>
              <span>Stage</span>
              <span>Health</span>
              <span>PI</span>
              <span>Created</span>
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
                    "w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 transition grid grid-cols-[32px_120px_1fr_160px_140px_140px_110px] gap-3 items-center group cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:bg-brand-50/40 " +
                    (selected.has(s.id) ? "bg-brand-50/60" : "hover:bg-brand-50/30")
                  }
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
                      {[s.sponsor, s.nct, s.therapeutic_area, s.phase]
                        .filter(Boolean)
                        .join(" · ")}
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
                  <span
                    className="text-xs text-slate-600 truncate cursor-pointer"
                    title={health.summary}
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    <HealthDot health={health} variant="pill" />
                  </span>
                  <span
                    className="text-xs text-slate-700 truncate cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    {s.pi_name || <span className="text-slate-400 italic">—</span>}
                  </span>
                  <span
                    className="text-xs text-slate-500 font-mono cursor-pointer"
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  >
                    {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}
                  </span>
                </div>
              );
            })}
          </>
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

      {creating && (
        <NewStudyModal
          stages={stages.rows}
          existingCodes={studies.rows.map((s) => s.code)}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            toast.success(`Created ${s.code}`);
            setCreating(false);
            onNavigate(`#/studies/${s.id}`);
          }}
        />
      )}
    </div>
  );
}

/** Tiny star icon (inline so we don't bloat the shared Icon component). */
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
