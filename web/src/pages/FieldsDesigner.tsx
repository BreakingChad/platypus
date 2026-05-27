import { useRef, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { FieldDefinitionRow, FieldType, FieldEditTier } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

const SECTIONS = ["Organizational", "Per-Site", "Regulatory", "Financial", "Operational"];

/** FieldsDesigner — admin-only surface for shaping the study record.
 *  Refactored onto AppShell + design primitives. Non-admins get a read-only
 *  EmptyState so they understand the page exists but isn't theirs to edit. */
export function FieldsDesigner() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();
  const { rows, loading, error, update, insert, remove } = useOrgTable<FieldDefinitionRow>(
    "field_definitions",
    { orderBy: "position", realtime: true }
  );

  const studyFields = rows.filter((f) => f.entity_type === "study");
  const enabled = studyFields.filter((f) => f.enabled).length;
  const required = studyFields.filter((f) => f.required).length;
  const customCount = studyFields.filter((f) => f.kind === "custom").length;

  const [composer, setComposer] = useState({
    label: "",
    section: "Organizational",
    field_type: "text" as FieldType,
    required: false,
  });
  const labelInputRef = useRef<HTMLInputElement>(null);
  const composerCardRef = useRef<HTMLDivElement>(null);

  const bySection = (section: string) =>
    studyFields.filter((f) => f.section === section).sort((a, b) => a.position - b.position);

  const startAddInSection = (section: string) => {
    setComposer((c) => ({ ...c, section }));
    composerCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => labelInputRef.current?.focus(), 250);
  };

  const addCustom = async () => {
    if (!composer.label.trim()) return;
    const sectionFields = bySection(composer.section);
    const nextPos = sectionFields.reduce((m, f) => Math.max(m, f.position), 0) + 1;
    const safeKey =
      composer.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "field";
    try {
      await insert({
        entity_type: "study",
        key: `cf_${Date.now().toString(36)}_${safeKey}`,
        label: composer.label.trim(),
        section: composer.section,
        field_type: composer.field_type,
        kind: "custom",
        enabled: true,
        required: composer.required,
        lock_after_commit: false,
        edit_tier: "admin",
        position: nextPos,
      });
      toast.success(`Added "${composer.label.trim()}" to ${composer.section}`);
      setComposer({ label: "", section: composer.section, field_type: "text", required: false });
      labelInputRef.current?.focus();
    } catch (e: any) {
      toast.error(e?.message || "Couldn't add the field");
    }
  };

  const tryUpdate = async (id: string, patch: Partial<FieldDefinitionRow>) => {
    try {
      await update(id, patch);
    } catch (e: any) {
      toast.error(e?.message || "Update failed");
    }
  };

  const tryRemove = async (id: string, label: string) => {
    if (!window.confirm(`Remove "${label}"? Existing studies keep their value, but the field disappears from forms.`)) return;
    try {
      await remove(id);
      toast.success(`Removed "${label}"`);
    } catch (e: any) {
      toast.error(e?.message || "Remove failed");
    }
  };

  /* ---------- gating ---------- */

  if (memberLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <div className="text-sm text-slate-500">Checking permissions…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
        <PageHeader
          kicker="Configure"
          title="Study fields"
          subtitle="Decide what every study record captures — which fields are required, which lock after commit, and who can edit each one."
        />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change the study record shape. Ask an owner or admin on your team — once they enable a field here, it shows up on every study form."
          />
        </Card>
      </div>
    );
  }

  /* ---------- admin view ---------- */

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure"
        title="Study fields"
        subtitle="Decide what every study record captures. Toggle, require, lock after commit, set who can edit. Add custom fields to any section. Every change writes live to Supabase."
        actions={<Pill tone="brand">live · admin-driven</Pill>}
      />

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3 mt-6 mb-6">
        <SummaryCard label="Fields enabled" value={`${enabled}`} sub={`of ${studyFields.length}`} />
        <SummaryCard label="Required" value={`${required}`} />
        <SummaryCard label="Custom fields" value={`${customCount}`} />
      </div>

      {/* COMPOSER — top-of-page primary action. */}
      <Card
        innerRef={composerCardRef}
        primary
        className="mb-8 scroll-mt-24"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-bold text-brand-700 uppercase tracking-wider">
              Add a custom field
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Pick the section below — available in <strong>every</strong> section.
            </div>
          </div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            writes live · Supabase
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1.3fr_1fr_auto_auto] gap-2 items-center">
          <Input
            ref={labelInputRef}
            value={composer.label}
            onChange={(e) => setComposer({ ...composer, label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && composer.label.trim()) void addCustom();
            }}
            placeholder="Field name (e.g. Sponsor portal ID)"
          />
          <Select
            value={composer.section}
            onChange={(e) => setComposer({ ...composer, section: e.target.value })}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select
            value={composer.field_type}
            onChange={(e) =>
              setComposer({ ...composer, field_type: e.target.value as FieldType })
            }
          >
            {(["text", "date", "number", "dropdown", "boolean"] as FieldType[]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={composer.required}
              onChange={(e) => setComposer({ ...composer, required: e.target.checked })}
              className="accent-brand-500 w-4 h-4"
            />
            Required
          </label>
          <Button onClick={addCustom} disabled={!composer.label.trim()}>
            + Add
          </Button>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="text-sm text-slate-500 mb-6">Loading fields…</div>
      )}

      {SECTIONS.map((section) => {
        const fields = bySection(section);
        if (fields.length === 0 && !loading) return null;
        const sectionCustomCount = fields.filter((f) => f.kind === "custom").length;
        return (
          <div
            key={section}
            className="bg-white rounded-xl border border-slate-200 mb-3 overflow-hidden shadow-sm"
          >
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  {section}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {fields.length} field{fields.length === 1 ? "" : "s"}
                  {sectionCustomCount > 0 ? ` · ${sectionCustomCount} custom` : ""}
                </span>
              </div>
              <button
                onClick={() => startAddInSection(section)}
                className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 transition flex items-center gap-1"
                title={`Add a custom field to ${section}`}
              >
                <Icon name="plus" size={11} /> Add field
              </button>
            </div>

            <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              <span className="w-8">On</span>
              <span className="flex-1">Field</span>
              <span className="w-16 text-center">Required</span>
              <span className="w-16 text-center">Locks</span>
              <span className="w-36">Who can edit</span>
              <span className="w-8" />
            </div>

            {fields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                onUpdate={tryUpdate}
                onRemove={() => tryRemove(f.id, f.label)}
              />
            ))}
          </div>
        );
      })}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Locks</strong> make a field read-only once a study is committed — use it for
        regulated identifiers (protocol number, IRB #) that shouldn't drift after activation.
        <strong> Who can edit</strong> sets the permission tier; every change is captured in
        the (coming) hash-chained audit trail regardless.
      </p>
    </div>
  );
}

