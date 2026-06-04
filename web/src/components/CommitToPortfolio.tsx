import { useMemo, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { supabase } from "../lib/supabase";
import { writeAuditEvent } from "../lib/auditLog";
import { spawnTasksForStageEntry } from "../lib/workStreamEngine";
import { confirmDialog } from "../lib/confirm";
import { friendlyError } from "../lib/errors";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import type { StudyRow, PipelineStageRow, WorkflowModuleRow, FieldDefinitionRow } from "../lib/types";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import { completeness } from "../pages/IntakeTriage";
import { useModalA11y } from "../lib/useModalA11y";

/** The intake decision lives ON THE RECORD (June note: "the list is too
 *  early — open the submission before choosing an action"). Shown on any
 *  prospective study: Under review / Decline / Commit to portfolio. */
export function IntakeDecisionBar({
  study,
  onChanged,
  onNavigate,
}: {
  study: StudyRow;
  onChanged: () => void;
  onNavigate: (h: string) => void;
}) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position" });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const [open, setOpen] = useState(false);

  const commitStage = useMemo(
    () => stages.rows.find((s) => s.key !== "intake" && !s.terminal) ?? null,
    [stages.rows]
  );
  const studyFields = fields.rows.filter((f) => f.entity_type === "study" && f.enabled);
  const comp = completeness(study, studyFields);

  if (study.committed_at || study.closed) return null;

  const underReview = async () => {
    try {
      const { error } = await supabase
        .from("studies").update({ intake_status: "under_review" } as never).eq("id", study.id);
      if (error) throw error;
      if (orgId && userId)
        void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: study.id, action: "intake_under_review", payload: { code: study.code } });
      toast.success(stamped("Marked under review"));
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't update"));
    }
  };

  const decline = async () => {
    if (!(await confirmDialog({ title: "Decline study", message: `Decline ${study.code}? It closes with a declined status — restorable for 30 days.`, confirmLabel: "Decline", danger: true }))) return;
    try {
      const { error } = await supabase
        .from("studies").update({ closed: true, closed_at: new Date().toISOString(), intake_status: "declined" } as never).eq("id", study.id);
      if (error) throw error;
      if (orgId && userId)
        void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: study.id, action: "intake_declined", payload: { code: study.code, title: study.title } });
      toast.success(stamped(`Declined ${study.code}`));
      onNavigate("#/intake");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't decline"));
    }
  };

  const commit = async () => {
    if (!orgId || !userId || !commitStage) return;
    try {
      const { error } = await supabase
        .from("studies")
        .update({ stage_key: commitStage.key, committed_at: new Date().toISOString(), intake_status: "committed", stage_entered_at: new Date().toISOString() } as never)
        .eq("id", study.id);
      if (error) throw error;
      void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: study.id, action: "committed_to_portfolio", payload: { code: study.code, to_stage: commitStage.key, to_label: commitStage.label } });
      void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: study.id, action: "stage_changed", payload: { from: study.stage_key ?? null, to: commitStage.key, from_label: "Intake", to_label: commitStage.label, source: "intake_commit" } });
      let spawned = 0;
      try {
        const res = await spawnTasksForStageEntry({ orgId, studyId: study.id, stageKey: commitStage.key, actorUserId: userId });
        spawned = res.spawned;
      } catch { /* engine failure shouldn't block commit */ }
      toast.success(stamped(`Committed ${study.code} to ${commitStage.label}` + (spawned > 0 ? ` — ${spawned} task${spawned === 1 ? "" : "s"} spawned` : "")));
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e, "Commit failed"));
    }
  };

  return (
    <>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 flex flex-wrap items-center gap-3">
        <Icon name="inbox" size={15} className="text-amber-600" />
        <span className="text-sm text-amber-900 flex-1 min-w-[200px]">
          <strong>Prospective study</strong> — not in the portfolio yet.
          <span className="text-amber-700"> Startup data {comp.pct}% complete{comp.missingRequired.length > 0 ? ` · missing required: ${comp.missingRequired.slice(0, 3).join(", ")}` : ""}.</span>
        </span>
        {study.intake_status === "under_review" && <Pill tone="warning">under review</Pill>}
        {isAdmin && (
          <span className="flex items-center gap-2">
            {study.intake_status !== "under_review" && (
              <Button size="sm" variant="ghost" onClick={() => void underReview()}>Under review</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void decline()}>Decline</Button>
            <Button size="sm" variant="primary" onClick={() => setOpen(true)} disabled={!commitStage}>
              <Icon name="check" size={12} /> Commit to portfolio
            </Button>
          </span>
        )}
      </div>

      {open && orgId && userId && commitStage && (
        <CommitModal
          study={study}
          commitStage={commitStage}
          modules={modules.rows.filter((m) => m.stage_key === commitStage.key && m.enabled)}
          completenessInfo={comp}
          onClose={() => setOpen(false)}
          onCommit={commit}
        />
      )}
    </>
  );
}

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
          <div className="text-[11px] font-semibold text-slate-400">
            {study.code}
          </div>
          <h2 className="text-lg font-display font-bold text-slate-900">Commit to portfolio</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Moves to <strong>{commitStage.label}</strong>, stamps the commit date, and fires the
            stage's work stream.
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
            <div className="text-xs font-semibold text-slate-500 mb-2">
              Work stream that fires on entry
            </div>
            {modules.length === 0 ? (
              <div className="text-sm text-slate-500">
                No work stream modules configured for {commitStage.label} — no tasks auto-spawn.
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
