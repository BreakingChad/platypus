import { supabase } from "./supabase";
import type { PipelineStageRow, StudyRow } from "./types";

/** Demo studies — generic, anonymized, plausible across most clinical research
 *  sites. Codes are generated from the org's project_id_prefix at insert time
 *  so they fit each tenant's pattern. */
type DemoStudy = {
  title: string;
  sponsor: string;
  therapeutic_area: string;
  phase: string;
  pi_name: string;
  nct: string;
  priority: string;
  stage_key_preference: string[]; // try these in order; fall back to first stage
  closed?: boolean;
};

const DEMO_STUDIES: DemoStudy[] = [
  {
    title: "Phase II adjunctive therapy for treatment-resistant depression",
    sponsor: "Synaptic Therapeutics",
    therapeutic_area: "Psychiatry",
    phase: "Phase II",
    pi_name: "Dr. Avery Chen",
    nct: "NCT05123456",
    priority: "high",
    stage_key_preference: ["activation", "site_initiation", "regulatory"],
  },
  {
    title: "Long-acting GLP-1 in adolescent obesity",
    sponsor: "MetabolixRx",
    therapeutic_area: "Endocrinology",
    phase: "Phase III",
    pi_name: "Dr. Priya Rao",
    nct: "NCT05234567",
    priority: "standard",
    stage_key_preference: ["contract_budget", "regulatory", "feasibility"],
  },
  {
    title: "Novel JAK inhibitor for moderate-to-severe atopic dermatitis",
    sponsor: "Inflectra Bio",
    therapeutic_area: "Dermatology",
    phase: "Phase II",
    pi_name: "Dr. Jordan Hayes",
    nct: "NCT05345678",
    priority: "standard",
    stage_key_preference: ["feasibility", "study_startup", "intake"],
  },
  {
    title: "Cardiac device early feasibility study — second-generation lead",
    sponsor: "Cardiac Innovations LLC",
    therapeutic_area: "Cardiology",
    phase: "EFS",
    pi_name: "Dr. Marcus Patel",
    nct: "NCT05456789",
    priority: "high",
    stage_key_preference: ["regulatory", "contract_budget", "site_selection"],
  },
  {
    title: "Pediatric pulmonary hypertension registry — multi-site",
    sponsor: "Riverside Children's Research Foundation",
    therapeutic_area: "Pediatrics",
    phase: "Observational",
    pi_name: "Dr. Sam Reynolds",
    nct: "NCT05567890",
    priority: "standard",
    stage_key_preference: ["site_initiation", "regulatory", "intake"],
  },
  {
    title: "Investigator-initiated trial — biomarker-guided dosing in NSCLC",
    sponsor: "Internal — IIT",
    therapeutic_area: "Oncology",
    phase: "Phase II",
    pi_name: "Dr. Maria Vargas",
    nct: "NCT05678901",
    priority: "high",
    stage_key_preference: ["activation", "regulatory", "contract_budget"],
  },
  {
    title: "Phase I first-in-human dose-escalation in advanced solid tumors",
    sponsor: "Helix Oncology",
    therapeutic_area: "Oncology",
    phase: "Phase I",
    pi_name: "Dr. Avery Chen",
    nct: "NCT05789012",
    priority: "standard",
    stage_key_preference: ["intake", "feasibility", "study_startup"],
  },
  {
    title: "Closed: alopecia areata phase II program — final report submitted",
    sponsor: "Inflectra Bio",
    therapeutic_area: "Dermatology",
    phase: "Phase II",
    pi_name: "Dr. Jordan Hayes",
    nct: "NCT05890123",
    priority: "standard",
    stage_key_preference: ["activation"],
    closed: true,
  },
];

export type SeedResult = {
  inserted: number;
  skipped: number;
  total: number;
};

/** Seed demo studies into an org. Skips any whose NCT already exists.
 *  Generates fresh codes from the org's project_id_prefix.
 */
export async function seedDemoStudies(
  orgId: string,
  stages: PipelineStageRow[]
): Promise<SeedResult> {
  // Look up org prefix
  const { data: orgRow } = await supabase
    .from("orgs")
    .select("project_id_prefix")
    .eq("id", orgId)
    .maybeSingle();
  const prefix = (orgRow as any)?.project_id_prefix || "STU";

  // Find existing codes + ncts for dedup
  const { data: existing } = await supabase
    .from("studies")
    .select("code, nct")
    .eq("org_id", orgId);
  const existingCodes = new Set<string>((existing ?? []).map((r: any) => r.code));
  const existingNcts = new Set<string>(
    (existing ?? []).filter((r: any) => r.nct).map((r: any) => r.nct)
  );

  let max = 0;
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$");
  for (const code of existingCodes) {
    const m = String(code).match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }

  // Build the candidate rows
  const stageByKey = new Map<string, PipelineStageRow>(stages.map((s) => [s.key, s]));
  const firstStage = stages[0]?.key ?? null;
  const candidates: Partial<StudyRow>[] = [];
  for (const d of DEMO_STUDIES) {
    if (existingNcts.has(d.nct)) continue;
    let stage_key: string | null = null;
    for (const pref of d.stage_key_preference) {
      if (stageByKey.has(pref)) {
        stage_key = pref;
        break;
      }
    }
    if (!stage_key) stage_key = firstStage;

    let next = max + 1;
    while (existingCodes.has(`${prefix}-${String(next).padStart(3, "0")}`)) next += 1;
    const code = `${prefix}-${String(next).padStart(3, "0")}`;
    existingCodes.add(code);
    max = next;

    candidates.push({
      org_id: orgId,
      code,
      title: d.title,
      sponsor: d.sponsor,
      therapeutic_area: d.therapeutic_area,
      phase: d.phase,
      pi_name: d.pi_name,
      nct: d.nct,
      priority: d.priority,
      stage_key,
      intake_status: "submitted",
      intake_date: new Date().toISOString(),
      committed_at:
        stage_key && stage_key !== "intake" ? new Date().toISOString() : null,
      closed: d.closed ?? false,
      closed_at: d.closed ? new Date().toISOString() : null,
      custom_field_values: {},
    });
  }

  const skipped = DEMO_STUDIES.length - candidates.length;

  if (candidates.length === 0) {
    return { inserted: 0, skipped, total: DEMO_STUDIES.length };
  }

  const { error } = await supabase.from("studies").insert(candidates as any);
  if (error) throw error;

  return { inserted: candidates.length, skipped, total: DEMO_STUDIES.length };
}
