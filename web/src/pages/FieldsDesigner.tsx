import { useMemo, useRef, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { FieldDefinitionRow, FieldType, FieldEditTier } from "../lib/types";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** FieldsDesigner — admin/developer-only.
 *
 *  Same designer, two entity types (study + site). A tab switcher at the top
 *  toggles between them, and the page repopulates with that entity's field
 *  set. Every field row supports:
 *    • toggle on/off
 *    • mark required
 *    • mark lock-after-commit
 *    • change who can edit
 *    • inline rename (click the label)
 *    • change the section (dropdown)            <-- NEW
 *    • change the field type (dropdown)         <-- NEW
 *    • remove (custom only)
 */

type EntityType = "study" | "site";

const ENTITY_META: Record<EntityType, {
  label: string;
  shortLabel: string;
  icon: string;
  noun: string;                  // "study" / "site" — used in copy
  description: string;
  accent: string;                // gradient class for the active tab tile
  ringTint: string;              // soft background tint for the whole section while active
  pillTone: "brand" | "info";
}> = {
  study: {
    label: "Study fields",
    shortLabel: "Studies",
    icon: "folder",
    noun: "study",
    description: "What every study record captures across its lifecycle.",
    accent: "bg-brand-gradient",
    ringTint: "bg-brand-50/40",
    pillTone: "brand",
  },
  site: {
    label: "Site fields",
    shortLabel: "Sites",
    icon: "hospital",
    noun: "site",
    description: "What every site record captures — institution, IRB, contacts, status.",
    accent: "bg-gradient-to-br from-sky-500 to-cyan-600",
    ringTint: "bg-sky-50/40",
    pillTone: "info",
  },
};

const STUDY_SECTIONS = ["Organizational", "Per-Site", "Regulatory", "Financial", "Operational"];
const SITE_SECTIONS = ["Identity", "Location", "Contacts", "Regulatory", "Operations"];

const FIELD_TYPES: FieldType[] = ["text", "date", "number", "dropdown", "boolean", "person"];

export function FieldsDesigner() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const toast = useToast();

  // ENTITY TAB STATE
  const [entityType, setEntityType] = useState<EntityType>("study");
  const sections = entityType === "study" ? STUDY_SECTIONS : SITE_SECTIONS;

  // DATA
  const { rows, loading, error, update, insert, remove } = useOrgTable<FieldDefinitionRow>(
    "field_definitions",
    { orderBy: "position", realtime: true }
  );

  const visibleFields = useMemo(
    () => rows.filter((f) => f.entity_type === entityType),
    [rows, entityType]
  );
  const enabled = visibleFields.filter((f) => f.enabled).length;
  const required = visibleFields.filter((f) => f.required).length;
  const customCount = visibleFields.filter((f) => f.kind === "custom").length;

  const [composer, setComposer] = useState({
    label: "",
    section: sections[0],
    field_type: "text" as FieldType,
    required: false,
  });
  const labelInputRef = useRef<HTMLInputElement>(null);
  const composerCardRef = useRef<HTMLDivElement>(null);

  // Keep composer.section valid when switching entity tabs.
  if (!sections.includes(composer.section)) {
    // Update on next tick to avoid a render warning.
    setTimeout(() => setComposer((c) => ({ ...c, section: sections[0] })), 0);
  }

  const bySection = (section: string) =>
    visibleFields.filter((f) => f.section === section).sort((a, b) => a.position - b.position);

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
        entity_type: entityType,
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
    if (!window.confirm(`Remove "${label}"? Existing records keep their value, but the field disappears from forms.`)) return;
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
          title="Field definitions"
          subtitle="Decide what every record captures — which fields are required, which lock after commit, and who can edit each one."
        />
        <Card className="mt-6">
          <EmptyState
            iconName="lock"
            title="Admin-only surface"
            sub="Only org admins can change the field structure. Ask an owner or admin on your team."
          />
        </Card>
      </div>
    );
  }

  /* ---------- admin view ---------- */

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Configure · Field definitions"
        title={ENTITY_META[entityType].label}
        subtitle={ENTITY_META[entityType].description}
        actions={<Pill tone={ENTITY_META[entityType].pillTone}>live · admin-driven</Pill>}
      />

      {/* BIG SEGMENTED CONTROL — the page's defining choice */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["study", "site"] as EntityType[]).map((k) => {
          const meta = ENTITY_META[k];
          const active = entityType === k;
          const count = rows.filter((f) => f.entity_type === k && f.enabled).length;
          return (
            <button
              key={k}
              onClick={() => setEntityType(k)}
              className={
                "relative text-left rounded-2xl border-2 p-4 transition flex items-center gap-3 " +
                (active
                  ? "border-transparent ring-2 ring-offset-2 ring-slate-300 shadow-md"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:-translate-y-[1px]")
              }
            >
              <div
                className={
                  "w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white " +
                  (active ? meta.accent : "bg-slate-200 text-slate-500")
                }
                style={active ? undefined : undefined}
              >
                <Icon name={meta.icon} size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={
                    "font-display font-extrabold text-base " +
                    (active ? "text-slate-900" : "text-slate-700")
                  }>
                    {meta.label}
                  </span>
                  {active && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                      editing
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">
                  {meta.description}
                </div>
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                <span className={
                  "text-xl font-display font-extrabold tracking-tight " +
                  (active ? "text-slate-900" : "text-slate-400")
                }>
                  {count}
                </span>
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  active
                </span>
              </div>
              {active && (
                <div
                  className={"absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl " + meta.accent}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Context banner — reinforces which entity is active right above the editor */}
      <div
        className={
          "mt-4 -mb-2 rounded-lg px-3 py-2 flex items-center gap-2 text-xs " +
          ENTITY_META[entityType].ringTint
        }
      >
        <div
          className={
            "w-1.5 h-4 rounded-full " + ENTITY_META[entityType].accent
          }
        />
        <span className="font-semibold text-slate-700">
          You're editing <span className="text-slate-900">{ENTITY_META[entityType].label.toLowerCase()}</span>.
        </span>
        <span className="text-slate-500">
          Changes apply to every {ENTITY_META[entityType].noun} record in your org.
        </span>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3 mt-6 mb-6">
        <SummaryCard label="Fields enabled" value={`${enabled}`} sub={`of ${visibleFields.length}`} />
        <SummaryCard label="Required" value={`${required}`} />
        <SummaryCard label="Custom fields" value={`${customCount}`} />
      </div>

      {/* COMPOSER */}
      <Card innerRef={composerCardRef} primary className="mb-8 scroll-mt-24">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs font-bold text-brand-700 uppercase tracking-wider">
              Add a custom field to {ENTITY_META[entityType].label.toLowerCase()}
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
          <select
            value={composer.section}
            onChange={(e) => setComposer({ ...composer, section: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition"
          >
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={composer.field_type}
            onChange={(e) => setComposer({ ...composer, field_type: e.target.value as FieldType })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition"
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={composer.required}
              onChange={(e) => setComposer({ ...composer, required: e.target.checked })}
              className="accent-brand-500 w-4 h-4"
            />
            Required
          </label>
          <Button onClick={addCustom} disabled={!composer.label.trim()}>+ Add</Button>
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

      {!loading && visibleFields.length === 0 && (
        <Card>
          <EmptyState
            iconName="file"
            title={`No ${ENTITY_META[entityType].noun} fields configured`}
            sub={
              entityType === "site"
                ? "Site fields seed on a fresh migration. If you just ran 0005, refresh — they should appear."
                : "Run the seed migration to populate the default study fields."
            }
          />
        </Card>
      )}

      {sections.map((section) => {
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

            {/* Column headers — wider grid to fit the new section + type dropdowns. */}
            <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              <span className="w-8">On</span>
              <span className="flex-1">Field</span>
              <span className="w-32">Section</span>
              <span className="w-24">Type</span>
              <span className="w-14 text-center">Required</span>
              <span className="w-14 text-center">Locks</span>
              <span className="w-32">Who can edit</span>
              <span className="w-8" />
            </div>

            {fields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                allSections={sections}
                onUpdate={tryUpdate}
                onRemove={() => tryRemove(f.id, f.label)}
              />
            ))}
          </div>
        );
      })}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Section</strong> groups fields visually on every form. <strong>Type</strong>
        determines what input renders downstream (text box / date picker / number / dropdown
        / yes-no / person picker). <strong>Locks</strong> make a field read-only once a study
        is committed. <strong>Who can edit</strong> sets the permission tier; every change is
        captured in the audit trail regardless.
      </p>
    </div>
  );
}

/* ---------- pieces ---------- */

function FieldRow({
  field,
  allSections,
  onUpdate,
  onRemove,
}: {
  field: FieldDefinitionRow;
  allSections: string[];
  onUpdate: (id: string, patch: Partial<FieldDefinitionRow>) => Promise<void>;
  onRemove: () => void;
}) {
  const isCustom = field.kind === "custom";
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(field.label);

  const commitLabel = () => {
    const next = labelDraft.trim();
    if (next && next !== field.label) void onUpdate(field.id, { label: next });
    setEditingLabel(false);
  };

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

      <span className="flex-1 min-w-0">
        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setLabelDraft(field.label);
                setEditingLabel(false);
              }
            }}
            className="text-sm font-semibold text-slate-900 border border-brand-200 rounded px-1.5 py-0.5 outline-none focus:border-brand-500 w-full"
          />
        ) : (
          <button
            onClick={() => setEditingLabel(true)}
            className="text-sm font-semibold text-slate-900 hover:text-brand-700 transition truncate flex items-center gap-2 w-full text-left"
            title="Click to rename"
          >
            {field.label}
            {isCustom && <Pill tone="brand">custom</Pill>}
          </button>
        )}
        <span className="text-[10px] font-mono text-slate-400 truncate block">
          {field.key}
        </span>
      </span>

      {/* SECTION dropdown */}
      <span className="w-32">
        <select
          disabled={!field.enabled}
          value={field.section}
          onChange={(e) => {
            if (e.target.value === field.section) return;
            void onUpdate(field.id, { section: e.target.value, position: 9999 });
          }}
          className="w-full text-xs rounded border border-slate-200 px-2 py-1 bg-white disabled:bg-slate-50 disabled:cursor-not-allowed focus:outline-none focus:border-brand-500"
        >
          {/* include current value even if not in allSections (defensive) */}
          {!allSections.includes(field.section) && (
            <option value={field.section}>{field.section}</option>
          )}
          {allSections.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </span>

      {/* FIELD TYPE dropdown */}
      <span className="w-24">
        <select
          disabled={!field.enabled}
          value={field.field_type}
          onChange={(e) => {
            const next = e.target.value as FieldType;
            if (next === field.field_type) return;
            if (
              !window.confirm(
                `Change "${field.label}" from ${field.field_type} to ${next}? Existing values stay in the database — only how the field renders changes.`
              )
            )
              return;
            void onUpdate(field.id, { field_type: next });
          }}
          className="w-full text-xs rounded border border-slate-200 px-2 py-1 bg-white disabled:bg-slate-50 disabled:cursor-not-allowed focus:outline-none focus:border-brand-500"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </span>

      <span className="w-14 text-center">
        <input
          type="checkbox"
          disabled={!field.enabled}
          checked={field.required}
          onChange={(e) => void onUpdate(field.id, { required: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        />
      </span>
      <span className="w-14 text-center">
        <input
          type="checkbox"
          disabled={!field.enabled}
          checked={field.lock_after_commit}
          onChange={(e) => void onUpdate(field.id, { lock_after_commit: e.target.checked })}
          className="accent-brand-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
        />
      </span>
      <span className="w-32">
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
            title="Standard field — can be disabled with the On toggle, but not removed (other parts of the app may reference it)"
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
