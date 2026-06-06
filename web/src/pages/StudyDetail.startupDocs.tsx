import { useMemo, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { stamped } from "../lib/stamp";
import { fmtDay } from "../lib/dates";
import type { StartupDocumentRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";
import { InfoTip } from "../components/ui/Tip";

/** StartupDocsTab — the "BOP" / pre-binder box of papers (Wave N).
 *
 *  Early study documents land here in bulk during intake/triage, tagged into
 *  three simple buckets — Operations · Regulatory · Startup. Original-study
 *  and amendment material live in the same place but stay clearly separated
 *  by a track label. Nothing leaves until you file it: at the terminal stage
 *  every doc must be filed to a binder, filed to the site file, or archived.
 */

const BUCKETS: { key: string; label: string; tone: "info" | "warning" | "brand" }[] = [
  { key: "operations", label: "Operations", tone: "info" },
  { key: "regulatory", label: "Regulatory", tone: "warning" },
  { key: "startup", label: "Startup", tone: "brand" },
];

const DISPOSITION_LABEL: Record<string, string> = {
  binder: "Filed to binder",
  site_file: "Filed to site file",
  archived: "Archived",
};

export function StartupDocsTab({ study }: { study: StudyRow }) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const toast = useToast();

  const { rows, loading, error, insert, update } = useOrgTable<StartupDocumentRow>(
    "startup_documents",
    { orderBy: "created_at", realtime: true }
  );
  const docs = useMemo(() => rows.filter((d) => d.study_id === study.id), [rows, study.id]);

  const isAmendment = (study as any).kind === "amendment";
  const defaultTrack = isAmendment ? "amendment" : "original";

  const [composer, setComposer] = useState({ title: "", bucket: "startup", track: defaultTrack });
  const [bulk, setBulk] = useState("");
  const [showFiled, setShowFiled] = useState(false);

  const staged = docs.filter((d) => d.status === "staged");
  const filedOrArchived = docs.filter((d) => d.status !== "staged");

  const add = async (title: string, bucket: string, track: string) => {
    const t = title.trim();
    if (!t || !orgId) return;
    try {
      await insert({
        study_id: study.id,
        bucket,
        track,
        title: t,
        status: "staged",
        created_by: userId,
      } as Partial<StartupDocumentRow>);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't add the document"));
    }
  };

  const addOne = async () => {
    if (!composer.title.trim()) return;
    await add(composer.title, composer.bucket, composer.track);
    toast.success(stamped(`Added "${composer.title.trim()}" to ${composer.bucket}`));
    setComposer({ ...composer, title: "" });
  };

  const addBulk = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    for (const l of lines) await add(l, composer.bucket, composer.track);
    toast.success(stamped(`Added ${lines.length} document${lines.length === 1 ? "" : "s"} to ${composer.bucket}`));
    setBulk("");
  };

  const setBucket = (d: StartupDocumentRow, bucket: string) =>
    update(d.id, { bucket }).catch((e: any) => toast.error(friendlyError(e, "Couldn't move it")));

  const fileTo = async (d: StartupDocumentRow, disposition: string) => {
    try {
      await update(d.id, {
        status: disposition === "archived" ? "archived" : "filed",
        disposition,
      } as Partial<StartupDocumentRow>);
      toast.success(stamped(`${d.title} — ${DISPOSITION_LABEL[disposition]}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't file it"));
    }
  };

  const unfile = (d: StartupDocumentRow) =>
    update(d.id, { status: "staged", disposition: null } as Partial<StartupDocumentRow>)
      .catch((e: any) => toast.error(friendlyError(e, "Couldn't move it back")));

  const remove = async (d: StartupDocumentRow) => {
    if (!(await confirmDialog({ title: "Remove document", message: `Remove "${d.title}" from staging?`, confirmLabel: "Remove", danger: true }))) return;
    update(d.id, { status: "archived", disposition: "archived" } as Partial<StartupDocumentRow>)
      .catch((e: any) => toast.error(friendlyError(e, "Couldn't remove it")));
  };

  return (
    <div className="space-y-4">
      {/* what this is */}
      <Card>
        <div className="flex items-start gap-2">
          <Icon name="folder" size={16} className="text-slate-400 mt-0.5" />
          <div className="text-xs text-slate-500 leading-relaxed">
            The pre-binder holding area. Drop everything that arrives during startup here, tag it
            into a bucket, and file it when you're ready. At the terminal stage, every document
            must be filed to a binder, filed to the site file, or archived — nothing left loose.
          </div>
        </div>
      </Card>

      {/* terminal-stage guard banner */}
      {staged.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-800">
          <Icon name="alert" size={14} className="flex-shrink-0" />
          <span>
            <strong>{staged.length}</strong> document{staged.length === 1 ? "" : "s"} still staged.
            Each must be filed or archived before this study can reach its terminal stage.
          </span>
        </div>
      )}

      {/* composer */}
      <Card primary>
        <div className="text-xs font-bold text-brand-700 uppercase tracking-wider mb-3">Add documents</div>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">Bucket</span>
            <select
              value={composer.bucket}
              onChange={(e) => setComposer({ ...composer, bucket: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {BUCKETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">Track</span>
            <select
              value={composer.track}
              onChange={(e) => setComposer({ ...composer, track: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="original">Original study</option>
              <option value="amendment">Amendment</option>
            </select>
          </label>
          <div className="flex-1 min-w-[200px]">
            <span className="block text-[11px] font-semibold text-slate-500 mb-1">Document name</span>
            <Input
              value={composer.title}
              onChange={(e) => setComposer({ ...composer, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && composer.title.trim()) void addOne(); }}
              placeholder="e.g. Draft budget v1"
            />
          </div>
          <Button variant="primary" onClick={addOne} disabled={!composer.title.trim()}>+ Add</Button>
        </div>
        <details className="mt-1">
          <summary className="text-[11px] font-semibold text-brand-700 cursor-pointer hover:underline">Bulk add — one per line</summary>
          <div className="mt-2 flex items-start gap-2">
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={4}
              placeholder={"Protocol v1\nDraft budget\nCV — Dr. Hayes\n1572"}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm resize-none"
            />
            <Button onClick={addBulk} disabled={!bulk.trim()}>Add all</Button>
          </div>
        </details>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}
      {loading && docs.length === 0 && <div className="text-sm text-slate-500">Loading documents…</div>}

      {/* three buckets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {BUCKETS.map((b) => {
          const items = staged.filter((d) => d.bucket === b.key);
          return (
            <div key={b.key} className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center gap-2">
                <Pill tone={b.tone}>{b.label}</Pill>
                <span className="ml-auto text-[11px] font-mono text-slate-400">{items.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[60px]">
                {items.length === 0 && (
                  <p className="text-[11px] text-slate-400 italic px-1 py-2 text-center">Nothing here yet.</p>
                )}
                {items.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-semibold text-slate-900 leading-snug flex-1 min-w-0">{d.title}</span>
                      <span
                        className={
                          "text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 flex-shrink-0 " +
                          (d.track === "amendment" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500")
                        }
                        title={d.track === "amendment" ? "Amendment material" : "Original study material"}
                      >
                        {d.track === "amendment" ? "AMD" : "ORIG"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      <select
                        value={d.bucket}
                        onChange={(e) => setBucket(d, e.target.value)}
                        className="text-[11px] rounded border border-slate-200 px-1.5 py-0.5 bg-white"
                        aria-label="Move to bucket"
                      >
                        {BUCKETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      <div className="flex-1" />
                      <FileMenu onFile={(disp) => fileTo(d, disp)} onRemove={() => remove(d)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* filed / archived */}
      {filedOrArchived.length > 0 && (
        <div>
          <button
            onClick={() => setShowFiled((s) => !s)}
            className="text-xs font-semibold text-slate-500 hover:text-brand-700 transition flex items-center gap-1"
          >
            <Icon name={showFiled ? "chevron-down" : "chevron-right"} size={12} />
            Filed &amp; archived · {filedOrArchived.length}
          </button>
          {showFiled && (
            <div className="mt-2 rounded-xl border border-slate-200 overflow-hidden">
              {filedOrArchived.map((d) => (
                <div key={d.id} className="px-3 py-2 border-b border-slate-100 last:border-b-0 flex items-center gap-2 text-xs">
                  <span className="font-semibold text-slate-700 flex-1 truncate">{d.title}</span>
                  <span className="text-slate-400">{BUCKETS.find((b) => b.key === d.bucket)?.label}</span>
                  <span className={d.disposition === "archived" ? "text-slate-500" : "text-emerald-700"}>
                    {DISPOSITION_LABEL[d.disposition ?? ""] ?? d.status}
                  </span>
                  <span className="font-mono text-slate-400">{fmtDay(d.updated_at)}</span>
                  <button onClick={() => unfile(d)} className="text-[11px] font-semibold text-brand-700 hover:underline">Undo</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileMenu({ onFile, onRemove }: { onFile: (d: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="primary" onClick={() => setOpen((o) => !o)}>File ▾</Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {[
              ["binder", "File to binder"],
              ["site_file", "File to site file"],
              ["archived", "Archive"],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => { setOpen(false); onFile(v); }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 transition"
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => { setOpen(false); onRemove(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition border-t border-slate-100"
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}
