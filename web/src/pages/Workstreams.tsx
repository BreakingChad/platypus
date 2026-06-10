import { useEffect, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { PipelineRow } from "../lib/types";
import { PageHeader } from "../components/ui/PageHeader";
import { Icon } from "../components/ui/Icon";
import { StageDesigner } from "./StageDesigner";
import { WorkStreamBuilder } from "./WorkStreamBuilder";

/** Workstreams — ONE design surface, two views (Chad, 2026-06-09).
 *
 *  A workstream is a stage pipeline (the path) + task flows (the work on the
 *  path). They share a lifted pipeline selection: pick "Industry-sponsored"
 *  once, flip between its spine and its flows without re-selecting.
 *
 *  Stage editing stays behind its own tab — deliberately one click away from
 *  daily task-flow iteration, because reshaping the backbone affects health
 *  targets and cross-study metric comparability (high blast radius).
 *
 *  Both legacy hashes still work and land on the right tab:
 *    #/settings/stages        → Stage pipeline tab
 *    #/settings/work-streams  → Task flows tab
 */
export function Workstreams({ initialTab }: { initialTab?: "stages" | "flows" }) {
  const pipelines = useOrgTable<PipelineRow>("pipelines", { orderBy: "position", realtime: true });
  const active = pipelines.rows.filter((p) => p.status === "active");

  // Shared pipeline selection — survives tab flips.
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  useEffect(() => {
    if (pipelineId && active.some((p) => p.id === pipelineId)) return;
    setPipelineId(active[0]?.id ?? null);
  }, [active, pipelineId]);

  const [tab, setTab] = useState<"stages" | "flows">(initialTab ?? "stages");
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const selectedName = active.find((p) => p.id === pipelineId)?.name ?? null;

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Workstreams"
        subtitle="One operating design, two views: the stage pipeline studies move through, and the task flows that fire at each stage. Your pipeline choice carries across both."
        actions={
          <span
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 text-emerald-700 px-2.5 py-1.5 text-xs font-semibold"
            title="There's no save button — every change is written instantly"
          >
            <Icon name="check" size={13} /> Auto-saved
          </span>
        }
      />

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {([
            ["stages", "Stage pipeline", "workflow"],
            ["flows", "Task flows", "layers"],
          ] as const).map(([k, label, icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={
                "px-3 py-2 rounded-md text-sm font-semibold transition inline-flex items-center gap-1.5 " +
                (tab === k
                  ? "bg-brand-gradient text-white shadow"
                  : "text-slate-600 hover:text-slate-900")
              }
              aria-pressed={tab === k}
            >
              <Icon name={icon} size={13} /> {label}
            </button>
          ))}
        </div>
        {selectedName && (
          <span className="text-xs text-slate-500">
            Editing <span className="font-semibold text-slate-700">{selectedName}</span>
            {tab === "stages" ? " — its stages" : " — its task flows"}
          </span>
        )}
      </div>

      <div className="mt-2">
        {tab === "stages" ? (
          <StageDesigner embedded pipelineId={pipelineId} onPipelineChange={setPipelineId} />
        ) : (
          <WorkStreamBuilder embedded pipelineId={pipelineId} onPipelineChange={setPipelineId} />
        )}
      </div>
    </div>
  );
}
