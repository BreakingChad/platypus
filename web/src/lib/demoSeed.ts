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
    stage_key_preference: ["activation", "regulatory"],
  },
  {
    title: "Long-acting GLP-1 in adolescent obesity",
    sponsor: "MetabolixRx",
    therapeutic_area: "Endocrinology",
    phase: "Phase III",
    pi_name: "Dr. Priya Rao",
    nct: "NCT05234567",
    priority: "standard",
    stage_key_preference: ["budget_contract", "contract_budget", "regulatory"],
  },
  {
    title: "Novel JAK inhibitor for moderate-to-severe atopic dermatitis",
    sponsor: "Inflectra Bio",
    therapeutic_area: "Dermatology",
    phase: "Phase II",
    pi_name: "Dr. Jordan Hayes",
    nct: "NCT05345678",
    priority: "standard",
    stage_key_preference: ["feasibility", "intake"],
  },
  {
    title: "Cardiac device early feasibility study — second-generation lead",
    sponsor: "Cardiac Innovations LLC",
    therapeutic_area: "Cardiology",
    phase: "EFS",
    pi_name: "Dr. Marcus Patel",
    nct: "NCT05456789",
    priority: "high",
    stage_key_preference: ["site_qualification", "regulatory", "site_selection"],
  },
  {
    title: "Pediatric pulmonary hypertension registry — multi-site",
    sponsor: "Riverside Children's Research Foundation",
    therapeutic_area: "Pediatrics",
    phase: "Observational",
    pi_name: "Dr. Sam Reynolds",
    nct: "NCT05567890",
    priority: "standard",
    stage_key_preference: ["site_selection", "regulatory", "intake"],
  },
  {
    title: "Investigator-initiated trial — biomarker-guided dosing in NSCLC",
    sponsor: "Internal — IIT",
    therapeutic_area: "Oncology",
    phase: "Phase II",
    pi_name: "Dr. Maria Vargas",
    nct: "NCT05678901",
    priority: "high",
    stage_key_preference: ["activation", "regulatory", "budget_contract"],
  },
  {
    title: "Phase I first-in-human dose-escalation in advanced solid tumors",
    sponsor: "Helix Oncology",
    therapeutic_area: "Oncology",
    phase: "Phase I",
    pi_name: "Dr. Avery Chen",
    nct: "NCT05789012",
    priority: "standard",
    stage_key_preference: ["intake", "feasibility"],
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

/** The seed's task flow: find the org's default (or first active) workstream,
 *  creating "Standard startup" on the first active pipeline if none exists.
 *  Seeded studies and modules both hang off it — without this, seeded data
 *  predates the pipeline/workstream model and the engine never fires. */
async function ensureDemoWorkstream(orgId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from("workstreams")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);
  if (existing && existing.length > 0) return (existing[0] as any).id as string;

  const { data: pls } = await supabase
    .from("pipelines")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("position", { ascending: true })
    .limit(1);
  const pipelineId = (pls?.[0] as any)?.id ?? null;
  if (!pipelineId) return null;

  const { data: created, error } = await supabase
    .from("workstreams")
    .insert({
      org_id: orgId,
      pipeline_id: pipelineId,
      name: "Standard startup",
      description: "Seeded demo task flow — rename or replace in Workstreams → Task flows.",
      status: "active",
      is_default: true,
    } as any)
    .select("id")
    .single();
  return error ? null : ((created as any).id as string);
}

/** Find-or-create sponsor rows for the demo sponsor names → name-to-id map. */
async function ensureDemoSponsors(orgId: string, names: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: existing } = await supabase
    .from("sponsors")
    .select("id, name")
    .eq("org_id", orgId);
  for (const r of (existing ?? []) as any[]) map.set(r.name, r.id);
  for (const name of names) {
    if (map.has(name)) continue;
    const { data, error } = await supabase
      .from("sponsors")
      .insert({ org_id: orgId, name, status: "active" } as any)
      .select("id")
      .single();
    if (!error && data) map.set(name, (data as any).id);
  }
  return map;
}

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

  // Wire seeded studies into the current model: a real task flow + sponsor FKs.
  const wsId = await ensureDemoWorkstream(orgId);
  const sponsorIds = await ensureDemoSponsors(
    orgId,
    [...new Set(DEMO_STUDIES.map((d) => d.sponsor))]
  );

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
      sponsor_id: sponsorIds.get(d.sponsor) ?? null,
      workstream_id: wsId,
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


