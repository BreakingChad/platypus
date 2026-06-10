import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useAuth } from "../auth/useAuth";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";
import { writeAuditEvent } from "../lib/auditLog";
import { useModalA11y } from "../lib/useModalA11y";
import { toCsv, downloadCsv } from "../lib/csv";
import { displayName } from "../lib/types";
import {
  GROUP_FIELDS,
  METRICS,
  SOURCE_LABELS,
  STANDARD_REPORTS,
  buildStageDurationRows,
  buildStudyRows,
  buildTaskRows,
  runReport,
  type ReportDef,
  type ReportResult,
  type ReportRow,
  type ReportSource,
} from "../lib/reports";
import type {
  PipelineStageRow,
  SavedReportRow,
  StudyRow,
  TaskRow,
  TeamRoleRow,
  TeamRow,
} from "../lib/types";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/EmptyState";
import { SkeletonRows } from "../components/ui/Loader";
import { DataTable } from "../components/ui/DataTable";
import { PageBlocks } from "../blocks/PageBlocks";

/** Analytics — reports & dashboards over the org's own operational data.
 *
 *  One declarative engine (lib/reports.ts): the standardized reports and
 *  admin-built custom reports are the same kind of object, so "create your
 *  own" is a three-select exercise, not a query language. Cycle times come
 *  from the audit chain. Everything exports to CSV.
 */

type OpenReport =
  | { kind: "standard"; id: string }
  | { kind: "saved"; id: string }
  | null;

