import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import type { StudyRow, PipelineStageRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** PipelineView — kanban by stage. Columns from pipeline_stages, cards from
 *  studies. Admins can drag cards between columns to advance/regress (writes
 *  stage_key to the studies row). Click a card to open the study detail.
 *  Closed studies are hidden by default.
 */
export function PipelineView({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", {
    orderBy: "position",
    realtime: true,
  });
  const studies = useOrgTable<StudyRow>("studies", {
    orderBy: "created_at",
    realtime: true,
  });

  const [showClosed, setShowClosed] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);

  const studiesByStage = useMemo(() => {
    const m: Record<string, StudyRow[]> = {};
    for (const s of studies.rows) {
      if (!showClosed && s.closed) continue;
      const k = s.stage_key ?? "__unassigned__";
      (m[k] = m[k] ?? []).push(s);
    }
    return m;
  }, [studies.rows, showClosed]);

  const unassigned = studiesByStage["__unassigned__"] ?? [];
  const hasStages = stages.rows.length > 0;

  const moveTo = async (studyId: string, stageKey: string) => {
    if (!isAdmin) {
      toast.error("Admin access required to move studies");
      return;
    }
    const study = studies.rows.find((s) => s.id === studyId);
    if (!study) return;
    if (study.stage_key === stageKey) return;

    const patch: Partial<StudyRow> = { stage_key: stageKey };
    if (study.stage_key === "intake" && stageKey !== "intake" && !study.committed_at) {
      patch.committed_at = new Date().toISOString();
    }
    try {
      const { error } = await supabase.from("studies").update(patch as any).eq("id", studyId);
      if (error) throw error;
      const stageLabel = stages.rows.find((s) => s.key === stageKey)?.label ?? stageKey;
      toast.success(`Moved ${study.code} to ${stageLabel}`);
    } catch (e: any) {
      toast.error(e?.message || "Move failed");
    }
  };

  if (!hasStages && stages.loading) {
    return <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-slate-500">Loading pipeline…</div>;
  }

  if (!hasStages) {
    return (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-8">
        <PageHeader kicker="Workspace" title="Pipeline" />
        <Card className="mt-6">
          <EmptyState
            iconName="layers"
            title="No stages configured"
            sub={
              isAdmin
                ? "Head to Settings → Pipeline stages to design the lifecycle your studies move through."
                : "An admin needs to configure the pipeline stages before this view comes alive."
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Pipeline"
        subtitle={
          isAdmin
            ? "Every active study, grouped by the stage it's in. Drag a card between columns to advance it."
            : "Every active study, grouped by the stage it's in. Click a card to open the study."
        }
        actions={
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              className="accent-brand-500 w-4 h-4"
            />
            Show closed
          </label>
        }
      />

      {unassigned.length > 0 && (
        <div className="mt-2 mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
          <Icon name="alert" size={14} />
          <span>
            <strong>{unassigned.length}</strong> stud{unassigned.length === 1 ? "y has" : "ies have"} no
            stage assigned. Open them to set a stage.
          </span>
        </div>
      )}

      {/* Kanban */}
      <div
        className="mt-6 overflow-x-auto -mx-4 md:-mx-6 px-4 md:px-6"
        style={{ scrollSnapType: "x proximity" }}
      >
        <div className="flex gap-3 pb-6 min-w-max">
          {stages.rows.map((stage) => {
            const items = studiesByStage[stage.key] ?? [];
            const isHover = hoverStage === stage.key;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  if (!isAdmin) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setHoverStage(stage.key);
                }}
                onDragLeave={() => setHoverStage((s) => (s === stage.key ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setHoverStage(null);
                  const id = e.dataTransfer.getData("text/study-id");
                  if (id) void moveTo(id, stage.key);
                }}
                className={
                  "w-72 shrink-0 rounded-xl border bg-slate-50/60 flex flex-col transition " +
                  (isHover ? "border-brand-400 bg-brand-50/40 ring-2 ring-brand-200" : "border-slate-200")
                }
                style={{ scrollSnapAlign: "start" }}
              >
                {/* Column header */}
                <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800 truncate">
                    {stage.label}
                  </span>
                  <div className="flex-1" />
                  <span className="text-[10px] font-mono text-slate-500">
                    {items.length}
                  </span>
                  {stage.terminal && <Pill tone="neutral">end</Pill>}
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2 min-h-[120px]">
                  {items.length === 0 && (
                    <div className="text-[11px] text-slate-400 italic px-2 py-3 text-center">
                      No studies here.
                    </div>
                  )}
                  {items.map((s) => (
                    <StudyCard
                      key={s.id}
                      study={s}
                      stage={stage}
                      draggable={isAdmin}
                      isDragging={draggingId === s.id}
                      onDragStart={(e) => {
                        if (!isAdmin) return;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/study-id", s.id);
                        setDraggingId(s.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setHoverStage(null);
                      }}
                      onClick={() => onNavigate(`#/studies/${s.id}`)}
                    />
                  ))}
                </div>

                {/* Target days footer */}
                {!stage.terminal && (
                  <div className="px-3 py-1.5 border-t border-slate-200 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    target: {stage.target_days}d
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {studies.rows.length === 0 && !studies.loading && (
        <Card className="mt-6">
          <EmptyState
            iconName="folder"
            title="No studies yet"
            sub="Studies will appear in their stage column as you add them."
          />
        </Card>
      )}
    </div>
  );
}

/* ---------- Study card ---------- */

function StudyCard({
  study,
  stage,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  study: StudyRow;
  stage: PipelineStageRow;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const subtitle = [study.sponsor, study.therapeutic_area, study.phase]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={
        "group bg-white rounded-lg border border-slate-200 px-3 py-2.5 hover:border-brand-300 hover:shadow-sm transition cursor-pointer select-none " +
        (isDragging ? "opacity-40" : "") +
        (draggable ? " cursor-grab active:cursor-grabbing" : "")
      }
      style={{ borderLeft: `4px solid ${stage.color}` }}
    >
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="text-[10px] font-mono text-slate-500 font-semibold">
          {study.code}
        </span>
        {study.priority === "high" && <Pill tone="warning">P1</Pill>}
        {study.closed && <Pill tone="neutral">closed</Pill>}
      </div>
      <div className="text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
        {study.title}
      </div>
      {subtitle && (
        <div className="mt-1 text-[11px] text-slate-500 truncate">{subtitle}</div>
      )}
      {study.pi_name && (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500">
          <Icon name="users" size={10} />
          <span className="truncate">{study.pi_name}</span>
        </div>
      )}
    </div>
  );
}