/** Seed a handful of representative workflow_modules + task templates so a
 *  fresh org demo-visualizes the Work Stream engine immediately. Idempotent
 *  — skips if any modules already exist for this org.
 */
export type WorkStreamSeedResult = {
  modules: number;
  templates: number;
  skipped: boolean;
};

const DEMO_WORK_STREAMS: {
  stage_key: string;
  name: string;
  description: string;
  templates: { title: string; kind: string; due_offset_days: number | null }[];
}[] = [
  {
    stage_key: "intake",
    name: "Intake triage",
    description: "Initial scan of the protocol to decide commit / decline.",
    templates: [
      { title: "Log protocol + sponsor in pipeline tracker", kind: "manual", due_offset_days: 1 },
      { title: "Scope feasibility & resource fit", kind: "manual", due_offset_days: 5 },
      { title: "Decision: commit, decline, or hold", kind: "handoff", due_offset_days: 7 },
    ],
  },
  {
    stage_key: "study_startup",
    name: "Startup coordination",
    description: "Kick-off coordination once the study is committed.",
    templates: [
      { title: "Set up the study folder + binder shell", kind: "manual", due_offset_days: 2 },
      { title: "Build the activation timeline draft", kind: "manual", due_offset_days: 4 },
      { title: "Schedule sponsor kick-off call", kind: "external_handoff", due_offset_days: 7 },
    ],
  },
  {
    stage_key: "feasibility",
    name: "Feasibility assessment",
    description: "Confirm the site can run the study end-to-end.",
    templates: [
      { title: "Pull patient population estimate from EHR", kind: "manual", due_offset_days: 3 },
      { title: "Confirm acuity score + score sign-off", kind: "manual", due_offset_days: 7 },
      { title: "Submit feasibility questionnaire to sponsor", kind: "external_handoff", due_offset_days: 10 },
    ],
  },
  {
    stage_key: "regulatory",
    name: "Regulatory submission",
    description: "IRB + ancillary committee approvals.",
    templates: [
      { title: "Compile IRB submission packet", kind: "manual", due_offset_days: 7 },
      { title: "Submit to IRB", kind: "external_handoff", due_offset_days: 10 },
      { title: "Respond to IRB stipulations", kind: "manual", due_offset_days: 30 },
    ],
  },
  {
    stage_key: "contract_budget",
    name: "Contract & budget",
    description: "Negotiation rounds with sponsor / CRO.",
    templates: [
      { title: "Draft internal budget", kind: "manual", due_offset_days: 5 },
      { title: "Send first redline to sponsor", kind: "external_handoff", due_offset_days: 10 },
      { title: "Final budget approval", kind: "manual", due_offset_days: 30 },
    ],
  },
  {
    stage_key: "site_initiation",
    name: "Site initiation",
    description: "Pre-activation operational checks.",
    templates: [
      { title: "Confirm IP availability + delivery window", kind: "manual", due_offset_days: 3 },
      { title: "Schedule + run SIV", kind: "manual", due_offset_days: 14 },
      { title: "Training attestations complete", kind: "manual", due_offset_days: 21 },
    ],
  },
];

export async function seedDemoWorkStreams(orgId: string): Promise<WorkStreamSeedResult> {
  // Skip if any modules already exist in this org — preserves admin work.
  const { count } = await supabase
    .from("workflow_modules")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId);
  if ((count ?? 0) > 0) {
    return { modules: 0, templates: 0, skipped: true };
  }

  // Modules belong to a task flow (0034) — without this they're invisible in
  // the builder and the engine never matches them.
  const wsId = await ensureDemoWorkstream(orgId);

  let modulesInserted = 0;
  let templatesInserted = 0;

  for (let i = 0; i < DEMO_WORK_STREAMS.length; i += 1) {
    const m = DEMO_WORK_STREAMS[i];
    const { data: modRow, error: modErr } = await supabase
      .from("workflow_modules")
      .insert({
        org_id: orgId,
        stage_key: m.stage_key,
        name: m.name,
        description: m.description,
        enabled: true,
        position: (i + 1) * 10,
        workstream_id: wsId,
      } as any)
      .select("id")
      .single();
    if (modErr || !modRow) continue;
    modulesInserted += 1;

    const tplInserts = m.templates.map((t, idx) => ({
      module_id: (modRow as any).id,
      kind: t.kind,
      title: t.title,
      due_offset_days: t.due_offset_days,
      position: (idx + 1) * 10,
    }));
    const { error: tplErr } = await supabase
      .from("workflow_task_templates")
      .insert(tplInserts as any);
    if (!tplErr) templatesInserted += tplInserts.length;
  }

  return { modules: modulesInserted, templates: templatesInserted, skipped: false };
}


