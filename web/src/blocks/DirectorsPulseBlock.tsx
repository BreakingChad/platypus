import { useMemo } from "react";
import { useAuth } from "../auth/useAuth";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineStageRow, StudyRow, TaskRow } from "../lib/types";
import { computeHealth } from "../lib/studyHealth";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

/** DirectorsPulseBlock — one-paragraph narrative for ops directors. Reads
 *  the current state of the portfolio and tasks and synthesizes a tone-
 *  appropriate summary with drill-through chips.
 *
 *  Sentiment tiers:
 *    'calm'    → all-green, no urgent tasks
 *    'mixed'   → some at-risk or tasks-due-today, nothing critical
 *    'urgent'  → overdue studies OR overdue tasks present
 */
export function DirectorsPulseBlock({ ctx }: { ctx: BlockContext }) {
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "updated_at", realtime: true });
  const tasks = useOrgTable<TaskRow>("tasks", { orderBy: "due_at", realtime: true });

  const summary = useMemo(() => {
    const open = studies.rows.filter((s) => !s.closed);
    const withHealth = open.map((s) => ({ row: s, health: computeHealth(s, stages.rows) }));
    const overdue = withHealth.filter((x) => x.health.level === "red");
    const atRisk = withHealth.filter((x) => x.health.level === "yellow");

    // Tasks due / overdue for me
    const now = Date.now();
    const myOpen = tasks.rows.filter(
      (t) => t.assigned_to_user_id === userId && (t.status === "open" || t.status === "in_progress")
    );
    const myOverdue = myOpen.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
    const myDueToday = myOpen.filter((t) => {
      if (!t.due_at) return false;
      const ts = new Date(t.due_at).getTime();
      const eod = new Date();
      eod.setHours(23, 59, 59, 999);
      return ts >= now && ts <= eod.getTime();
    });

    // Bottleneck: the stage with the most overdue studies.
    let bottleneckStage: PipelineStageRow | null = null;
    let bottleneckCount = 0;
    if (overdue.length > 0) {
      const counts: Record<string, number> = {};
      for (const x of overdue) {
        const k = x.row.stage_key ?? "__unassigned__";
        counts[k] = (counts[k] ?? 0) + 1;
      }
      let bestKey: string | null = null;
      let bestN = 0;
      for (const [k, n] of Object.entries(counts)) {
        if (n > bestN) {
          bestN = n;
          bestKey = k;
        }
      }
      bottleneckCount = bestN;
      bottleneckStage = bestKey ? stages.rows.find((s) => s.key === bestKey) ?? null : null;
    }

    // Worst-offender study (deepest red).
    const worst = [...overdue].sort(
      (a, b) => a.health.daysToTarget - b.health.daysToTarget
    )[0];

    let sentiment: "calm" | "mixed" | "urgent" = "calm";
    if (overdue.length > 0 || myOverdue.length > 0) sentiment = "urgent";
    else if (atRisk.length > 0 || myDueToday.length > 0) sentiment = "mixed";

    // Compose sentences
    const parts: string[] = [];
    if (overdue.length > 0) {
      parts.push(
        `${overdue.length} stud${overdue.length === 1 ? "y is" : "ies are"} past target` +
          (atRisk.length > 0
            ? `, ${atRisk.length} more slipping toward red`
            : "")
      );
    } else if (atRisk.length > 0) {
      parts.push(`${atRisk.length} stud${atRisk.length === 1 ? "y" : "ies"} approaching target`);
    } else if (open.length > 0) {
      parts.push(`All ${open.length} open stud${open.length === 1 ? "y is" : "ies are"} on track`);
    } else {
      parts.push("No open studies yet");
    }

    if (myOverdue.length > 0) {
      parts.push(
        `${myOverdue.length} of your task${myOverdue.length === 1 ? " is" : "s are"} overdue`
      );
    } else if (myDueToday.length > 0) {
      parts.push(
        `${myDueToday.length} of your task${myDueToday.length === 1 ? " is" : "s are"} due today`
      );
    }

    if (bottleneckStage && bottleneckCount > 1) {
      parts.push(`${bottleneckStage.label} is the current bottleneck (${bottleneckCount} stuck)`);
    }

    let narrative = parts.join(". ") + ".";
    if (worst) {
      narrative += ` Deepest red: ${worst.row.code} — ${worst.health.summary.toLowerCase()}.`;
    }

    return {
      sentiment,
      narrative,
      overdue,
      atRisk,
      myOverdue,
      myDueToday,
      bottleneckStage,
      worst,
    };
  }, [studies.rows, stages.rows, tasks.rows, userId]);

  // Hide on totally empty portfolios — nothing to narrate.
  if (studies.rows.filter((s) => !s.closed).length === 0) return null;

  const toneCls =
    summary.sentiment === "urgent"
      ? "from-red-50 to-amber-50 border-red-200"
      : summary.sentiment === "mixed"
      ? "from-amber-50 to-white border-amber-200"
      : "from-emerald-50/60 to-white border-emerald-200";

  const dotCls =
    summary.sentiment === "urgent"
      ? "bg-red-500"
      : summary.sentiment === "mixed"
      ? "bg-amber-500"
      : "bg-emerald-500";

  const sentimentLabel =
    summary.sentiment === "urgent"
      ? "Needs attention"
      : summary.sentiment === "mixed"
      ? "Watch list"
      : "On track";

  return (
    <section>
      <div className={"rounded-2xl border-2 bg-gradient-to-br p-5 " + toneCls}>
        <div className="flex items-center gap-2 mb-2">
          <span className={"inline-block w-2.5 h-2.5 rounded-full " + dotCls} />
          <span className="text-[11px] font-semibold text-slate-700">
            Director's pulse · {sentimentLabel}
          </span>
        </div>
        <p className="text-base font-display font-bold text-slate-900 leading-snug">
          {summary.narrative}
        </p>

        {/* Drill-through chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {summary.overdue.length > 0 && (
            <Chip
              tone="red"
              icon="alert"
              onClick={() => ctx.navigate("#/studies")}
            >
              {summary.overdue.length} overdue
            </Chip>
          )}
          {summary.atRisk.length > 0 && (
            <Chip
              tone="amber"
              icon="alert"
              onClick={() => ctx.navigate("#/studies")}
            >
              {summary.atRisk.length} at risk
            </Chip>
          )}
          {summary.myOverdue.length > 0 && (
            <Chip
              tone="red"
              icon="inbox"
              onClick={() => ctx.navigate("#/inbox")}
            >
              {summary.myOverdue.length} of your tasks overdue
            </Chip>
          )}
          {summary.myDueToday.length > 0 && (
            <Chip
              tone="amber"
              icon="inbox"
              onClick={() => ctx.navigate("#/inbox")}
            >
              {summary.myDueToday.length} of your tasks due today
            </Chip>
          )}
          {summary.bottleneckStage && (
            <Chip
              tone="slate"
              icon="layers"
              onClick={() => ctx.navigate("#/pipeline")}
            >
              {summary.bottleneckStage.label}: bottleneck
            </Chip>
          )}
          {summary.worst && (
            <Chip
              tone="red"
              icon="folder"
              onClick={() => ctx.navigate(`#/studies/${summary.worst!.row.id}`)}
            >
              Deepest red: {summary.worst.row.code}
            </Chip>
          )}
        </div>
      </div>
    </section>
  );
}

function Chip({
  tone,
  icon,
  children,
  onClick,
}: {
  tone: "red" | "amber" | "slate";
  icon: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const cls =
    tone === "red"
      ? "bg-white/80 border-red-200 text-red-700 hover:bg-red-50"
      : tone === "amber"
      ? "bg-white/80 border-amber-200 text-amber-800 hover:bg-amber-50"
      : "bg-white/80 border-slate-200 text-slate-700 hover:bg-slate-50";
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition " +
        cls
      }
    >
      <Icon name={icon} size={11} />
      {children}
    </button>
  );
}
