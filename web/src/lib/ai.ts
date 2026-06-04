import type { StudyRow } from "./types";

/** Client for the server-side AI proxy (/api/ai-summary). The Anthropic key
 *  lives only in the server env — this module never sees it. */

export type AiStatus = { configured: boolean };

export async function aiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch("/api/ai-summary", { method: "GET" });
    if (!r.ok) return { configured: false };
    const d = await r.json();
    return { configured: Boolean(d.configured) };
  } catch {
    return { configured: false };
  }
}

/** Map a study row to the human-labeled fields the model summarizes. */
function studyFields(study: StudyRow): Record<string, unknown> {
  const cf = study.custom_field_values ?? {};
  return {
    "Short title": study.title,
    Phase: study.phase,
    "Therapeutic area": study.therapeutic_area,
    Sponsor: study.sponsor,
    "Study type": study.study_kind,
    "NCT number": study.nct,
    "PI": study.pi_name,
    Indication: (cf as any).indication ?? (cf as any).disease,
    Intervention: (cf as any).intervention,
    "Enrollment target": (cf as any).enrollmentTarget ?? (cf as any).accrualGoal,
    "Pharmacy required": (cf as any).pharmacyRequired,
    "Imaging required": (cf as any).imagingRequired,
    "Central lab required": (cf as any).centralLabRequired,
  };
}

export async function generateStudySummary(
  study: StudyRow,
  model: "fast" | "balanced" = "fast"
): Promise<string> {
  const r = await fetch("/api/ai-summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "summary", model, fields: studyFields(study) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "AI request failed");
  return String(d.text || "").trim();
}
