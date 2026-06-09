import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useOrgTable } from "../lib/useOrgTable";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import type { FieldDefinitionRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

/** TherapeuticAreas (Foundation) — a plain list of the org's therapeutic areas.
 *  It is the option list for the study 'Therapeutic area' field (Organizational
 *  section), so editing here feeds that dropdown everywhere a study is created
 *  or edited. TAs are the main way studies get sliced for team access. */
export function TherapeuticAreas() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { realtime: true });
  const [draft, setDraft] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  const taField = fields.rows.find((f) => f.entity_type === "study" && f.key === "therapeuticArea") ?? null;
  const values: string[] = ((taField?.options as { values?: string[] } | null)?.values ?? []).slice();

  const save = async (next: string[]) => {
    if (!taField) return;
    try {
      const { error } = await supabase.from("field_definitions").update({ options: { values: next } } as any).eq("id", taField.id);
      if (error) throw error;
      await fields.refresh();
    } catch (e: any) { toast.error(friendlyError(e, "Couldn't save therapeutic areas")); }
  };

  const add = async () => {
    const v = draft.trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return; }
    await save([...values, v]);
    setDraft("");
    toast.success(stamped(`Added "${v}"`));
  };
  const rename = async (i: number, v: string) => {
    const t = v.trim();
    setEditIdx(null);
    if (!t || t === values[i]) return;
    const next = values.slice(); next[i] = t;
    await save(next);
  };
  const remove = async (v: string) => {
    if (!(await confirmDialog({ title: "Remove therapeutic area", message: `Remove "${v}"? Studies already set to it keep the value; it just won't be offered for new ones.`, confirmLabel: "Remove" }))) return;
    await save(values.filter((x) => x !== v));
  };

  if (memberLoading) {
    return <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8"><Loader label="Checking permissions…" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Therapeutic areas" />
        <Card className="mt-6"><EmptyState iconName="lock" title="Admin-only surface" sub="Only admins manage the therapeutic-area list." /></Card>
      </div>
    );
  }

  return (
    <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Therapeutic areas"
        subtitle="The list of therapeutic areas your org runs. This is the option list for the study 'Therapeutic area' field, and the main way studies are sliced for team access."
      />

      {!taField ? (
        <Card className="mt-6">
          <EmptyState
            iconName="alert"
            title="Therapeutic area field not found"
            sub="Run migration 0039 to add the study 'Therapeutic area' field — then manage its list here."
          />
        </Card>
      ) : (
        <Card className="mt-6 space-y-4">
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="Add a therapeutic area (e.g. Oncology)"
              className="max-w-sm"
            />
            <Button variant="primary" onClick={add} disabled={!draft.trim()}><Icon name="plus" size={12} /> Add</Button>
          </div>

          {values.length === 0 ? (
            <p className="text-sm text-slate-500">None yet — add your first therapeutic area above.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {values.map((v, i) => (
                <li key={v} className="px-3 py-2 flex items-center gap-2 group">
                  <Icon name="layers" size={13} className="text-slate-400 flex-shrink-0" />
                  {editIdx === i ? (
                    <input
                      autoFocus
                      defaultValue={v}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => void rename(i, editVal || v)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditIdx(null); }}
                      className="flex-1 text-sm border border-brand-200 rounded px-1.5 py-0.5 outline-none"
                    />
                  ) : (
                    <button onClick={() => { setEditIdx(i); setEditVal(v); }} className="flex-1 text-left text-sm text-slate-800 hover:text-brand-700" title="Rename">{v}</button>
                  )}
                  <button onClick={() => void remove(v)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition leading-none" aria-label={`Remove ${v}`}>×</button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-400">Used on the study record's Organizational section. You can also reorder or change the field itself under Study &amp; site fields.</p>
        </Card>
      )}
    </div>
  );
}
