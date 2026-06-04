import type { FieldDefinitionRow, FieldType } from "./types";

/** fieldCatalog — the standard study-field catalog (June five-group spec).
 *
 *  "Load standard catalog" in the Field designer seeds a clinically literate
 *  study schema: the full five-group record — Organizational / Per-Site /
 *  Regulatory / Financial / Operational — with controlled-vocabulary choices
 *  where the spec defines them.
 *
 *  Idempotent by key. Existing fields are never renamed, re-sectioned,
 *  disabled, or have their permissions touched; they only gain:
 *    • choice lists they don't have yet (options.values)
 *    • a type upgrade from plain text to the spec'd dropdown (never the reverse)
 *    • the canonical position, so the record reads in spec order
 */

export type CatalogField = {
  key: string;
  label: string;
  section: string;
  field_type: FieldType;
  /** Controlled vocabulary for dropdown / multiselect fields. */
  values?: string[];
  position: number;
};

/* ── Controlled vocabularies (May 13 spec doc) ───────────────────────── */

/** 45 CFR 46 Subparts B/C/D + 21 CFR 50 Subpart D. */
export const VULNERABLE_POPULATIONS = [
  "None / General Adult Population",
  "Children / Minors",
  "Pregnant Participants",
  "Neonates",
  "Prisoners / Incarcerated Individuals",
  "Cognitively Impaired",
  "Individuals with Impaired Consent Capacity",
  "Economically Disadvantaged",
  "Educationally Disadvantaged",
  "Employees / Students",
  "Military Personnel",
  "Non-English Speaking Participants",
  "Seriously Ill / Terminally Ill",
  "Emergency Setting Participants",
  "Substance Use Disorder Population",
  "Elderly / Frail Adults",
  "Undocumented Individuals",
  "Indigenous / Tribal Populations",
  "Institutionalized Individuals",
  "Decisionally Impaired Psychiatric Population",
  "Wards of the State / Foster Children",
  "Other Vulnerable Population",
];

export const STUDY_INTERVENTIONS = [
  "Drug", "Device", "Biologic", "Behavioral", "Procedure", "Diagnostic", "Observational", "Other",
];
export const IRB_TYPES = ["Central", "Local"];
export const COI_STATUSES = ["Cleared", "Pending"];
export const FUNDING_SOURCES = ["Industry", "Federal", "Internal", "Philanthropy"];
export const CTA_STATUSES = ["Not started", "In negotiation", "Sponsor review", "Site review", "Executed"];
export const CA_STATUSES = ["Not started", "In progress", "Complete", "Not applicable"];
export const BUDGET_STATUSES = ["Not started", "In negotiation", "Approved", "Final"];
export const PAYMENT_TERMS = ["Milestone", "Invoice", "Net 30", "Net 60", "Net 90"];
export const TRAINING_STATUSES = ["Not started", "In progress", "Complete"];

/* ── The catalog ─────────────────────────────────────────────────────── */

