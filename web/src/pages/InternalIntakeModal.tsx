import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { stamped } from "../lib/stamp";
import { writeAuditEvent } from "../lib/auditLog";
import { useModalA11y } from "../lib/useModalA11y";
import { missingRequired, type FormFieldSnapshot } from "../lib/forms";
import { nextStudyCode, buildStudyInsert } from "../lib/submissions";
import type { FieldDefinitionRow, IntakeFormRow, StudyRow, WorkstreamRow, PipelineRow } from "../lib/types";
import { useOrgTable } from "../lib/useOrgTable";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

/** InternalIntakeModal (R2) — the internal intake form IS the study-creation
 *  wizard. Renders the active internal form's frozen field snapshot; on submit
 *  it creates the STUDY directly (stage = intake) rather than a public
 *  submission, so "Add new study" and the org's own intake form are one tool.
 */
export function InternalIntakeModal({
  form,
  orgId,
  studyFields,
  existingCodes,
  prefix,
  userId,
  userEmail,
  onClose,
  onCreated,
}: {
  form: IntakeFormRow;
  orgId: string;
  studyFields: FieldDefinitionRow[];
  existingCodes: string[];
  prefix: string;
  userId: string | null;
  userEmail: string | null;
  onClose: () => void;
  onCreated: (studyId: string) => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const toast = useToast();
  const fields = useMemo(() => (form.fields as FormFieldSnapshot[]) ?? [], [form.fields]);
  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const f of fields) if (!seen.includes(f.section)) seen.push(f.section);
    return seen;
  }, [fields]);
  const workstreams = useOrgTable<WorkstreamRow>("workstreams", {});
  const pipelines = useOrgTable<PipelineRow>("pipelines", { orderBy: "position" });
  const activeWs = useMemo(() => workstreams.rows.filter((w) => w.status === "active"), [workstreams.rows]);
  /** Task flows grouped by their pipeline, for an optgroup picker. */
  const wsByPipeline = useMemo(() => {
    const groups = pipelines.rows
      .filter((p) => p.status === "active")
      .map((p) => ({ pipeline: p, items: activeWs.filter((w) => w.pipeline_id === p.id) }))
      .filter((g) => g.items.length > 0);
    const orphan = activeWs.filter((w) => !pipelines.rows.some((p) => p.id === w.pipeline_id));
    if (orphan.length > 0) groups.push({ pipeline: { id: "", name: "Other" } as PipelineRow, items: orphan });
    return groups;
  }, [pipelines.rows, activeWs]);
  const [workstreamId, setWorkstreamId] = useState<string>("");
  // Auto-select when there's exactly one task flow; otherwise force a choice.
  useEffect(() => {
    if (workstreamId && activeWs.some((w) => w.id === workstreamId)) return;
    setWorkstreamId(activeWs.length === 1 ? activeWs[0].id : "");
  }, [activeWs, workstreamId]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const missing = missingRequired(fields, values);
    if (activeWs.length > 0 && !workstreamId) missing.push("Task flow");
    setProblems(missing);
    if (missing.length > 0) return;
    setBusy(true);
    try {
      const code = nextStudyCode(existingCodes, prefix);
      const insert = buildStudyInsert({
        orgId, code, stageKey: "intake", values, studyFields,
        fallbackTitle: form.title,
      });
      const wsId = workstreamId || null;
      const { data, error } = await supabase.from("studies").insert({ ...insert, workstream_id: wsId } as any).select("id, code").single();
      if (error) throw error;
      const id = (data as any).id as string;
      if (userId) {
        void writeAuditEvent({
          orgId, actorId: userId, actorEmail: userEmail,
          entityType: "study", entityId: id,
          action: "created",
          payload: { code: (data as any).code, stage_key: "intake", source: "internal_intake_form", form: form.title },
        });
      }
      toast.success(stamped(`${(data as any).code} created via ${form.title}`));
      onCreated(id);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create the study"));
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
        aria-label={`New intake — ${form.title}`}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">New intake</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Using your internal form <strong>{form.title}</strong>. Required fields marked
            <span className="text-brand-600 font-bold"> *</span>.
          </p>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {activeWs.length > 0 && (
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Task flow <span className="text-brand-600 font-bold">*</span></span>
              <select
                value={workstreamId}
                onChange={(e) => setWorkstreamId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">— Select a task flow —</option>
                {wsByPipeline.map((g) => (
                  <optgroup key={g.pipeline.id || "other"} label={g.pipeline.name}>
                    {g.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <span className="block text-[11px] text-slate-400 mt-1">Sets the pipeline this study runs on.</span>
            </label>
          )}
          {fields.length === 0 && (
            <p className="text-sm text-slate-500 italic">This form has no fields — add some in Configure → Intake forms.</p>
          )}
          {sections.map((section) => (
            <div key={section}>
              <div className="text-xs font-semibold text-slate-500 mb-2">{section}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {fields.filter((f) => f.section === section).map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-xs font-semibold text-slate-700 mb-1">
                      {f.label} {f.required && <span className="text-brand-600 font-bold">*</span>}
                    </span>
                    <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))} />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {problems.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <strong>Still needed:</strong> {problems.join(" · ")}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create study"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: FormFieldSnapshot; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.field_type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="accent-brand-500 w-4 h-4" />
          Yes
        </label>
      );
    case "number":
      return <Input type="number" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return <Input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "dropdown": {
      const opts = field.values ?? [];
      if (opts.length === 0) return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
      return (
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="">— Select —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case "multiselect": {
      const opts = field.values ?? [];
      const sel: string[] = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) => onChange(sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((v) => (
            <button key={v} type="button" onClick={() => toggle(v)}
              className={"text-xs rounded-full border px-2.5 py-1 transition " + (sel.includes(v) ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
              {sel.includes(v) ? "✓ " : ""}{v}
            </button>
          ))}
        </div>
      );
    }
    case "list": {
      const items: string[] = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input value={it} onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }} />
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500 px-1" aria-label="Remove">×</button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...items, ""])} className="text-xs font-semibold text-brand-700 hover:underline">+ Add entry</button>
        </div>
      );
    }
    default:
      return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}
