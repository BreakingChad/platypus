import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";
import { writeAuditEvent } from "../lib/auditLog";
import { nextStudyCode } from "../lib/submissions";
import {
  buildAmendmentInsert, lineageOf, isHistorical, needsAmendmentPurpose, AMENDMENT_PURPOSES,
} from "../lib/amendments";
import type { StudyRow } from "../lib/types";
import { useModalA11y } from "../lib/useModalA11y";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Icon } from "../components/ui/Icon";

/** VersionBar — lineage awareness on the study record (Wave O).
 *
 *  Shows where this record sits in its version lineage, links to siblings,
 *  warns if it's an amendment missing its required purpose, and (admins) can
 *  create the next amendment or supersede the predecessor. Historical
 *  versions read as locked snapshots.
 */
export function VersionBar({
  study,
  isAdmin,
  onNavigate,
}: {
  study: StudyRow;
  isAdmin: boolean;
  onNavigate: (h: string) => void;
}) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const toast = useToast();

  const [lineage, setLineage] = useState<StudyRow[]>([]);
  const [creating, setCreating] = useState(false);

  const rootId = study.root_study_id ?? study.id;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("studies")
        .select("*")
        .or(`id.eq.${rootId},root_study_id.eq.${rootId}`);
      if (!cancelled && data) setLineage(lineageOf(data as StudyRow[], study));
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId, study.id, study.updated_at]);

  const idx = lineage.findIndex((s) => s.id === study.id);
  const versionN = idx >= 0 ? idx + 1 : 1;
  const hasLineage = lineage.length > 1;
  const historical = isHistorical(study);
  const predecessor = study.amendment_of ? lineage.find((s) => s.id === study.amendment_of) ?? null : null;
  const needsPurpose = needsAmendmentPurpose(study);

  const supersede = async () => {
    if (!predecessor || !orgId || !userId) return;
    if (
      !(await confirmDialog({
        title: "Make this the active version",
        message: `Supersede ${predecessor.code}${predecessor.version_label ? ` (${predecessor.version_label})` : ""}? It becomes a locked historical snapshot; this version takes over as current. The history stays viewable behind "show historical".`,
        confirmLabel: "Supersede predecessor",
      }))
    )
      return;
    try {
      const { error } = await supabase
        .from("studies")
        .update({ superseded_at: new Date().toISOString(), superseded_by: study.id } as any)
        .eq("id", predecessor.id);
      if (error) throw error;
      void writeAuditEvent({
        orgId, actorId: userId, actorEmail: userEmail,
        entityType: "study", entityId: predecessor.id,
        action: "superseded",
        payload: { by: study.code, by_id: study.id },
      });
      toast.success(stamped(`${predecessor.code} is now historical — this version is active`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't supersede the predecessor"));
    }
  };

  return (
    <>
      {(hasLineage || study.study_kind === "amendment" || isAdmin) && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 flex items-center flex-wrap gap-2 text-xs">
          <span className="font-semibold text-slate-600">
            {study.study_kind === "amendment" ? "Amendment" : "Original"}
            {study.version_label ? ` · ${study.version_label}` : ` · v${versionN}`}
          </span>
          {historical && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 text-slate-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              <Icon name="lock" size={9} /> historical
            </span>
          )}
          {study.amendment_purpose && (
            <span className="text-slate-500">· {study.amendment_purpose}</span>
          )}

          {/* lineage links */}
          {hasLineage && (
            <span className="flex items-center gap-1 flex-wrap">
              <span className="text-slate-400">·</span>
              {lineage.map((v, i) => (
                <button
                  key={v.id}
                  onClick={() => v.id !== study.id && onNavigate(`#/studies/${v.id}`)}
                  className={
                    "font-mono rounded px-1.5 py-0.5 transition " +
                    (v.id === study.id
                      ? "bg-brand-100 text-brand-700 font-semibold cursor-default"
                      : "text-slate-500 hover:bg-slate-200")
                  }
                  title={v.version_label || `v${i + 1}`}
                >
                  {v.version_label || `v${i + 1}`}
                  {isHistorical(v) ? " ·hist" : ""}
                </button>
              ))}
            </span>
          )}

          <span className="flex-1" />

          {isAdmin && predecessor && !isHistorical(predecessor) && (
            <Button size="sm" variant="ghost" onClick={() => void supersede()}>
              Make active version
            </Button>
          )}
          {isAdmin && !study.closed && !historical && (
            <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
              <Icon name="copy" size={11} /> Create amendment
            </Button>
          )}
        </div>
      )}

      {/* required-purpose nudge */}
      {needsPurpose && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
          <Icon name="alert" size={13} className="flex-shrink-0" />
          This amendment needs a purpose — set a version label or pick why it was raised.
          <PurposeQuickSet study={study} onSaved={() => toast.success(stamped("Amendment purpose set"))} />
        </div>
      )}

      {creating && (
        <AmendmentModal
          original={study}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onNavigate(`#/studies/${id}`);
          }}
        />
      )}
    </>
  );
}

