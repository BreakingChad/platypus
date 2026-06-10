import { friendlyError } from "../lib/errors";
import { PageBlocks } from "../blocks/PageBlocks";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { fmtDate } from "../lib/dates";
import type {
  StudyRow,
  PipelineStageRow,
  FieldDefinitionRow,
  IntakeFormRow,
  FormSubmissionRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { NewStudyModal } from "../components/NewStudyModal";
import { InternalIntakeModal } from "./InternalIntakeModal";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";
import { SubmissionsQueue } from "../components/SubmissionsQueue";

type IntakeTab = "active" | "new" | "submissions" | "forms" | "declined" | "amendments";

/** Intake — study intake and triage, in one tabbed surface (modeled on the
 *  proof-of-concept): Active intakes, + New intake, Submissions, Forms, and a
 *  Declined archive with a 30-day restore window.
 */
export function IntakeTriage({
  onNavigate,
  initialTab,
}: {
  onNavigate: (h: string) => void;
  initialTab?: "new" | "amendments";
}) {
  const [tab, setTab] = useState<IntakeTab>(initialTab === "amendments" ? "amendments" : "active");
  const [creating, setCreating] = useState(false);
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const forms = useOrgTable<IntakeFormRow>("intake_forms", { realtime: true });
  const submissions = useOrgTable<FormSubmissionRow>("form_submissions", { realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });

  const internalForm = forms.rows.find((x) => x.status === "active" && (x as any).scope === "internal") ?? null;
  const studyFields = useMemo(() => fields.rows.filter((f) => f.entity_type === "study" && f.enabled), [fields.rows]);

  const intakeStudies = useMemo(
    () => studies.rows.filter((s) => !s.closed && (s.stage_key === "intake" || s.stage_key === null) && !s.committed_at),
    [studies.rows]
  );
  const declinedStudies = useMemo(
    () => studies.rows.filter((s) => (s as any).intake_status === "declined"),
    [studies.rows]
  );
  const newSubmissions = useMemo(() => submissions.rows.filter((s) => s.status === "new"), [submissions.rows]);
  const activeForms = useMemo(() => forms.rows.filter((f) => f.status === "active"), [forms.rows]);

  /* ---------- declined: restore + purge (30-day window) ---------- */
  const restoreDeclined = async (s: StudyRow) => {
    try {
      const { error } = await supabase.from("studies")
        .update({ closed: false, closed_at: null, intake_status: "under_review", stage_key: "intake" } as any)
        .eq("id", s.id);
      if (error) throw error;
      if (orgId && userId) void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: s.id, action: "intake_restored", payload: { code: s.code } });
      toast.success(stamped(`${s.code} restored to active intakes`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't restore")); }
  };
  const purgeDeclined = async (s: StudyRow) => {
    if (!(await confirmDialog({ title: "Delete study", message: `Permanently delete ${s.code}? This happens automatically 30 days after decline — doing it now skips the restore window.`, confirmLabel: "Delete now", danger: true }))) return;
    try {
      const { error } = await supabase.from("studies").delete().eq("id", s.id);
      if (error) throw error;
      if (orgId && userId) void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "study", entityId: s.id, action: "intake_deleted", payload: { code: s.code } });
      toast.success(stamped(`${s.code} permanently deleted`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't delete")); }
  };

  // The "30-day window" promise, made real without a cron: whenever an admin
  // views intake, declined studies past the window are purged — audited.
  useEffect(() => {
    if (!isAdmin || !orgId || !userId) return;
    const cutoff = Date.now() - 30 * 86400000;
    const stale = declinedStudies.filter(
      (s) => s.closed_at && new Date(s.closed_at).getTime() < cutoff
    );
    if (stale.length === 0) return;
    void (async () => {
      let purged = 0;
      for (const s of stale) {
        const { error } = await supabase.from("studies").delete().eq("id", s.id);
        if (!error) {
          purged += 1;
          void writeAuditEvent({
            orgId, actorId: userId, actorEmail: userEmail,
            entityType: "study", entityId: s.id,
            action: "intake_purged_auto",
            payload: { code: s.code, declined_at: s.closed_at },
          });
        }
      }
      if (purged > 0) {
        toast.info(`${purged} declined stud${purged === 1 ? "y" : "ies"} past the 30-day window permanently deleted`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declinedStudies.length, isAdmin, orgId, userId]);

  if (memberLoading) {
    return <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }

  const tabs: { id: IntakeTab; label: string; icon: string; count?: number }[] = [
    { id: "active", label: "Active intakes", icon: "inbox", count: intakeStudies.length },
    { id: "new", label: "New intake", icon: "plus" },
    { id: "submissions", label: "Submissions", icon: "mail", count: newSubmissions.length },
    { id: "forms", label: "Forms", icon: "file", count: activeForms.length },
    { id: "declined", label: "Declined", icon: "trash", count: declinedStudies.length },
    { id: "amendments", label: "Amendments", icon: "file" },
  ];

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="Study intake & triage"
        subtitle="Every new study arrives here with the same standardized record. Complete the data, then commit it to the portfolio — or decline it. Incomplete startup data is where workflow nightmares begin."
      />

      {/* Tabs */}
      <div className="mt-5 flex flex-wrap gap-1 p-1 bg-slate-100/70 border border-slate-200 rounded-lg w-fit">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={"flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-semibold transition " +
                (active ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
              <Icon name={t.icon} size={13} className={active ? "text-brand-600" : "text-slate-400"} />
              <span>{t.label}</span>
              {t.count != null && t.count > 0 && (
                <span className={"text-[11px] font-mono " + (active ? "text-brand-600" : "text-slate-400")}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── ACTIVE INTAKES ── */}
      {tab === "active" && (
        <>
          <PageBlocks pageKey="intake" region="top" navigate={onNavigate} />
          <Card flush className="mt-6 overflow-hidden">
            {studies.loading && intakeStudies.length === 0 && <div className="p-6"><Loader label="Loading intake queue…" /></div>}
            {!studies.loading && intakeStudies.length === 0 && (
              <EmptyState iconName="inbox" title="Intake queue is clear"
                sub="Commit a submission or start a fresh intake to see it here." />
            )}
            {intakeStudies.length > 0 && (
              <>
                <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[110px_1fr_120px] gap-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                  <span>Code</span><span>Study</span><span className="text-right">Triage</span>
                </div>
                {intakeStudies.map((s) => (
                  <button key={s.id} onClick={() => onNavigate(`#/studies/${s.id}`)}
                    className="w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[110px_1fr_120px] gap-3 items-center group hover:bg-brand-50/20 transition">
                    <span className="font-mono text-xs text-slate-600 group-hover:text-brand-700">{s.code}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900 truncate group-hover:text-brand-800">{s.title}</span>
                      <span className="block text-[11px] text-slate-500 truncate">{[s.sponsor, s.nct, s.phase].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                    <span className="flex items-center gap-1.5 justify-end text-brand-700 text-sm font-semibold">Open <Icon name="chevron-right" size={14} /></span>
                  </button>
                ))}
              </>
            )}
          </Card>
          <PageBlocks pageKey="intake" region="bottom" navigate={onNavigate} />
        </>
      )}

      {/* ── + NEW INTAKE ── */}
      {tab === "new" && (
        <Card className="mt-6">
          <div className="text-lg font-display font-bold text-slate-900 mb-1">Start a new intake</div>
          <p className="text-sm text-slate-600 leading-relaxed mb-4 max-w-2xl">
            Skip the external form and go straight to a study record. Use this when a study is flagged internally — typically by a startup manager — rather than submitted by a sponsor or CRA.
          </p>
          {isAdmin ? (
            <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={13} /> Open a new study record</Button>
          ) : (
            <p className="text-sm text-slate-500">Ask an admin to start a new intake.</p>
          )}
        </Card>
      )}

      {/* ── SUBMISSIONS ── */}
      {tab === "submissions" && (
        <div className="mt-6">
          <SubmissionsQueue studyFields={studyFields} existingCodes={studies.rows.map((s) => s.code)} onNavigate={onNavigate} />
          {newSubmissions.length === 0 && submissions.rows.length === 0 && (
            <Card><EmptyState iconName="mail" title="No submissions yet" sub="When someone submits one of your intake forms, it lands here for triage." /></Card>
          )}
        </div>
      )}

      {/* ── FORMS ── */}
      {tab === "forms" && (
        <Card flush className="mt-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">Published intake forms</span>
            <div className="flex-1" />
            {isAdmin && (
              <button onClick={() => onNavigate("#/settings/forms")} className="text-xs font-semibold text-brand-700 hover:underline">Manage forms →</button>
            )}
          </div>
          {forms.loading && forms.rows.length === 0 ? (
            <div className="p-6"><Loader label="Loading forms…" /></div>
          ) : activeForms.length === 0 ? (
            <EmptyState iconName="file" title="No active forms"
              sub={isAdmin ? "Build and activate intake forms in Settings → Intake forms." : "Your admins haven't published an intake form yet."} />
          ) : (
            activeForms.map((f) => (
              <div key={f.id} className="px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center gap-3">
                <Icon name="file" size={15} className="text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{f.title}</div>
                  <div className="text-[11px] text-slate-500">{f.scope === "internal" ? "Internal" : "External"} · {submissions.rows.filter((s) => s.form_id === f.id).length} submission{submissions.rows.filter((s) => s.form_id === f.id).length === 1 ? "" : "s"}</div>
                </div>
                <Pill tone="success">active</Pill>
              </div>
            ))
          )}
        </Card>
      )}

      {/* ── DECLINED (30-day restore window) ── */}
      {tab === "declined" && (
        <div className="mt-6">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 mb-4 flex items-start gap-2.5">
            <Icon name="alert" size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 leading-relaxed">
              <span className="font-semibold text-slate-900">30-day restore window.</span> Declined intakes stay here for 30 days so you can recover an accidental decline. After that they're permanently deleted. Restoring puts the study back on Active intakes.
            </p>
          </div>
          {declinedStudies.length === 0 ? (
            <Card><EmptyState iconName="check" title="Nothing in the declined archive" sub="Declined studies show here for 30 days before they're deleted." /></Card>
          ) : (
            <Card flush className="overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[100px_1fr_140px_120px_180px] gap-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                <span>Code</span><span>Study</span><span>Declined</span><span>Days left</span><span className="text-right">Actions</span>
              </div>
              {declinedStudies.map((s) => {
                const declinedAt = (s as any).closed_at as string | null;
                const daysSince = declinedAt ? Math.round((Date.now() - new Date(declinedAt).getTime()) / 86400000) : 0;
                const daysLeft = Math.max(0, 30 - daysSince);
                const urgent = daysLeft <= 5;
                return (
                  <div key={s.id} className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[100px_1fr_140px_120px_180px] gap-3 items-center">
                    <span className="font-mono text-xs text-slate-600">{s.code}</span>
                    <span className="text-sm text-slate-800 truncate">{s.title}</span>
                    <span className="text-[11px] font-mono text-slate-500">{declinedAt ? fmtDate(declinedAt) : "—"}</span>
                    <span className={"text-xs font-mono " + (urgent ? "text-red-600 font-bold" : "text-slate-500")}>{daysLeft === 0 ? "0d" : `${daysLeft}d`}</span>
                    <span className="flex items-center gap-1.5 justify-end">
                      <Button size="sm" variant="primary" onClick={() => void restoreDeclined(s)}>Restore</Button>
                      {isAdmin && <Button size="sm" variant="ghost" onClick={() => void purgeDeclined(s)}>Delete</Button>}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      )}

      {/* ── AMENDMENTS ── */}
      {tab === "amendments" && (
        <Card className="mt-6">
          <EmptyState iconName="file" title="Amendment intake lands here"
            sub="Intake for studies that already exist: truncated feasibility, full regulatory, budget, and CTMS pathway — run as a parallel study instance that replaces the original at activation, audit chain intact. In build now." />
        </Card>
      )}

      {creating && internalForm && orgId && (
        <InternalIntakeModal
          form={internalForm}
          orgId={orgId}
          studyFields={studyFields}
          existingCodes={studies.rows.map((s) => s.code)}
          prefix={"STU"}
          userId={userId}
          userEmail={userEmail}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onNavigate(`#/studies/${id}`); }}
        />
      )}
      {creating && !internalForm && (
        <NewStudyModal
          stages={stages.rows}
          existingCodes={studies.rows.map((s) => s.code)}
          onClose={() => setCreating(false)}
          onCreated={(st) => { setCreating(false); onNavigate(`#/studies/${st.id}`); }}
        />
      )}
    </div>
  );
}

export function completeness(
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
