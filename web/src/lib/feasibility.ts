import { supabase } from "./supabase";
import { writeAuditEvent } from "./auditLog";
import type { StudyRow } from "./types";

/** Feasibility models — M11 structured protocol + acuity scoring.
 *  Both live in studies.feasibility (jsonb):
 *    { m11?: M11Data, acuity?: AcuityData }
 */

/* ============================ M11 ============================ */

export type M11Section = { title: string; body: string };
export type M11Data = {
  fileName: string;
  ingestedAt: string;
  sections: Record<string, M11Section>;
};

/** The 11 top-level sections of the ICH M11 Common Protocol Template. */
export const M11_SECTIONS: { id: string; label: string; icon: string }[] = [
  { id: "1",  label: "Protocol summary",                          icon: "file" },
  { id: "2",  label: "Introduction & background",                 icon: "info" },
  { id: "3",  label: "Objectives & endpoints",                    icon: "check" },
  { id: "4",  label: "Study design",                              icon: "layers" },
  { id: "5",  label: "Study population (eligibility)",            icon: "users" },
  { id: "6",  label: "Study intervention (IP)",                   icon: "file" },
  { id: "7",  label: "Study procedures & schedule of activities", icon: "inbox" },
  { id: "8",  label: "Statistical considerations",                icon: "layers" },
  { id: "9",  label: "Safety & adverse-event reporting",          icon: "alert" },
  { id: "10", label: "Quality control & assurance",               icon: "shield" },
  { id: "11", label: "Ethics, regulatory & informed consent",     icon: "lock" },
];

/** Demo M11 content — ported from the BEACON-3 demo seed. In production this
 *  arrives from the M11 ingestion pipeline (.docx / XML upload). */
export const M11_DEMO: M11Data = {
  fileName: "Protocol v2.1 — M11 export.docx",
  ingestedAt: new Date().toISOString(),
  sections: {
    "1":  { title: "Protocol summary", body: "A Phase III, randomized, double-blind, placebo-controlled study evaluating MX-2031 in combination with standard-of-care targeted therapy in adults with previously-treated BRAF V600E-mutated unresectable Stage III/IV melanoma. Primary endpoint: overall survival." },
    "2":  { title: "Background", body: "BRAF-mutated melanoma carries a 5-year survival of ~30% in the metastatic setting despite targeted therapy + checkpoint blockade. MX-2031 is a first-in-class oral selective MEK1 inhibitor with preclinical synergy data demonstrating durable response in resistant tumor models. The rationale for combination is to overcome bypass-resistance mediated by MAPK pathway reactivation." },
    "3":  { title: "Objectives & endpoints", body: "PRIMARY: Overall survival (OS). SECONDARY: Progression-free survival (PFS), objective response rate (ORR) per RECIST v1.1, duration of response, safety/tolerability. EXPLORATORY: Quality of life (FACT-M, EQ-5D-5L), pharmacokinetics, biomarkers of response (tumor BRAF/MEK pathway reactivation)." },
    "4":  { title: "Study design", body: "Multicenter, randomized 1:1, double-blind, placebo-controlled, parallel-group. Stratification by ECOG (0 vs 1), prior lines of therapy (1 vs ≥2), and lactate dehydrogenase (≤ULN vs >ULN). Treatment continues until PD, intolerance, or withdrawal. Follow-up for survival every 12 weeks. Estimated enrollment: 540 patients across ~60 sites globally." },
    "5":  { title: "Study population — eligibility", body: "INCLUSION: Adults ≥18, histologically confirmed unresectable Stage III/IV melanoma, BRAF V600E mutation by central testing, ECOG 0–1, measurable disease per RECIST v1.1, life expectancy ≥3 months, adequate organ function. EXCLUSION: Prior MEK inhibitor exposure, untreated CNS metastases, ocular melanoma, active autoimmune disease requiring systemic immunosuppression, QTcF >480ms, pregnancy/lactation." },
    "6":  { title: "Study intervention", body: "MX-2031 60mg PO QD continuous + standard-of-care BRAF/MEK doublet (encorafenib 450mg PO QD + binimetinib 45mg PO BID), OR matching placebo + standard-of-care doublet. Dose modifications per protocol Appendix B. Drug supply provided by sponsor." },
    "7":  { title: "Schedule of activities", body: "SCREENING (Day -28 to -1): consent, eligibility, central BRAF testing, baseline imaging, labs, ECG, biomarker collection. CYCLE 1 (Day 1, 8, 15, 22): vitals, AE assessment, drug compliance, safety labs. EVERY 12 WEEKS: tumor imaging (CT chest/abdomen/pelvis + brain MRI), QoL assessments. END OF TREATMENT visit + safety follow-up at 30 + 90 days. SURVIVAL FOLLOW-UP: every 12 weeks until death or study close." },
    "8":  { title: "Statistical considerations", body: "Sample size: 540 patients provides 85% power to detect HR=0.72 (median OS 24 → 33 mo) at one-sided α=0.025, assuming 18-month accrual + 24-month minimum follow-up. Primary analysis: stratified log-rank test on ITT. Interim futility analysis at 50% events. Hierarchical testing: OS → PFS → ORR." },
    "9":  { title: "Safety & adverse events", body: "All AEs graded per CTCAE v5.0. SAEs reported within 24 hours of awareness. Suspected unexpected serious adverse reactions (SUSARs) reported per ICH E2A. AESIs include: cardiomyopathy (ejection-fraction monitoring required), retinal vein occlusion, hepatotoxicity, dermatologic reactions. DSMB reviews every 6 months." },
    "10": { title: "Quality control & assurance", body: "Sponsor monitoring per ICH E6(R2). Risk-based monitoring with central + on-site visits. Site initiation visits required prior to enrollment. Data management per CDISC standards (CDASH input, SDTM tabulation, ADaM analysis). Source data verification on 100% of primary endpoint data, sample of secondary." },
    "11": { title: "Ethics & consent", body: "Conducted per Declaration of Helsinki, ICH E6(R2), 21 CFR 312, and applicable national/local regulations. IRB/EC approval required prior to site activation. Subjects (or LAR) provide written informed consent prior to any study-specific procedure. Re-consent for major amendments. Subjects free to withdraw at any time." },
  },
};

