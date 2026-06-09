import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useAuth } from "../auth/useAuth";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { writeAuditEvent } from "../lib/auditLog";
import { useModalA11y } from "../lib/useModalA11y";
import type { SiteRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

/** SiteSetup (Foundation) — provision the org's sites: create, set the code,
 *  deactivate/reactivate. Once a site exists it appears in the Sites directory,
 *  where provisioned team members manage its profile. Setup ≠ management. */
export function SiteSetup() {
  const { orgId } = useCurrentOrg();
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const toast = useToast();
  const sites = useOrgTable<SiteRow>("sites", { orderBy: "name", realtime: true });
  const [composerOpen, setComposerOpen] = useState(false);

  const setStatus = async (s: SiteRow, next: "active" | "inactive") => {
    if (next === "inactive" && !(await confirmDialog({
      title: "Deactivate site",
      message: `Deactivate ${s.name}? Studies keep their link; the site stops appearing in pickers.`,
      confirmLabel: "Deactivate", danger: true,
    }))) return;
    try {
      const { error } = await supabase.from("sites").update({ status: next } as any).eq("id", s.id);
      if (error) throw error;
      if (orgId && userId) void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "site", entityId: s.id, action: next === "inactive" ? "deactivated" : "reactivated", payload: { name: s.name } });
      toast.success(stamped(next === "inactive" ? "Site deactivated" : "Site reactivated"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't update site")); }
  };

  if (memberLoading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Site setup" />
        <Card className="mt-6"><EmptyState iconName="lock" title="Admin-only surface" sub="Only admins provision sites. Manage existing sites in the Sites directory." /></Card>
      </div>
    );
  }

  const code = (s: SiteRow) => ((s.profile ?? {}) as any).siteCode ?? null;

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Site setup"
        subtitle="Provision the sites your org runs studies at. Once a site is added here it appears in the Sites directory, where provisioned team members manage its profile."
        actions={isAdmin && <Button variant="primary" onClick={() => setComposerOpen(true)}><Icon name="plus" size={14} /> New site</Button>}
      />

      <Card flush className="mt-6 overflow-hidden">
        {sites.loading && sites.rows.length === 0 && <div className="p-6"><Loader label="Loading sites…" /></div>}
        {!sites.loading && sites.rows.length === 0 && (
          <EmptyState
            iconName="hospital"
            title="No sites yet"
            sub="Add the sites you run studies at. They'll appear in the directory for your team to manage."
            action={<Button variant="primary" onClick={() => setComposerOpen(true)}><Icon name="plus" size={14} /> Add first site</Button>}
          />
        )}
        {sites.rows.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[1fr_140px_160px_120px] gap-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Site</span><span>Code</span><span>Location</span><span>Status</span>
            </div>
            {sites.rows.map((s) => (
              <div key={s.id} className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 grid grid-cols-[1fr_140px_160px_120px] gap-3 items-center">
                <span className="flex items-center gap-2 min-w-0">
                  <Icon name="hospital" size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="font-semibold text-slate-900 truncate">{s.name}</span>
                </span>
                <span className="text-xs font-mono text-slate-600 truncate">{code(s) || <span className="text-slate-400">—</span>}</span>
                <span className="text-xs text-slate-600 truncate">{[s.city, s.state].filter(Boolean).join(", ") || <span className="text-slate-400 italic">—</span>}</span>
                <span className="flex items-center gap-2">
                  <Pill tone={s.status === "active" ? "success" : "neutral"}>{s.status}</Pill>
                  <button
                    onClick={() => void setStatus(s, s.status === "active" ? "inactive" : "active")}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-900"
                  >
                    {s.status === "active" ? "Deactivate" : "Reactivate"}
                  </button>
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      {composerOpen && orgId && userId && (
        <NewSiteModal
          orgId={orgId}
          userId={userId}
          userEmail={userEmail}
          onClose={() => setComposerOpen(false)}
          onCreated={() => { setComposerOpen(false); toast.success(stamped("Site added — manage it in the Sites directory")); }}
        />
      )}
    </div>
  );
}

/* ---------- New site modal (provisioning) ---------- */
function NewSiteModal({
  orgId, userId, userEmail, onClose, onCreated,
}: {
  orgId: string;
  userId: string;
  userEmail: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [name, setName] = useState("");
  const [siteCode, setSiteCode] = useState("");
  const [institutionType, setInstitutionType] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError("Give the site a name."); return; }
    setBusy(true);
    try {
      const { data, error: e } = await supabase
        .from("sites")
        .insert({
          org_id: orgId,
          name: name.trim(),
          city: city.trim() || null,
          state: state.trim() || null,
          country: country.trim() || null,
          profile: {
            ...(siteCode.trim() ? { siteCode: siteCode.trim() } : {}),
            ...(institutionType.trim() ? { institutionType: institutionType.trim() } : {}),
          },
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (e) throw e;
      void writeAuditEvent({ orgId, actorId: userId, actorEmail: userEmail, entityType: "site", entityId: (data as any).id, action: "created", payload: { name: name.trim() } });
      onCreated((data as any).id);
    } catch (e: any) {
      setError(e?.message || "Couldn't add site. Has migration 0012 been applied?");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div ref={dlgRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New site" className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">New site</h2>
          <p className="text-xs text-slate-500 mt-0.5">The essentials now — capabilities, certifications, and investigators live in the full profile in the Sites directory.</p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Site name <span className="text-red-500">*</span></span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Banner Health — Phoenix" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Site code</span>
              <Input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="e.g. BAN-PHX" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Institution type</span>
              <Input value={institutionType} onChange={(e) => setInstitutionType(e.target.value)} placeholder="e.g. Academic medical center" />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block"><span className="block text-xs font-semibold text-slate-700 mb-1">City</span><Input value={city} onChange={(e) => setCity(e.target.value)} /></label>
            <label className="block"><span className="block text-xs font-semibold text-slate-700 mb-1">State</span><Input value={state} onChange={(e) => setState(e.target.value)} /></label>
            <label className="block"><span className="block text-xs font-semibold text-slate-700 mb-1">Country</span><Input value={country} onChange={(e) => setCountry(e.target.value)} /></label>
          </div>
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add site"}</Button>
        </div>
      </div>
    </div>
  );
}
