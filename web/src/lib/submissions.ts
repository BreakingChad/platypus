import type { FieldDefinitionRow, StudyRow } from "./types";

/** Submission → study helpers (Wave G3) — pure, unit-tested.
 *
 *  "Commit to Intake" turns an external form submission into a study record
 *  sitting on the intake stage. These are the typed-column maps and builders
 *  that make that translation — single source of truth, shared with the
 *  internal "+ New Intake" modal.
 */

/** Field keys that map to typed columns on `studies` (everything else lands
 *  in custom_field_values JSONB). */
export const TYPED_COLUMN_KEYS = new Set<string>([
  "shortTitle", // → title
  "sponsor",
  "nct",
  "therapeuticArea",
  "phase",
  "piName",
  "studyKind",
  "priority",
]);

export const KEY_TO_COLUMN: Record<string, keyof StudyRow> = {
  shortTitle: "title",
  sponsor: "sponsor",
  nct: "nct",
  therapeuticArea: "therapeutic_area",
  phase: "phase",
  piName: "pi_name",
  studyKind: "study_kind",
  priority: "priority",
};

/** Next code for a prefix: highest numeric suffix + 1, collision-safe. */
export function nextStudyCode(existingCodes: string[], prefix: string): string {
  const taken = new Set(existingCodes);
  const re = new RegExp(
    "^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$"
  );
  let max = 0;
  for (const c of existingCodes) {
    const m = re.exec(c);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  let next = max + 1;
  while (taken.has(`${prefix}-${String(next).padStart(3, "0")}`)) next += 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/** Split submitted values into a `studies` insert: typed columns where the
 *  schema has them, custom_field_values for the rest. Only keys present in
 *  the org's enabled study fields are accepted (defense against stale or
 *  hand-crafted submissions). */
export function buildStudyInsert(opts: {
  orgId: string;
  code: string;
  stageKey: string;
  values: Record<string, unknown>;
  studyFields: FieldDefinitionRow[];
  fallbackTitle?: string;
}): Partial<StudyRow> {
  const title =
    (typeof opts.values["shortTitle"] === "string" && (opts.values["shortTitle"] as string).trim()) ||
    (opts.fallbackTitle ?? "").trim() ||
    "Untitled study";

  const typed: Partial<StudyRow> = {
    org_id: opts.orgId,
    code: opts.code,
    title,
    stage_key: opts.stageKey,
    intake_status: "submitted",
    intake_date: new Date().toISOString(),
  };
  const custom: Record<string, unknown> = {};

  for (const f of opts.studyFields) {
    if (!f.enabled || f.entity_type !== "study") continue;
    const v = opts.values[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (TYPED_COLUMN_KEYS.has(f.key)) {
      const col = KEY_TO_COLUMN[f.key];
      if (col && col !== "title") (typed as any)[col] = v;
    } else {
      custom[f.key] = v;
    }
  }
  (typed as any).custom_field_values = custom;
  return typed;
}