/* ============================================================================
 * Demo sites — the "site information collection system" needs believable
 * profiles. Names are playful but plausible (per demo guidance).
 * ========================================================================== */

const DEMO_SITES = [
  {
    name: "St. Mallard Medical Center",
    city: "Phoenix", state: "AZ", country: "USA",
    profile: {
      siteCode: "SMMC-01",
      institutionType: "Academic medical center",
      siteContactName: "Dana Webb",
      siteContactEmail: "d.webb@stmallard.org",
      siteContactPhone: "+1 (602) 555-0142",
      timezone: "America/Phoenix",
    },
  },
  {
    name: "Billabong Clinical Research",
    city: "Austin", state: "TX", country: "USA",
    profile: {
      siteCode: "BCR-02",
      institutionType: "Dedicated research site",
      siteContactName: "Theo Park",
      siteContactEmail: "tpark@billabongcr.com",
      siteContactPhone: "+1 (512) 555-0117",
      timezone: "America/Chicago",
    },
  },
  {
    name: "Webbed Foot Health Network — North Campus",
    city: "Portland", state: "OR", country: "USA",
    profile: {
      siteCode: "WFHN-N",
      institutionType: "Community hospital",
      siteContactName: "Rosa Delgado",
      siteContactEmail: "rdelgado@webbedfoot.health",
      siteContactPhone: "+1 (503) 555-0186",
      timezone: "America/Los_Angeles",
    },
  },
];

export type SiteSeedResult = { sites: number; linked: number };

/** Seed demo sites (idempotent by name) and link any unlinked demo studies
 *  round-robin so site rosters look alive. */
export async function seedDemoSites(orgId: string): Promise<SiteSeedResult> {
  const { data: existing } = await supabase
    .from("sites")
    .select("id, name")
    .eq("org_id", orgId);
  const byName = new Map<string, string>(
    ((existing ?? []) as any[]).map((r) => [r.name, r.id])
  );

  let created = 0;
  const siteIds: string[] = [];
  for (const d of DEMO_SITES) {
    const have = byName.get(d.name);
    if (have) {
      siteIds.push(have);
      continue;
    }
    const { data, error } = await supabase
      .from("sites")
      .insert({
        org_id: orgId,
        name: d.name,
        city: d.city,
        state: d.state,
        country: d.country,
        profile: d.profile,
      } as any)
      .select("id")
      .single();
    if (!error && data) {
      siteIds.push((data as any).id);
      created += 1;
    }
  }

  // Link unlinked open studies round-robin.
  let linked = 0;
  if (siteIds.length > 0) {
    const { data: studies } = await supabase
      .from("studies")
      .select("id, site_id")
      .eq("org_id", orgId)
      .is("site_id", null);
    let i = 0;
    for (const st of (studies ?? []) as any[]) {
      const { error } = await supabase
        .from("studies")
        .update({ site_id: siteIds[i % siteIds.length] } as any)
        .eq("id", st.id);
      if (!error) {
        linked += 1;
        i += 1;
      }
    }
  }
  return { sites: created, linked };
}

/* ------------------------------------------------------------------ */
/*  Demo story beats — make the "system noticing things" moment real   */
/* ------------------------------------------------------------------ */

export type StorySeedResult = {
  notes: number;
  tasks: number;
  oooSet: boolean;
  heroCode: string | null;
};

/** Stages the demo narrative on the most mid-process seeded study:
 *   - three believable study notes (intake context → handoff → risk)
 *   - an OVERDUE escalation task (the red pill the demo points at)
 *   - a completed handoff + an open handoff (the baton, mid-pass)
 *   - vacation coverage: first non-you member goes OOO with you as
 *     delegate — or you go OOO delegating to them ("Carol → Steve")
 *  Idempotent: skips anything already present (matched by title/body).
 */
