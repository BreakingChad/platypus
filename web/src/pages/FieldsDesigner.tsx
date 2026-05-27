import { useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import type { FieldDefinitionRow, FieldType, FieldEditTier } from "../lib/types";

const SECTIONS = ["Organizational", "Per-Site", "Regulatory", "Financial", "Operational"];

export function FieldsDesigner({ onBack }: { onBack: () => void }) {
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

  const bySection = (section: string) => studyFields.filter((f) => f.section === section);

  const addCustom = async () => {
    if (!composer.label.trim()) return;
    const sectionFields = bySection(composer.section);
    const nextPos = sectionFields.reduce((m, f) => Math.max(m, f.position), 0) + 1;
    const safeKey =
      composer.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "field";
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
    setComposer({ label: "", section: composer.section, field_type: "text", required: false });
  };

  return (
    <div className="min-h-screen bg-[#faf8f4]">
      <header className="bg-brand-gradient text-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <button onClick={onBack} className="text-sm opacity-80 hover:opacity-100 transition">
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
                <Mark />
              </div>
              <span className="text-2xl font-display font-extrabold tracking-tight">Platypus</span>
            </div>
          </div>
          <div className="text-xs font-mono uppercase tracking-wider opacity-80">
            Settings · Study fields
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-slate-900 mb-2">
          Study fields
        </h1>
        <p className="text-slate-600 mb-8 max-w-3xl leading-relaxed">
          Decide what every study record captures — which fields are required, which lock once a
          study is committed (for regulatory integrity), and who's allowed to change each one.
          Add custom fields for anything specific to how your site works. Every change writes
          directly to Supabase.
        </p>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <SummaryCard label="Fields enabled" value={`${enabled}`} sub={`of ${studyFields.length}`} />
          <SummaryCard label="Required" value={`${required}`} />
          <SummaryCard label="Custom fields" value={`${customCount}`} />
        </div>

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
          return (
            <div
              key={section}
              className="bg-white rounded-xl border border-slate-200 mb-3 overflow-hidden shadow-sm"
            >
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">
                {section}
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
                <FieldRow key={f.id} field={f} onUpdate={update} onRemove={remove} />
              ))}
            </div>
          );
        })}

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mt-6">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
            Add a custom field
          </div>
          <div className="grid grid-cols-[2fr_1.3fr_1fr_auto_auto] gap-2 items-center">
            <input
              type="text"
              value={composer.label}
              onChange={(e) => setComposer({ ...composer, label: e.target.value })}
              placeholder="Field name (e.g. Sponsor portal ID)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <select
              value={composer.section}
              onChange={(e) => setComposer({ ...composer, section: e.target.value })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium focus:outline-none focus:border-brand-500"
            >
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={composer.field_type}
              onChange={(e) =>
                setComposer({ ...composer, field_type: e.target.value as FieldType })
              }
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium focus:outline-none focus:border-brand-500"
            >
              {(["text", "date", "number", "dropdown", "boolean"] as FieldType[]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={composer.required}
                onChange={(e) => setComposer({ ...composer, required: e.target.checked })}
                className="accent-brand-500"
              />
              Required
            </label>
            <button
              onClick={addCustom}
              disabled={!composer.label.trim()}
              className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white shadow shadow-brand-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-6 leading-relaxed">
          <strong>Locks</strong> make a field read-only once a study is committed — use it for
          regulated identifiers (protocol number, IRB #) that shouldn't drift after activation.
          <strong> Who can edit</strong> sets the permission tier; every change is captured in
          the (coming) hash-chained audit trail regardless.
        </p>
      </main>
    </div>
  );
}

function FieldRow({
  field,
  onUpdate,
  onRemove,
}: {
  field: FieldDefinitionRow;
  onUpdate: (id: string, patch: Partial<FieldDefinitionRow>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
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
        {isCustom && (
          <span className="text-[10px] uppercase tracking-wider text-brand-700 font-bold">
            Custom
          </span>
        )}
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
            onClick={() => void onRemove(field.id)}
            title="Remove this custom field"
            className="text-slate-400 hover:text-red-600 transition text-lg leading-none"
          >
            ×
          </button>
        ) : (
          <span title="Standard field — can be disabled but not removed" className="text-slate-300 text-xs">
            🛡
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-0.5 flex items-baseline gap-1.5">
        {value}
        {sub && <span className="text-xs text-slate-400 font-normal">{sub}</span>}
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 300 300" className="w-6 h-6">
      <path fill="#ffffff" d="M 268 155 C 269 147 263 142 251 141 L 210 141 C 197 140 189 132 181 119 C 170 101 148 94 125 97 C 101 100 83 112 73 130 C 67 140 63 147 60 154 C 50 147 34 150 26 163 C 18 176 20 194 33 204 C 45 213 62 210 72 198 C 86 206 106 211 130 211 C 168 212 202 203 226 184 C 243 171 256 163 264 159 C 268 157 268 157 268 155 Z" />
      <circle cx="166" cy="121" r="9" fill="#4F46E5" />
    </svg>
  );
}