export const STANDARD_STUDY_CATALOG: CatalogField[] = [
  /* Organizational */
  { key: "shortTitle", label: "Short title", section: "Organizational", field_type: "text", position: 1 },
  { key: "protocolNumber", label: "Protocol number", section: "Organizational", field_type: "text", position: 2 },
  { key: "protocolVersion", label: "Protocol version", section: "Organizational", field_type: "text", position: 3 },
  { key: "protocolDate", label: "Protocol date", section: "Organizational", field_type: "date", position: 4 },
  { key: "cro", label: "CRO", section: "Organizational", field_type: "text", position: 5 },
  { key: "disease", label: "Disease / indication", section: "Organizational", field_type: "text", position: 6 },
  { key: "intervention", label: "Intervention", section: "Organizational", field_type: "dropdown", values: STUDY_INTERVENTIONS, position: 7 },
  { key: "studyStartDate", label: "Study start date", section: "Organizational", field_type: "date", position: 8 },
  { key: "forecastCloseDate", label: "Forecast close date", section: "Organizational", field_type: "date", position: 9 },

  /* Per-Site */
  { key: "primarySiteName", label: "Primary study site", section: "Per-Site", field_type: "text", position: 10 },
  { key: "sponsorSiteNumber", label: "Sponsor site #", section: "Per-Site", field_type: "text", position: 11 },
  { key: "estimatedActivationDate", label: "Estimated activation date", section: "Per-Site", field_type: "date", position: 12 },
  { key: "activationDate", label: "Activation date", section: "Per-Site", field_type: "date", position: 13 },
  { key: "estimatedEndDate", label: "Estimated end date", section: "Per-Site", field_type: "date", position: 14 },
  { key: "closeoutDate", label: "Closeout date", section: "Per-Site", field_type: "date", position: 15 },
  { key: "sivDate", label: "SIV date", section: "Per-Site", field_type: "date", position: 16 },

  /* Regulatory */
  { key: "irbProtocolNumber", label: "IRB protocol #", section: "Regulatory", field_type: "text", position: 17 },
  { key: "irbType", label: "IRB type", section: "Regulatory", field_type: "dropdown", values: IRB_TYPES, position: 18 },
  { key: "irbName", label: "IRB name", section: "Regulatory", field_type: "text", position: 19 },
  { key: "indIdeNumber", label: "IND / IDE number", section: "Regulatory", field_type: "text", position: 20 },
  { key: "fdaRegulated", label: "FDA regulated", section: "Regulatory", field_type: "boolean", position: 21 },
  { key: "dsmbRequired", label: "DSMB required", section: "Regulatory", field_type: "boolean", position: 22 },
  { key: "coiStatus", label: "COI status", section: "Regulatory", field_type: "dropdown", values: COI_STATUSES, position: 23 },
  { key: "consentVersions", label: "Consent versions", section: "Regulatory", field_type: "list", position: 24 },
  { key: "vulnerablePopulation", label: "Vulnerable populations", section: "Regulatory", field_type: "multiselect", values: VULNERABLE_POPULATIONS, position: 25 },
  { key: "hipaaAuthRequired", label: "HIPAA authorization required", section: "Regulatory", field_type: "boolean", position: 26 },

  /* Financial */
  { key: "fundingSource", label: "Funding source", section: "Financial", field_type: "dropdown", values: FUNDING_SOURCES, position: 27 },
  { key: "ctaStatus", label: "CTA status", section: "Financial", field_type: "dropdown", values: CTA_STATUSES, position: 28 },
  { key: "caStatus", label: "Coverage analysis status", section: "Financial", field_type: "dropdown", values: CA_STATUSES, position: 29 },
  { key: "budgetStatus", label: "Budget status", section: "Financial", field_type: "dropdown", values: BUDGET_STATUSES, position: 30 },
  { key: "startupFees", label: "Startup fees", section: "Financial", field_type: "number", position: 31 },
  { key: "managementFees", label: "Management fees", section: "Financial", field_type: "number", position: 32 },
  { key: "screenFailureReimburse", label: "Screen-failure reimbursement", section: "Financial", field_type: "number", position: 33 },
  { key: "paymentTerms", label: "Payment terms", section: "Financial", field_type: "dropdown", values: PAYMENT_TERMS, position: 34 },
  { key: "costCenter", label: "Cost center", section: "Financial", field_type: "text", position: 35 },

  /* Operational */
  { key: "accrualGoal", label: "Enrollment target", section: "Operational", field_type: "number", position: 36 },
  { key: "investigationalProduct", label: "Investigational product", section: "Operational", field_type: "text", position: 37 },
  { key: "pharmacyRequired", label: "Pharmacy required", section: "Operational", field_type: "boolean", position: 38 },
  { key: "imagingRequired", label: "Imaging required", section: "Operational", field_type: "boolean", position: 39 },
  { key: "centralLabRequired", label: "Central lab required", section: "Operational", field_type: "boolean", position: 40 },
  { key: "edcPlatform", label: "EDC platform", section: "Operational", field_type: "text", position: 41 },
  { key: "ctmsId", label: "CTMS ID", section: "Operational", field_type: "text", position: 42 },
  { key: "emrId", label: "EMR ID", section: "Operational", field_type: "text", position: 43 },
  { key: "trainingStatus", label: "Training status", section: "Operational", field_type: "dropdown", values: TRAINING_STATUSES, position: 44 },
];

/* ── Diff (pure — unit tested) ───────────────────────────────────────── */

export type CatalogUpdate = {
  id: string;
  key: string;
  patch: Partial<FieldDefinitionRow>;
};

