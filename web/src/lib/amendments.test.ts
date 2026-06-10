import { describe, it, expect } from "vitest";
import {
  isHistorical, rootIdOf, buildAmendmentInsert, lineageOf, needsAmendmentPurpose, visibleStudies,
} from "./amendments";
import type { StudyRow } from "./types";

function study(p: Partial<StudyRow> & { id: string }): StudyRow {
  return {
    org_id: "o", code: "X-001", title: "T", nct: null, sponsor: null,
    therapeutic_area: null, phase: null, stage_key: "intake", study_kind: null,
    priority: "normal", intake_status: "submitted", committed_at: null, site_id: null,
    stage_entered_at: null, intake_date: null, closed: false, closed_at: null,
    pi_name: null, custom_field_values: {}, created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    root_study_id: null, amendment_of: null, version_label: null,
    amendment_purpose: null, superseded_at: null, superseded_by: null,
    ...p,
  } as StudyRow;
}

describe("rootIdOf / isHistorical", () => {
  it("original is its own root", () => {
    expect(rootIdOf(study({ id: "a" }))).toBe("a");
    expect(rootIdOf(study({ id: "b", root_study_id: "a" }))).toBe("a");
  });
  it("historical iff superseded", () => {
    expect(isHistorical(study({ id: "a" }))).toBe(false);
    expect(isHistorical(study({ id: "a", superseded_at: "2026-07-01" }))).toBe(true);
  });
});

describe("buildAmendmentInsert", () => {
  const orig = study({
    id: "a", code: "BAN-001", title: "JAK study", sponsor: "Inflectra",
    nct: "NCT1", pi_name: "Hayes", site_id: "s1", custom_field_values: { irbType: "Central" },
    stage_key: "activation", committed_at: "2026-06-02",
  });
  it("copies identity, resets lifecycle, wires lineage", () => {
    const a = buildAmendmentInsert(orig, { code: "BAN-002", versionLabel: "v2", purpose: "" });
    expect(a.study_kind).toBe("amendment");
    expect(a.root_study_id).toBe("a");
    expect(a.amendment_of).toBe("a");
    expect(a.title).toBe("JAK study");
    expect(a.sponsor).toBe("Inflectra");
    expect(a.custom_field_values).toEqual({ irbType: "Central" });
    expect(a.stage_key).toBe("intake");
    expect(a.version_label).toBe("v2");
  });
  it("inherits the root for an amendment-of-an-amendment", () => {
    const v2 = study({ id: "b", root_study_id: "a", amendment_of: "a" });
    const a = buildAmendmentInsert(v2, { code: "BAN-003", versionLabel: "v3", purpose: "" });
    expect(a.root_study_id).toBe("a");
    expect(a.amendment_of).toBe("b");
  });
});

describe("lineageOf", () => {
  it("returns all versions of a root oldest-first", () => {
    const rows = [
      study({ id: "a", created_at: "2026-06-01" }),
      study({ id: "b", root_study_id: "a", created_at: "2026-06-10" }),
      study({ id: "z", created_at: "2026-06-05" }), // unrelated
    ];
    expect(lineageOf(rows, rows[1]).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("needsAmendmentPurpose", () => {
  it("required only for amendments lacking both label and purpose", () => {
    expect(needsAmendmentPurpose(study({ id: "a" }))).toBe(false);
    expect(needsAmendmentPurpose(study({ id: "a", study_kind: "amendment" }))).toBe(true);
    expect(needsAmendmentPurpose(study({ id: "a", study_kind: "amendment", version_label: "v2" }))).toBe(false);
    expect(needsAmendmentPurpose(study({ id: "a", study_kind: "amendment", amendment_purpose: "Budget amendment" }))).toBe(false);
  });
});

describe("visibleStudies", () => {
  const rows = [study({ id: "a" }), study({ id: "b", superseded_at: "2026-07-01" })];
  it("hides historical by default, shows on request", () => {
    expect(visibleStudies(rows, false).map((s) => s.id)).toEqual(["a"]);
    expect(visibleStudies(rows, true).map((s) => s.id)).toEqual(["a", "b"]);
  });
});
