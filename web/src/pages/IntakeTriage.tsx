import { friendlyError } from "../lib/errors";
import { PageBlocks } from "../blocks/PageBlocks";
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
import { NewStudyModal } from "../components/NewStudyModal";
import { InternalIntakeModal } from "./InternalIntakeModal";
import type { IntakeFormRow } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";
import { SubmissionsQueue } from "../components/SubmissionsQueue";

/** Intake — centralized triage for studies sitting in the intake stage.
 *
 *  "This is the foundation. How many studies become financial or logistical
 *  workflow nightmares because of incomplete or missing startup data?"
 *
 *  Triage is per-study and intentional: open the record to fill gaps,
 *  COMMIT to the portfolio (with a preview of the work stream tasks that
 *  will fire), or DECLINE (audited, study closes).
 *
 *  The data-completeness score (completeness() below) is hidden from the
 *  queue for now — it still backs the missing-required warning at commit.
 */
export function IntakeTriage({
  onNavigate,
  initialTab,
}: {
  onNavigate: (h: string) => void;
  /** One intake door, two arrivals (Plan B). */
  initialTab?: "new" | "amendments";
}) {
  const [intakeTab, setIntakeTab] = useState<"new" | "amendments">(initialTab ?? "new");
  const [creating, setCreating] = useState(false);
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const forms = useOrgTable<IntakeFormRow>("intake_forms", { realtime: true });
  const internalForm = forms.rows.find((x) => x.status === "active" && (x as any).scope === "internal") ?? null;

  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at", realtime: true });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position", realtime: true });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const modules = useOrgTable<WorkflowModuleRow>("workflow_modules", { orderBy: "position" });


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

  if (memberLoading) {
    return (
      <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <Loader label="Checking permissions…" />
      </div>
    );
  }

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Workspace"
        title="Intake"
        subtitle="Every new study arrives here with the same standardized record. Complete the data, then commit it to the portfolio — or decline it. Incomplete startup data is where workflow nightmares begin."
        actions={
          <div className="flex items-center gap-2">
            <Pill tone={intakeStudies.length > 0 ? "brand" : "neutral"}>
              {intakeStudies.length} awaiting triage
            </Pill>
            {isAdmin && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Icon name="plus" size={12} /> New intake
              </Button>
            )}
          </div>
        }
      />

      <PageBlocks pageKey="intake" region="top" navigate={onNavigate} />

      {/* One intake door, two kinds of arrivals */}
      <div className="mt-5 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([
          ["new", "New studies"],
          ["amendments", "Amendments"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setIntakeTab(k)}
            className={
              "px-3 py-2 rounded-md text-sm font-semibold transition " +
              (intakeTab === k ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {intakeTab === "amendments" && (
        <Card className="mt-4">
          <EmptyState
            iconName="file"
            title="Amendment intake lands here"
            sub="Intake for studies that already exist: truncated feasibility, full regulatory, budget, and CTMS pathway — run as a parallel study instance that replaces the original at activation, audit chain intact. In build now."
          />
        </Card>
      )}

      {intakeTab === "new" && (<>

      {/* External form submissions — triage them INTO intake (G3). */}
      <SubmissionsQueue
        studyFields={studyFields}
        existingCodes={studies.rows.map((s) => s.code)}
        onNavigate={onNavigate}
      />

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
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[110px_1fr_200px] gap-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Code</span>
              <span>Study</span>
              <span className="text-right">Triage</span>
            </div>
            {intakeStudies.map((s) => {
              return (
                <div
                  key={s.id}
                  className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[110px_1fr_200px] gap-3 items-center group hover:bg-brand-50/20 transition"
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
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => onNavigate(`#/studies/${s.id}`)}>
                      Open →
                    </Button>

                  </div>
                </div>
              );
            })}
          </>
        )}
      </Card>

      <PageBlocks pageKey="intake" region="bottom" navigate={onNavigate} />
      </>)}

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
          onCreated={(st) => {
            setCreating(false);
            onNavigate(`#/studies/${st.id}`);
          }}
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

/* ---------- Commit modal: the work stream moment ---------- */