/* ---------- pieces ---------- */

function FieldRow({
  field,
  onUpdate,
  onRemove,
}: {
  field: FieldDefinitionRow;
  onUpdate: (id: string, patch: Partial<FieldDefinitionRow>) => Promise<void>;
  onRemove: () => void;
}) {
  const isCustom = field.kind === "custom";
  return (
    <div
      className={`px-4 py-2.5 border-b border-slate-100 last:border-b-0 flex items-center gap-2 ${
        field.enabled ? "" : "opacity-50"
      } ${isCustom ? "bg-brand-50/40" : ""}`}
    >
      <span className="w-8">
        <input
          type="checkbox"
          checked={field.enabled}
          onChange={(e) => void onUpdate(field.id, { enabled: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer"
        />
      </span>
      <span className="flex-1 text-sm font-semibold text-slate-900 flex items-center gap-2">
        {field.label}
        {isCustom && <Pill tone="brand">custom</Pill>}
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
          {field.field_type}
        </span>
      </span>
      <span className="w-16 text-center">
        <input
          type="checkbox"
          disabled={!field.enabled}
          checked={field.required}
          onChange={(e) => void onUpdate(field.id, { required: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        />
      </span>
      <span className="w-16 text-center">
        <input
          type="checkbox"
          disabled={!field.enabled}
          checked={field.lock_after_commit}
          onChange={(e) => void onUpdate(field.id, { lock_after_commit: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        />
      </span>
      <span className="w-36">
        <select
          disabled={!field.enabled}
          value={field.edit_tier}
          onChange={(e) =>
            void onUpdate(field.id, { edit_tier: e.target.value as FieldEditTier })
          }
          className="w-full text-xs rounded border border-slate-200 px-2 py-1 bg-white disabled:bg-slate-50 disabled:cursor-not-allowed focus:outline-none focus:border-brand-500"
        >
          <option value="admin">Admin only</option>
          <option value="coordinator">Coordinator+</option>
          <option value="any">Anyone</option>
        </select>
      </span>
      <span className="w-8 text-center">
        {isCustom ? (
          <button
            onClick={onRemove}
            title="Remove this custom field"
            className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
          >
            ×
          </button>
        ) : (
          <span
            title="Standard field — can be disabled with the On toggle, but not removed (other parts of the app reference it)"
            className="inline-flex"
          >
            <Icon name="lock" size={14} className="text-slate-400" />
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-0.5 flex items-baseline gap-1.5">
        {value}
        {sub && <span className="text-xs text-slate-400 font-normal">{sub}</span>}
      </div>
    </div>
  );
}
