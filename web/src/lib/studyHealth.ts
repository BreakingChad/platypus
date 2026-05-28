import type { StudyRow, PipelineStageRow } from "./types";

/** Project health for a study — Green / Yellow / Red, computed from how
 *  long it's been in its current stage vs the stage's target_days.
 *
 *  Reference point for elapsed time:
 *    - committed_at   if set (study has been committed to portfolio)
 *    - else intake_date
 *    - else created_at
 *
 *  Thresholds:
 *    - elapsed <= target * 0.75       → green   (healthy)
 *    - elapsed <= target              → yellow  (at risk)
 *    - elapsed >  target              → red     (overdue)
 *  Stages with target_days = 0 (terminal) are always considered green.
 *  Closed studies are 'closed' and never red.
 */

export type HealthLevel = "green" | "yellow" | "red" | "unknown" | "closed";

export type HealthInfo = {
  level: HealthLevel;
  /** Whole days elapsed since the relevant anchor date in this stage. */
  daysInStage: number;
  /** Days remaining to target (positive = healthy, negative = over). */
  daysToTarget: number;
  /** target_days of the current stage (0 for terminal stages). */
  targetDays: number;
  /** Human-readable summary, e.g. "5d in stage, 9d to target". */
  summary: string;
  /** Stage label for convenience (so consumers don't need to pass stages). */
  stageLabel: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function anchorDate(s: StudyRow): Date | null {
  const candidates = [s.stage_entered_at, s.committed_at, s.intake_date, s.created_at];
  for (const c of candidates) {
    if (c) {
      const d = new Date(c);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function computeHealth(
  study: StudyRow,
  stages: PipelineStageRow[],
  now: Date = new Date()
): HealthInfo {
  if (study.closed) {
    return {
      level: "closed",
      daysInStage: 0,
      daysToTarget: 0,
      targetDays: 0,
      summary: "Closed",
      stageLabel: stages.find((s) => s.key === study.stage_key)?.label ?? null,
    };
  }
  const stage = study.stage_key ? stages.find((s) => s.key === study.stage_key) : null;
  if (!stage) {
    return {
      level: "unknown",
      daysInStage: 0,
      daysToTarget: 0,
      targetDays: 0,
      summary: "Unassigned stage",
      stageLabel: null,
    };
  }
  const anchor = anchorDate(study);
  if (!anchor) {
    return {
      level: "unknown",
      daysInStage: 0,
      daysToTarget: stage.target_days,
      targetDays: stage.target_days,
      summary: "No anchor date",
      stageLabel: stage.label,
    };
  }
  const daysInStage = Math.max(0, daysBetween(anchor, now));
  const target = stage.target_days;
  const daysToTarget = target - daysInStage;

  // Terminal stages (target=0) — show healthy with elapsed time.
  if (target === 0) {
    return {
      level: "green",
      daysInStage,
      daysToTarget: 0,
      targetDays: 0,
      summary: `${daysInStage}d in ${stage.label}`,
      stageLabel: stage.label,
    };
  }

  let level: HealthLevel;
  if (daysInStage <= Math.floor(target * 0.75)) level = "green";
  else if (daysInStage <= target) level = "yellow";
  else level = "red";

  let summary: string;
  if (level === "red") {
    summary = `${-daysToTarget}d overdue (${daysInStage}d / ${target}d target)`;
  } else if (level === "yellow") {
    summary = `${daysToTarget}d to target (${daysInStage}d / ${target}d)`;
  } else {
    summary = `${daysInStage}d in stage · ${daysToTarget}d to target`;
  }

  return {
    level,
    daysInStage,
    daysToTarget,
    targetDays: target,
    summary,
    stageLabel: stage.label,
  };
}

/** Numeric sort weight — lower = should appear higher in lists.
 *  Useful for ordering Pipeline cards "most urgent first". */
export function healthSortWeight(h: HealthInfo): number {
  switch (h.level) {
    case "red":     return 0;
    case "yellow":  return 1;
    case "green":   return 2;
    case "unknown": return 3;
    case "closed":  return 4;
  }
}

export const HEALTH_TONE: Record<HealthLevel, { bg: string; text: string; border: string; dot: string; label: string }> = {
  green: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
    label: "Healthy",
  },
  yellow: {
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
    dot: "bg-amber-500",
    label: "At risk",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-500",
    label: "Overdue",
  },
  unknown: {
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
    dot: "bg-slate-400",
    label: "Unknown",
  },
  closed: {
    bg: "bg-slate-100",
    text: "text-slate-600",
    border: "border-slate-200",
    dot: "bg-slate-300",
    label: "Closed",
  },
};