export async function seedDemoStory(orgId: string): Promise<StorySeedResult> {
  const result: StorySeedResult = { notes: 0, tasks: 0, oooSet: false, heroCode: null };

  // Hero = a non-closed seeded study, preferring one mid-pipeline.
  const { data: studies } = await supabase
    .from("studies")
    .select("id, code, title, stage_key, closed")
    .eq("org_id", orgId)
    .eq("closed", false)
    .order("created_at", { ascending: true });
  const rows = (studies ?? []) as any[];
  if (rows.length === 0) return result;
  const hero =
    rows.find((r) => r.stage_key && !["intake", "regulatory"].includes(r.stage_key)) ?? rows[0];
  result.heroCode = hero.code;

  const me = (await supabase.auth.getUser()).data.user;
  const meId = me?.id ?? null;

  // Make the demo driver the PI of the hero study — the 0044 name-link
  // trigger picks it up, so "you're PI" chips and My Studies light up.
  if (meId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", meId)
      .maybeSingle();
    const myName = (prof as any)?.full_name ?? null;
    if (myName) {
      await supabase.from("studies").update({ pi_name: myName } as any).eq("id", hero.id);
    }
  }

  // ---- Notes (append-only; dedupe on body prefix) ----
  const { data: existingNotes } = await supabase
    .from("study_notes")
    .select("body")
    .eq("study_id", hero.id);
  const noteBodies = new Set(((existingNotes ?? []) as any[]).map((n) => String(n.body)));
  const NOTES = [
    "Sponsor confirmed enrollment target moved to 24 — CDA addendum filed. Budget assumptions need a second pass before the contracting call.",
    "Handed feasibility packet to Budgets & Contracts. Open question for the site call: pharmacy hood certification expires next month — renewal already scheduled?",
    "PI flagged a staffing concern for Q3 (research coordinator out on leave). Watch workload before committing to the sponsor's timeline.",
  ];
  for (const body of NOTES) {
    if ([...noteBodies].some((b) => b.startsWith(body.slice(0, 40)))) continue;
    const { error } = await supabase.from("study_notes").insert({
      org_id: orgId,
      study_id: hero.id,
      body,
      author_id: meId,
      author_email: me?.email ?? null,
    } as any);
    if (!error) result.notes += 1;
  }

  // ---- Tasks: overdue escalation + handoff pair (dedupe on title) ----
  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("title")
    .eq("study_id", hero.id);
  const taskTitles = new Set(((existingTasks ?? []) as any[]).map((t) => String(t.title)));
  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86400000).toISOString();
  const STORY_TASKS: any[] = [
    {
      title: "ESCALATION: Budget sign-off blocked — sponsor rate card mismatch",
      description:
        "Per-visit rates in the sponsor budget template don't match the CTA draft. Needs director decision before the contracting call.",
      kind: "escalation",
      status: "open",
      due_at: iso(-2), // overdue — the red pill
      position: 0,
    },
    {
      title: "Handoff: feasibility packet → Budgets & Contracts",
      description: "Acuity score + workforce snapshot attached. Over to contracting.",
      kind: "handoff",
      status: "done",
      due_at: iso(-6),
      completed_at: iso(-5),
      position: 1,
    },
    {
      title: "Handoff: draft CTA → Regulatory for IRB submission prep",
      description: "Waiting on the budget escalation above before this baton passes.",
      kind: "handoff",
      status: "open",
      due_at: iso(3),
      position: 2,
    },
  ];
  for (const t of STORY_TASKS) {
    if (taskTitles.has(t.title)) continue;
    const { error } = await supabase.from("tasks").insert({
      org_id: orgId,
      study_id: hero.id,
      stage_key: hero.stage_key,
      created_by: meId,
      completed_by: t.status === "done" ? meId : null,
      ...t,
    } as any);
    if (!error) result.tasks += 1;
  }

  // ---- Vacation coverage (Carol → Steve) ----
  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, ooo_until, ooo_delegate_user_id")
    .eq("org_id", orgId);
  const mrows = (members ?? []) as any[];
  if (mrows.length >= 2 && meId) {
    const other = mrows.find((m) => m.user_id !== meId);
    const already = mrows.some((m) => m.ooo_until && new Date(m.ooo_until).getTime() > now);
    if (other && !already) {
      // The OTHER member is on vacation; work routes to YOU — so the demo
      // driver sees the coverage banner + rerouted tasks first-hand.
      const { error } = await supabase
        .from("org_members")
        .update({ ooo_until: iso(7), ooo_delegate_user_id: meId } as any)
        .eq("org_id", orgId)
        .eq("user_id", other.user_id);
      if (!error) result.oooSet = true;
    }
  }

  return result;
}
