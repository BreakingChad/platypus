import { useEffect, useState } from "react";
import { fmtDateTime } from "../lib/dates";
import { supabase } from "../lib/supabase";
import { uniqueChannelName } from "../lib/uniqueChannel";
import type { AuditEventRow } from "../lib/types";
import { verifyChain } from "../lib/auditLog";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/EmptyState";
import { StudyTimeline } from "./StudyDetail.timeline";
import type { StudyRow, PipelineStageRow } from "../lib/types";

/** ActivityTab — renders audit_events for a single study as a chronological
 *  timeline. When showChain is true, it also exposes the hash-chain verifier
 *  and the prev_hash/event_hash breadcrumbs per event (the "audit chain
 *  visualizer" view).
 */
export function ActivityTab({
  studyId,
  study,
  stages,
}: {
  studyId: string;
  /** Optional — when provided, renders a lifecycle timeline at the top. */
  study?: StudyRow;
  /** Optional — needed alongside `study` to color the stage bands. */
  stages?: PipelineStageRow[];
}) {
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [showChain, setShowChain] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("*")
        .eq("entity_type", "study")
        .eq("entity_id", studyId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) setError(error.message);
      else setEvents((data ?? []) as AuditEventRow[]);
    })();

    // Subscribe to new events on this study so the timeline self-updates.
    const ch = supabase
      .channel(uniqueChannelName(`audit-${studyId}`))
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "audit_events",
          filter: `entity_id=eq.${studyId}`,
        },
        (payload: any) => {
          if (cancelled) return;
          setEvents((prev) => [payload.new as AuditEventRow, ...(prev ?? [])]);
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [studyId]);

  const runVerify = () => {
    if (!events) return;
    const result = verifyChain(events as any);
    if (result.ok) {
      setVerifyResult(`Chain integrity verified — ${result.count} event${result.count === 1 ? "" : "s"} hash-chained from intake to now.`);
    } else {
      setVerifyResult(`Chain broken at event ${result.brokenAtEventId.slice(0, 8)}: ${result.reason}`);
    }
  };

  if (error) {
    return (
      <Card>
        <EmptyState
          iconName="alert"
          title="Couldn't load activity"
          sub={error}
        />
      </Card>
    );
  }

  if (events === null) {
    return <div className="text-sm text-slate-500">Loading activity…</div>;
  }

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState
          iconName="info"
          title={showChain ? "No audit events yet" : "No activity yet"}
          sub={
            showChain
              ? "Every action on this study — stage advances, field edits, closure, e-signatures — will be appended to a hash-chained log. No events have been recorded yet for this study."
              : "When someone changes a field, advances the stage, or closes the study, you'll see the change here."
          }
        />
      </Card>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowChain((v) => !v)}
          aria-pressed={showChain}
          className={
            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition " +
            (showChain
              ? "border-brand-300 bg-brand-50 text-brand-700"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
          }
        >
          <Icon name="shield" size={12} />
          {showChain ? "Hide hash chain" : "Show hash chain"}
        </button>
      </div>
      {study && stages && events.length > 0 && (
        <StudyTimeline study={study} events={events} stages={stages} />
      )}

      {showChain && (
        <Card className="mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-display font-bold text-slate-900">
                Hash-chained audit trail
              </div>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed max-w-2xl">
                Every event carries the hash of the previous event, giving a tamper-evident
                sequence. Click verify to walk every link.
              </p>
            </div>
            <Button variant="primary" onClick={runVerify}>
              <Icon name="shield" size={12} /> Verify chain
            </Button>
          </div>
          {verifyResult && (
            <div
              className={
                "mt-3 rounded-lg border px-3 py-2 text-xs " +
                (verifyResult.startsWith("Chain integrity")
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-800")
              }
            >
              {verifyResult}
            </div>
          )}
        </Card>
      )}

      <Card flush>
        <ul className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.id} className="px-4 py-3 flex items-start gap-3">
              <ActionIcon action={e.action} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900">
                    {renderAction(e)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {e.actor_email ?? "system"}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {fmtDateTime(e.created_at)}
                  </span>
                </div>
                {renderDetails(e)}
                {showChain && (
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-1 text-[10px] font-mono text-slate-500">
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider">prev_hash</span>{" "}
                      {e.prev_hash || "—"}
                    </div>
                    <div>
                      <span className="text-slate-400 uppercase tracking-wider">event_hash</span>{" "}
                      {e.event_hash}
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ActionIcon({ action }: { action: string }) {
  let icon = "info";
  let tone = "bg-slate-100 text-slate-500";
  if (action === "stage_changed") {
    icon = "layers";
    tone = "bg-brand-50 text-brand-600";
  } else if (action === "field_updated") {
    icon = "file";
    tone = "bg-sky-50 text-sky-600";
  } else if (action === "closed") {
    icon = "x";
    tone = "bg-slate-100 text-slate-600";
  } else if (action === "reopened") {
    icon = "check";
    tone = "bg-emerald-50 text-emerald-700";
  } else if (action === "created") {
    icon = "plus";
    tone = "bg-brand-50 text-brand-600";
  }
  return (
    <div className={"w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 " + tone}>
      <Icon name={icon} size={14} />
    </div>
  );
}

function renderAction(e: AuditEventRow): string {
  switch (e.action) {
    case "stage_changed":
      return `Stage → ${String(e.payload?.to_label ?? e.payload?.to ?? "(unknown)")}`;
    case "field_updated":
      return `Updated ${String(e.payload?.field_label ?? e.payload?.field_key ?? "field")}`;
    case "closed":
      return "Closed the study";
    case "reopened":
      return "Reopened the study";
    case "created":
      return "Created the study";
    default:
      return e.action;
  }
}

function renderDetails(e: AuditEventRow): React.ReactNode {
  if (e.action === "field_updated") {
    const from = e.payload?.from;
    const to = e.payload?.to;
    return (
      <div className="mt-0.5 text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
        <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
          {formatVal(from)}
        </code>
        <Icon name="chevron-right" size={10} className="text-slate-400" />
        <code className="font-mono bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded text-[11px]">
          {formatVal(to)}
        </code>
      </div>
    );
  }
  if (e.action === "stage_changed") {
    return (
      <div className="mt-0.5 text-xs text-slate-600">
        <span className="italic text-slate-500">
          {String(e.payload?.from_label ?? e.payload?.from ?? "—")}
        </span>{" "}
        →{" "}
        <span className="font-semibold">
          {String(e.payload?.to_label ?? e.payload?.to ?? "—")}
        </span>
      </div>
    );
  }
  return null;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
