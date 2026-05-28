import type { ComponentType } from "react";
import { QuickStartBlock } from "./QuickStartBlock";
import { KpiStripBlock } from "./KpiStripBlock";
import { StageBreakdownBlock } from "./StageBreakdownBlock";
import { RecentActivityBlock } from "./RecentActivityBlock";
import { SetupHubBlock } from "./SetupHubBlock";
import { WorkTilesBlock } from "./WorkTilesBlock";
import { SetupChecklistBlock } from "./SetupChecklistBlock";
import { TasksDueBlock } from "./TasksDueBlock";
import { AtRiskStudiesBlock } from "./AtRiskStudiesBlock";
import { DirectorsPulseBlock } from "./DirectorsPulseBlock";
import { CycleTimeBlock } from "./CycleTimeBlock";

/** Block registry — every block the PageLayoutDesigner can place onto a page.
 *
 *  Each block component takes a single `context` prop that carries:
 *    - settings: the per-instance settings object from the layout config
 *    - navigate: (hash: string) => void
 *  The shape of the context is defined per-block in its module.
 *
 *  Adding a new block:
 *    1. Build it in a sibling file with a Block component accepting BlockContext.
 *    2. Import + register here.
 *    3. Reference its key in PAGE_REGISTRY.allowedBlocks in navConfig.ts.
 */

export type BlockContext = {
  settings: Record<string, unknown>;
  navigate: (hash: string) => void;
};

export type BlockRegistryEntry = {
  key: string;
  label: string;
  description: string;
  icon: string;
  component: ComponentType<{ ctx: BlockContext }>;
  /** Default settings applied when the block is added to a layout. */
  defaultSettings?: Record<string, unknown>;
  /** Optional settings schema description (used by the designer to render
   *  per-block settings inputs). */
  settingsSchema?: {
    key: string;
    label: string;
    kind: "number" | "text" | "boolean";
    min?: number;
    max?: number;
    description?: string;
  }[];
};

export const BLOCK_REGISTRY: Record<string, BlockRegistryEntry> = {
  "quick-start": {
    key: "quick-start",
    label: "Quick start nudge",
    description: "Visible only when the org has <3 studies. Loads 8 demo studies in one click.",
    icon: "layers",
    component: QuickStartBlock,
  },
  "setup-checklist": {
    key: "setup-checklist",
    label: "Setup checklist",
    description: "Admin-only walkthrough — org name, stages, fields, teams, access roles, first study. Hides once everything's done.",
    icon: "check",
    component: SetupChecklistBlock,
  },
  "tasks-due": {
    key: "tasks-due",
    label: "Tasks due today",
    description: "Your assigned + role-tasks that are due today or overdue. Hides when empty.",
    icon: "alert",
    component: TasksDueBlock,
  },
  "at-risk-studies": {
    key: "at-risk-studies",
    label: "At-risk studies",
    description: "Every yellow / red study across the portfolio, sorted by urgency. Hides when nothing is at risk.",
    icon: "alert",
    component: AtRiskStudiesBlock,
  },
  "directors-pulse": {
    key: "directors-pulse",
    label: "Director's pulse",
    description: "Auto-generated one-paragraph state-of-the-portfolio with sentiment tone and drill-through chips.",
    icon: "info",
    component: DirectorsPulseBlock,
  },
  "cycle-time": {
    key: "cycle-time",
    label: "Cycle time by stage",
    description: "Per-stage average dwell time vs target, computed from audit_events stage_changed entries.",
    icon: "workflow",
    component: CycleTimeBlock,
  },
  "kpi-strip": {
    key: "kpi-strip",
    label: "KPI strip",
    description: "Four metric chips — open studies, high priority, closed, unassigned-stage.",
    icon: "alert",
    component: KpiStripBlock,
  },
  "stage-breakdown": {
    key: "stage-breakdown",
    label: "Stage breakdown",
    description: "Stacked bar of open studies by stage with click-through to pipeline.",
    icon: "layers",
    component: StageBreakdownBlock,
  },
  "recent-activity": {
    key: "recent-activity",
    label: "Recently touched",
    description: "Most-recently-updated studies. Click into the study.",
    icon: "inbox",
    component: RecentActivityBlock,
    defaultSettings: { limit: 5 },
    settingsSchema: [
      {
        key: "limit",
        label: "Number of rows",
        kind: "number",
        min: 1,
        max: 25,
        description: "How many studies to surface.",
      },
    ],
  },
  "setup-hub": {
    key: "setup-hub",
    label: "Setup hub",
    description: "Grid of admin-editable configuration surfaces.",
    icon: "settings",
    component: SetupHubBlock,
  },
  "work-tiles": {
    key: "work-tiles",
    label: "Work surfaces tiles",
    description: "Quick links to Studies / Pipeline / Inbox / Members.",
    icon: "folder",
    component: WorkTilesBlock,
  },
};

export function blockEntry(key: string): BlockRegistryEntry | undefined {
  return BLOCK_REGISTRY[key];
}
