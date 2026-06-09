import { describe, it, expect } from "vitest";
import { computeHealth, healthSortWeight, HEALTH_TONE } from "./studyHealth";
import type { StudyRow, PipelineStageRow } from "./types";

/** Helpers to build minimal fixtures without exhaustive boilerplate. */
function mkStage(over: Partial<PipelineStageRow> = {}): PipelineStageRow {
  return {
    id: "stage-1",
    org_id: "org-1",
    pipeline_id: null,
    key: "intake",
    label: "Intake",
    icon_key: "inbox",
    color: "#6366F1",
    target_days: 14,
    owner_team_id: null,
    terminal: false,
    is_core: true,
    position: 1,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mkStudy(over: Partial<StudyRow> = {}): StudyRow {
  return {
    id: "study-1",
    org_id: "org-1",
    code: "STU-001",
    title: "A study",
    nct: null,
    sponsor: null,
    therapeutic_area: null,
    phase: null,
    stage_key: "intake",
    study_kind: null,
    priority: "standard",
    intake_status: "submitted",
    committed_at: null,
    site_id: null,
    stage_entered_at: null,
    intake_date: "2026-05-01T00:00:00Z",
    closed: false,
    closed_at: null,
    pi_name: null,
    custom_field_values: {},
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...over,
  };
}

describe("computeHealth", () => {
  it("anchors on stage_entered_at (time in current stage), not commit date", () => {
    const h = computeHealth(
      mkStudy({
        stage_entered_at: "2026-05-25T00:00:00Z",
        committed_at: "2026-05-01T00:00:00Z",
      }),
      [mkStage({ target_days: 14 })],
      new Date("2026-05-30T00:00:00Z")
    );
    // 5d since entering the stage (not 29d since commit) -> healthy
    expect(h.daysInStage).toBe(5);
    expect(h.level).toBe("green");
  });

  it("returns 'closed' for closed studies regardless of dates", () => {
    const h = computeHealth(
      mkStudy({ closed: true, closed_at: "2026-05-02T00:00:00Z" }),
      [mkStage()],
      new Date("2026-06-01T00:00:00Z")
    );
    expect(h.level).toBe("closed");
  });

  it("returns 'unknown' when stage_key isn't in the stage list", () => {
    const h = computeHealth(
      mkStudy({ stage_key: "ghost_stage" }),
      [mkStage()],
      new Date("2026-05-10T00:00:00Z")
    );
    expect(h.level).toBe("unknown");
  });

  it("returns 'green' inside the first 75% of the target window", () => {
    const h = computeHealth(
      mkStudy({ intake_date: "2026-05-01T00:00:00Z" }),
      [mkStage({ target_days: 14 })],
      new Date("2026-05-08T00:00:00Z") // day 7, 50% of 14
    );
    expect(h.level).toBe("green");
    expect(h.daysInStage).toBe(7);
    expect(h.daysToTarget).toBe(7);
  });

  it("returns 'yellow' between 75% and 100% of target", () => {
    const h = computeHealth(
      mkStudy({ intake_date: "2026-05-01T00:00:00Z" }),
      [mkStage({ target_days: 14 })],
      new Date("2026-05-13T00:00:00Z") // day 12, ~85%
    );
    expect(h.level).toBe("yellow");
    expect(h.daysInStage).toBe(12);
    expect(h.daysToTarget).toBe(2);
  });

  it("returns 'red' past target", () => {
    const h = computeHealth(
      mkStudy({ intake_date: "2026-05-01T00:00:00Z" }),
      [mkStage({ target_days: 14 })],
      new Date("2026-05-20T00:00:00Z") // day 19
    );
    expect(h.level).toBe("red");
    expect(h.daysToTarget).toBe(-5);
    expect(h.summary).toMatch(/overdue/);
  });

  it("treats terminal stages (target=0) as healthy", () => {
    const h = computeHealth(
      mkStudy({ stage_key: "activation", intake_date: "2026-05-01T00:00:00Z" }),
      [mkStage({ key: "activation", target_days: 0, terminal: true, label: "Activated" })],
      new Date("2026-06-30T00:00:00Z")
    );
    expect(h.level).toBe("green");
    expect(h.summary).toMatch(/Activated/);
  });

  it("prefers committed_at over intake_date as the anchor", () => {
    const h = computeHealth(
      mkStudy({
        intake_date: "2026-04-01T00:00:00Z", // 30 days earlier
        committed_at: "2026-05-01T00:00:00Z",
      }),
      [mkStage({ target_days: 14 })],
      new Date("2026-05-08T00:00:00Z")
    );
    // Anchor should be committed_at, so 7 days in
    expect(h.daysInStage).toBe(7);
    expect(h.level).toBe("green");
  });
});

describe("healthSortWeight", () => {
  it("sorts urgent → quiet → closed", () => {
    const stage = [mkStage()];
    const now = new Date("2026-06-01T00:00:00Z");
    const overdue = computeHealth(
      mkStudy({ intake_date: "2026-04-01T00:00:00Z" }),
      stage,
      now
    );
    const closed = computeHealth(
      mkStudy({ closed: true, closed_at: "2026-05-01T00:00:00Z" }),
      stage,
      now
    );
    expect(healthSortWeight(overdue)).toBeLessThan(healthSortWeight(closed));
  });
});

describe("HEALTH_TONE", () => {
  it("has the five levels", () => {
    const keys = Object.keys(HEALTH_TONE).sort();
    expect(keys).toEqual(["closed", "green", "red", "unknown", "yellow"]);
  });
});
