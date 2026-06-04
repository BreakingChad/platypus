import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { fmtDate } from "../lib/dates";
import { useModalA11y } from "../lib/useModalA11y";
import { nextStudyCode, buildStudyInsert } from "../lib/submissions";
import type { FieldDefinitionRow, FormSubmissionRow, IntakeFormRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { InfoTip } from "../components/ui/Tip";
import type { FormFieldSnapshot } from "../lib/forms";

/** SubmissionsQueue — external form submissions awaiting triage (Wave G3).
 *
 *  Sits at the top of Intake. A submission is NOT a study: "Commit to
 *  Intake" is the step that creates the study record (on the intake stage),
 *  where it picks up data-completeness triage like any prospective study.
 *  Decline is restorable — same forgiving model as study declines.
 */
export function SubmissionsQueue({
  studyFields,
  existingCodes,
  onNavigate,
}: {
  studyFields: FieldDefinitionRow[];
  existingCodes: string[];
  onNavigate: (h: string) => void;
}) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const submissions = useOrgTable<FormSubmissionRow>("form_submissions", {
    orderBy: "created_at",
    ascending: false,
    realtime: true,
  });

  const fresh = useMemo(() => submissions.rows.filter((s) => s.status === "new"), [submissions.rows]);
  const declined = useMemo(() => submissions.rows.filter((s) => s.status === "declined"), [submissions.rows]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [showDeclined, setShowDeclined] = useState(false);
  const open = submissions.rows.find((s) => s.id === openId) ?? null;

  // Nothing to show, nothing to render — the queue earns its space.
  if (submissions.rows.length === 0) return null;

  return (
    <Card flush className="mt-6 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Icon name="mail" size={13} className="text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">Form submissions</span>
        <InfoTip
          side="bottom"
          label="External submissions land here. Nothing exists in the pipeline until you commit one — Commit to Intake creates the study record, which then goes through data triage like any prospective study."
        />
        {fresh.length > 0 && <Pill tone="brand">{fresh.length} new</Pill>}
        <div className="flex-1" />
        {declined.length > 0 && (
          <button
            onClick={() => setShowDeclined((v) => !v)}
            className="text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition"
          >
            {showDeclined ? "Hide declined" : `Declined (${declined.length})`}
          </button>
        )}
      </div>

      {fresh.length === 0 && !showDeclined && (
        <div className="px-4 py-3 text-xs text-slate-500 italic">
          No new submissions — the public form links land here the moment someone submits.
        </div>
      )}

      {(showDeclined ? [...fresh, ...declined] : fresh).map((s) => (
        <button
          key={s.id}
          onClick={() => setOpenId(s.id)}
          className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-brand-50/30 transition grid grid-cols-[1fr_200px_110px_90px] gap-3 items-center"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 truncate">{s.form_title}</span>
            <span className="block text-[11px] text-slate-500 truncate">
              {s.submitter_name ?? "Unknown"} · {s.submitter_email ?? "no email"}
            </span>
          </span>
          <span className="text-[11px] text-slate-500 truncate">
            {Object.keys(s.values ?? {}).length} field{Object.keys(s.values ?? {}).length === 1 ? "" : "s"} provided
          </span>
          <span className="text-[11px] font-mono text-slate-500">{fmtDate(s.created_at)}</span>
          <span className="justify-self-end">
            {s.status === "declined" ? <Pill tone="neutral">declined</Pill> : <Pill tone="brand">new</Pill>}
          </span>
        </button>
      ))}

      {open && (
        <SubmissionModal
          submission={open}
          studyFields={studyFields}
          existingCodes={existingCodes}
          orgId={orgId}
          userId={userId}
          userEmail={userEmail}
          onClose={() => setOpenId(null)}
          onCommitted={(studyId, code) => {
            setOpenId(null);
            toast.success(stamped(`Committed to Intake — ${code}`));
            onNavigate(`#/studies/${studyId}`);
          }}
          onError={(e, fallback) => toast.error(friendlyError(e, fallback))}
          onToast={(msg) => toast.success(stamped(msg))}
        />
      )}
    </Card>
  );
}

/* ---------- detail modal ---------- */

function SubmissionModal({
  submission,
  studyFields,
  existingCodes,
  orgId,
  userId,
  userEmail,
  onClose,
  onCommitted,
  onError,
  onToast,
}: {
  submission: FormSubmissionRow;
  studyFields: FieldDefinitionRow[];
  existingCodes: string[];
  orgId: string | null;
  userId: string | null;
  userEmail: string | null;
  onClose: () => void;
  onCommitted: (studyId: string, code: string) => void;
  onError: (e: unknown, fallback: string) => void;
  onToast: (msg: string) => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<IntakeFormRow | null>(null);

  // Labels come from the form version the submission was made on.
  useMemo(() => {
    void (async () => {
      const { data } = await supabase
        .from("intake_forms")
        .select("*")
        .eq("id", submission.form_id)
        .maybeSingle();
      setForm((data as IntakeFormRow) ?? null);
    })();
  }, [submission.form_id]);

  const snapshot = ((form?.fields as FormFieldSnapshot[]) ?? []);
  const labelFor = (key: string) =>
    snapshot.find((f) => f.key === key)?.label ??
    studyFields.find((f) => f.key === key)?.label ??
    key;

  const entries = Object.entries(submission.values ?? {});

  const commit = async () => {
    if (!orgId || !userId || busy) return;
    setBusy(true);
    try {
      const { data: org } = await supabase
        .from("orgs")
        .select("project_id_prefix")
        .eq("id", orgId)
        .maybeSingle();
      const code = nextStudyCode(existingCodes, (org as any)?.project_id_prefix || "STU");
      const insert = buildStudyInsert({
        orgId,
        code,
        stageKey: "intake",
        values: submission.values ?? {},
        studyFields,
        fallbackTitle: `${submission.form_title} — ${submission.submitter_name ?? "external"}`,
      });
      const { data: study, error } = await supabase
        .from("studies")
        .insert(insert as any)
        .select("*")
        .single();
      if (error) throw error;
      const newStudy = study as unknown as StudyRow;

      const { error: upError } = await supabase
        .from("form_submissions")
        .update({ status: "committed", study_id: newStudy.id })
        .eq("id", submission.id);
      if (upError) throw upError;

      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "study", entityId: newStudy.id,
        action: "created",
        payload: {
          code: newStudy.code, title: newStudy.title, stage_key: "intake",
          source: "form_submission", form_title: submission.form_title,
          submission_id: submission.id, submitter_email: submission.submitter_email,
        },
      });
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "form_submission", entityId: submission.id,
        action: "submission_committed",
        payload: { study_id: newStudy.id, code: newStudy.code },
      });

      onCommitted(newStudy.id, newStudy.code);
    } catch (e) {
      onError(e, "Couldn't commit this submission");
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (
      !(await confirmDialog({
        title: "Decline submission",
        message: `Decline "${submission.form_title}" from ${submission.submitter_name ?? "this submitter"}? It moves to Declined and can be restored from there.`,
        confirmLabel: "Decline",
        danger: true,
      }))
    )
      return;
    try {
      const { error } = await supabase
        .from("form_submissions")
        .update({ status: "declined", declined_at: new Date().toISOString() })
        .eq("id", submission.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "form_submission", entityId: submission.id,
          action: "submission_declined",
          payload: { form_title: submission.form_title, submitter_email: submission.submitter_email },
        });
      }
      onToast("Submission declined");
      onClose();
    } catch (e) {
      onError(e, "Couldn't decline this submission");
    }
  };

  const restore = async () => {
    try {
      const { error } = await supabase
        .from("form_submissions")
        .update({ status: "new", declined_at: null })
        .eq("id", submission.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "form_submission", entityId: submission.id,
          action: "submission_restored",
          payload: { form_title: submission.form_title },
        });
      }
      onToast("Submission restored to the queue");
    } catch (e) {
      onError(e, "Couldn't restore this submission");
    }
  };

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
        aria-label={`Submission — ${submission.form_title}`}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* Actions live at the TOP — triage is the work. */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-display font-bold text-slate-900 truncate">
                {submission.form_title}
              </h2>
              <p className="text-[11px] text-slate-500">
                {submission.submitter_name ?? "Unknown"} · {submission.submitter_email ?? "no email"} ·{" "}
                {fmtDate(submission.created_at)}
                {form ? ` · form v${form.version}` : ""}
              </p>
            </div>
            {submission.status === "new" && (
              <>
                <Button variant="primary" size="sm" onClick={() => void commit()} disabled={busy}
                  title="Creates the study record on the intake stage — data triage happens there">
                  {busy ? "Committing…" : "Commit to Intake"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void decline()} disabled={busy}>
                  Decline
                </Button>
              </>
            )}
            {submission.status === "declined" && (
              <Button variant="primary" size="sm" onClick={() => void restore()}>
                Restore
              </Button>
            )}
            {submission.status === "committed" && submission.study_id && (
              <Button variant="primary" size="sm" onClick={() => onCommitted(submission.study_id!, "")}>
                Open study
              </Button>
            )}
          </div>
        </div>

        <div className="p-5 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No field values on this submission.</p>
          ) : (
            <dl className="space-y-2.5">
              {entries.map(([key, v]) => (
                <div key={key} className="grid grid-cols-[180px_1fr] gap-3">
                  <dt className="text-xs font-semibold text-slate-500 pt-0.5">{labelFor(key)}</dt>
                  <dd className="text-sm text-slate-900 break-words">
                    {Array.isArray(v) ? (
                      <span className="flex flex-wrap gap-1">
                        {(v as unknown[]).map((x, i) => (
                          <span key={i} className="text-xs rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                            {String(x)}
                          </span>
                        ))}
                      </span>
                    ) : typeof v === "boolean" ? (
                      v ? "Yes" : "No"
                    ) : (
                      String(v)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
