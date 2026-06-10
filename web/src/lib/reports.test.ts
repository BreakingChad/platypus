import { describe, it, expect } from "vitest";
import {
  buildStageDurationRows,
  buildStudyRows,
  buildTaskRows,
  runReport,
  STANDARD_REPORTS,
} from "./reports";
import type { PipelineStageRow, StudyRow, TaskRow } from "./types";

const NOW = new Date("2026-06-09T12:00:00Z");

const stages = [
  { key: "feasibility", label: "Feasibility" },
  { key: "regulatory", label: "Regulatory" },
] as PipelineStageRow[];

const study = (over: Partial<StudyRow>): StudyRow =>
  ({
    id: "s1", org_id: "o", code: "STU-001", title: "T", sponsor: null, nct: null,
    therapeutic_area: null, phase: null, stage_key: "feasibility", study_kind: null,
    priority: "standard", intake_status: "submitted", committed_at: null, site_id: null,
    stage_entered_at: null, intake_date: "2026-06-01T00:00:00Z", closed: false,
    closed_at: null, pi_name: null, custom_field_values: {}, created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...over,
  }) as StudyRow;

describe("runReport", () => {
  it("counts by group with filters", () => {
    const rows = buildStudyRows(
      [
        study({ id: "a", stage_key: "feasibility" }),
        study({ id: "b", stage_key: "feasibility" }),
        study({ id: "c", stage_key: "regulatory", closed: true }),
      ],
      stages,
      NOW
    );
    const r = runReport(
      { source: "studies", groupBy: "stage", metric: "count", filters: [{ field: "status", value: "active" }] },
      rows
    );
    expect(r.groups).toEqual([{ group: "Feasibility", value: 2, count: 2 }]);
    expect(r.rowCount).toBe(2);
  });

  it("drops null group buckets (e.g. month of a null date)", () => {
    const rows = buildStudyRows([study({ committed_at: null })], stages, NOW);
    const r = runReport({ source: "studies", groupBy: "committed_month", metric: "count" }, rows);
    expect(r.groups).toHaveLength(0);
  });

  it("sorts month groups chronologically, others by value", () => {
    const rows = [
      { m: "2026-02", v: 1 },
      { m: "2026-01", v: 9 },
    ].map((x) => ({ committed_month: x.m, age_days: x.v })) as any[];
    const r = runReport({ source: "studies", groupBy: "committed_month", metric: "count" }, rows);
    expect(r.groups.map((g) => g.group)).toEqual(["2026-01", "2026-02"]);
  });

  it("avg_days uses the source's numeric field", () => {
    const rows = [
      { stage: "Feasibility", days: 10 },
      { stage: "Feasibility", days: 20 },
    ] as any[];
    const r = runReport({ source: "stage_durations", groupBy: "stage", metric: "avg_days" }, rows);
    expect(r.groups[0]).toEqual({ group: "Feasibility", value: 15, count: 2 });
  });
});

describe("buildStageDurationRows", () => {
  it("reconstructs completed intervals from stage_changed events", () => {
    const events = [
      { entity_id: "s1", created_at: "2026-05-01T00:00:00Z", payload: { to: "feasibility" } },
      { entity_id: "s1", created_at: "2026-05-11T00:00:00Z", payload: { to: "regulatory" } },
    ];
    const rows = buildStageDurationRows(events, [study({ id: "s1" })], stages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ study: "STU-001", stage: "Feasibility", days: 10 });
  });
  it("the still-open current stage produces no row", () => {
    const events = [
      { entity_id: "s1", created_at: "2026-05-01T00:00:00Z", payload: { to: "feasibility" } },
    ];
    expect(buildStageDurationRows(events, [study({ id: "s1" })], stages)).toHaveLength(0);
  });
});

describe("buildTaskRows", () => {
  it("derives overdue + names", () => {
    const t = {
      id: "t1", org_id: "o", study_id: null, stage_key: "feasibility", kind: "manual",
      title: "Do it", status: "open", due_at: "2026-06-01T00:00:00Z",
      assigned_to_user_id: "u1", assigned_to_role_id: null, handoff_to_role_id: null,
      completed_at: null, completed_by: null, created_by: null, position: 0,
      created_at: "2026-05-30T00:00:00Z", updated_at: "2026-05-30T00:00:00Z",
    } as unknown as TaskRow;
    const rows = buildTaskRows([t], { roles: [], teams: [], stages, studies: [], nameById: { u1: "Chad Trim" } }, NOW);
    expect(rows[0]).toMatchObject({ assignee: "Chad Trim", overdue: true, stage: "Feasibility" });
  });
});

describe("STANDARD_REPORTS", () => {
  it("every standard report evaluates without throwing on empty data", () => {
    for (const r of STANDARD_REPORTS) {
      expect(() => runReport(r.def, [])).not.toThrow();
    }
  });
});
