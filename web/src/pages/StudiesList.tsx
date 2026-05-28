import { useMemo, useState } from "react";
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
import { NewStudyModal } from "../components/NewStudyModal";

/** Studies List — the full portfolio. Click into a study (coming next phase).
 *  Live on the studies table. Admin can create; everyone can read. */
export function StudiesList({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [healthFilter, setHealthFilter] = useState<"all" | HealthLevel>("all");
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);

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
    return <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Studies"
        subtitle="Every study you're running. Sorted newest first. Click into a study to see its full record."
        actions={
          isAdmin ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> New study
            </Button>
          ) : (
            <Pill tone="neutral">read-only</Pill>
          )
        }
      />

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
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mr-1">
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

      {/* List */}
      <Card flush className="mt-4 overflow-hidden">
        {studies.error && (
          <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <strong>Error:</strong> {studies.error}
          </div>
        )}

        {studies.loading && studies.rows.length === 0 && (
          <div className="p-6 text-sm text-slate-500">Loading studies…</div>
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
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[120px_1fr_160px_140px_140px_110px] gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500 font-bold">
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
                <button
                  key={s.id}
                  onClick={() => onNavigate(`#/studies/${s.id}`)}
                  className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-brand-50/30 transition grid grid-cols-[120px_1fr_160px_140px_140px_110px] gap-3 items-center group"
                >
                  <span className="font-mono text-xs text-slate-600 flex items-center gap-2">
                    <HealthDot health={health} variant="dot" />
                    {s.code}
                  </span>
                  <span className="min-w-0">
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
                    </div>
                  </span>
                  <span>
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
                  <span className="text-xs text-slate-600 truncate" title={health.summary}>
                    <HealthDot health={health} variant="pill" />
                  </span>
                  <span className="text-xs text-slate-700 truncate">
                    {s.pi_name || <span className="text-slate-400 italic">—</span>}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    {s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"}
                  </span>
                </button>
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
              }}
              className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </Card>

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
