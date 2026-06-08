import { useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { friendlyError } from "../lib/errors";
import { useDismissable } from "../lib/useDismissable";
import { Icon } from "../components/ui/Icon";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import type { InvestigatorRow, SiteInvestigatorRow } from "../lib/types";

/** Investigators affiliated with a site. PIs live HERE (the people credentialed
 *  at a site); a study then picks its PI from the site's investigators. */
export function SiteInvestigators({ siteId, editable }: { siteId: string; editable: boolean }) {
  const toast = useToast();
  const inv = useOrgTable<InvestigatorRow>("investigators", { orderBy: "name", realtime: true });
  const links = useOrgTable<SiteInvestigatorRow>("site_investigators", { realtime: true });

  const [adding, setAdding] = useState(false);
  useDismissable("[data-add-inv]", () => setAdding(false), adding);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDegree, setNewDegree] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const siteLinks = links.rows.filter((l) => l.site_id === siteId);
  const affiliated = siteLinks
    .map((l) => ({ link: l, person: inv.rows.find((i) => i.id === l.investigator_id) }))
    .filter((x): x is { link: SiteInvestigatorRow; person: InvestigatorRow } => !!x.person)
    .sort((a, b) => Number(b.link.is_primary) - Number(a.link.is_primary) || a.person.name.localeCompare(b.person.name));
  const available = inv.rows.filter(
    (i) => i.status === "active" && !siteLinks.some((l) => l.investigator_id === i.id)
  );

  const addExisting = async (investigatorId: string) => {
    try {
      await links.insert({ site_id: siteId, investigator_id: investigatorId, is_primary: siteLinks.length === 0 } as any);
      toast.success(stamped("Investigator added to site"));
      setAdding(false);
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't add investigator")); }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await inv.insert({ name, degree: newDegree.trim() || null, status: "active" } as any);
      if (created) {
        await links.insert({ site_id: siteId, investigator_id: created.id, is_primary: siteLinks.length === 0 } as any);
        toast.success(stamped(`Added ${name}`));
        setExpandedId(created.id);
      }
      setNewName(""); setNewDegree(""); setCreating(false); setAdding(false);
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't create investigator")); }
  };

  const setPrimary = async (linkId: string) => {
    try {
      await Promise.all(siteLinks.map((l) => links.update(l.id, { is_primary: l.id === linkId } as any)));
      toast.success(stamped("Primary investigator set"));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't set primary")); }
  };

  const removeLink = async (link: SiteInvestigatorRow, name: string) => {
    try {
      await links.remove(link.id);
      toast.success(stamped(`Removed ${name} from site`));
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't remove")); }
  };

  const patchInv = (id: string, patch: Partial<InvestigatorRow>) =>
    inv.update(id, patch).catch((e: any) => toast.error(friendlyError(e, "Update failed")));

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="users" size={14} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-500">Investigators</span>
        {affiliated.length > 0 && <span className="text-[10px] font-mono text-slate-400">{affiliated.length}</span>}
        <div className="flex-1" />
        {editable && (
          <div className="relative" data-add-inv>
            <button onClick={() => { setAdding((a) => !a); setCreating(false); }} className="text-xs font-semibold text-brand-700 hover:underline">
              + Add investigator
            </button>
            {adding && (
              <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-1 max-h-80 overflow-y-auto">
                {!creating && (
                  <>
                    {available.length > 0 && (
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">From your catalog</div>
                    )}
                    {available.map((i) => (
                      <button key={i.id} onClick={() => void addExisting(i.id)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 rounded transition flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800 truncate">{i.name}</span>
                        {i.degree && <span className="text-slate-400">{i.degree}</span>}
                      </button>
                    ))}
                    <button onClick={() => setCreating(true)} className="w-full text-left px-2 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 rounded transition flex items-center gap-1 border-t border-slate-100 mt-1">
                      <Icon name="plus" size={11} /> Create new investigator
                    </button>
                  </>
                )}
                {creating && (
                  <div className="p-2 space-y-2">
                    <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name (e.g. Dr. Jane Smith)"
                      onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) void createAndAdd(); }} className="text-sm" />
                    <Input value={newDegree} onChange={(e) => setNewDegree(e.target.value)} placeholder="Degree (MD, DO, PhD…)" className="text-sm" />
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="primary" onClick={createAndAdd} disabled={!newName.trim()}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Back</Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {affiliated.length === 0 ? (
        <div className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl px-3 py-3">
          No investigators at this site yet. {editable ? "Add the PIs and sub-Is who practice here — studies pick their PI from this list." : ""}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
          {affiliated.map(({ link, person }) => {
            const expanded = expandedId === person.id;
            const expiringSoon = isExpiringSoon(person.gcp_training_expires);
            return (
              <li key={link.id}>
                <div className="px-3 py-2 flex items-center gap-2">
                  <button onClick={() => setExpandedId(expanded ? null : person.id)} className="min-w-0 flex-1 text-left flex items-center gap-2" title="Credentials">
                    <Icon name={expanded ? "chevron-down" : "chevron-right"} size={13} className="text-slate-300 flex-shrink-0" />
                    <span className="text-sm text-slate-900 truncate">{person.name}</span>
                    {person.degree && <span className="text-[11px] text-slate-400 flex-shrink-0">{person.degree}</span>}
                    {link.is_primary && <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 flex-shrink-0">primary</span>}
                    {expiringSoon && <Pill tone="warning">GCP expiring</Pill>}
                  </button>
                  {editable && !link.is_primary && (
                    <button onClick={() => void setPrimary(link.id)} className="text-[10px] font-semibold text-slate-400 hover:text-amber-600 flex-shrink-0" title="Mark as the site's primary investigator">★</button>
                  )}
                  {editable && (
                    <button onClick={() => void removeLink(link, person.name)} className="text-slate-300 hover:text-red-500 leading-none flex-shrink-0" aria-label={`Remove ${person.name}`}>×</button>
                  )}
                </div>
                {expanded && (
                  <div className="px-3 pb-3 pt-1 bg-slate-50/60">
                    <InvestigatorEditor person={person} editable={editable} onPatch={(p) => void patchInv(person.id, p)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function InvestigatorEditor({ person, editable, onPatch }: {
  person: InvestigatorRow;
  editable: boolean;
  onPatch: (patch: Partial<InvestigatorRow>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Email" value={person.email} type="text" editable={editable} onSave={(v) => onPatch({ email: v })} />
        <Field label="Phone" value={person.phone} type="text" editable={editable} onSave={(v) => onPatch({ phone: v })} />
        <Field label="NPI" value={person.npi} type="text" editable={editable} onSave={(v) => onPatch({ npi: v })} />
        <Field label="Degree" value={person.degree} type="text" editable={editable} onSave={(v) => onPatch({ degree: v })} />
        <Field label="Medical license #" value={person.license_number} type="text" editable={editable} onSave={(v) => onPatch({ license_number: v })} />
        <Field label="License state" value={person.license_state} type="text" editable={editable} onSave={(v) => onPatch({ license_state: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="GCP training date" value={person.gcp_training_date} type="date" editable={editable} onSave={(v) => onPatch({ gcp_training_date: v })} />
        <Field label="GCP training expires" value={person.gcp_training_expires} type="date" editable={editable} onSave={(v) => onPatch({ gcp_training_expires: v })} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Toggle label="CV on file" checked={person.cv_on_file} editable={editable} onChange={(v) => onPatch({ cv_on_file: v })} />
        <Toggle label="FDA 1572 on file" checked={person.form_1572_on_file} editable={editable} onChange={(v) => onPatch({ form_1572_on_file: v })} />
        <Toggle label="Financial disclosure" checked={person.financial_disclosure_on_file} editable={editable} onChange={(v) => onPatch({ financial_disclosure_on_file: v })} />
      </div>
    </div>
  );
}

function Field({ label, value, type, editable, onSave }: {
  label: string; value: string | null; type: "text" | "date"; editable: boolean; onSave: (v: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">{label}</span>
      {editable ? (
        <Input type={type} value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const v = draft.trim(); if (v !== (value ?? "")) onSave(v || null); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className="text-xs py-1 px-2" />
      ) : (
        <span className="text-xs text-slate-800">{value || "—"}</span>
      )}
    </label>
  );
}

function Toggle({ label, checked, editable, onChange }: {
  label: string; checked: boolean; editable: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
      <input type="checkbox" checked={checked} disabled={!editable} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500 w-3.5 h-3.5" />
      {label}
    </label>
  );
}

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return false;
  const days = (d - Date.now()) / 86_400_000;
  return days <= 60; // expired or within 60 days
}
