import { describe, it, expect } from "vitest";
import {
  EMPTY_ADV_FILTERS,
  advFilterCount,
  matchesAdvFilters,
  describeAdvFilters,
  optionCounts,
  type AdvFilters,
} from "./portfolioFilters";
import type { StudyRow } from "./types";

function study(p: Partial<StudyRow>): StudyRow {
  return {
    id: "s1", org_id: "o", code: "X-001", title: "T", stage_key: "intake",
    sponsor: null, nct: null, therapeutic_area: null, phase: null, pi_name: null,
    study_kind: null, priority: "normal", closed: false, committed_at: null,
    created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
    ...p,
  } as StudyRow;
}

describe("matchesAdvFilters", () => {
  const f: AdvFilters = { ...EMPTY_ADV_FILTERS, sponsors: ["AbbVie"], nct: "yes" };
  it("empty filters match everything", () => {
    expect(matchesAdvFilters(study({}), EMPTY_ADV_FILTERS)).toBe(true);
  });
  it("multi-selects are OR within, AND across", () => {
    expect(matchesAdvFilters(study({ sponsor: "AbbVie", nct: "NCT1" }), f)).toBe(true);
    expect(matchesAdvFilters(study({ sponsor: "Pfizer", nct: "NCT1" }), f)).toBe(false);
    expect(matchesAdvFilters(study({ sponsor: "AbbVie", nct: null }), f)).toBe(false);
  });
  it("nct=no excludes registered studies", () => {
    const g = { ...EMPTY_ADV_FILTERS, nct: "no" as const };
    expect(matchesAdvFilters(study({ nct: "NCT1" }), g)).toBe(false);
    expect(matchesAdvFilters(study({ nct: null }), g)).toBe(true);
  });
  it("created range is inclusive on date strings", () => {
    const g = { ...EMPTY_ADV_FILTERS, createdFrom: "2026-06-01", createdTo: "2026-06-30" };
    expect(matchesAdvFilters(study({ created_at: "2026-06-01T10:00:00Z" }), g)).toBe(true);
    expect(matchesAdvFilters(study({ created_at: "2026-05-31T23:00:00Z" }), g)).toBe(false);
    expect(matchesAdvFilters(study({ created_at: "2026-07-01T00:00:00Z" }), g)).toBe(false);
  });
});

describe("advFilterCount / describeAdvFilters", () => {
  it("counts active criteria, not values", () => {
    expect(advFilterCount(EMPTY_ADV_FILTERS)).toBe(0);
    expect(
      advFilterCount({ ...EMPTY_ADV_FILTERS, sponsors: ["A", "B"], nct: "yes", createdFrom: "2026-01-01" })
    ).toBe(3);
  });
  it("chips remove exactly their own value", () => {
    const f = { ...EMPTY_ADV_FILTERS, sponsors: ["A", "B"], nct: "yes" as const };
    const chips = describeAdvFilters(f);
    expect(chips.map((c) => c.label)).toEqual(["Sponsor: A", "Sponsor: B", "Has NCT"]);
    expect(chips[0].without.sponsors).toEqual(["B"]);
    expect(chips[2].without.nct).toBe("any");
  });
});

describe("optionCounts", () => {
  it("counts distinct values, frequency then name", () => {
    const rows = [study({ sponsor: "B" }), study({ sponsor: "A" }), study({ sponsor: "B" }), study({ sponsor: null })];
    expect(optionCounts(rows, (r) => r.sponsor)).toEqual([
      { value: "B", count: 2 },
      { value: "A", count: 1 },
    ]);
  });
});
