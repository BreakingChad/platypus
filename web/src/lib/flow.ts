import type { PipelineStageRow } from "./types";

/** Workstream flow layout (Wave P) — pure, unit-tested.
 *
 *  Turns the ordered pipeline stages into left-to-right COLUMNS. Adjacent
 *  stages sharing a non-null parallel_group collapse into one column (a lane
 *  that runs in parallel); everything else is its own sequential column.
 */

export type FlowColumn = {
  /** Group id for the column (null for a solo sequential stage). */
  group: number | null;
  stages: PipelineStageRow[];
};

export function flowColumns(stages: PipelineStageRow[]): FlowColumn[] {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const cols: FlowColumn[] = [];
  for (const s of sorted) {
    const g = s.parallel_group ?? null;
    const last = cols[cols.length - 1];
    if (g !== null && last && last.group === g) {
      last.stages.push(s);
    } else {
      cols.push({ group: g, stages: [s] });
    }
  }
  return cols;
}

/** Group id when merging a stage into a parallel lane with its predecessor.
 *  Reuses the predecessor's group if it has one, else mints a stable id from
 *  the predecessor's position. Returns the patches to apply. */
export function mergeWithPrevious(
  stages: PipelineStageRow[],
  stageId: string
): { id: string; parallel_group: number }[] {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((s) => s.id === stageId);
  if (i <= 0) return [];
  const prev = sorted[i - 1];
  const me = sorted[i];
  const group = prev.parallel_group ?? prev.position;
  const patches: { id: string; parallel_group: number }[] = [];
  if (prev.parallel_group !== group) patches.push({ id: prev.id, parallel_group: group });
  if (me.parallel_group !== group) patches.push({ id: me.id, parallel_group: group });
  return patches;
}

/** Whether a stage can merge up (has a predecessor it isn't already grouped with). */
export function canMergeWithPrevious(stages: PipelineStageRow[], stageId: string): boolean {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((s) => s.id === stageId);
  if (i <= 0) return false;
  const prev = sorted[i - 1];
  const me = sorted[i];
  return me.parallel_group === null || me.parallel_group !== (prev.parallel_group ?? prev.position) || prev.parallel_group === null;
}
