import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import type {
  FieldDefinitionRow,
  PipelineStageRow,
  StudyRow,
  TeamRow,
  AccessRoleRow,
} from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import type { BlockContext } from "./registry";

/** SetupChecklistBlock — admin-only "what to do first" surface for fresh orgs.
 *  Walks the org through the configuration steps that make Platypus useful:
 *  org details, stages, fields, teams, access role assignments, first study.
 *
 *  Visibility rule: shown only to admins, and only while at least one step
 *  is still pending. Hides itself the moment everything is complete.
 */
export function SetupChecklistBlock({ ctx }: { ctx: BlockContext }) {
  const { isAdmin } = useCurrentMember();
  const { orgId } = useCurrentOrg();
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const stages = useOrgTable<PipelineStageRow>("pipeline_stages", { orderBy: "position" });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const teams = useOrgTable<TeamRow>("teams", { orderBy: "position" });
  const accessRoles = useOrgTable<AccessRoleRow>("access_roles");

  const [orgName, setOrgName] = useState<string | null>(null);

  // Load org name so we can detect "still default"
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("orgs")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      if (!cancelled) setOrgName(data?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!isAdmin) return null;

  // Compute steps
  const orgNamed = Boolean(orgName) && orgName !== "My Organization" && orgName !== "Platypus";
  const hasStages = stages.rows.length > 0;
  const enabledStudyFields = fields.rows.filter((f) => f.entity_type === "study" && f.enabled).length;
  const hasFields = enabledStudyFields > 0;
  const hasTeams = teams.rows.length > 0;
  const hasAccessRoles = accessRoles.rows.length > 0;
  const hasStudies = studies.rows.length > 0;

  const steps: Step[] = [
    {
      key: "org",
      label: "Name your organization",
      sub: orgNamed ? orgName! : "Currently using the placeholder name",
      done: orgNamed,
      onClick: () => ctx.navigate("#/settings/org"),
    },
    {
      key: "stages",
      label: "Design the pipeline lifecycle",
      sub: hasStages ? `${stages.rows.length} stages configured` : "No stages yet",
      done: hasStages,
      onClick: () => ctx.navigate("#/settings/stages"),
    },
    {
      key: "fields",
      label: "Choose study fields",
      sub: hasFields ? `${enabledStudyFields} fields enabled` : "Pick what every study captures",
      done: hasFields,
      onClick: () => ctx.navigate("#/settings/fields"),
    },
    {
      key: "teams",
      label: "Build your teams",
      sub: hasTeams ? `${teams.rows.length} team${teams.rows.length === 1 ? "" : "s"}` : "Add the teams that own work",
      done: hasTeams,
      onClick: () => ctx.navigate("#/settings/teams"),
    },
    {
      key: "access",
      label: "Confirm access roles",
      sub: hasAccessRoles
        ? `${accessRoles.rows.length} role${accessRoles.rows.length === 1 ? "" : "s"}`
        : "Set who can see what",
      done: hasAccessRoles,
      onClick: () => ctx.navigate("#/settings/access"),
    },
    {
      key: "studies",
      label: "Add your first study",
      sub: hasStudies
        ? `${studies.rows.length} stud${studies.rows.length === 1 ? "y" : "ies"} in your portfolio`
        : "Create a study or load 8 demo studies",
      done: hasStudies,
      onClick: () => ctx.navigate("#/studies"),
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);

  if (completed === total) return null; // hide once everything is in place

  return (
    <section>
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-display font-bold text-slate-900">
          Set up your workspace
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500">
            {completed} / {total} complete
          </span>
          <Button size="sm" variant="primary" onClick={() => ctx.navigate("#/setup")}>
            Guided setup
          </Button>
        </div>
      </div>
      <Card flush className="overflow-hidden">
        {/* Progress bar */}
        <div className="h-1.5 bg-slate-100">
          <div
            className="h-full bg-brand-gradient transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="divide-y divide-slate-100">
          {steps.map((s) => (
            <li key={s.key}>
              <button
                onClick={s.onClick}
                className={
                  "w-full text-left px-4 py-3 flex items-center gap-3 transition group " +
                  (s.done ? "hover:bg-slate-50" : "hover:bg-brand-50/30")
                }
              >
                <div
                  className={
                    "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition " +
                    (s.done
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-400 group-hover:bg-brand-100 group-hover:text-brand-700")
                  }
                >
                  {s.done ? (
                    <Icon name="check" size={12} />
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={
                      "text-sm font-semibold " +
                      (s.done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900")
                    }
                  >
                    {s.label}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{s.sub}</div>
                </div>
                <Icon
                  name="chevron-right"
                  size={14}
                  className={
                    "text-slate-300 transition " +
                    (s.done ? "" : "group-hover:text-brand-500 group-hover:translate-x-0.5")
                  }
                />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

type Step = {
  key: string;
  label: string;
  sub: string;
  done: boolean;
  onClick: () => void;
};
