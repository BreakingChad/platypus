import type { StudyRow } from "./types";

/** Amendments as parallel tracks (Wave O) — pure helpers, unit-tested.
 *
 *  An amendment is a NEW study row that copies the predecessor's identity,
 *  carries `study_kind="amendment"`, points `root_study_id` at the lineage
 *  root and `amendment_of` at its immediate predecessor, and runs its own
 *  status pipeline from intake. The predecessor is only locked (superseded)
 *  when a later version explicitly takes over.
 */

/** A study is historical once a later version has superseded it. */
export function isHistorical(s: StudyRow): boolean {
  return Boolean(s.superseded_at);
}

/** The root id of a study's lineage (itself if it is the original). */
export function rootIdOf(s: StudyRow): string {
  return s.root_study_id ?? s.id;
}

/** Build the insert for a new amendment off `original`. Copies identity +
 *  custom fields; resets lifecycle to intake; wires the lineage.
 *  NOTE: studies has no created_by column — the creator is recorded by the
 *  amendment_created audit event (sending the field broke every insert). */
export function buildAmendmentInsert(
  original: StudyRow,
  opts: { code: string; versionLabel: string; purpose: string }
): Partial<StudyRow> {
  return {
    org_id: original.org_id,
    code: opts.code,
    title: original.title,
    nct: original.nct,
    sponsor: original.sponsor,
    therapeutic_area: original.therapeutic_area,
    phase: original.phase,
    pi_name: original.pi_name,
    site_id: original.site_id,
    priority: original.priority,
    study_kind: "amendment",
    root_study_id: rootIdOf(original),
    amendment_of: original.id,
    version_label: opts.versionLabel.trim() || null,
    amendment_purpose: opts.purpose.trim() || null,
    custom_field_values: { ...(original.custom_field_values ?? {}) },
    stage_key: "intake",
    intake_status: "submitted",
    intake_date: new Date().toISOString(),
  } as Partial<StudyRow>;
}

/** Every version sharing a root, oldest first (original, then amendments by
 *  creation). Includes the study itself. */
export function lineageOf(rows: StudyRow[], study: StudyRow): StudyRow[] {
  const root = rootIdOf(study);
  return rows
    .filter((s) => rootIdOf(s) === root)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

/** An amendment needs an explanation: required only when there's no
 *  version-label change to speak for it. Returns true if it's missing. */
export function needsAmendmentPurpose(s: StudyRow): boolean {
  return s.study_kind === "amendment" && !s.version_label && !s.amendment_purpose;
}

/** Default list visibility: hide superseded historical versions unless asked.
 *  Pure so the list + search share one rule. */
export function visibleStudies(rows: StudyRow[], showHistorical: boolean): StudyRow[] {
  return showHistorical ? rows : rows.filter((s) => !isHistorical(s));
}

/** Starter amendment-purpose options (orgs extend). Used when no version
 *  number changes — budget/contract/PI/etc. */
export const AMENDMENT_PURPOSES = [
  "Budget amendment",
  "Contract amendment",
  "PI change",
  "Site change",
  "ICF update",
  "Administrative",
  "Other",
];
