import { useModalA11y } from "../lib/useModalA11y";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { writeAuditEvent } from "../lib/auditLog";
import { useOrgTable } from "../lib/useOrgTable";
import type {
  FieldDefinitionRow,
  FieldType,
  PipelineStageRow,
  WorkstreamRow,
  StudyRow,
} from "../lib/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Icon } from "./ui/Icon";

/** NewStudyModal — driven by field_definitions.
 *
 *  Maps "well-known" study keys onto typed columns (shortTitle → title,
 *  sponsor → sponsor, etc.) so the studies table stays queryable; everything
 *  else (custom fields, less-common standard fields) goes into the
 *  custom_field_values JSONB column.
 *
 *  Validates required fields up front, generates the code from the org's
 *  project_id_prefix + next available number, drops the study into the first
 *  non-terminal stage by default (intake when present).
 */

import { TYPED_COLUMN_KEYS, KEY_TO_COLUMN } from "../lib/submissions";

type Draft = Record<string, string | number | boolean | null>;

export function NewStudyModal({
  stages,
  existingCodes,
  onClose,
  onCreated,
}: {
  stages: PipelineStageRow[];
  existingCodes: string[];
  onClose: () => void;
  onCreated: (s: StudyRow) => void;
}) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", {
    orderBy: "position",
  });

  const workstreams = useOrgTable<WorkstreamRow>("workstreams", {});
  const activeWs = workstreams.rows.filter((w) => w.status === "active");
  const defaultWs = activeWs.find((w) => w.is_default) ?? activeWs[0] ?? null;
  const [workstreamId, setWorkstreamId] = useState<string>("");
  const wsValue = workstreamId || defaultWs?.id || "";

  const studyFields = useMemo(
    () =>
      fields.rows
        .filter((f) => f.entity_type === "study" && f.enabled)
        .sort((a, b) => a.position - b.position),
    [fields.rows]
  );

  // We always need a title — even if no field_definition exists for it yet,
  // we surface a fallback Short Title input so the modal is never useless.
  const hasShortTitle = useMemo(
    () => studyFields.some((f) => f.key === "shortTitle"),
    [studyFields]
  );

  const sections = useMemo(() => {
    const s = new Set<string>();
    for (const f of studyFields) s.add(f.section);
    return Array.from(s);
  }, [studyFields]);

  // Pick a default stage — first non-terminal, or first stage at all.
  const defaultStageKey = useMemo(() => {
    const open = stages.find((s) => !s.terminal);
    return open?.key ?? stages[0]?.key ?? null;
  }, [stages]);

  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [draft, setDraft] = useState<Draft>({});
  const [stageKey, setStageKey] = useState<string | null>(defaultStageKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackTitle, setFallbackTitle] = useState("");

  useEffect(() => {
    if (defaultStageKey && !stageKey) setStageKey(defaultStageKey);
  }, [defaultStageKey, stageKey]);

  const updateDraft = (key: string, value: Draft[string]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const validate = (): string | null => {
    for (const f of studyFields) {
      if (!f.required) continue;
      const v = draft[f.key];
      if (v === undefined || v === null || v === "") {
        return `${f.label} is required.`;
      }
    }
    const title = (draft["shortTitle"] as string) ?? fallbackTitle;
    if (!title || !String(title).trim()) {
      return "Short title is required (every study needs a name).";
    }
    return null;
  };

  const generateCode = async (): Promise<string> => {
    let prefix = "STU";
    if (orgId) {
      const { data } = await supabase
        .from("orgs")
        .select("project_id_prefix")
        .eq("id", orgId)
        .maybeSingle();
      prefix = data?.project_id_prefix || "STU";
    }
    const taken = new Set(existingCodes);
    // Find the highest existing numeric suffix for this prefix and add 1.
    let max = 0;
    const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)$");
    for (const c of existingCodes) {
      const m = c.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    let next = max + 1;
    while (taken.has(`${prefix}-${String(next).padStart(3, "0")}`)) next += 1;
    return `${prefix}-${String(next).padStart(3, "0")}`;
  };

  const onSubmit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (!orgId) throw new Error("No active organization.");

      const code = await generateCode();
      const title =
        ((draft["shortTitle"] as string) ?? fallbackTitle ?? "").trim() ||
        "Untitled study";

      // Split the draft into typed columns + custom_field_values JSONB.
      const typed: Partial<StudyRow> = {
        org_id: orgId,
        code,
        title,
        stage_key: stageKey,
        workstream_id: wsValue || null,
        intake_status: "submitted",
        intake_date: new Date().toISOString(),
      };
      const custom: Record<string, unknown> = {};

      for (const f of studyFields) {
        const v = draft[f.key];
        if (v === undefined || v === null || v === "") continue;
        if (TYPED_COLUMN_KEYS.has(f.key)) {
          const col = KEY_TO_COLUMN[f.key];
          if (col && col !== "title") {
            // typed column (other than title which we already set above)
            (typed as any)[col] = v;
          }
        } else {
          custom[f.key] = v;
        }
      }
      typed.custom_field_values = custom;

      const { data, error } = await supabase
        .from("studies")
        .insert(typed as any)
        .select("*")
        .single();
      if (error) throw error;
      const newStudy = data as unknown as StudyRow;
      if (orgId && userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: newStudy.id,
          action: "created",
          payload: {
            code: newStudy.code,
            title: newStudy.title,
            stage_key: newStudy.stage_key,
          },
        });
      }
      onCreated(newStudy);
    } catch (e: any) {
      setError(e?.message || "Couldn't create the study.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Create study"
        className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-slate-400">
              Studies
            </div>
            <h2 className="text-lg font-display font-bold text-slate-900">
              New study
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 transition"
            title="Close (Esc)"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Title fallback when no shortTitle field is configured */}
          {!hasShortTitle && (
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Short title <span className="text-red-500">*</span>
              </label>
              <Input
                value={fallbackTitle}
                onChange={(e) => setFallbackTitle(e.target.value)}
                placeholder="A working name for the study"
                autoFocus
              />
              <p className="text-[11px] text-slate-500 mt-1">
                No <code className="text-[10px] font-mono">shortTitle</code> field is configured for studies — add one in Settings → Study fields to make this part of every study record.
              </p>
            </div>
          )}

          {/* Stage picker */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Starting stage
            </label>
            <Select
              value={stageKey ?? ""}
              onChange={(e) => setStageKey(e.target.value || null)}
            >
              <option value="">— Unassigned —</option>
              {stages.map((s) => (
                <option key={s.id} value={s.key}>
                  {s.label}
                  {s.terminal ? " (terminal)" : ""}
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-slate-500 mt-1">
              Defaults to the first non-terminal stage. You can move the study anytime from its detail page.
            </p>
          </div>

          {/* Task flow picker — assigned at creation */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Task flow</label>
            <Select value={wsValue} onChange={(e) => setWorkstreamId(e.target.value)}>
              {activeWs.length === 0 && <option value="">— None configured —</option>}
              {activeWs.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.is_default ? " (default)" : ""}</option>
              ))}
            </Select>
            <p className="text-[11px] text-slate-500 mt-1">The pathway this study follows.</p>
          </div>

          {/* Field-driven inputs, grouped by section */}
          {fields.loading && studyFields.length === 0 && (
            <div className="text-sm text-slate-500">Loading field definitions…</div>
          )}

          {sections.map((section) => {
            const sectionFields = studyFields.filter((f) => f.section === section);
            if (sectionFields.length === 0) return null;
            return (
              <div key={section} className="mb-5">
                <div className="text-[11px] font-semibold text-slate-500 mb-2">
                  {section}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sectionFields.map((f) => (
                    <FieldInput
                      key={f.id}
                      field={f}
                      value={draft[f.key]}
                      onChange={(v) => updateDraft(f.key, v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit} disabled={saving}>
              {saving ? "Creating…" : "Create study"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- field renderer ---------- */

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinitionRow;
  value: Draft[string];
  onChange: (v: Draft[string]) => void;
}) {
  const label = (
    <label className="block text-xs font-semibold text-slate-700 mb-1">
      {field.label}
      {field.required && <span className="text-red-500 ml-1">*</span>}
    </label>
  );

  switch (field.field_type as FieldType) {
    case "boolean":
      return (
        <div>
          {label}
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="accent-brand-500 w-4 h-4"
            />
            Yes
          </label>
        </div>
      );
    case "number":
      return (
        <div>
          {label}
          <Input
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
      );
    case "date":
      return (
        <div>
          {label}
          <Input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </div>
      );
    case "dropdown": {
      const opts = (field.options as { values?: string[] } | null)?.values ?? [];
      return (
        <div>
          {label}
          <Select
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          {opts.length === 0 && (
            <p className="text-[10px] text-slate-400 mt-0.5 italic">
              No options configured yet — falls back to free text.
            </p>
          )}
          {opts.length === 0 && (
            <Input
              className="mt-1"
              value={(value as string) ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder={`Type a ${field.label.toLowerCase()}`}
            />
          )}
        </div>
      );
    }
    default:
      return (
        <div>
          {label}
          <Input
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.label}
          />
        </div>
      );
  }
}
