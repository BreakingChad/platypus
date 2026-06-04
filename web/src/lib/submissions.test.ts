import { describe, it, expect } from "vitest";
import { nextStudyCode, buildStudyInsert } from "./submissions";
import type { FieldDefinitionRow } from "./types";

function def(key: string, extra: Partial<FieldDefinitionRow> = {}): FieldDefinitionRow {
  return {
    id: `d_${key}`, org_id: "org1", entity_type: "study", key, label: key,
    section: "Organizational", field_type: "text", kind: "standard",
    enabled: true, required: false, lock_after_commit: false,
    edit_tier: "admin", position: 0, options: null, created_at: "", updated_at: "",
    ...extra,
  };
}

describe("nextStudyCode", () => {
  it("starts at 001 for a fresh prefix", () => {
    expect(nextStudyCode([], "BAN")).toBe("BAN-001");
  });
  it("continues from the highest suffix, ignoring other prefixes", () => {
    expect(nextStudyCode(["BAN-001", "BAN-007", "XYZ-100"], "BAN")).toBe("BAN-008");
  });
  it("walks past collisions", () => {
    expect(nextStudyCode(["BAN-001", "BAN-002", "BAN-003"], "BAN")).toBe("BAN-004");
  });
  it("escapes regex specials in prefixes", () => {
    expect(nextStudyCode(["A.B-004"], "A.B")).toBe("A.B-005");
  });
});

describe("buildStudyInsert", () => {
  const fields = [
    def("shortTitle"),
    def("sponsor"),
    def("irbType", { field_type: "dropdown" }),
    def("accrualGoal", { field_type: "number", section: "Operational" }),
    def("disabledField", { enabled: false }),
  ];

  it("maps typed columns and routes the rest to custom_field_values", () => {
    const row = buildStudyInsert({
      orgId: "org1", code: "BAN-009", stageKey: "intake",
      values: { shortTitle: "BEACON-3", sponsor: "AbbVie", irbType: "Central", accrualGoal: 24 },
      studyFields: fields,
    });
    expect(row.title).toBe("BEACON-3");
    expect((row as any).sponsor).toBe("AbbVie");
    expect((row as any).custom_field_values).toEqual({ irbType: "Central", accrualGoal: 24 });
    expect(row.stage_key).toBe("intake");
    expect(row.intake_status).toBe("submitted");
  });

  it("falls back on the provided title, then 'Untitled study'", () => {
    const a = buildStudyInsert({
      orgId: "o", code: "C-1", stageKey: "intake",
      values: {}, studyFields: fields, fallbackTitle: "New industry study — Jane",
    });
    expect(a.title).toBe("New industry study — Jane");
    const b = buildStudyInsert({ orgId: "o", code: "C-1", stageKey: "intake", values: {}, studyFields: fields });
    expect(b.title).toBe("Untitled study");
  });

  it("drops empty values, unknown keys, and disabled fields", () => {
    const row = buildStudyInsert({
      orgId: "o", code: "C-1", stageKey: "intake",
      values: { sponsor: "", madeUpKey: "x", disabledField: "y" },
      studyFields: fields,
    });
    expect((row as any).sponsor).toBeUndefined();
    expect((row as any).custom_field_values).toEqual({});
  });
});
