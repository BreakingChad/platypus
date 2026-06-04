import type { FieldDefinitionRow } from "./types";

/** Intake-form helpers (Wave G) — pure, unit-tested.
 *
 *  A form holds a SNAPSHOT of its fields, frozen at activation, so a
 *  submission is always interpretable against the form version it was
 *  submitted on — even after the org reshapes its field definitions.
 */

export type FormFieldSnapshot = {
  key: string;
  label: string;
  section: string;
  field_type: string;
  required: boolean;
  /** Choice list for dropdown / multiselect fields. */
  values?: string[];
};

export type FormStatus = "draft" | "active" | "inactive" | "archived";

/** URL-safe slug from a title. */
export function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "form"
  );
}

/** Pick a slug that doesn't collide with the org's existing ones. */
export function uniqueSlug(title: string, taken: string[]): string {
  const base = slugify(title);
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/** Build the frozen snapshot for the selected keys from the org's live
 *  field definitions. Selected order wins; disabled/missing keys drop. */
export function snapshotFields(
  defs: FieldDefinitionRow[],
  selected: { key: string; required: boolean }[]
): FormFieldSnapshot[] {
  const byKey = new Map(defs.filter((d) => d.enabled).map((d) => [d.key, d]));
  const out: FormFieldSnapshot[] = [];
  for (const sel of selected) {
    const d = byKey.get(sel.key);
    if (!d) continue;
    const values = ((d.options as { values?: string[] } | null)?.values ?? []).filter(Boolean);
    out.push({
      key: d.key,
      label: d.label,
      section: d.section,
      field_type: d.field_type,
      required: sel.required,
      ...(values.length > 0 ? { values } : {}),
    });
  }
  return out;
}

/** Required-field validation for a public submission.
 *  Returns the LABELS of missing required fields (empty = valid). */
export function missingRequired(
  fields: FormFieldSnapshot[],
  values: Record<string, unknown>
): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.filter((x) => String(x).trim() !== "").length === 0);
    // booleans are never "missing" — unchecked is a valid answer
    if (f.field_type === "boolean") continue;
    if (empty) missing.push(f.label);
  }
  return missing;
}
