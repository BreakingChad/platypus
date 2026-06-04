import { friendlyError } from "../lib/errors";
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
 *  portfolio (with a preview of the work stream tasks that will fire), or
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

