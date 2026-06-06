import { describe, it, expect } from "vitest";
import {
  STANDARD_STUDY_CATALOG,
  VULNERABLE_POPULATIONS,
  diffCatalog,
  type CatalogField,
} from "./fieldCatalog";
import type { FieldDefinitionRow } from "./types";

const SECTIONS = ["Organizational", "Per-Site", "Regulatory", "Financial", "Operational"];

/** Build a FieldDefinitionRow the way migrations 0002/0005b seeded them. */
function seededRow(partial: Partial<FieldDefinitionRow> & { key: string }): FieldDefinitionRow {
  return {
    id: `row_${partial.key}`,
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

/** The 22 study fields exactly as the 0005b seed left them (no options). */
const MIGRATION_SEED: FieldDefinitionRow[] = [
  ["shortTitle", "Organizational", "text", 1],
  ["protocolNumber", "Organizational", "text", 2],
  ["protocolVersion", "Organizational", "text", 3],
  ["protocolDate", "Organizational", "date", 4],
  ["cro", "Organizational", "text", 5],
  ["disease", "Organizational", "text", 6],
  ["intervention", "Organizational", "text", 7],
  ["primarySiteName", "Per-Site", "text", 8],
  ["sponsorSiteNumber", "Per-Site", "text", 9],
  ["estimatedActivationDate", "Per-Site", "date", 10],
  ["irbProtocolNumber", "Regulatory", "text", 11],
  ["irbType", "Regulatory", "dropdown", 12],
  ["irbName", "Regulatory", "text", 13],
  ["indIdeNumber", "Regulatory", "text", 14],
  ["fdaRegulated", "Regulatory", "boolean", 15],
  ["fundingSource", "Financial", "text", 16],
  ["startupFees", "Financial", "number", 17],
  ["costCenter", "Financial", "text", 18],
  ["paymentTerms", "Financial", "text", 19],
  ["accrualGoal", "Operational", "number", 20],
  ["edcPlatform", "Operational", "text", 21],
].map(([key, section, field_type, position]) =>
  seededRow({
    key: key as string,
    section: section as string,
    field_type: field_type as FieldDefinitionRow["field_type"],
    position: position as number,
  })
);

/** Simulate applying a diff so we can assert idempotency. */
function simulateApply(existing: FieldDefinitionRow[], catalog?: CatalogField[]): FieldDefinitionRow[] {
  const diff = diffCatalog(existing, catalog);
  const next = existing.map((r) => {
    const u = diff.toUpdate.find((x) => x.id === r.id);
    return u ? ({ ...r, ...u.patch } as FieldDefinitionRow) : r;
  });
  for (const cf of diff.toInsert) {
    next.push(
      seededRow({
        key: cf.key,
        label: cf.label,
        section: cf.section,
        field_type: cf.field_type,
        position: cf.position,
        options: cf.values ? { values: cf.values } : null,
      })
    );
  }
  return next;
}

describe("STANDARD_STUDY_CATALOG integrity", () => {
  it("has unique keys and unique positions", () => {
    const keys = STANDARD_STUDY_CATALOG.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const positions = STANDARD_STUDY_CATALOG.map((f) => f.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("covers all five spec sections and only those", () => {
    const sections = new Set(STANDARD_STUDY_CATALOG.map((f) => f.section));
    expect([...sections].sort()).toEqual([...SECTIONS].sort());
  });

  it("every dropdown and multiselect ships with choices", () => {
    for (const f of STANDARD_STUDY_CATALOG) {
      if (f.field_type === "dropdown" || f.field_type === "multiselect") {
        expect(f.values && f.values.length > 0, `${f.key} needs values`).toBe(true);
      }
    }
  });

  it("includes the spec'd marquee fields", () => {
    const byKey = Object.fromEntries(STANDARD_STUDY_CATALOG.map((f) => [f.key, f]));
    expect(byKey.vulnerablePopulation.field_type).toBe("multiselect");
    expect(VULNERABLE_POPULATIONS.length).toBeGreaterThanOrEqual(20);
    expect(byKey.consentVersions.field_type).toBe("list");
    expect(byKey.sivDate.field_type).toBe("date");
    for (const k of ["ctaStatus", "caStatus", "budgetStatus"]) {
      expect(byKey[k].field_type).toBe("dropdown");
    }
    for (const k of ["ctmsId", "emrId", "edcPlatform"]) {
      expect(byKey[k]).toBeTruthy();
    }
  });

  it("positions ascend in section order (sections never interleave)", () => {
    let lastSectionIndex = 0;
    for (const f of [...STANDARD_STUDY_CATALOG].sort((a, b) => a.position - b.position)) {
      const idx = SECTIONS.indexOf(f.section);
      expect(idx).toBeGreaterThanOrEqual(lastSectionIndex);
      lastSectionIndex = idx;
    }
  });
});

describe("diffCatalog", () => {
  it("inserts everything on an empty org", () => {
    const diff = diffCatalog([]);
    expect(diff.toInsert.length).toBe(STANDARD_STUDY_CATALOG.length);
    expect(diff.toUpdate.length).toBe(0);
  });

  it("on a migration-seeded org: inserts only the missing fields", () => {
    const diff = diffCatalog(MIGRATION_SEED);
    expect(diff.toInsert.length).toBe(STANDARD_STUDY_CATALOG.length - MIGRATION_SEED.length);
    const insertKeys = diff.toInsert.map((f) => f.key);
    expect(insertKeys).toContain("vulnerablePopulation");
    expect(insertKeys).toContain("consentVersions");
    expect(insertKeys).not.toContain("shortTitle");
  });

  it("fills choices on seeded dropdowns that have none", () => {
    const diff = diffCatalog(MIGRATION_SEED);
    const irb = diff.toUpdate.find((u) => u.key === "irbType");
    expect((irb?.patch.options as { values: string[] }).values).toEqual(["Central", "Local"]);
  });

  it("does not overwrite choices an admin already set", () => {
    const customized = MIGRATION_SEED.map((r) =>
      r.key === "irbType" ? { ...r, options: { values: ["Central", "Local", "sIRB"] } } : r
    );
    const diff = diffCatalog(customized);
    expect(diff.toUpdate.find((u) => u.key === "irbType" && u.patch.options)).toBeUndefined();
  });

  it("upgrades text to the spec'd dropdown, never the reverse", () => {
    const diff = diffCatalog(MIGRATION_SEED);
    const funding = diff.toUpdate.find((u) => u.key === "fundingSource");
    expect(funding?.patch.field_type).toBe("dropdown");
    // An admin's deliberate non-text choice is left alone:
    const customized = MIGRATION_SEED.map((r) =>
      r.key === "fundingSource" ? { ...r, field_type: "boolean" as const } : r
    );
    const diff2 = diffCatalog(customized);
    expect(diff2.toUpdate.find((u) => u.key === "fundingSource" && u.patch.field_type)).toBeUndefined();
  });

  it("normalizes standard positions but leaves custom fields alone", () => {
    const withCustom = [
      ...MIGRATION_SEED,
      seededRow({ key: "cf_x_sponsor_portal", kind: "custom", section: "Organizational", position: 9999 }),
    ];
    const diff = diffCatalog(withCustom);
    expect(diff.toUpdate.find((u) => u.key === "cf_x_sponsor_portal")).toBeUndefined();
    const moved = diff.toUpdate.find((u) => u.key === "primarySiteName");
    expect(moved?.patch.position).toBe(10);
  });

  it("never patches label, section, enabled, required, or edit tier", () => {
    const renamed = MIGRATION_SEED.map((r) =>
      r.key === "disease" ? { ...r, label: "Condition", section: "Operational", enabled: false } : r
    );
    const diff = diffCatalog(renamed);
    for (const u of diff.toUpdate) {
      expect(u.patch.label).toBeUndefined();
      expect(u.patch.section).toBeUndefined();
      expect(u.patch.enabled).toBeUndefined();
      expect(u.patch.required).toBeUndefined();
      expect(u.patch.edit_tier).toBeUndefined();
    }
  });

  it("is idempotent: applying twice yields an empty second diff", () => {
    const afterFirst = simulateApply(MIGRATION_SEED);
    const second = diffCatalog(afterFirst);
    expect(second.toInsert.length).toBe(0);
    expect(second.toUpdate.length).toBe(0);
  });

  it("ignores site-entity rows entirely", () => {
    const siteRow = seededRow({ key: "shortTitle", entity_type: "site", position: 50 });
    const diff = diffCatalog([siteRow]);
    expect(diff.toInsert.length).toBe(STANDARD_STUDY_CATALOG.length);
    expect(diff.toUpdate.length).toBe(0);
  });
});