export function Analytics({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const roles = useOrgTable<TeamRoleRow>("team_roles");
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position" });
  const saved = useOrgTable<SavedReportRow>("saved_reports", { orderBy: "position", realtime: true });

  // Member display names (assignee grouping).
  const [nameById, setNameById] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      const { data: mems } = await supabase.from("org_members").select("user_id").eq("org_id", orgId);
      const ids = ((mems ?? []) as any[]).map((m) => m.user_id);
      if (ids.length === 0) return;
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, full_name, first_name, last_name")
        .in("id", ids);
      if (cancelled) return;
      const m: Record<string, string> = {};
      for (const p of (profs ?? []) as any[]) m[p.id] = displayName(p) || p.email;
      setNameById(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Stage transitions from the audit chain (cycle times).
  const [stageEvents, setStageEvents] = useState<
    { entity_id: string | null; created_at: string; payload: Record<string, unknown> }[]
  >([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("audit_events")
        .select("entity_id, created_at, payload")
        .eq("org_id", orgId)
        .eq("action", "stage_changed")
        .order("created_at", { ascending: true })
        .limit(5000);
      if (!cancelled) {
        setStageEvents(((data ?? []) as any[]) || []);
        setEventsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const rowsBySource = useMemo<Record<ReportSource, ReportRow[]>>(
    () => ({
      studies: buildStudyRows(studies.rows, stages.rows),
      tasks: buildTaskRows(tasks.rows, {
        roles: roles.rows,
        teams: teams.rows,
        stages: stages.rows,
        studies: studies.rows,
        nameById,
      }),
      stage_durations: buildStageDurationRows(stageEvents, studies.rows, stages.rows),
    }),
    [studies.rows, tasks.rows, stages.rows, roles.rows, teams.rows, nameById, stageEvents]
  );

  const [tab, setTab] = useState<"dashboard" | "library">("dashboard");
  const [openReport, setOpenReport] = useState<OpenReport>(null);
  const [building, setBuilding] = useState<null | { existing: SavedReportRow | null }>(null);

  const loading = (studies.loading || tasks.loading || !eventsLoaded) && studies.rows.length === 0;

  const resolveReport = (
    o: NonNullable<OpenReport>
  ): { name: string; description: string | null; def: ReportDef; saved?: SavedReportRow } | null => {
    if (o.kind === "standard") {
      const std = STANDARD_REPORTS.find((r) => r.id === o.id);
      return std ? { name: std.name, description: std.description, def: std.def } : null;
    }
    const row = saved.rows.find((r) => r.id === o.id);
    return row
      ? { name: row.name, description: row.description, def: row.definition as unknown as ReportDef, saved: row }
      : null;
  };

  const exportReport = (name: string, def: ReportDef, result: ReportResult) => {
    const metricLabel = METRICS[def.source].find((m) => m.key === def.metric)?.label ?? def.metric;
    const csv = toCsv([
      ["Group", metricLabel, "Rows"],
      ...result.groups.map((g) => [g.group, g.value, g.count] as (string | number)[]),
    ]);
    downloadCsv(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, csv);
    toast.success(stamped(`Exported "${name}"`));
  };

  const togglePin = async (row: SavedReportRow) => {
    try {
      await saved.update(row.id, { pinned: !row.pinned });
      toast.success(stamped(row.pinned ? "Unpinned from dashboard" : "Pinned to dashboard"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update"));
    }
  };

  const removeReport = async (row: SavedReportRow) => {
    if (
      !(await confirmDialog({
        title: "Delete report",
        message: `Delete "${row.name}"? The underlying data is untouched.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await saved.remove(row.id);
      if (orgId && userId)
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "report", entityId: row.id,
          action: "report_deleted", payload: { name: row.name },
        });
      setOpenReport(null);
      toast.success(stamped(`"${row.name}" deleted`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't delete"));
    }
  };

  // Dashboard contents: pinned saved reports; a starter set of standards
  // until the org pins anything (teaches what pinning does).
  const pinnedSaved = saved.rows.filter((r) => r.pinned);
  const dashboard: { key: string; name: string; def: ReportDef; open: OpenReport }[] =
    pinnedSaved.length > 0
      ? pinnedSaved.map((r) => ({
          key: r.id, name: r.name,
          def: r.definition as unknown as ReportDef,
          open: { kind: "saved", id: r.id },
        }))
      : STANDARD_REPORTS.slice(0, 4).map((r) => ({
          key: r.id, name: r.name, def: r.def, open: { kind: "standard", id: r.id },
        }));

  const detail = openReport ? resolveReport(openReport) : null;
  const detailResult = detail ? runReport(detail.def, rowsBySource[detail.def.source]) : null;

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Insights"
        title="Analytics"
        subtitle="Reports and dashboards over your own operational data — cycle times from the audit chain, throughput, workload. Build a report from any slice; everything exports to CSV."
        actions={
          isAdmin ? (
            <Button variant="primary" size="sm" onClick={() => setBuilding({ existing: null })}>
              <Icon name="plus" size={12} /> New report
            </Button>
          ) : undefined
        }
      />

      <PageBlocks pageKey="analytics" region="top" navigate={onNavigate} />

      <div className="mt-5 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([
          ["dashboard", "Dashboard"],
          ["library", "Report library"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setOpenReport(null);
            }}
            className={
              "px-3 py-2 rounded-md text-sm font-semibold transition " +
              (tab === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <Card flush className="mt-4 overflow-hidden">
          <SkeletonRows rows={6} />
        </Card>
      )}

      {/* ── Report detail (either tab) ── */}
      {!loading && detail && detailResult && (
        <Card className="mt-4">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[260px]">
              <button
                onClick={() => setOpenReport(null)}
                className="text-xs font-semibold text-slate-500 hover:text-brand-700 inline-flex items-center gap-1"
              >
                <Icon name="chevron-right" size={11} className="rotate-180" /> All reports
              </button>
              <h2 className="text-lg font-display font-bold text-slate-900 mt-1">{detail.name}</h2>
              {detail.description && <p className="text-xs text-slate-500 mt-0.5">{detail.description}</p>}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Pill tone="neutral">{SOURCE_LABELS[detail.def.source]}</Pill>
                <Pill tone="info">
                  {METRICS[detail.def.source].find((m) => m.key === detail.def.metric)?.label}
                </Pill>
                {(detail.def.filters ?? []).map((f, i) => (
                  <Pill key={i} tone="warning">{`${f.field} = ${f.value}`}</Pill>
                ))}
                <span className="text-[11px] text-slate-400">{detailResult.rowCount} rows in scope</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {detail.saved && isAdmin && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void togglePin(detail.saved!)}>
                    {detail.saved.pinned ? "Unpin" : "Pin to dashboard"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setBuilding({ existing: detail.saved! })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeReport(detail.saved!)}>
                    Delete
                  </Button>
                </>
              )}
              <Button size="sm" variant="primary" onClick={() => exportReport(detail.name, detail.def, detailResult)}>
                <Icon name="external" size={12} /> Export CSV
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <BarViz groups={detailResult.groups} />
            <DataTable
              columns={[
                { key: "group", label: "Group" },
                { key: "value", label: METRICS[detail.def.source].find((m) => m.key === detail.def.metric)?.label ?? "Value", align: "right" },
                { key: "count", label: "Rows", align: "right" },
              ]}
              rows={detailResult.groups as unknown as Record<string, unknown>[]}
              initialSort={undefined}
              emptyLabel="No data matches this report yet."
            />
          </div>
        </Card>
      )}

      {/* ── Dashboard ── */}
      {!loading && !detail && tab === "dashboard" && (
        <>
          {pinnedSaved.length === 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              Starter dashboard — pin any report from the library{isAdmin ? " (or build your own)" : ""} to make this yours.
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            {dashboard.map((d) => {
              const res = runReport(d.def, rowsBySource[d.def.source]);
              return (
                <button
                  key={d.key}
                  onClick={() => setOpenReport(d.open)}
                  className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 truncate">{d.name}</span>
                    <Icon name="chevron-right" size={13} className="text-slate-300" />
                  </div>
                  <div className="mt-3">
                    <BarViz groups={res.groups} max={5} compact />
                  </div>
                  {res.groups.length === 0 && (
                    <p className="text-[11px] text-slate-400 italic">No data yet.</p>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Library ── */}
      {!loading && !detail && tab === "library" && (
        <div className="mt-4 space-y-5">
          <Card flush className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500">
              Standard reports
            </div>
            {STANDARD_REPORTS.map((r) => (
              <ReportRowItem
                key={r.id}
                name={r.name}
                description={r.description}
                badge="standard"
                onOpen={() => setOpenReport({ kind: "standard", id: r.id })}
              />
            ))}
          </Card>

          <Card flush className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Your reports</span>
              {isAdmin && (
                <button
                  onClick={() => setBuilding({ existing: null })}
                  className="ml-auto text-xs font-semibold text-brand-700 hover:underline"
                >
                  + New report
                </button>
              )}
            </div>
            {saved.rows.length === 0 && (
              <EmptyState
                iconName="workflow"
                title="No custom reports yet"
                sub={isAdmin
                  ? "Build one in three selects: pick a data source, group it, pick a metric. It runs on the same engine as the standard reports above."
                  : "Admins can build custom reports here — ask for the slice you need."}
              />
            )}
            {saved.rows.map((r) => (
              <ReportRowItem
                key={r.id}
                name={r.name}
                description={r.description}
                badge={r.pinned ? "pinned" : undefined}
                onOpen={() => setOpenReport({ kind: "saved", id: r.id })}
              />
            ))}
          </Card>
        </div>
      )}

      <PageBlocks pageKey="analytics" region="bottom" navigate={onNavigate} />

      {building && orgId && userId && (
        <ReportBuilderModal
          existing={building.existing}
          rowsBySource={rowsBySource}
          onClose={() => setBuilding(null)}
          onSave={async (draft) => {
            try {
              if (building.existing) {
                await saved.update(building.existing.id, {
                  name: draft.name,
                  description: draft.description || null,
                  definition: draft.def as unknown as Record<string, unknown>,
                  pinned: draft.pinned,
                });
                void writeAuditEvent({
                  orgId, actorId: userId, actorEmail: userEmail,
                  entityType: "report", entityId: building.existing.id,
                  action: "report_updated", payload: { name: draft.name },
                });
                toast.success(stamped(`"${draft.name}" updated`));
              } else {
                const pos = saved.rows.reduce((m, x) => Math.max(m, x.position), 0) + 10;
                await saved.insert({
                  name: draft.name,
                  description: draft.description || null,
                  definition: draft.def as unknown as Record<string, unknown>,
                  pinned: draft.pinned,
                  position: pos,
                  created_by: userId,
                } as Partial<SavedReportRow>);
                void writeAuditEvent({
                  orgId, actorId: userId, actorEmail: userEmail,
                  entityType: "report", entityId: null,
                  action: "report_created", payload: { name: draft.name, def: draft.def },
                });
                toast.success(stamped(`"${draft.name}" saved to the library`));
              }
              setBuilding(null);
            } catch (e: any) {
              toast.error(friendlyError(e, "Couldn't save — has migration 0048 been applied?"));
            }
          }}
        />
      )}
    </div>
  );
}

/* ---------------- pieces ---------------- */

function ReportRowItem({
  name, description, badge, onOpen,
}: {
  name: string;
  description: string | null;
  badge?: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center gap-3 hover:bg-brand-50/30 transition"
    >
      <Icon name="workflow" size={14} className="text-brand-500 flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-slate-900 truncate">{name}</span>
        {description && <span className="block text-[11px] text-slate-500 truncate">{description}</span>}
      </span>
      {badge && <Pill tone={badge === "pinned" ? "brand" : "neutral"}>{badge}</Pill>}
      <Icon name="chevron-right" size={13} className="text-slate-300 flex-shrink-0" />
    </button>
  );
}

function BarViz({
  groups, max = 12, compact = false,
}: {
  groups: { group: string; value: number; count: number }[];
  max?: number;
  compact?: boolean;
}) {
  const top = groups.slice(0, max);
  const peak = Math.max(1, ...top.map((g) => g.value));
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      {top.map((g) => (
        <div key={g.group} className="flex items-center gap-2">
          <span
            className={
              "truncate text-slate-600 " + (compact ? "w-28 text-[11px]" : "w-40 text-xs")
            }
            title={g.group}
          >
            {g.group}
          </span>
          <span className="flex-1 h-3.5 rounded bg-slate-100 overflow-hidden">
            <span
              className="block h-full rounded bg-brand-gradient"
              style={{ width: `${Math.max(2, (g.value / peak) * 100)}%` }}
            />
          </span>
          <span className={"font-mono text-slate-700 text-right " + (compact ? "w-10 text-[11px]" : "w-14 text-xs")}>
            {g.value}
          </span>
        </div>
      ))}
      {top.length === 0 && !compact && (
        <p className="text-sm text-slate-400 italic">No data matches this report yet.</p>
      )}
    </div>
  );
}

function ReportBuilderModal({
  existing, rowsBySource, onClose, onSave,
}: {
  existing: SavedReportRow | null;
  rowsBySource: Record<ReportSource, ReportRow[]>;
  onClose: () => void;
  onSave: (draft: { name: string; description: string; def: ReportDef; pinned: boolean }) => Promise<void>;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const initial = (existing?.definition as unknown as ReportDef) ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [source, setSource] = useState<ReportSource>(initial?.source ?? "studies");
  const [groupBy, setGroupBy] = useState<string>(initial?.groupBy ?? "stage");
  const [metric, setMetric] = useState<string>(initial?.metric ?? "count");
  const [filterField, setFilterField] = useState<string>(initial?.filters?.[0]?.field ?? "");
  const [filterValue, setFilterValue] = useState<string>(initial?.filters?.[0]?.value ?? "");
  const [pinned, setPinned] = useState<boolean>(existing?.pinned ?? false);
  const [busy, setBusy] = useState(false);

  // Keep groupBy/metric valid when the source changes.
  useEffect(() => {
    if (!GROUP_FIELDS[source].some((f) => f.key === groupBy)) setGroupBy(GROUP_FIELDS[source][0].key);
    if (!METRICS[source].some((m) => m.key === metric)) setMetric(METRICS[source][0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const def: ReportDef = {
    source,
    groupBy,
    metric: metric as ReportDef["metric"],
    filters: filterField && filterValue ? [{ field: filterField, value: filterValue }] : undefined,
  };
  const preview = runReport(def, rowsBySource[source]);

  const filterValues = useMemo(() => {
    if (!filterField) return [];
    const seen = new Set<string>();
    for (const r of rowsBySource[source]) {
      const v = r[filterField];
      if (v === null || v === undefined) continue;
      seen.add(String(v));
      if (seen.size > 40) break;
    }
    return [...seen].sort();
  }, [filterField, source, rowsBySource]);

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Edit report" : "New report"}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[88vh]"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">
            {existing ? "Edit report" : "New report"}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pick a source, group it, pick a metric. The preview updates live on your real data.
          </p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="Report name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oncology pipeline census" autoFocus />
            </L>
            <L label="Description (optional)">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What question does this answer?" />
            </L>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <L label="Data source">
              <Select value={source} onChange={(e) => setSource(e.target.value as ReportSource)}>
                {(Object.keys(SOURCE_LABELS) as ReportSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
                ))}
              </Select>
            </L>
            <L label="Group by">
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                {GROUP_FIELDS[source].map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </Select>
            </L>
            <L label="Metric">
              <Select value={metric} onChange={(e) => setMetric(e.target.value)}>
                {METRICS[source].map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </Select>
            </L>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <L label="Filter (optional)">
              <Select value={filterField} onChange={(e) => { setFilterField(e.target.value); setFilterValue(""); }}>
                <option value="">— No filter —</option>
                {GROUP_FIELDS[source].map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </Select>
            </L>
            {filterField && (
              <L label="equals">
                <Select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}>
                  <option value="">— Pick a value —</option>
                  {filterValues.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              </L>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-brand-500 w-4 h-4" />
            Pin to the dashboard
          </label>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Live preview · {preview.rowCount} rows in scope
            </div>
            <BarViz groups={preview.groups} max={6} compact />
            {preview.groups.length === 0 && (
              <p className="text-[11px] text-slate-400 italic">Nothing matches yet — the report still saves and fills as data arrives.</p>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({ name: name.trim(), description: description.trim(), def, pinned });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : existing ? "Save changes" : "Save report"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
