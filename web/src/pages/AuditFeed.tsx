import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type { AuditEventRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { PageHeader } from "../components/ui/PageHeader";
import { useStickyState } from "../lib/useStickyState";
import { EmptyState } from "../components/ui/EmptyState";

/** AuditFeed — org-wide chronological audit log. Admin-only. Surfaces every
 *  audit_event written by the app, with filters by entity type, actor, and
 *  date range. CSV export for regulators / external audit.
 */
export function AuditFeed({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();

  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });

  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useStickyState<string>("audit/entity", "all");
  const [actionFilter, setActionFilter] = useStickyState<string>("audit/action", "all");
  const [actorFilter, setActorFilter] = useStickyState<string>("audit/actor", "");
  const [fromDate, setFromDate] = useStickyState<string>("audit/from", "");
  const [toDate, setToDate] = useStickyState<string>("audit/to", "");
  const [limit, setLimit] = useStickyState<number>("audit/limit", 200);
  const [dateRangePreset, setDateRangePreset] = useStickyState<string>("audit/dateRangePreset", "all");

  // Load events
  useEffect(() => {
    if (!orgId || !isAdmin) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error) setError(error.message);
      else setEvents((data ?? []) as AuditEventRow[]);
    })();

    // Subscribe — new events stream in
    const ch = supabase
      .channel(`audit-org-${orgId}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "audit_events", filter: `org_id=eq.${orgId}` },
        (payload: any) => {
          if (cancelled) return;
          setEvents((prev) => {
            if (!prev) return prev;
            return [payload.new as AuditEventRow, ...prev].slice(0, limit);
          });
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [orgId, isAdmin, limit]);

  // Apply date-range preset → from/to dates.
  useEffect(() => {
    if (dateRangePreset === "all") return;
    const now = new Date();
    const yyyy = (d: Date) => d.toISOString().slice(0, 10);
    if (dateRangePreset === "today") {
      setFromDate(yyyy(now));
      setToDate(yyyy(now));
    } else if (dateRangePreset === "7d") {
      const start = new Date(now.getTime() - 6 * 86400000);
      setFromDate(yyyy(start));
      setToDate(yyyy(now));
    } else if (dateRangePreset === "30d") {
      const start = new Date(now.getTime() - 29 * 86400000);
      setFromDate(yyyy(start));
      setToDate(yyyy(now));
    } else if (dateRangePreset === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(yyyy(start));
      setToDate(yyyy(now));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRangePreset]);

  // Pre-build study code lookup for clickable entity refs
  const studyById = useMemo(() => {
    const m: Record<string, StudyRow> = {};
    for (const s of studies.rows) m[s.id] = s;
    return m;
  }, [studies.rows]);

  // Filtered list
  const filtered = useMemo(() => {
    if (!events) return null;
    const aq = actorFilter.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate + "T23:59:59").getTime() : null;
    return events.filter((e) => {
      if (entityFilter !== "all" && e.entity_type !== entityFilter) return false;
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (aq && !(e.actor_email ?? "").toLowerCase().includes(aq)) return false;
      const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
      if (from !== null && ts < from) return false;
      if (to !== null && ts > to) return false;
      return true;
    });
  }, [events, entityFilter, actionFilter, actorFilter, fromDate, toDate]);

  // Unique entity types present in current data
  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    (events ?? []).forEach((e) => set.add(e.entity_type));
    return Array.from(set).sort();
  }, [events]);

  // Unique actions present in current data
  const actionTypes = useMemo(() => {
    const set = new Set<string>();
    (events ?? []).forEach((e) => set.add(e.action));
    return Array.from(set).sort();
  }, [events]);

  const exportCsv = () => {
    if (!filtered || filtered.length === 0) return;
    const rows = [
      ["created_at", "actor_email", "entity_type", "entity_id", "action", "payload", "prev_hash", "event_hash"],
      ...filtered.map((e) => [
        e.created_at,
        e.actor_email ?? "",
        e.entity_type,
        e.entity_id ?? "",
        e.action,
        JSON.stringify(e.payload ?? {}),
        e.prev_hash ?? "",
        e.event_hash,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const v = String(cell ?? "");
            if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
            return v;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `platypus-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (memberLoading) {
    return <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-slate-500">Checking permissions…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8">
        <PageHeader kicker="Audit" title="Audit feed" />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can view the cross-entity audit feed."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Audit"
        title="Audit feed"
        subtitle="Every action across your organization, hash-chained per entity. Filter, search, export. The chain integrity is maintained per entity — open a study to verify its specific chain."
        actions={
          <div className="flex items-center gap-2">
            <Pill tone="brand">21 CFR Part 11 ready</Pill>
            <Button variant="primary" size="sm" onClick={exportCsv} disabled={!filtered || filtered.length === 0}>
              <Icon name="external" size={12} /> Export CSV
            </Button>
          </div>
        }
      />

      {/* Date-range preset chips */}
      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mr-1">
          When
        </span>
        {([
          ["all", "All time"],
          ["today", "Today"],
          ["7d", "Last 7 days"],
          ["30d", "Last 30 days"],
          ["this_month", "This month"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              if (key === "all") {
                setFromDate("");
                setToDate("");
              }
              setDateRangePreset(key);
            }}
            className={
              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition " +
              (dateRangePreset === key
                ? "bg-brand-50 border-brand-200 text-brand-700"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Action chips (visible only when at least 2 action types exist) */}
      {actionTypes.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mr-1">
            Action
          </span>
          <button
            onClick={() => setActionFilter("all")}
            className={
              "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition " +
              (actionFilter === "all"
                ? "bg-brand-50 border-brand-200 text-brand-700"
                : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
            }
          >
            All actions
          </button>
          {actionTypes.map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition " +
                (actionFilter === a
                  ? "bg-brand-50 border-brand-200 text-brand-700"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-300")
              }
              title={a}
            >
              {a.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card primary className="mt-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Entity type
            </label>
            <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">All entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Actor email contains
            </label>
            <Input value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} placeholder="e.g. chad" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              From
            </label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              To
            </label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Limit
            </label>
            <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value="50">50</option>
              <option value="200">200</option>
              <option value="500">500</option>
              <option value="2000">2000</option>
            </Select>
          </div>
        </div>
      </Card>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}

      {filtered === null && (
        <div className="mt-4 text-sm text-slate-500">Loading audit feed…</div>
      )}

      {filtered && filtered.length === 0 && (
        <Card className="mt-4">
          <EmptyState
            iconName="info"
            title="No matching audit events"
            sub="Adjust the filters above or extend the date range."
          />
        </Card>
      )}

      {filtered && filtered.length > 0 && (
        <Card flush className="mt-4">
          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[160px_120px_1fr_180px_140px] gap-3 items-center text-[10px] uppercase tracking-wider text-slate-500 font-bold">
            <span>Timestamp</span>
            <span>Entity</span>
            <span>Action</span>
            <span>Actor</span>
            <span>Hash</span>
          </div>
          {filtered.map((e) => {
            const study = e.entity_type === "study" && e.entity_id ? studyById[e.entity_id] : null;
            return (
              <div
                key={e.id}
                className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 grid grid-cols-[160px_120px_1fr_180px_140px] gap-3 items-center text-sm hover:bg-slate-50/50 transition"
              >
                <span className="text-xs font-mono text-slate-600">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                <span>
                  <button
                    onClick={() => {
                      // Route per entity type. Study events go to detail; task
                      // events open the related study (or fall back to inbox);
                      // member events open the Members page.
                      if (e.entity_type === "study" && study) {
                        onNavigate(`#/studies/${study.id}`);
                      } else if (e.entity_type === "task") {
                        const sid = e.payload?.study_id as string | undefined;
                        if (sid) onNavigate(`#/studies/${sid}`);
                        else onNavigate("#/inbox");
                      } else if (e.entity_type === "member") {
                        onNavigate("#/settings/members");
                      }
                    }}
                    className={
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition " +
                      (e.entity_type === "study" && study
                        ? "bg-brand-50 text-brand-700 border border-brand-100 hover:bg-brand-100"
                        : e.entity_type === "task"
                        ? "bg-sky-50 text-sky-700 border border-sky-100 hover:bg-sky-100"
                        : e.entity_type === "member"
                        ? "bg-violet-50 text-violet-700 border border-violet-100 hover:bg-violet-100"
                        : "bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200")
                    }
                  >
                    {e.entity_type === "study" && study ? study.code : e.entity_type}
                  </button>
                </span>
                <span className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">
                    {actionLabel(e)}
                  </div>
                  {renderActionDetail(e)}
                </span>
                <span className="text-xs text-slate-700 truncate" title={e.actor_email ?? ""}>
                  {e.actor_email ?? <span className="italic text-slate-400">system</span>}
                </span>
                <span className="text-[10px] font-mono text-slate-400 truncate" title={e.event_hash}>
                  {e.event_hash.slice(0, 8)}…
                </span>
              </div>
            );
          })}
          {filtered.length === limit && (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50 text-center text-[11px] text-slate-500">
              Showing first {limit} events. Increase the limit above to see more.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function actionLabel(e: AuditEventRow): string {
  switch (e.action) {
    case "stage_changed":
      return `Stage → ${String(e.payload?.to_label ?? e.payload?.to ?? "(unknown)")}`;
    case "field_updated":
      return `Updated ${String(e.payload?.field_label ?? e.payload?.field_key ?? "field")}`;
    case "closed":
      return "Closed";
    case "reopened":
      return "Reopened";
    case "created":
      return "Created";
    case "task_created":
      return `Task created: ${String(e.payload?.title ?? "")}`;
    case "task_completed":
      return `Task completed: ${String(e.payload?.title ?? "")}`;
    case "task_skipped":
      return `Task skipped: ${String(e.payload?.title ?? "")}`;
    case "task_reopened":
      return `Task reopened: ${String(e.payload?.title ?? "")}`;
    case "tier_changed":
      return `Tier ${String(e.payload?.target_email ?? "")} → ${String(e.payload?.to ?? "")}`;
    case "access_role_changed":
      return `Access role ${String(e.payload?.target_email ?? "")} → ${String(e.payload?.to_label ?? e.payload?.to ?? "(none)")}`;
    case "member_removed":
      return `Removed ${String(e.payload?.target_email ?? "")}`;
    default:
      return e.action;
  }
}

function renderActionDetail(e: AuditEventRow): React.ReactNode {
  if (e.action === "field_updated") {
    return (
      <div className="text-[11px] text-slate-500 truncate">
        {formatVal(e.payload?.from)} → {formatVal(e.payload?.to)}
      </div>
    );
  }
  if (e.action === "stage_changed" && e.payload?.from_label) {
    return (
      <div className="text-[11px] text-slate-500 truncate">
        from {String(e.payload?.from_label)}
      </div>
    );
  }
  return null;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