function PurposeQuickSet({ study, onSaved }: { study: StudyRow; onSaved: () => void }) {
  const toast = useToast();
  return (
    <select
      defaultValue=""
      onChange={async (e) => {
        const v = e.target.value;
        if (!v) return;
        const { error } = await supabase.from("studies").update({ amendment_purpose: v } as any).eq("id", study.id);
        if (error) toast.error(friendlyError(e, "Couldn't save"));
        else onSaved();
      }}
      className="ml-auto rounded border border-amber-300 bg-white px-2 py-1 text-xs"
      aria-label="Amendment purpose"
    >
      <option value="">Pick purpose…</option>
      {AMENDMENT_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

function AmendmentModal({
  original,
  onClose,
  onCreated,
}: {
  original: StudyRow;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const toast = useToast();

  const [versionChanged, setVersionChanged] = useState<null | boolean>(null);
  const [versionLabel, setVersionLabel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  const valid =
    versionChanged === true ? versionLabel.trim() !== "" :
    versionChanged === false ? purpose.trim() !== "" :
    false;

  const submit = async () => {
    if (!orgId || busy || !valid) return;
    setBusy(true);
    try {
      const { data: codes } = await supabase.from("studies").select("code").eq("org_id", orgId);
      const { data: org } = await supabase.from("orgs").select("project_id_prefix").eq("id", orgId).maybeSingle();
      const code = nextStudyCode(((codes ?? []) as { code: string }[]).map((c) => c.code), (org as any)?.project_id_prefix || "STU");
      const insert = buildAmendmentInsert(original, { code, versionLabel, purpose, createdBy: userId });
      const { data: created, error } = await supabase.from("studies").insert(insert as any).select("id, code").single();
      if (error) throw error;
      const newId = (created as any).id as string;
      if (userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: newId,
          action: "amendment_created",
          payload: { of: original.code, of_id: original.id, version_label: versionLabel || null, purpose: purpose || null },
        });
      }
      toast.success(stamped(`Amendment ${(created as any).code} created from ${original.code}`));
      onCreated(newId);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create the amendment"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create amendment"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">Create amendment</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            A new version of <span className="font-mono">{original.code}</span> that runs its own
            pipeline from intake. The original stays active until you make this one current.
          </p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <span className="block text-sm font-semibold text-slate-800 mb-2">Did the protocol version change?</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {([[true, "Yes"], [false, "No"]] as const).map(([v, label]) => (
                <button
                  key={label}
                  onClick={() => { setVersionChanged(v); setVersionLabel(""); setPurpose(""); }}
                  className={
                    "px-4 py-1.5 rounded-md text-sm font-semibold transition " +
                    (versionChanged === v ? "bg-brand-gradient text-white shadow" : "text-slate-600 hover:text-slate-900")
                  }
                  aria-pressed={versionChanged === v}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {versionChanged === true && (
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">New version label</span>
              <Input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="e.g. v2.0 / Amendment 3" autoFocus />
              <p className="text-[11px] text-slate-500 mt-1">The protocol's new version or amendment number.</p>
            </label>
          )}

          {versionChanged === false && (
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">What kind of amendment is this?</span>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
                autoFocus
              >
                <option value="">— Select —</option>
                {AMENDMENT_PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">Budget, contract, PI change… — so the record explains itself.</p>
            </label>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create amendment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
