import { useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import type { SponsorRow, CroRow, StudyRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

const SPONSOR_TYPES = [
  { value: "industry", label: "Industry" },
  { value: "nih", label: "NIH / federal" },
  { value: "foundation", label: "Foundation" },
  { value: "investigator_initiated", label: "Investigator-initiated" },
  { value: "other", label: "Other" },
];

/** Sponsors & CROs — first-class catalogs (0037). Studies reference these by FK
 *  instead of typing the name, so filtering and roll-ups are reliable. */
export function SponsorsCros() {
  const { isAdmin, loading } = useCurrentMember();
  const sponsors = useOrgTable<SponsorRow>("sponsors", { orderBy: "name", realtime: true });
  const cros = useOrgTable<CroRow>("cros", { orderBy: "name", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { realtime: true });

  if (loading) {
    return <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Loading…" /></div>;
  }

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader kicker="Configure" title="Sponsors & CROs" subtitle="The companies behind your studies. Pick these on a study instead of typing — so you get reliable filtering and roll-ups." />

      <SponsorSection sponsors={sponsors} studies={studies.rows} editable={isAdmin} />
      <div className="h-6" />
      <CroSection cros={cros} studies={studies.rows} editable={isAdmin} />
    </div>
  );
}

/* ---------- Sponsors ---------- */

function SponsorSection({ sponsors, studies, editable }: {
  sponsors: ReturnType<typeof useOrgTable<SponsorRow>>;
  studies: StudyRow[];
  editable: boolean;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const active = sponsors.rows.filter((s) => s.status === "active");
  const studyCount = (id: string) => studies.filter((st) => st.sponsor_id === id).length;

  const add = async () => {
    if (!name.trim()) return;
    try { await sponsors.insert({ name: name.trim(), status: "active", sponsor_type: "industry" } as any); toast.success(stamped(`Sponsor "${name.trim()}" added`)); setName(""); setAdding(false); }
    catch (e: any) { toast.error(friendlyError(e, "Couldn't add sponsor")); }
  };
  const patch = (id: string, p: Partial<SponsorRow>) => sponsors.update(id, p).catch((e: any) => toast.error(friendlyError(e, "Update failed")));
  const archive = async (s: SponsorRow) => {
    if (!(await confirmDialog({ title: "Archive sponsor", message: `Archive "${s.name}"? Studies keep their link; it won't appear in pickers.`, confirmLabel: "Archive" }))) return;
    patch(s.id, { status: "inactive" } as any);
  };

  return (
    <Card flush>
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <Icon name="building" size={15} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">Sponsors</span>
        <span className="text-[11px] font-mono text-slate-400">{active.length}</span>
        <div className="flex-1" />
        {editable && !adding && <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add sponsor</Button>}
        {editable && adding && (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); if (e.key === "Escape") { setAdding(false); setName(""); } }} placeholder="Sponsor name" className="text-sm w-56" />
            <Button size="sm" variant="primary" onClick={add} disabled={!name.trim()}>Add</Button>
          </div>
        )}
      </div>
      {active.length === 0 ? (
        <EmptyState iconName="building" title="No sponsors yet" sub="Add the companies that sponsor your studies." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.map((s) => {
            const open = openId === s.id;
            const n = studyCount(s.id);
            return (
              <li key={s.id}>
                <div className="px-4 py-2.5 flex items-center gap-2">
                  <button onClick={() => setOpenId(open ? null : s.id)} className="min-w-0 flex-1 text-left flex items-center gap-2">
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={13} className="text-slate-300 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-900 truncate">{s.name}</span>
                    {s.sponsor_type && <Pill tone="neutral">{SPONSOR_TYPES.find((t) => t.value === s.sponsor_type)?.label ?? s.sponsor_type}</Pill>}
                  </button>
                  <span className="text-[11px] text-slate-400">{n} stud{n === 1 ? "y" : "ies"}</span>
                  {editable && <button onClick={() => void archive(s)} className="text-slate-300 hover:text-red-500 leading-none flex-shrink-0" title="Archive" aria-label="Archive">×</button>}
                </div>
                {open && (
                  <div className="px-4 pb-3 pt-1 bg-slate-50/60 space-y-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      <F label="Name" value={s.name} editable={editable} onSave={(v) => v && patch(s.id, { name: v })} />
                      <label className="block">
                        <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">Type</span>
                        {editable ? (
                          <Select value={s.sponsor_type ?? ""} onChange={(e) => patch(s.id, { sponsor_type: e.target.value || null })} className="text-xs py-1 px-2">
                            <option value="">—</option>
                            {SPONSOR_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </Select>
                        ) : <span className="text-xs text-slate-800">{SPONSOR_TYPES.find((t) => t.value === s.sponsor_type)?.label ?? "—"}</span>}
                      </label>
                      <F label="Contact name" value={s.contact_name} editable={editable} onSave={(v) => patch(s.id, { contact_name: v })} />
                      <F label="Contact email" value={s.contact_email} editable={editable} onSave={(v) => patch(s.id, { contact_email: v })} />
                      <F label="Contact phone" value={s.contact_phone} editable={editable} onSave={(v) => patch(s.id, { contact_phone: v })} />
                      <F label="Portal URL" value={s.portal_url} editable={editable} onSave={(v) => patch(s.id, { portal_url: v })} />
                      <F label="Payment terms" value={s.payment_terms} editable={editable} onSave={(v) => patch(s.id, { payment_terms: v })} />
                    </div>
                    <StudiesFor studies={studies.filter((st) => st.sponsor_id === s.id)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------- CROs ---------- */

function CroSection({ cros, studies, editable }: {
  cros: ReturnType<typeof useOrgTable<CroRow>>;
  studies: StudyRow[];
  editable: boolean;
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const active = cros.rows.filter((c) => c.status === "active");
  const studyCount = (id: string) => studies.filter((st) => st.cro_id === id).length;

  const add = async () => {
    if (!name.trim()) return;
    try { await cros.insert({ name: name.trim(), status: "active" } as any); toast.success(stamped(`CRO "${name.trim()}" added`)); setName(""); setAdding(false); }
    catch (e: any) { toast.error(friendlyError(e, "Couldn't add CRO")); }
  };
  const patch = (id: string, p: Partial<CroRow>) => cros.update(id, p).catch((e: any) => toast.error(friendlyError(e, "Update failed")));
  const archive = async (c: CroRow) => {
    if (!(await confirmDialog({ title: "Archive CRO", message: `Archive "${c.name}"? Studies keep their link; it won't appear in pickers.`, confirmLabel: "Archive" }))) return;
    patch(c.id, { status: "inactive" } as any);
  };

  return (
    <Card flush>
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
        <Icon name="users" size={15} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-800">CROs</span>
        <span className="text-[11px] text-slate-400">— contract research organizations</span>
        <span className="text-[11px] font-mono text-slate-400">{active.length}</span>
        <div className="flex-1" />
        {editable && !adding && <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> Add CRO</Button>}
        {editable && adding && (
          <div className="flex items-center gap-1.5">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); if (e.key === "Escape") { setAdding(false); setName(""); } }} placeholder="CRO name" className="text-sm w-56" />
            <Button size="sm" variant="primary" onClick={add} disabled={!name.trim()}>Add</Button>
          </div>
        )}
      </div>
      {active.length === 0 ? (
        <EmptyState iconName="users" title="No CROs yet" sub="Add the CROs that manage your studies." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {active.map((c) => {
            const open = openId === c.id;
            const n = studyCount(c.id);
            return (
              <li key={c.id}>
                <div className="px-4 py-2.5 flex items-center gap-2">
                  <button onClick={() => setOpenId(open ? null : c.id)} className="min-w-0 flex-1 text-left flex items-center gap-2">
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={13} className="text-slate-300 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-900 truncate">{c.name}</span>
                  </button>
                  <span className="text-[11px] text-slate-400">{n} stud{n === 1 ? "y" : "ies"}</span>
                  {editable && <button onClick={() => void archive(c)} className="text-slate-300 hover:text-red-500 leading-none flex-shrink-0" title="Archive" aria-label="Archive">×</button>}
                </div>
                {open && (
                  <div className="px-4 pb-3 pt-1 bg-slate-50/60 space-y-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      <F label="Name" value={c.name} editable={editable} onSave={(v) => v && patch(c.id, { name: v })} />
                      <F label="Contact name" value={c.contact_name} editable={editable} onSave={(v) => patch(c.id, { contact_name: v })} />
                      <F label="Contact email" value={c.contact_email} editable={editable} onSave={(v) => patch(c.id, { contact_email: v })} />
                      <F label="Contact phone" value={c.contact_phone} editable={editable} onSave={(v) => patch(c.id, { contact_phone: v })} />
                    </div>
                    <StudiesFor studies={studies.filter((st) => st.cro_id === c.id)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ---------- shared bits ---------- */

function StudiesFor({ studies }: { studies: StudyRow[] }) {
  if (studies.length === 0) return <p className="text-[11px] text-slate-400 italic">No studies yet.</p>;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Studies</div>
      <ul className="border border-slate-100 rounded-lg overflow-hidden divide-y divide-slate-100 bg-white">
        {studies.map((st) => (
          <li key={st.id}>
            <button onClick={() => { window.location.hash = `#/studies/${st.id}`; }} className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-brand-50/40 transition">
              <span className="font-mono text-[11px] text-slate-500">{st.code}</span>
              <span className="text-xs text-slate-800 truncate flex-1">{st.title}</span>
              {st.closed && <Pill tone="neutral">closed</Pill>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function F({ label, value, editable, onSave }: { label: string; value: string | null; editable: boolean; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold text-slate-500 mb-0.5">{label}</span>
      {editable ? (
        <Input value={draft} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const v = draft.trim(); if (v !== (value ?? "")) onSave(v || null); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="text-xs py-1 px-2" />
      ) : <span className="text-xs text-slate-800">{value || "—"}</span>}
    </label>
  );
}