/* =========================== Acuity =========================== */

export type AcuityData = {
  scores: Record<string, number>;
  notes: string;
  total: number;
  category: string;
  standard: string;
  standardLabel?: string;
  scoredBy: string | null;
  scoredByEmail?: string | null;
  scoredAt: string;
};

export const ACUITY_DIMENSIONS: { id: string; label: string; desc: string }[] = [
  { id: "protocol",   label: "Protocol complexity",           desc: "Visit count, procedure burden, schedule complexity." },
  { id: "population", label: "Patient population difficulty", desc: "Recruitment difficulty, vulnerable population, eligibility tightness." },
  { id: "ip",         label: "Investigational product",       desc: "Handling, storage, infusion vs oral, controlled-substance status." },
  { id: "safety",     label: "Safety profile / monitoring",   desc: "AE frequency, AESIs, DSMB cadence, ECG/imaging burden." },
  { id: "data",       label: "Data collection burden",        desc: "CRF page count, central labs, biomarkers, ePRO frequency." },
  { id: "regulatory", label: "Regulatory complexity",         desc: "FDA/EMA dual filing, IRB sub-studies, IND-safety reporting." },
];

export const ACUITY_STANDARDS: Record<string, { label: string; desc: string }> = {
  opal:        { label: "Opal (default)", desc: "6 dimensions, 1–5 scale. Industry-standard for mid-size sites." },
  md_anderson: { label: "MD Anderson",    desc: "5 dimensions, weighted oncology-specific scoring." },
  custom:      { label: "Custom",         desc: "Org-defined dimensions + cutoffs (admin-configured)." },
};

export function acuityCategoryFor(total: number): {
  label: string;
  tone: "success" | "brand" | "warning" | "danger";
} {
  if (total <= 12) return { label: "Routine",     tone: "success" };
  if (total <= 18) return { label: "Moderate",    tone: "brand" };
  if (total <= 24) return { label: "Complex",     tone: "warning" };
  return                  { label: "High-acuity", tone: "danger" };
}

/* ====================== persistence helpers ====================== */

type FeasibilityBlob = { m11?: M11Data; acuity?: AcuityData };

export function feasibilityOf(study: StudyRow): FeasibilityBlob {
  return ((study as any).feasibility ?? {}) as FeasibilityBlob;
}

async function writeFeasibility(
  study: StudyRow,
  next: FeasibilityBlob
): Promise<void> {
  const { error } = await supabase
    .from("studies")
    .update({ feasibility: next } as any)
    .eq("id", study.id);
  if (error) throw error;
}

export async function ingestDemoM11(opts: {
  orgId: string;
  study: StudyRow;
  actorUserId: string;
  actorEmail: string | null;
}): Promise<M11Data> {
  const m11: M11Data = {
    ...M11_DEMO,
    fileName: `${opts.study.code} ${M11_DEMO.fileName}`,
    ingestedAt: new Date().toISOString(),
  };
  await writeFeasibility(opts.study, { ...feasibilityOf(opts.study), m11 });
  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "study",
    entityId: opts.study.id,
    action: "m11_ingested",
    payload: { file_name: m11.fileName, sections: Object.keys(m11.sections).length },
  });
  return m11;
}

export async function saveAcuity(opts: {
  orgId: string;
  study: StudyRow;
  scores: Record<string, number>;
  notes: string;
  standard: string;
  actorUserId: string;
  actorEmail: string | null;
}): Promise<AcuityData> {
  const total = Object.values(opts.scores).reduce((a, v) => a + (v || 0), 0);
  const cat = acuityCategoryFor(total);
  const acuity: AcuityData = {
    scores: opts.scores,
    notes: opts.notes,
    total,
    category: cat.label,
    standard: opts.standard,
    standardLabel: ACUITY_STANDARDS[opts.standard]?.label,
    scoredBy: opts.actorUserId,
    scoredByEmail: opts.actorEmail,
    scoredAt: new Date().toISOString(),
  };
  await writeFeasibility(opts.study, { ...feasibilityOf(opts.study), acuity });
  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "study",
    entityId: opts.study.id,
    action: "acuity_scored",
    payload: {
      total,
      category: cat.label,
      standard: opts.standard,
      scores: opts.scores,
    },
  });
  return acuity;
}
