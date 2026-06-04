import type { StudyRow } from "./types";

/** Portfolio advanced filters (Wave L2) — pure, unit-tested.
 *
 *  The quick chips (stage, health) stay on the toolbar; everything else
 *  lives in the Filters modal and composes through this module. Empty
 *  arrays / undefined mean "no constraint".
 */

export type AdvFilters = {
  sponsors: string[];
  phases: string[];
  tas: string[];
  pis: string[];
  kinds: string[];
  priorities: string[];
  createdFrom?: string; // ISO date (yyyy-mm-dd)
  createdTo?: string;
  /** NCT registration: any | yes | no */
  nct: "any" | "yes" | "no";
};

export const EMPTY_ADV_FILTERS: AdvFilters = {
  sponsors: [],
  phases: [],
  tas: [],
  pis: [],
  kinds: [],
  priorities: [],
  nct: "any",
};

export function advFilterCount(f: AdvFilters): number {
  let n = 0;
  n += f.sponsors.length > 0 ? 1 : 0;
  n += f.phases.length > 0 ? 1 : 0;
  n += f.tas.length > 0 ? 1 : 0;
  n += f.pis.length > 0 ? 1 : 0;
  n += f.kinds.length > 0 ? 1 : 0;
  n += f.priorities.length > 0 ? 1 : 0;
  n += f.createdFrom ? 1 : 0;
  n += f.createdTo ? 1 : 0;
  n += f.nct !== "any" ? 1 : 0;
  return n;
}

export function matchesAdvFilters(row: StudyRow, f: AdvFilters): boolean {
  const has = (list: string[], v: string | null | undefined) =>
    list.length === 0 || (v != null && list.includes(v));
  if (!has(f.sponsors, row.sponsor)) return false;
  if (!has(f.phases, row.phase)) return false;
  if (!has(f.tas, row.therapeutic_area)) return false;
  if (!has(f.pis, row.pi_name)) return false;
  if (!has(f.kinds, row.study_kind)) return false;
  if (!has(f.priorities, row.priority)) return false;
  if (f.nct === "yes" && !row.nct) return false;
  if (f.nct === "no" && row.nct) return false;
  if (f.createdFrom && (!row.created_at || row.created_at.slice(0, 10) < f.createdFrom)) return false;
  if (f.createdTo && (!row.created_at || row.created_at.slice(0, 10) > f.createdTo)) return false;
  return true;
}

export type FilterChip = {
  key: string;
  label: string;
  /** Filters with this chip removed. */
  without: AdvFilters;
};

/** Human chips for the active-filters bar, each individually removable. */
export function describeAdvFilters(f: AdvFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const multi = (
    key: keyof Pick<AdvFilters, "sponsors" | "phases" | "tas" | "pis" | "kinds" | "priorities">,
    label: string
  ) => {
    for (const v of f[key]) {
      chips.push({
        key: `${key}:${v}`,
        label: `${label}: ${v}`,
        without: { ...f, [key]: f[key].filter((x) => x !== v) },
      });
    }
  };
  multi("sponsors", "Sponsor");
  multi("phases", "Phase");
  multi("tas", "TA");
  multi("pis", "PI");
  multi("kinds", "Kind");
  multi("priorities", "Priority");
  if (f.createdFrom)
    chips.push({ key: "createdFrom", label: `Created ≥ ${f.createdFrom}`, without: { ...f, createdFrom: undefined } });
  if (f.createdTo)
    chips.push({ key: "createdTo", label: `Created ≤ ${f.createdTo}`, without: { ...f, createdTo: undefined } });
  if (f.nct !== "any")
    chips.push({ key: "nct", label: f.nct === "yes" ? "Has NCT" : "No NCT", without: { ...f, nct: "any" } });
  return chips;
}

/** Distinct non-empty values of a study column, with counts, sorted by
 *  frequency then name — the option lists for the modal. */
export function optionCounts(
  rows: StudyRow[],
  get: (r: StudyRow) => string | null | undefined
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = get(r);
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
