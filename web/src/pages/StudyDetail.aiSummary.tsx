import { useEffect, useState } from "react";
import type { StudyRow } from "../lib/types";
import { aiStatus, generateStudySummary } from "../lib/ai";
import { friendlyError } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { writeAuditEvent } from "../lib/auditLog";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/Icon";
import { Tip } from "../components/ui/Tip";

/** AiSummaryCard — the "AI Summary" box from the scope. Generates a 3–4
 *  sentence plain-English read of the study from its structured fields,
 *  caches it on the study, and re-generates on demand. Gracefully absent
 *  when AI isn't configured (no key) or the org has AI turned off. */
export function AiSummaryCard({ study, aiEnabled }: { study: StudyRow; aiEnabled: boolean }) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const toast = useToast();

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [summary, setSummary] = useState<string | null>(study.ai_summary ?? null);
  const [at, setAt] = useState<string | null>(study.ai_summary_at ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSummary(study.ai_summary ?? null);
    setAt(study.ai_summary_at ?? null);
  }, [study.id, study.ai_summary, study.ai_summary_at]);

  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;
    aiStatus().then((s) => !cancelled && setConfigured(s.configured));
    return () => {
      cancelled = true;
    };
  }, [aiEnabled]);

  if (!aiEnabled) return null;

  const run = async () => {
    setBusy(true);
    try {
      const text = await generateStudySummary(study);
      if (!text) throw new Error("The AI returned an empty summary.");
      const stampNow = new Date().toISOString();
      setSummary(text);
      setAt(stampNow);
      const { error } = await supabase
        .from("studies")
        .update({ ai_summary: text, ai_summary_at: stampNow, ai_summary_by: userId } as never)
        .eq("id", study.id);
      if (error) throw error;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: auth.status === "signedIn" ? auth.user.email ?? null : null,
          entityType: "study", entityId: study.id,
          action: "ai_summary_generated",
          payload: { length: text.length },
        });
      }
      toast.success(stamped("AI summary generated"));
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't generate a summary."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-brand-100 bg-gradient-to-br from-brand-50/40 to-transparent">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center">
            <Icon name="layers" size={14} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              AI summary
              <Tip side="bottom" label="A plain-English read of this study generated from its structured fields by Claude. A starting point for reviewers — always verify against the protocol.">
                <span className="text-[9px] font-bold uppercase tracking-wider text-brand-600 bg-brand-100 rounded px-1 py-0.5 cursor-help">beta</span>
              </Tip>
            </h3>
            {at && (
              <p className="text-[10px] font-mono text-slate-400">
                generated {new Date(at).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        {configured && (
          <button
            onClick={run}
            disabled={busy}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
          >
            {busy ? "Generating…" : summary ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>

      {configured === false ? (
        <p className="text-xs text-slate-500 leading-relaxed">
          AI isn't switched on for this deployment yet. An admin can connect it
          under Settings → Organization → AI.
        </p>
      ) : summary ? (
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{summary}</p>
      ) : (
        <p className="text-xs text-slate-500 leading-relaxed">
          Generate a quick, plain-English overview of this study from its fields.
          {configured === null && " Checking availability…"}
        </p>
      )}
    </Card>
  );
}
