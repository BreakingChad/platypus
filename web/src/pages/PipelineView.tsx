import { friendlyError } from "../lib/errors";
import { PageBlocks } from "../blocks/PageBlocks";
import { Tip } from "../components/ui/Tip";
import { Loader } from "../components/ui/Loader";
import { stamped } from "../lib/stamp";
import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useCurrentOrg } from "../lib/OrgContext";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { useToast } from "../lib/Toast";
import type { StudyRow, PipelineStageRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { HealthDot } from "../components/ui/HealthDot";
import { computeHealth, healthSortWeight, type HealthInfo } from "../lib/studyHealth";
import { useStickyState, useStickyStateWithRoleDefault } from "../lib/useStickyState";
import { useResolvedConfig } from "../lib/useResolvedConfig";
import { useStarredStudies } from "../lib/useStarred";
import { useAuth } from "../auth/useAuth";

/** PipelineView — kanban by stage. Columns from pipeline_stages, cards from
 *  studies. Admins can drag cards between columns to advance/regress (writes
 *  stage_key to the studies row). Click a card to open the study detail.
 *  Closed studies are hidden by default.
 */
export function PipelineView({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin } = useCurrentMember();
  const auth = useAuth();
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const { orgId } = useCurrentOrg();
  const starred = useStarredStudies(userEmail);
  const toast = useToast();
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", {
    orderBy: "position",
    realtime: true,
  });
  const studies = useOrgTable<StudyRow>("studies", {
    orderBy: "created_at",
    realtime: true,
  });

  const { configFor } = useResolvedConfig();
  const pipelineOpts = configFor("pipeline").options ?? {};
  const [showClosed, setShowClosed] = useStickyStateWithRoleDefault<boolean>(
    "pipeline/showClosed", false, pipelineOpts.showClosed as boolean | undefined
  );
  const [viewMode, setViewMode] = useStickyStateWithRoleDefault<"scroll" | "tabbed">(
    "pipeline/viewMode", "scroll", pipelineOpts.viewMode as "scroll" | "tabbed" | undefined
  );
  const [tabStageKey, setTabStageKey] = useStickyState<string | null>("pipeline/tabStage", null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverStage, setHoverStage] = useState<string | null>(null);

  const studiesByStage = useMemo(() => {
    const m: Record<string, { row: StudyRow; health: HealthInfo }[]> = {};
    for (const s of studies.rows) {
      if (!showClosed && s.closed) continue;
      const k = s.stage_key ?? "__unassigned__";
      const item = { row: s, health: computeHealth(s, stages.rows) };
      (m[k] = m[k] ?? []).push(item);
    }
    // Sort each column: overdue → at risk → healthy → unknown → closed
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => healthSortWeight(a.health) - healthSortWeight(b.health));
    }
    return m;
  }, [studies.rows, stages.rows, showClosed]);

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
      // Stamp stage-entry time (best-effort; no-op until migration 0010 runs).
      void supabase.from("studies").update({ stage_entered_at: new Date().toISOString() } as any).eq("id", studyId);
      const stageLabel = stages.rows.find((s) => s.key === stageKey)?.label ?? stageKey;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: studyId,
          action: "stage_changed",
          payload: {
            from: study.stage_key ?? null,
            to: stageKey,
            from_label: stages.rows.find((s) => s.key === study.stage_key)?.label ?? null,
            to_label: stageLabel,
            source: "pipeline_dnd",
          },
        });
        try {
          const res = await spawnTasksForStageEntry({
            orgId,
            studyId,
            stageKey,
            actorUserId: userId,
          });
          if (res.spawned > 0) {
            toast.info(`+${res.spawned} task${res.spawned === 1 ? "" : "s"} spawned for ${stageLabel}`);
          }
        } catch (e: any) {
          toast.error(`Stage advanced but task spawn failed: ${e?.message ?? "unknown"}`);
        }
      }
      toast.success(stamped(`Moved ${study.code} to ${stageLabel}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Move failed"));
    }
  };

  if (!hasStages && stages.loading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 py-8"><Loader label="Loading pipeline…" /></div>;
  }

  if (!hasStages) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 py-8">
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
    <div className="max-w-page-wide mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Pipeline"
        subtitle={
          isAdmin
            ? "Every active study, grouped by the stage it's in. Drag a card between columns to advance it."
            : "Every active study, grouped by the stage it's in. Click a card to open the study."
        }
        actions={
          <div className="flex items-center gap-3">
            <Tip side="bottom" label="Two reads of the same board: every stage side-by-side, or one stage at a time with counts in the tabs. Admins set each role's default in the Page designer.">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Board view">
              <button
                onClick={() => setViewMode("scroll")}
                className={
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition " +
                  (viewMode === "scroll" ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
                }
              >
                Columns
              </button>
              <button
                onClick={() => setViewMode("tabbed")}
                className={
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition " +
                  (viewMode === "tabbed" ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
                }
              >
                By stage
              </button>
            </div>
            </Tip>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                className="accent-brand-500 w-4 h-4"
              />
              Show closed
            </label>
          </div>
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

      <PageBlocks pageKey="pipeline" region="top" navigate={onNavigate} />

      {/* Tabbed-by-stage view */}
      {viewMode === "tabbed" && (() => {
        const activeKey =
          tabStageKey && stages.rows.some((st) => st.key === tabStageKey)
            ? tabStageKey
            : stages.rows[0]?.key ?? null;
        const activeStage = stages.rows.find((st) => st.key === activeKey) ?? null;
        const items = activeKey ? studiesByStage[activeKey] ?? [] : [];
        return (
          <div className="mt-6">
            <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
              {stages.rows.map((st) => {
                const n = (studiesByStage[st.key] ?? []).length;
                const active = st.key === activeKey;
                return (
                  <button
                    key={st.id}
                    onClick={() => setTabStageKey(st.key)}
                    className={
                      "px-3 py-2 text-sm font-semibold transition border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 " +
                      (active
                        ? "border-brand-600 text-brand-700"
                        : "border-transparent text-slate-500 hover:text-slate-900")
                    }
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />
                    {st.label}
                    <span className={"text-[10px] font-mono " + (active ? "text-brand-600" : "text-slate-400")}>
                      {n}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.length === 0 && (
                <div className="col-span-full">
                  <Card>
                    <EmptyState
                      iconName="layers"
                      title={`Nothing in ${activeStage?.label ?? "this stage"}`}
                      sub="Studies appear here as they enter the stage."
                    />
                  </Card>
                </div>
              )}
              {activeStage &&
                items.map(({ row: s, health }) => (
                  <StudyCard
                    key={s.id}
                    study={s}
                    health={health}
                    starred={starred.isStarred(s.id)}
                    stage={activeStage}
                    draggable={false}
                    isDragging={false}
                    onDragStart={() => {}}
                    onDragEnd={() => {}}
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                  />
                ))}
            </div>
            {isAdmin && (
              <p className="mt-3 text-[11px] text-slate-400">
                Tip: stage moves by drag live in the Columns view; here you advance from inside the study.
              </p>
            )}
          </div>
        );
      })()}

      {/* Kanban */}
      {viewMode === "scroll" && (
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
                <div className="px-3 py-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stage.color }}
                    />
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {stage.label}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[10px] font-mono text-slate-500">
                      {items.length}
                    </span>
                    {stage.terminal && <Pill tone="neutral">end</Pill>}
                  </div>
                  {/* Health distribution micro-bar */}
                  {items.length > 0 && (() => {
                    const counts = { red: 0, yellow: 0, green: 0, other: 0 };
                    for (const it of items) {
                      if (it.health.level === "red") counts.red += 1;
                      else if (it.health.level === "yellow") counts.yellow += 1;
                      else if (it.health.level === "green") counts.green += 1;
                      else counts.other += 1;
                    }
                    const total = items.length;
                    const pct = (n: number) => (n / total) * 100;
                    return (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden flex">
                          {counts.red > 0 && <div className="bg-red-500" style={{ width: pct(counts.red) + "%" }} />}
                          {counts.yellow > 0 && <div className="bg-amber-500" style={{ width: pct(counts.yellow) + "%" }} />}
                          {counts.green > 0 && <div className="bg-emerald-500" style={{ width: pct(counts.green) + "%" }} />}
                          {counts.other > 0 && <div className="bg-slate-300" style={{ width: pct(counts.other) + "%" }} />}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] font-mono text-slate-500">
                          {counts.red > 0 && <span className="text-red-600">{counts.red}</span>}
                          {counts.yellow > 0 && <span className="text-amber-700">{counts.yellow}</span>}
                          {counts.green > 0 && <span className="text-emerald-700">{counts.green}</span>}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2 min-h-[120px]">
                  {items.length === 0 && (
                    <div className="text-[11px] text-slate-400 italic px-2 py-3 text-center">
                      No studies here.
                    </div>
                  )}
                  {items.map(({ row: s, health }) => (
                    <StudyCard
                      key={s.id}
                      study={s}
                      health={health}
                      starred={starred.isStarred(s.id)}
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
                  <div className="px-3 py-1.5 border-t border-slate-200 text-[11px] font-semibold text-slate-400">
                    target: {stage.target_days}d
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {studies.rows.length === 0 && !studies.loading && (
        <Card className="mt-6">
          <EmptyState
            iconName="folder"
            title="No studies yet"
            sub="Studies will appear in their stage column as you add them."
          />
        </Card>
      )}

      <PageBlocks pageKey="pipeline" region="bottom" navigate={onNavigate} />
    </div>
  );
}

/* ---------- Study card ---------- */

function StudyCard({
  study,
  health,
  starred,
  stage,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  study: StudyRow;
  health: HealthInfo;
  starred: boolean;
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
      role="button"
      tabIndex={0}
      aria-label={`Open ${study.code}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={
        "group bg-white rounded-lg border border-slate-200 px-3 py-2.5 hover:border-brand-300 hover:shadow-sm transition cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-brand-500/30 " +
        (isDragging ? "opacity-40" : "") +
        (draggable ? " cursor-grab active:cursor-grabbing" : "")
      }
      style={{ borderLeft: `4px solid ${stage.color}` }}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <HealthDot health={health} variant="dot" />
        {starred && (
          <span title="Pinned" className="text-amber-500 flex-shrink-0">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </span>
        )}
        <span className="text-[10px] font-mono text-slate-500 font-semibold">
          {study.code}
        </span>
        {study.priority === "high" && <Pill tone="warning">P1</Pill>}
        {study.closed && <Pill tone="neutral">closed</Pill>}
        <span className="flex-1" />
        {!study.closed && (
          <span
            className="text-[10px] font-mono text-slate-500"
            title={health.summary}
          >
            {health.targetDays > 0 && (
              health.daysToTarget >= 0
                ? `${health.daysInStage}d / ${health.targetDays}d`
                : `+${-health.daysToTarget}d over`
            )}
            {health.targetDays === 0 && health.level !== "unknown" && (
              `${health.daysInStage}d`
            )}
          </span>
        )}
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