export type CatalogDiff = {
  toInsert: CatalogField[];
  toUpdate: CatalogUpdate[];
  /** Convenience counts for the confirm dialog. */
  counts: { newFields: number; optionsFilled: number; typeUpgrades: number; repositioned: number };
};

const optionValues = (row: FieldDefinitionRow): string[] =>
  ((row.options as { values?: string[] } | null)?.values ?? []).filter(Boolean);

/** Compare the org's current study fields against the catalog.
 *  Never patches label, section, enabled, required, lock or edit tier. */
export function diffCatalog(
  existing: FieldDefinitionRow[],
  catalog: CatalogField[] = STANDARD_STUDY_CATALOG
): CatalogDiff {
  const byKey = new Map(
    existing.filter((r) => r.entity_type === "study").map((r) => [r.key, r])
  );
  const toInsert: CatalogField[] = [];
  const toUpdate: CatalogUpdate[] = [];
  let optionsFilled = 0, typeUpgrades = 0, repositioned = 0;

  for (const cf of catalog) {
    const row = byKey.get(cf.key);
    if (!row) {
      toInsert.push(cf);
      continue;
    }
    const patch: Partial<FieldDefinitionRow> = {};
    if (cf.values && cf.values.length > 0 && optionValues(row).length === 0) {
      patch.options = { values: cf.values };
      optionsFilled++;
    }
    // Upgrade plain text to the spec'd richer type; never downgrade,
    // never override a deliberate non-text choice.
    if (row.field_type !== cf.field_type && row.field_type === "text") {
      patch.field_type = cf.field_type;
      typeUpgrades++;
    }
    // Normalize standard rows to canonical spec order (also heals the
    // position-9999 rows left by section moves). Custom fields untouched.
    if (row.kind === "standard" && row.position !== cf.position) {
      patch.position = cf.position;
      repositioned++;
    }
    if (Object.keys(patch).length > 0) toUpdate.push({ id: row.id, key: cf.key, patch });
  }

  return {
    toInsert,
    toUpdate,
    counts: { newFields: toInsert.length, optionsFilled, typeUpgrades, repositioned },
  };
}

/* ── Apply (direct supabase writes — per-row error capture) ──────────── */

export type CatalogApplyResult = {
  inserted: number;
  updated: number;
  failed: { key: string; message: string }[];
};

/** New-enum types: these need migration 0019 applied before the DB enum
 *  accepts them. Inserted as a separate batch so a missing migration only
 *  costs those rows, with a precise error — never the whole catalog. */
const NEW_ENUM_TYPES: FieldType[] = ["multiselect", "list"];

export async function applyCatalog(
  sb: any,
  orgId: string,
  diff: CatalogDiff
): Promise<CatalogApplyResult> {
  const result: CatalogApplyResult = { inserted: 0, updated: 0, failed: [] };

  const rowFor = (cf: CatalogField) => ({
    org_id: orgId,
    entity_type: "study",
    key: cf.key,
    label: cf.label,
    section: cf.section,
    field_type: cf.field_type,
    kind: "standard",
    enabled: true,
    required: false,
    lock_after_commit: false,
    edit_tier: "admin",
    position: cf.position,
    options: cf.values && cf.values.length > 0 ? { values: cf.values } : null,
  });

  const safe = diff.toInsert.filter((f) => !NEW_ENUM_TYPES.includes(f.field_type));
  const enumDependent = diff.toInsert.filter((f) => NEW_ENUM_TYPES.includes(f.field_type));

  for (const batch of [safe, enumDependent]) {
    if (batch.length === 0) continue;
    const { error } = await sb.from("field_definitions").insert(batch.map(rowFor));
    if (error) {
      // Batch failed — retry rows one at a time so one bad row doesn't
      // take its neighbors down.
      for (const cf of batch) {
        const { error: rowError } = await sb.from("field_definitions").insert(rowFor(cf));
        if (rowError) result.failed.push({ key: cf.key, message: rowError.message });
        else result.inserted++;
      }
    } else {
      result.inserted += batch.length;
    }
  }

  for (const u of diff.toUpdate) {
    const { error } = await sb.from("field_definitions").update(u.patch).eq("id", u.id);
    if (error) result.failed.push({ key: u.key, message: error.message });
    else result.updated++;
  }

  return result;
}
