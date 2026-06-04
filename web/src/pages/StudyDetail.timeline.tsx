import { useMemo, useState } from "react";
import type { AuditEventRow, PipelineStageRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";

/** StudyTimeline — a horizontal SVG visualisation of a study's lifecycle.
 *
 *  Two layers:
 *    1. Stage bands — each colored band spans the time the study spent in a
 *       given stage (computed from stage_changed audit events).
 *    2. Event dots — every non-stage event plotted at its created_at, coded
 *       by action type. Hovering surfaces a tooltip with details.
 *
 *  Inputs:
 *    study   — the StudyRow (we use intake_date / committed_at / created_at
 *              as the anchor and updated_at / closed_at / now as the end)
 *    events  — audit_events for this study (sorted ascending). Stage events
 *              produce the bands; everything else becomes a dot.
 *    stages  — pipeline_stages for color + label lookups.
 */
export function StudyTimeline({
  study,
  events,
  stages,
}: {
  study: StudyRow;
  events: AuditEventRow[];
  stages: PipelineStageRow[];
}) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Sort events ascending for the band reconstruction. We don't mutate the
  // caller's array.
  const sorted = useMemo(
    () =>
      [...events].sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
      ),
    [events]
  );

  // Time window for the chart.
  const anchorISO =
    study.committed_at || study.intake_date || study.created_at || sorted[0]?.created_at;
  const endISO = study.closed
    ? study.closed_at ?? study.updated_at ?? new Date().toISOString()
    : new Date().toISOString();
  const t0 = anchorISO ? new Date(anchorISO).getTime() : Date.now() - 86400000;
  const t1 = endISO ? new Date(endISO).getTime() : Date.now();
  const span = Math.max(86400000, t1 - t0); // at least 1 day

  const W = 700; // viewBox width
  const H = 56;
  const pad = 8;
  const barH = 18;
  const barY = (H - barH) / 2;

  const x = (ts: number) => pad + ((ts - t0) / span) * (W - 2 * pad);

  // Reconstruct stage bands from stage_changed events.
  const bands = useMemo(() => {
    const stageMap = new Map(stages.map((s) => [s.key, s]));
    const stageChanges = sorted.filter((e) => e.action === "stage_changed");

    // Bands[i] = { from: ts, to: ts, stage_key }
    type Band = { from: number; to: number; stageKey: string; color: string; label: string };
    const out: Band[] = [];

    // The 'from' state at the anchor is the first transition's `from`, or
    // the study's current stage if there are no transitions.
    let prevFromTs = t0;
    let prevStageKey: string | null =
      (stageChanges[0]?.payload as any)?.from ?? study.stage_key ?? null;

    for (const ev of stageChanges) {
      const evTs = ev.created_at ? new Date(ev.created_at).getTime() : prevFromTs;
      if (prevStageKey) {
        const meta = stageMap.get(prevStageKey);
        out.push({
          from: prevFromTs,
          to: evTs,
          stageKey: prevStageKey,
          color: meta?.color ?? "#94a3b8",
          label: meta?.label ?? prevStageKey,
        });
      }
      prevStageKey = (ev.payload as any)?.to ?? null;
      prevFromTs = evTs;
    }

    // Final open band — from the last transition to now (or closed_at).
    if (prevStageKey) {
      const meta = stageMap.get(prevStageKey);
      out.push({
        from: prevFromTs,
        to: t1,
        stageKey: prevStageKey,
        color: meta?.color ?? "#94a3b8",
        label: meta?.label ?? prevStageKey,
      });
    }

    return out;
  }, [sorted, stages, t0, t1, study.stage_key]);

  // Non-stage events become dots.
  const dots = useMemo(() => {
    return sorted
      .filter((e) => e.action !== "stage_changed")
      .map((e) => {
        const ts = e.created_at ? new Date(e.created_at).getTime() : null;
        if (ts === null) return null;
        return { event: e, ts, color: dotColor(e.action) };
      })
      .filter((x): x is { event: AuditEventRow; ts: number; color: string } => x !== null);
  }, [sorted]);

  if (bands.length === 0 && dots.length === 0) {
    return null;
  }

  // Format span as a sub-label.
  const days = Math.max(1, Math.round(span / 86400000));

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">
            Lifecycle timeline
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {days} day{days === 1 ? "" : "s"} elapsed since {formatDate(t0)}
            {study.closed ? ` · closed ${formatDate(t1)}` : " · open"}
          </div>
        </div>
        <Legend />
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" role="img" aria-label="Study lifecycle timeline">
          {/* Background rail */}
          <rect x={pad} y={barY} width={W - 2 * pad} height={barH} fill="#f1f5f9" rx={4} />
          {/* Stage bands */}
          {bands.map((b, i) => {
            const x0 = x(b.from);
            const x1 = x(b.to);
            const w = Math.max(1, x1 - x0);
            return (
              <g key={`band-${i}`}>
                <rect
                  x={x0}
                  y={barY}
                  width={w}
                  height={barH}
                  fill={b.color}
                  opacity={0.85}
                  onMouseEnter={(e) => {
                    const svg = (e.currentTarget.ownerSVGElement!) as SVGSVGElement;
                    const r = svg.getBoundingClientRect();
                    setHover({
                      kind: "band",
                      x: (x0 + w / 2) / W * r.width,
                      label: b.label,
                      sub: `${formatDate(b.from)} → ${formatDate(b.to)} (${Math.max(1, Math.round((b.to - b.from) / 86400000))}d)`,
                      color: b.color,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
                {/* Stage labels — only show if band is wide enough */}
                {w > 60 && (
                  <text
                    x={x0 + 6}
                    y={barY + barH / 2 + 3.5}
                    fill="#ffffff"
                    fontSize="9"
                    fontWeight="700"
                    style={{ pointerEvents: "none", fontFamily: "ui-monospace, monospace" }}
                  >
                    {truncateLabel(b.label, Math.floor(w / 6))}
                  </text>
                )}
              </g>
            );
          })}

          {/* Event dots */}
          {dots.map(({ event, ts, color }) => {
            const cx = x(ts);
            return (
              <circle
                key={event.id}
                cx={cx}
                cy={barY + barH + 8}
                r={4}
                fill={color}
                stroke="#fff"
                strokeWidth={1.5}
                onMouseEnter={(e) => {
                  const svg = (e.currentTarget.ownerSVGElement!) as SVGSVGElement;
                  const r = svg.getBoundingClientRect();
                  setHover({
                    kind: "event",
                    x: (cx / W) * r.width,
                    label: actionLabelShort(event),
                    sub: `${formatDate(ts)} · ${event.actor_email ?? "system"}`,
                    color,
                  });
                }}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}

          {/* End markers */}
          <line x1={pad} y1={barY - 4} x2={pad} y2={barY + barH + 4} stroke="#94a3b8" strokeWidth={1} />
          <line x1={W - pad} y1={barY - 4} x2={W - pad} y2={barY + barH + 4} stroke="#94a3b8" strokeWidth={1} />
        </svg>

        {hover && (
          <div
            className="absolute -translate-x-1/2 top-0 -translate-y-full mt-[-4px] pointer-events-none z-10"
            style={{ left: `${hover.x}px` }}
          >
            <div
              className="px-2 py-1 rounded-md text-white text-[10px] font-semibold shadow-lg whitespace-nowrap"
              style={{ backgroundColor: hover.color }}
            >
              {hover.label}
              <div className="text-[9px] font-mono opacity-80 font-normal">{hover.sub}</div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- helpers ---------- */

type HoverInfo = {
  kind: "band" | "event";
  x: number;
  label: string;
  sub: string;
  color: string;
};

function dotColor(action: string): string {
  switch (action) {
    case "created":          return "#7C3AED"; // brand violet
    case "field_updated":    return "#0EA5E9"; // sky
    case "closed":           return "#64748B"; // slate
    case "reopened":         return "#10B981"; // emerald
    case "task_created":
    case "task_completed":
    case "task_skipped":
    case "task_reopened":    return "#F59E0B"; // amber
    default:                 return "#4F46E5"; // brand
  }
}

function actionLabelShort(e: AuditEventRow): string {
  switch (e.action) {
    case "created":         return "Created";
    case "field_updated":   return `Updated ${String((e.payload as any)?.field_label ?? (e.payload as any)?.field_key ?? "field")}`;
    case "closed":          return "Closed";
    case "reopened":        return "Reopened";
    case "task_created":    return `Task: ${String((e.payload as any)?.title ?? "")}`;
    case "task_completed":  return `Task done: ${String((e.payload as any)?.title ?? "")}`;
    case "task_skipped":    return `Task skipped: ${String((e.payload as any)?.title ?? "")}`;
    case "task_reopened":   return `Task reopened: ${String((e.payload as any)?.title ?? "")}`;
    default:                return e.action;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function truncateLabel(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return "";
  return s.slice(0, Math.max(1, maxChars - 1)) + "…";
}

function Legend() {
  const dotCls = "inline-block w-2 h-2 rounded-full";
  return (
    <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
      <span className="flex items-center gap-1"><span className={dotCls} style={{ backgroundColor: "#7C3AED" }} /> created</span>
      <span className="flex items-center gap-1"><span className={dotCls} style={{ backgroundColor: "#0EA5E9" }} /> field</span>
      <span className="flex items-center gap-1"><span className={dotCls} style={{ backgroundColor: "#F59E0B" }} /> task</span>
      <span className="flex items-center gap-1"><span className={dotCls} style={{ backgroundColor: "#64748B" }} /> close</span>
    </div>
  );
}
