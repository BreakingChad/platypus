import { useMemo, useState } from "react";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useCurrentOrg } from "../lib/OrgContext";
import { useToast } from "../lib/Toast";
import { stamped } from "../lib/stamp";
import { supabase } from "../lib/supabase";
import { uniqueSlug, snapshotFields, type FormFieldSnapshot, type FormStatus } from "../lib/forms";
import type { FieldDefinitionRow, IntakeFormRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { MicroField } from "../components/ui/MicroField";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";

/** FormsAdmin — admin-only. External intake forms.
 *
 *  Lifecycle (per spec): Draft → Active → Inactive → Archived.
 *   · Drafts are editable (pick fields from the study schema, mark required).
 *   · Activating FREEZES a field snapshot — submissions stay bound to the
 *     version they were submitted on.
 *   · Active forms are NOT directly editable: Copy-and-Edit makes a new
 *     draft version; deactivate-then-replace is the flow.
 *   · Share an individual link, or the landing page that always lists every
 *     active form.
 *   · No submitter drafts, by design — required fields mean submissions
 *     arrive complete.
 */

const STATUS_META: Record<FormStatus, { label: string; tone: "brand" | "success" | "neutral" | "warning" }> = {
  draft: { label: "Draft", tone: "brand" },
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

const ORDER: FormStatus[] = ["active", "draft", "inactive", "archived"];

export function FormsAdmin() {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const { orgId } = useCurrentOrg();
  const toast = useToast();

  const forms = useOrgTable<IntakeFormRow>("intake_forms", { orderBy: "created_at", ascending: false, realtime: true });
  const fieldDefs = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });
  const studyFields = useMemo(
    () => fieldDefs.rows.filter((f) => f.entity_type === "study" && f.enabled),
    [fieldDefs.rows]
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"internal" | "external" | "specialized">("specialized");

  const landingUrl = `${window.location.origin}${window.location.pathname}#/f`;
  const formUrl = (slug: string) => `${window.location.origin}${window.location.pathname}#/f/${slug}`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied to clipboard`);
    } catch {
      toast.error("Couldn't reach the clipboard — copy from the address bar instead");
    }
  };

  const createDraft = async () => {
    if (!title.trim() || !orgId) return;
    try {
      const { data: me } = await supabase.auth.getUser();
      const created = await forms.insert({
        title: title.trim(),
        description: description.trim() || null,
        status: "draft",
        scope,
        slug: uniqueSlug(title, forms.rows.map((f) => f.slug)),
        version: 1,
        fields: [],
        created_by: me?.user?.id ?? null,
      } as Partial<IntakeFormRow>);
      if (created) {
        toast.success(stamped(`Draft "${title.trim()}" created — pick its fields below`));
        setTitle("");
        setDescription("");
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create the form"));
    }
  };

  const update = async (id: string, patch: Partial<IntakeFormRow>) => {
    try {
      await forms.update(id, patch);
    } catch (e: any) {
      toast.error(friendlyError(e, "That change didn't save"));
    }
  };

  const activate = async (form: IntakeFormRow) => {
    const selected = (form.fields as FormFieldSnapshot[]) ?? [];
    if (selected.length === 0) {
      toast.error("Pick at least one field before activating");
      return;
    }
    // Re-snapshot from live definitions at activation — labels/choices fresh,
    // then frozen for the life of this version.
    const snapshot = snapshotFields(
      studyFields,
      selected.map((s) => ({ key: s.key, required: s.required }))
    );
    if (
      !(await confirmDialog({
        title: "Activate this form",
        message: `Activating freezes this version's ${snapshot.length} field${snapshot.length === 1 ? "" : "s"} and makes the public link live. To change it later you'll copy-and-edit a new version.`,
        confirmLabel: "Activate",
      }))
    )
      return;
    await update(form.id, { status: "active", fields: snapshot } as Partial<IntakeFormRow>);
    toast.success(stamped(`"${form.title}" is live`));
  };

  const deactivate = async (form: IntakeFormRow) => {
    if (
      !(await confirmDialog({
        title: "Deactivate form",
        message: `The public link for "${form.title}" stops accepting submissions immediately. Existing submissions are unaffected.`,
        confirmLabel: "Deactivate",
      }))
    )
      return;
    await update(form.id, { status: "inactive" } as Partial<IntakeFormRow>);
    toast.success(stamped(`"${form.title}" deactivated`));
  };

  const copyAndEdit = async (form: IntakeFormRow) => {
    try {
      const created = await forms.insert({
        title: form.title,
        description: form.description,
        status: "draft",
        slug: uniqueSlug(`${form.slug}-v${form.version + 1}`, forms.rows.map((f) => f.slug)),
        version: form.version + 1,
        copied_from: form.id,
        fields: form.fields,
      } as Partial<IntakeFormRow>);
      if (created) toast.success(stamped(`Draft v${form.version + 1} of "${form.title}" created`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't copy the form"));
    }
  };

  const archive = async (form: IntakeFormRow) => {
    if (
      !(await confirmDialog({
        title: "Archive form",
        message: `"${form.title}" moves to the archive. Its submissions stay searchable; the form can't be reactivated from there (copy-and-edit instead).`,
        confirmLabel: "Archive",
      }))
    )
      return;
    await update(form.id, { status: "archived" } as Partial<IntakeFormRow>);
    toast.success(stamped(`"${form.title}" archived`));
  };

  const removeArchived = async (form: IntakeFormRow) => {
    if (
      !(await confirmDialog({
        title: "Delete archived form",
        message: `Permanently delete "${form.title}" (v${form.version})? Forms that ever received submissions can't be deleted — the audit chain needs them.`,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await forms.remove(form.id);
      toast.success(stamped(`Deleted "${form.title}"`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't delete — forms with submissions are kept for the audit chain"));
    }
  };

  /* ---------- gating ---------- */

  if (memberLoading) {
    return (
      <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <div className="text-sm text-slate-500">Checking permissions…</div>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-page-narrow mx-auto px-4 md:px-6 2xl:px-12 py-8">
        <PageHeader kicker="Configure" title="Intake forms" subtitle="External forms that feed the intake funnel." />
        <Card className="mt-6">
          <EmptyState iconName="lock" title="Admin-only surface" sub="Only org admins manage intake forms." />
        </Card>
      </div>
    );
  }

  const byStatus = (s: FormStatus) => forms.rows.filter((f) => f.status === s);

  return (
    <div className="max-w-page-standard mx-auto px-4 md:px-6 2xl:px-12 py-8">
      <PageHeader
        kicker="Configure"
        title="Intake forms"
        subtitle="Build a form from your study fields, activate it, and share one link — or the landing page that always lists every active form. Required fields mean submissions arrive complete; there are no submitter drafts."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void copy(landingUrl, "Landing page link")}>
              <Icon name="external" size={12} /> Copy landing link
            </Button>
            <Pill tone="brand">live · admin-driven</Pill>
          </div>
        }
      />
      <AutoSaveNote />

      {(() => {
        const active = forms.rows.filter((x) => x.status === "active");
        const hasInternal = active.some((x) => x.scope === "internal");
        const hasExternal = active.some((x) => x.scope === "external");
        if (hasInternal && hasExternal) return null;
        const missing = [!hasInternal && "internal", !hasExternal && "external"].filter(Boolean).join(" and ");
        return (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-center gap-2">
            <Icon name="alert" size={14} className="flex-shrink-0" />
            Onboarding needs at least one <strong>internal</strong> and one <strong>external</strong> active
            form. Missing: <strong>{missing}</strong>. The internal form powers "+ New intake".
          </div>
        );
      })()}

      {/* COMPOSER */}
      <Card primary className="mt-6 mb-6">
        <div className="text-xs font-bold text-brand-700 uppercase tracking-wider mb-3">
          New intake form
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_2fr_auto_auto] gap-3 items-end">
          <MicroField label="Form title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) void createDraft();
              }}
              placeholder="e.g. New industry study intake"
            />
          </MicroField>
          <MicroField label="Description shown to submitters (optional)">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Sponsors & CROs: tell us about your study"
            />
          </MicroField>
          <MicroField label="Kind">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="internal">Internal (study wizard)</option>
              <option value="external">External (public)</option>
              <option value="specialized">Specialized</option>
            </select>
          </MicroField>
          <Button onClick={() => void createDraft()} disabled={!title.trim()}>
            + Create draft
          </Button>
        </div>
      </Card>

      {forms.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-6">
          <strong>Error:</strong> {forms.error}
        </div>
      )}

      {!forms.loading && forms.rows.length === 0 && (
        <Card>
          <EmptyState
            iconName="file"
            title="No intake forms yet"
            sub="Create a draft above, pick the fields it asks for, then activate it to get a shareable public link."
          />
        </Card>
      )}

      {ORDER.map((status) => {
        const list = byStatus(status);
        if (list.length === 0) return null;
        return (
          <div key={status} className="mb-6">
            <div className="text-xs font-semibold text-slate-500 mb-2">
              {STATUS_META[status].label} · {list.length}
            </div>
            <div className="space-y-3">
              {list.map((form) => (
                <FormCard
                  key={form.id}
                  form={form}
                  studyFields={studyFields}
                  onUpdate={(patch) => void update(form.id, patch)}
                  onActivate={() => void activate(form)}
                  onDeactivate={() => void deactivate(form)}
                  onCopyAndEdit={() => void copyAndEdit(form)}
                  onArchive={() => void archive(form)}
                  onDelete={() => void removeArchived(form)}
                  onCopyLink={() => void copy(formUrl(form.slug), "Form link")}
                />
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-slate-500 mt-6 leading-relaxed max-w-3xl">
        <strong>Versioning is regulatory-grade:</strong> an active form is never edited in place.
        Copy-and-edit creates the next draft version; old submissions stay bound to the version
        they were submitted on. The landing page only ever lists active forms, so the link you
        put in an email signature never goes stale.
      </p>
    </div>
  );
}

/* ---------- form card ---------- */

function FormCard({
  form,
  studyFields,
  onUpdate,
  onActivate,
  onDeactivate,
  onCopyAndEdit,
  onArchive,
  onDelete,
  onCopyLink,
}: {
  form: IntakeFormRow;
  studyFields: FieldDefinitionRow[];
  onUpdate: (patch: Partial<IntakeFormRow>) => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onCopyAndEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
}) {
  const status = form.status as FormStatus;
  const selected = (form.fields as FormFieldSnapshot[]) ?? [];
  const selectedKeys = new Set(selected.map((s) => s.key));
  const [expanded, setExpanded] = useState(status === "draft");

  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const f of studyFields) if (!seen.includes(f.section)) seen.push(f.section);
    return seen;
  }, [studyFields]);

  const toggleField = (def: FieldDefinitionRow) => {
    const next = selectedKeys.has(def.key)
      ? selected.filter((s) => s.key !== def.key)
      : [...selected, { key: def.key, label: def.label, section: def.section, field_type: def.field_type, required: def.required }];
    onUpdate({ fields: next } as Partial<IntakeFormRow>);
  };
  const toggleRequired = (key: string) => {
    onUpdate({
      fields: selected.map((s) => (s.key === key ? { ...s, required: !s.required } : s)),
    } as Partial<IntakeFormRow>);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-slate-400 hover:text-slate-900"
          aria-label={expanded ? "Collapse form" : "Expand form"}
        >
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 truncate">{form.title}</span>
            <Pill tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Pill>
            <span className={
              "text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 " +
              ((form as any).scope === "internal" ? "bg-brand-50 text-brand-700"
                : (form as any).scope === "external" ? "bg-sky-50 text-sky-700"
                : "bg-slate-100 text-slate-500")
            }>
              {(form as any).scope ?? "specialized"}
            </span>
            <span className="text-[11px] font-mono text-slate-400">v{form.version}</span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {selected.length} field{selected.length === 1 ? "" : "s"}
            {form.description ? ` · ${form.description}` : ""}
            {status === "active" ? ` · /#/f/${form.slug}` : ""}
          </div>
        </div>

        {/* state-appropriate tools (per spec) */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {status === "draft" && (
            <Button size="sm" variant="primary" onClick={onActivate} disabled={selected.length === 0}
              title={selected.length === 0 ? "Pick at least one field first" : "Freeze this version and make the public link live"}>
              Activate
            </Button>
          )}
          {status === "active" && (
            <>
              <Button size="sm" onClick={onCopyLink}>
                <Icon name="external" size={11} /> Copy link
              </Button>
              <Button size="sm" variant="ghost" onClick={onCopyAndEdit} title="New draft version — this one stays live until you deactivate it">
                <Icon name="copy" size={11} /> Copy &amp; edit
              </Button>
              <Button size="sm" variant="ghost" onClick={onDeactivate}>
                Deactivate
              </Button>
            </>
          )}
          {status === "inactive" && (
            <>
              <Button size="sm" variant="primary" onClick={() => onUpdate({ status: "active" } as Partial<IntakeFormRow>)} title="Reactivate — same frozen version, link live again">
                Reactivate
              </Button>
              <Button size="sm" variant="ghost" onClick={onCopyAndEdit}>
                <Icon name="copy" size={11} /> Copy &amp; edit
              </Button>
              <Button size="sm" variant="ghost" onClick={onArchive}>
                Archive
              </Button>
            </>
          )}
          {status === "archived" && (
            <Button size="sm" variant="danger" onClick={onDelete}>
              <Icon name="trash" size={11} /> Delete
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4">
          {status === "draft" ? (
            <>
              <div className="text-[11px] font-semibold text-slate-500 mb-2">
                Fields this form asks for — pick from your study schema; toggle which are required.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                {sections.map((section) => {
                  const defs = studyFields.filter((d) => d.section === section);
                  if (defs.length === 0) return null;
                  return (
                    <div key={section} className="mb-3">
                      <div className="text-[11px] font-semibold text-slate-400 mb-1">{section}</div>
                      {defs.map((d) => {
                        const sel = selected.find((s) => s.key === d.key);
                        return (
                          <div key={d.key} className="flex items-center gap-2 py-0.5">
                            <input
                              type="checkbox"
                              checked={!!sel}
                              onChange={() => toggleField(d)}
                              className="accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                              aria-label={`Include ${d.label}`}
                            />
                            <span className="text-xs text-slate-700 flex-1 truncate">{d.label}</span>
                            {sel && (
                              <button
                                onClick={() => toggleRequired(d.key)}
                                className={
                                  "text-[10px] font-semibold rounded-full px-2 py-0.5 border transition " +
                                  (sel.required
                                    ? "border-brand-200 bg-brand-50 text-brand-700"
                                    : "border-slate-200 text-slate-400 hover:border-slate-300")
                                }
                                title="Submitters can't submit without required fields — that's how submissions arrive complete"
                              >
                                {sel.required ? "required" : "optional"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selected.length === 0 && (
                <span className="text-xs text-slate-400 italic">No fields on this version.</span>
              )}
              {selected.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1 text-xs rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700"
                >
                  {s.label}
                  {s.required && <span className="text-brand-600 font-bold" title="Required">*</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
