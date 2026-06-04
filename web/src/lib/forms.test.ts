import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug, snapshotFields, missingRequired, type FormFieldSnapshot } from "./forms";
import type { FieldDefinitionRow } from "./types";

function def(partial: Partial<FieldDefinitionRow> & { key: string }): FieldDefinitionRow {
  return {
    id: `d_${partial.key}`,
    org_id: "org1",
    entity_type: "study",
    label: partial.key,
    section: "Organizational",
    field_type: "text",
    kind: "standard",
    enabled: true,
    required: false,
    lock_after_commit: false,
    edit_tier: "admin",
    position: 0,
    options: null,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("slugify / uniqueSlug", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("New Industry Study — Intake!")).toBe("new-industry-study-intake");
    expect(slugify("   ")).toBe("form");
  });
  it("dedupes against taken slugs", () => {
    expect(uniqueSlug("Intake", [])).toBe("intake");
    expect(uniqueSlug("Intake", ["intake"])).toBe("intake-2");
    expect(uniqueSlug("Intake", ["intake", "intake-2"])).toBe("intake-3");
  });
});

describe("snapshotFields", () => {
  const defs = [
    def({ key: "shortTitle", label: "Short title" }),
    def({ key: "irbType", label: "IRB type", field_type: "dropdown", options: { values: ["Central", "Local"] } }),
    def({ key: "ghost", enabled: false }),
  ];
  it("freezes label/type/choices and honors selection order + required", () => {
    const snap = snapshotFields(defs, [
      { key: "irbType", required: true },
      { key: "shortTitle", required: false },
    ]);
    expect(snap.map((s) => s.key)).toEqual(["irbType", "shortTitle"]);
    expect(snap[0].values).toEqual(["Central", "Local"]);
    expect(snap[0].required).toBe(true);
  });
  it("drops disabled and unknown keys", () => {
    const snap = snapshotFields(defs, [
      { key: "ghost", required: true },
      { key: "nope", required: true },
    ]);
    expect(snap).toEqual([]);
  });
});

describe("missingRequired", () => {
  const fields: FormFieldSnapshot[] = [
    { key: "a", label: "A", section: "S", field_type: "text", required: true },
    { key: "b", label: "B", section: "S", field_type: "multiselect", required: true, values: ["x", "y"] },
    { key: "c", label: "C", section: "S", field_type: "boolean", required: true },
    { key: "d", label: "D", section: "S", field_type: "text", required: false },
  ];
  it("flags empty strings and empty arrays; booleans never block", () => {
    expect(missingRequired(fields, { a: "  ", b: [] })).toEqual(["A", "B"]);
    expect(missingRequired(fields, { a: "ok", b: ["x"], c: false })).toEqual([]);
  });
  it("treats whitespace-only array entries as empty", () => {
    expect(missingRequired(fields, { a: "ok", b: [" "] })).toEqual(["B"]);
  });
});
