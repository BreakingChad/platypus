import type { PipelineStageRow, StudyRow, TaskRow, TeamRoleRow, TeamRow } from "./types";

/** Report engine (Analytics v1) — pure functions over client-loaded org data.
 *
 *  A report is a tiny declarative definition: pick a SOURCE (studies, tasks,
 *  or stage durations derived from the audit chain), GROUP by a field,
 *  apply a METRIC, optionally filter. Standard reports and admin-built
 *  custom reports run through the same evaluator, so the examples teach
 *  the model. Cycle times come from `stage_changed` audit events — the
 *  defensible chain doubles as the metrics source.
 */

export type ReportSource = "studies" | "tasks" | "stage_durations";
export type ReportMetric = "count" | "avg_days" | "overdue_count";
export type ReportFilter = { field: string; value: string };

export type ReportDef = {
  source: ReportSource;
  groupBy: string;
  metric: ReportMetric;
  filters?: ReportFilter[];
};

export type ReportRow = Record<string, string | number | boolean | null>;

export type ReportResult = {
  groups: { group: string; value: number; count: number }[];
  total: number;
  rowCount: number;
};

/* ---------------- row builders ---------------- */

const month = (iso: string | null | undefined): string | null =>
  iso ? String(iso).slice(0, 7) : null;

const days = (ms: number): number => Math.round((ms / 86400000) * 10) / 10;

export function buildStudyRows(
  studies: StudyRow[],
  stages: PipelineStageRow[],
  now: Date = new Date()
): ReportRow[] {
  const stageLabel = new Map(stages.map((s) => [s.key, s.label]));
  return studies.map((s) => ({
    code: s.code,
    title: s.title,
    stage: s.stage_key ? stageLabel.get(s.stage_key) ?? s.stage_key : "—",
    sponsor: s.sponsor ?? "—",
    phase: s.phase ?? "—",
    therapeutic_area: s.therapeutic_area ?? "—",
    priority: s.priority ?? "—",
    study_kind: s.study_kind ?? "—",
    pi: s.pi_name ?? "—",
    status: s.closed ? "closed" : "active",
    committed: s.committed_at ? "yes" : "no",
    committed_month: month(s.committed_at),
    intake_month: month(s.intake_date ?? s.created_at),
    intake_status: (s as any).intake_status ?? "—",
    age_days: days(now.getTime() - new Date(s.intake_date ?? s.created_at).getTime()),
  }));
}

export function buildTaskRows(
  tasks: TaskRow[],
  ctx: {
    roles: TeamRoleRow[];
    teams: TeamRow[];
    stages: PipelineStageRow[];
    studies: StudyRow[];
    nameById: Record<string, string>;
  },
  now: Date = new Date()
): ReportRow[] {
  const roleById = new Map(ctx.roles.map((r) => [r.id, r]));
  const teamById = new Map(ctx.teams.map((t) => [t.id, t.name]));
  const stageLabel = new Map(ctx.stages.map((s) => [s.key, s.label]));
  const studyCode = new Map(ctx.studies.map((s) => [s.id, s.code]));
  return tasks.map((t) => {
    const role = t.assigned_to_role_id ? roleById.get(t.assigned_to_role_id) : undefined;
    const open = t.status === "open" || t.status === "in_progress";
    const overdue = open && !!t.due_at && new Date(t.due_at).getTime() < now.getTime();
    return {
      title: t.title,
      status: t.status,
      kind: t.kind,
      stage: t.stage_key ? stageLabel.get(t.stage_key) ?? t.stage_key : "—",
      study: t.study_id ? studyCode.get(t.study_id) ?? "—" : "—",
      assignee: t.assigned_to_user_id ? ctx.nameById[t.assigned_to_user_id] ?? "(member)" : "(unassigned)",
      role: role?.title ?? "—",
      team: role ? teamById.get(role.team_id) ?? "—" : t.assigned_to_team_id ? teamById.get(t.assigned_to_team_id) ?? "—" : "—",
      overdue,
      due_month: month(t.due_at),
      created_month: month(t.created_at),
      age_days: days(now.getTime() - new Date(t.created_at).getTime()),
    };
  });
}

/** One row per COMPLETED stage interval, reconstructed from the audit chain's
 *  stage_changed events (payload: { from, to, from_label, to_label }). */
export function buildStageDurationRows(
  events: { entity_id: string | null; created_at: string; payload: Record<string, unknown> }[],
  studies: StudyRow[],
  stages: PipelineStageRow[]
): ReportRow[] {
  const stageLabel = new Map(stages.map((s) => [s.key, s.label]));
  const studyById = new Map(studies.map((s) => [s.id, s]));
  const byStudy = new Map<string, { at: number; to: string | null; month: string | null }[]>();
  for (const e of events) {
    if (!e.entity_id) continue;
    const to = (e.payload?.to as string | undefined) ?? null;
    (byStudy.get(e.entity_id) ?? byStudy.set(e.entity_id, []).get(e.entity_id)!).push({
      at: new Date(e.created_at).getTime(),
      to,
      month: month(e.created_at),
    });
  }
  const rows: ReportRow[] = [];
  for (const [studyId, evs] of byStudy) {
    const study = studyById.get(studyId);
    evs.sort((a, b) => a.at - b.at);
    for (let i = 0; i < evs.length - 1; i += 1) {
      const cur = evs[i];
      const next = evs[i + 1];
      if (!cur.to) continue;
      rows.push({
        study: study?.code ?? "(deleted)",
        stage: stageLabel.get(cur.to) ?? cur.to,
        days: days(next.at - cur.at),
        ended_month: next.month,
      });
    }
  }
  return rows;
}

