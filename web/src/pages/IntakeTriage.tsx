import { PageBlocks } from "../blocks/PageBlocks";
import { InfoTip } from "../components/ui/Tip";
import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useModalA11y } from "../lib/useModalA11y";
import type {
  StudyRow,
  PipelineStageRow,
  FieldDefinitionRow,
  WorkflowModuleRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

/** Intake — centralized triage for studies sitting in the intake stage.
 *
 *  "This is the foundation. How many studies become financial or logistical
 *  workflow nightmares because of incomplete or missing startup data?"
 *
 *  Every intake study shows a data-completeness score computed from the
 *  org's enabled study fields (required fields weigh double). Triage is
 *  per-study and intentional: open the record to fill gaps, COMMIT to the
 *  portfolio (with a preview of the workstream tasks that will fire), or
 *  DECLINE (audited, study closes).
 */
export function IntakeTriage({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position" });

  const [committing, setCommitting] = useState<StudyRow | null>(null);

  const studyFields = useMemo(
    () => fields.rows.filter((f) => f.entity_type === "study" && f.enabled),
    [fields.rows]
  );

  const intakeStudies = useMemo(
    () =>
      studies.rows.filter(
        (s) => !s.closed && (s.stage_key === "intake" || s.stage_key === null) && !s.committed_at
      ),
    [studies.rows]
  );

  // First non-intake stage = the commit destination.
  const commitStage = useMemo(() => {
    const sorted = [...stages.rows].sort((a, b) => a.position - b.position);
    return sorted.find((s) => s.key !== "intake") ?? null;
  }, [stages.rows]);

  if (memberLoading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Loader label="Checking permissions…" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Intake"
        subtitle="Every new study arrives here with the same standardized record. Complete the data, then commit it to the portfolio — or decline it. Incomplete startup data is where workflow nightmares begin."
        actions={
          <div className="flex items-center gap-2">
            <Pill tone={intakeStudies.length > 0 ? "brand" : "neutral"}>
              {intakeStudies.length} awaiting triage
            </Pill>
          </div>
        }
      />

      <PageBlocks pageKey="intake" region="top" navigate={onNavigate} />

      <Card flush className="mt-6 overflow-hidden">
        {studies.loading && intakeStudies.length === 0 && (
          <div className="p-6">
            <Loader label="Loading intake queue…" />
          </div>
        )}
        {!studies.loading && intakeStudies.length === 0 && (
          <EmptyState
            iconName="inbox"
            title="Intake queue is clear"
            sub="New studies land here for data triage before they're committed to the portfolio. Create one from the Studies page."
          />
        )}
        {intakeStudies.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[110px_1fr_190px_200px] gap-3 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Code</span>
              <span>Study</span>
              <span className="flex items-center gap-1">
                Data completeness
                <InfoTip side="bottom" label="How much of the org's study schema is filled, with required fields weighted double. Studies missing startup data become tonight's nightmares — commit with eyes open." />
              </span>
              <span className="text-right">Triage</span>
            </div>
            {intakeStudies.map((s) => {
              const comp = completeness(s, studyFields);
              return (
                <div
                  key={s.id}
                  className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[110px_1fr_190px_200px] gap-3 items-center group hover:bg-brand-50/20 transition"
                >
                  <button
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                    className="font-mono text-xs text-slate-600 text-left hover:text-brand-700 transition"
                  >
                    {s.code}
                  </button>
                  <button
                    onClick={() => onNavigate(`#/studies/${s.id}`)}
                    className="min-w-0 text-left"
                  >
                    <div className="font-semibold text-slate-900 truncate group-hover:text-brand-800 transition">
                      {s.title}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {[s.sponsor, s.nct, s.phase].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-[110px]">
                        <div
                          className={
                            "h-full rounded-full transition-all " +
                            (comp.pct >= 85 ? "bg-emerald-500" : comp.pct >= 50 ? "bg-amber-500" : "bg-red-400")
                          }
                          style={{ width: `${comp.pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">{comp.pct}%</span>
                    </div>
                    {comp.missingRequired.length > 0 && (
                      <div className="text-[10px] text-red-600 mt-0.5 truncate" title={comp.missingRequired.join(", ")}>
                        missing required: {comp.missingRequired.slice(0, 2).join(", ")}
                        {comp.missingRequired.length > 2 && ` +${comp.missingRequired.length - 2}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => onNavigate(`#/studies/${s.id}`)}>
                      Review
                    </Button>
                    {isAdmin && (
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setCommitting(s)}
                          title="Commit to portfolio"
                        >
                          <Icon name="check" size={11} /> Commit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!orgId || !userId) return;
                            if (
                              !(await confirmDialog({
                                title: "Decline study",
                                message: `Decline ${s.code}? It closes with a declined status — fully audited, restorable by reopening.`,
                                confirmLabel: "Decline",
                                danger: true,
                              }))
                            )
                              return;
                            try {
                              const { error } = await supabase
                                .from("studies")
                                .update({
                                  closed: true,
                                  closed_at: new Date().toISOString(),
                                  intake_status: "declined",
                                } as any)
                                .eq("id", s.id);
                              if (error) throw error;
                              void writeAuditEvent({
                                orgId, actorId: userId, actorEmail: userEmail,
                                entityType: "study", entityId: s.id,
                                action: "intake_declined",
                                payload: { code: s.code, title: s.title },
                              });
                              toast.success(stamped(`Declined ${s.code}`));
                            } catch (e: any) {
                              toast.error(e?.message || "Couldn't decline");
                            }
                          }}
                        >
                          Decline
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      <PageBlocks pageKey="intake" region="bottom" navigate={onNavigate} />

      {committing && orgId && userId && commitStage && (
        <CommitModal
          study={committing}
          commitStage={commitStage}
          modules={modules.rows.filter((m) => m.stage_key === commitStage.key && m.enabled)}
          completenessInfo={completeness(committing, studyFields)}
          onClose={() => setCommitting(null)}
          onCommit={async () => {
            try {
              const { error } = await supabase
                .from("studies")
                .update({
                  stage_key: commitStage.key,
                  committed_at: new Date().toISOString(),
                  intake_status: "committed",
                } as any)
                .eq("id", committing.id);
              if (error) throw error;
              void supabase
                .from("studies")
                .update({ stage_entered_at: new Date().toISOString() } as any)
                .eq("id", committing.id);
              void writeAuditEvent({
                orgId, actorId: userId, actorEmail: userEmail,
                entityType: "study", entityId: committing.id,
                action: "committed_to_portfolio",
                payload: { code: committing.code, to_stage: commitStage.key, to_label: commitStage.label },
              });
              void writeAuditEvent({
                orgId, actorId: userId, actorEmail: userEmail,
                entityType: "study", entityId: committing.id,
                action: "stage_changed",
                payload: {
                  from: committing.stage_key ?? null,
                  to: commitStage.key,
                  from_label: "Intake",
                  to_label: commitStage.label,
                  source: "intake_commit",
                },
              });
              let spawned = 0;
              try {
                const res = await spawnTasksForStageEntry({
                  orgId,
                  studyId: committing.id,
                  stageKey: commitStage.key,
                  actorUserId: userId,
                });
                spawned = res.spawned;
              } catch {
                /* engine failure shouldn't block commit */
              }
              toast.success(
                stamped(
                  `Committed ${committing.code} to ${commitStage.label}` +
                    (spawned > 0 ? ` — ${spawned} task${spawned === 1 ? "" : "s"} spawned` : "")
                )
              );
              setCommitting(null);
              onNavigate(`#/studies/${committing.id}`);
            } catch (e: any) {
              toast.error(e?.message || "Commit failed");
            }
          }}
        />
      )}
    </div>
  );
}

function completeness(
  study: StudyRow,
  defs: FieldDefinitionRow[]
): { pct: number; missingRequired: string[] } {
  if (defs.length === 0) return { pct: 0, missingRequired: [] };
  const KEY_TO_COLUMN: Record<string, keyof StudyRow> = {
    shortTitle: "title",
    sponsor: "sponsor",
    nct: "nct",
    therapeuticArea: "therapeutic_area",
    phase: "phase",
    piName: "pi_name",
    studyKind: "study_kind",
    priority: "priority",
  };
  let score = 0;
  let weight = 0;
  const missingRequired: string[] = [];
  for (const f of defs) {
    const w = f.required ? 2 : 1;
    weight += w;
    const col = KEY_TO_COLUMN[f.key];
    const v = col ? (study as any)[col] : (study.custom_field_values ?? {})[f.key];
    const has = v !== null && v !== undefined && v !== "";
    if (has) score += w;
    else if (f.required) missingRequired.push(f.label);
  }
  return { pct: Math.round((score / Math.max(1, weight)) * 100), missingRequired };
}

/* ---------- Commit modal: the workstream moment ---------- */

function CommitModal({
  study,
  commitStage,
  modules,
  completenessInfo,
  onClose,
  onCommit,
}: {
  study: StudyRow;
  commitStage: PipelineStageRow;
  modules: WorkflowModuleRow[];
  completenessInfo: { pct: number; missingRequired: string[] };
  onClose: () => void;
  onCommit: () => Promise<void>;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Commit to portfolio"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            {study.code}
          </div>
          <h2 className="text-lg font-display font-bold text-slate-900">Commit to portfolio</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Moves to <strong>{commitStage.label}</strong>, stamps the commit date, and fires the
            stage's workstream.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {completenessInfo.missingRequired.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 leading-relaxed">
              <strong>{completenessInfo.missingRequired.length} required field
              {completenessInfo.missingRequired.length === 1 ? "" : "s"} still empty:</strong>{" "}
              {completenessInfo.missingRequired.join(", ")}. You can commit anyway — the gaps stay
              visible on the record.
            </div>
          )}
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Workstream that fires on entry
            </div>
            {modules.length === 0 ? (
              <div className="text-sm text-slate-500">
                No workstream modules configured for {commitStage.label} — no tasks auto-spawn.
                Configure them in Work Streams.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {modules.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-sm text-slate-800">
                    <Icon name="workflow" size={13} className="text-brand-600 flex-shrink-0" />
                    <span className="truncate">{m.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onCommit();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Committing…" : "Commit to portfolio"}
          </Button>
        </div>
      </div>
    </div>
  );
}