/* ---------------- evaluator ---------------- */

const NUMERIC_FIELD: Record<ReportSource, string> = {
  studies: "age_days",
  tasks: "age_days",
  stage_durations: "days",
};

export function runReport(def: ReportDef, rows: ReportRow[]): ReportResult {
  let xs = rows;
  for (const f of def.filters ?? []) {
    xs = xs.filter((r) => String(r[f.field] ?? "") === f.value);
  }
  const groups = new Map<string, ReportRow[]>();
  for (const r of xs) {
    const raw = r[def.groupBy];
    if (raw === null || raw === undefined) continue; // no bucket (e.g. month of a null date)
    const key = String(raw);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const numField = NUMERIC_FIELD[def.source];
  const out = [...groups.entries()].map(([group, members]) => {
    let value: number;
    if (def.metric === "count") value = members.length;
    else if (def.metric === "overdue_count") value = members.filter((m) => m.overdue === true).length;
    else {
      const nums = members
        .map((m) => Number(m[numField]))
        .filter((n) => Number.isFinite(n));
      value = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;
    }
    return { group, value, count: members.length };
  });
  // Months sort chronologically; everything else by value, biggest first.
  const monthly = /_month$/.test(def.groupBy);
  out.sort((a, b) => (monthly ? a.group.localeCompare(b.group) : b.value - a.value));
  const total = out.reduce((s, g) => s + g.value, 0);
  return { groups: out, total: Math.round(total * 10) / 10, rowCount: xs.length };
}

/* ---------------- vocabulary for the builder UI ---------------- */

export const GROUP_FIELDS: Record<ReportSource, { key: string; label: string }[]> = {
  studies: [
    { key: "stage", label: "Stage" },
    { key: "sponsor", label: "Sponsor" },
    { key: "phase", label: "Phase" },
    { key: "therapeutic_area", label: "Therapeutic area" },
    { key: "priority", label: "Priority" },
    { key: "study_kind", label: "Study kind" },
    { key: "pi", label: "PI" },
    { key: "status", label: "Active / closed" },
    { key: "intake_status", label: "Intake outcome" },
    { key: "committed_month", label: "Month committed" },
    { key: "intake_month", label: "Month received" },
  ],
  tasks: [
    { key: "assignee", label: "Assignee" },
    { key: "role", label: "Role" },
    { key: "team", label: "Team" },
    { key: "stage", label: "Stage" },
    { key: "status", label: "Status" },
    { key: "kind", label: "Task type" },
    { key: "study", label: "Study" },
    { key: "due_month", label: "Month due" },
    { key: "created_month", label: "Month created" },
  ],
  stage_durations: [
    { key: "stage", label: "Stage" },
    { key: "study", label: "Study" },
    { key: "ended_month", label: "Month completed" },
  ],
};

export const METRICS: Record<ReportSource, { key: ReportMetric; label: string }[]> = {
  studies: [
    { key: "count", label: "Count of studies" },
    { key: "avg_days", label: "Avg age (days since intake)" },
  ],
  tasks: [
    { key: "count", label: "Count of tasks" },
    { key: "overdue_count", label: "Overdue count" },
    { key: "avg_days", label: "Avg task age (days)" },
  ],
  stage_durations: [
    { key: "avg_days", label: "Avg days in stage (cycle time)" },
    { key: "count", label: "Completed stage passes" },
  ],
};

export const SOURCE_LABELS: Record<ReportSource, string> = {
  studies: "Studies",
  tasks: "Tasks",
  stage_durations: "Stage durations (from the audit chain)",
};

/** The standardized examples — they run through the same evaluator the
 *  custom builder uses, so they double as documentation. */
export const STANDARD_REPORTS: { id: string; name: string; description: string; def: ReportDef }[] = [
  {
    id: "std-cycle-time",
    name: "Cycle time by stage",
    description: "Average days a study spends in each stage, reconstructed from the audit trail. The where-are-we-slow report.",
    def: { source: "stage_durations", groupBy: "stage", metric: "avg_days" },
  },
  {
    id: "std-throughput",
    name: "Throughput — studies committed per month",
    description: "How many studies entered the portfolio each month.",
    def: { source: "studies", groupBy: "committed_month", metric: "count", filters: [{ field: "committed", value: "yes" }] },
  },
  {
    id: "std-census",
    name: "Pipeline census",
    description: "Where every active study sits right now.",
    def: { source: "studies", groupBy: "stage", metric: "count", filters: [{ field: "status", value: "active" }] },
  },
  {
    id: "std-workload",
    name: "Coordinator workload",
    description: "Open tasks per person — who's drowning, who has capacity.",
    def: { source: "tasks", groupBy: "assignee", metric: "count", filters: [{ field: "status", value: "open" }] },
  },
  {
    id: "std-overdue-team",
    name: "Overdue tasks by team",
    description: "Which team's queue is slipping.",
    def: { source: "tasks", groupBy: "team", metric: "overdue_count" },
  },
  {
    id: "std-intake-outcomes",
    name: "Intake outcomes",
    description: "Committed vs declined vs in-triage across everything that arrived.",
    def: { source: "studies", groupBy: "intake_status", metric: "count" },
  },
  {
    id: "std-aging-role",
    name: "Task aging by role",
    description: "Average task age per role — stale queues show up here first.",
    def: { source: "tasks", groupBy: "role", metric: "avg_days", filters: [{ field: "status", value: "open" }] },
  },
];
