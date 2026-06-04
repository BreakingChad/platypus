import { friendlyError } from "../lib/errors";
import { PageBlocks } from "../blocks/PageBlocks";
import { useMemo, useState } from "react";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { confirmDialog } from "../lib/confirm";
import { useModalA11y } from "../lib/useModalA11y";
import type { SiteRow, StudyRow, FieldDefinitionRow, FieldType } from "../lib/types";
import { supabase } from "../lib/supabase";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { PageHeader } from "../components/ui/PageHeader";
import { AutoSaveNote } from "../components/ui/AutoSaveNote";
import { EmptyState } from "../components/ui/EmptyState";
import { Loader } from "../components/ui/Loader";

/** Sites — the site information collection system.
 *
 *  Each site is a first-class record: identity columns + a profile object
 *  whose shape is driven by the org's entity_type='site' field definitions
 *  (admin-configurable in the Field Designer, Site tab). The profile editor
 *  renders those definitions grouped by section — the same configurable-
 *  fields model studies use, so orgs collect exactly the site data they
 *  care about: capabilities, equipment, certifications, contacts.
 */
export function Sites({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin, loading: memberLoading } = useCurrentMember();
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const sites = useOrgTable<SiteRow>("sites", { orderBy: "created_at", realtime: true });
  const studies = useOrgTable<StudyRow>("studies", { orderBy: "created_at" });
  const fields = useOrgTable<FieldDefinitionRow>("field_definitions", { orderBy: "position" });

  const [search, setSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [openSiteId, setOpenSiteId] = useState<string | null>(null);

  const siteFields = useMemo(
    () =>
      fields.rows
        .filter((f) => f.entity_type === "site" && f.enabled)
        .sort((a, b) => a.position - b.position),
    [fields.rows]
  );

  const studyCountBySite = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of studies.rows) {
      if (!s.site_id || s.closed) continue;
      m[s.site_id] = (m[s.site_id] ?? 0) + 1;
    }
    return m;
  }, [studies.rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sites.rows.filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q) ||
        (s.state ?? "").toLowerCase().includes(q) ||
        (s.country ?? "").toLowerCase().includes(q)
      );
    });
  }, [sites.rows, search]);

  const openSite = openSiteId ? sites.rows.find((s) => s.id === openSiteId) ?? null : null;

  if (memberLoading) {
    return (
      <div className="max-w-page-wide mx-auto px-4 md:px-6 py-8">
        <Loader label="Checking permissions…" />
      </div>
    );
  }

  return (
    <div className="max-w-page-wide mx-auto px-4 md:px-6 py-8">
      <PageHeader
        kicker="Workspace"
        title="Sites"
        subtitle="Every site you run studies at — capabilities, contacts, and qualification data in one collection system. Site fields are configurable in the Field Designer."
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setComposerOpen(true)}>
              <Icon name="plus" size={14} />
              New site
            </Button>
          )
        }
      />
      <AutoSaveNote />

      <div className="mt-6">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, city, state, country…"
        />
      </div>

      <PageBlocks pageKey="sites" region="top" navigate={onNavigate} />

      <Card flush className="mt-4 overflow-hidden">
        {sites.error && (
          <div className="m-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <strong>Error:</strong> {sites.error}
            {sites.error.toLowerCase().includes("relation") && (
              <span className="block mt-1 text-xs">
                Has migration 0012 been applied?
              </span>
            )}
          </div>
        )}
        {sites.loading && sites.rows.length === 0 && (
          <div className="p-6">
            <Loader label="Loading sites…" />
          </div>
        )}
        {!sites.loading && sites.rows.length === 0 && !sites.error && (
          <EmptyState
            iconName="hospital"
            title="No sites yet"
            sub={
              isAdmin
                ? "Add the sites you run studies at. Their profiles collect the capability and qualification data feasibility depends on."
                : "An admin will add sites here."
            }
            action={
              isAdmin && (
                <Button variant="primary" onClick={() => setComposerOpen(true)}>
                  <Icon name="plus" size={14} /> Add first site
                </Button>
              )
            }
          />
        )}
        {filtered.length > 0 && (
          <>
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 grid grid-cols-[1fr_180px_120px_120px] gap-3 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              <span>Site</span>
              <span>Location</span>
              <span>Studies</span>
              <span>Profile</span>
            </div>
            {filtered.map((s) => {
              const pf = profileFill(s, siteFields);
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${s.name}`}
                  onClick={() => setOpenSiteId(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenSiteId(s.id);
                    }
                  }}
                  className="px-4 py-3 border-b border-slate-100 last:border-b-0 grid grid-cols-[1fr_180px_120px_120px] gap-3 items-center cursor-pointer transition hover:bg-brand-50/30 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:bg-brand-50/40"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <Icon name="hospital" size={14} className="text-slate-400 flex-shrink-0" />
                      <span className="font-semibold text-slate-900 truncate">{s.name}</span>
                      {s.status !== "active" && <Pill tone="neutral">{s.status}</Pill>}
                    </span>
                  </span>
                  <span className="text-xs text-slate-600 truncate">
                    {[s.city, s.state, s.country].filter(Boolean).join(", ") || (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </span>
                  <span className="text-xs font-mono text-slate-600">
                    {studyCountBySite[s.id] ?? 0} active
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-[64px]">
                      <span
                        className={
                          "block h-full rounded-full " +
                          (pf >= 80 ? "bg-emerald-500" : pf >= 40 ? "bg-amber-500" : "bg-slate-300")
                        }
                        style={{ width: `${pf}%` }}
                      />
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">{pf}%</span>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </Card>

      <PageBlocks pageKey="sites" region="bottom" navigate={onNavigate} />

      {composerOpen && orgId && userId && (
        <NewSiteModal
          orgId={orgId}
          userId={userId}
          userEmail={userEmail}
          onClose={() => setComposerOpen(false)}
          onCreated={(id) => {
            setComposerOpen(false);
            setOpenSiteId(id);
            toast.success(stamped("Site added"));
          }}
        />
      )}

      {openSite && orgId && (
        <SiteProfilePanel
          site={openSite}
          siteFields={siteFields}
          isAdmin={isAdmin}
          orgId={orgId}
          userId={userId}
          userEmail={userEmail}
          studies={studies.rows.filter((st) => st.site_id === openSite.id)}
          onNavigate={onNavigate}
          onClose={() => setOpenSiteId(null)}
        />
      )}
    </div>
  );
}

/** % of enabled site fields with a value (identity cols + profile). */
function profileFill(site: SiteRow, defs: FieldDefinitionRow[]): number {
  if (defs.length === 0) return 0;
  let filled = 0;
  for (const f of defs) {
    const v = siteFieldValue(site, f.key);
    if (v !== null && v !== undefined && v !== "") filled += 1;
  }
  return Math.round((filled / defs.length) * 100);
}

const SITE_KEY_TO_COLUMN: Record<string, keyof SiteRow> = {
  siteName: "name",
  city: "city",
  state: "state",
  country: "country",
  siteStatus: "status",
};

function siteFieldValue(site: SiteRow, key: string): unknown {
  const col = SITE_KEY_TO_COLUMN[key];
  if (col) return (site as any)[col] ?? null;
  return (site.profile ?? {})[key] ?? null;
}

/* ---------- New site modal ---------- */

function NewSiteModal({
  orgId,
  userId,
  userEmail,
  onClose,
  onCreated,
}: {
  orgId: string;
  userId: string;
  userEmail: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give the site a name.");
      return;
    }
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
          created_by: userId,
        } as any)
        .select("id")
        .single();
      if (e) throw e;
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "site",
        entityId: (data as any).id,
        action: "created",
        payload: { name: name.trim() },
      });
      onCreated((data as any).id);
    } catch (e: any) {
      setError(e?.message || "Couldn't add site. Has migration 0012 been applied?");
    } finally {
      setBusy(false);
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
        aria-label="New site"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-lg font-display font-bold text-slate-900">New site</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Identity first — fill the full profile (capabilities, contacts, certifications) after.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Site name <span className="text-red-500">*</span>
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Banner Health — Phoenix" autoFocus />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">City</span>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">State</span>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Country</span>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </label>
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Adding…" : "Add site"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Site profile panel (drawer) ---------- */

function SiteProfilePanel({
  site,
  siteFields,
  isAdmin,
  orgId,
  userId,
  userEmail,
  studies,
  onNavigate,
  onClose,
}: {
  site: SiteRow;
  siteFields: FieldDefinitionRow[];
  isAdmin: boolean;
  orgId: string;
  userId: string | null;
  userEmail: string | null;
  studies: StudyRow[];
  onNavigate: (h: string) => void;
  onClose: () => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const toast = useToast();

  const sections = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of siteFields)
      if (!seen.has(f.section)) {
        seen.add(f.section);
        out.push(f.section);
      }
    return out;
  }, [siteFields]);

  const writeField = async (f: FieldDefinitionRow, v: unknown) => {
    if (!isAdmin || !userId) {
      toast.error("Admin access required");
      return;
    }
    const col = SITE_KEY_TO_COLUMN[f.key];
    let patch: Partial<SiteRow>;
    if (col) {
      patch = { [col]: (v as any) || null } as Partial<SiteRow>;
    } else {
      const next = { ...(site.profile ?? {}) };
      if (v === null || v === undefined || v === "") delete next[f.key];
      else next[f.key] = v as any;
      patch = { profile: next };
    }
    try {
      const { error } = await supabase.from("sites").update(patch as any).eq("id", site.id);
      if (error) throw error;
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "site",
        entityId: site.id,
        action: "field_updated",
        payload: {
          field_key: f.key,
          field_label: f.label,
          from: siteFieldValue(site, f.key),
          to: v,
        },
      });
      toast.success(stamped(`Updated ${f.label}`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Update failed"));
    }
  };

  const archive = async () => {
    if (!userId) return;
    const next = site.status === "active" ? "inactive" : "active";
    if (
      next === "inactive" &&
      !(await confirmDialog({
        title: "Deactivate site",
        message: `Deactivate ${site.name}? Studies keep their link; the site stops appearing in pickers.`,
        confirmLabel: "Deactivate",
        danger: true,
      }))
    )
      return;
    try {
      const { error } = await supabase.from("sites").update({ status: next } as any).eq("id", site.id);
      if (error) throw error;
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "site",
        entityId: site.id,
        action: next === "inactive" ? "deactivated" : "reactivated",
        payload: { name: site.name },
      });
      toast.success(stamped(next === "inactive" ? "Site deactivated" : "Site reactivated"));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update site"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Site profile — ${site.name}`}
        className="h-full w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col"
      >
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-400">Site profile</div>
            <div className="flex items-center gap-2 mt-0.5">
              <Icon name="hospital" size={16} className="text-slate-400 flex-shrink-0" />
              <h2 className="text-lg font-display font-bold text-slate-900 truncate">{site.name}</h2>
              <Pill tone={site.status === "active" ? "success" : "neutral"}>{site.status}</Pill>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {[site.city, site.state, site.country].filter(Boolean).join(", ") || "Location not set"}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={archive}>
                {site.status === "active" ? "Deactivate" : "Reactivate"}
              </Button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-900 transition"
              title="Close"
              aria-label="Close site profile"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Studies at this site */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Icon name="folder" size={14} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-500">Studies here</span>
              <span className="text-[10px] font-mono text-slate-400">{studies.length}</span>
            </div>
            {studies.length === 0 ? (
              <div className="text-sm text-slate-500">No studies linked to this site yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                {studies.map((st) => (
                  <li key={st.id}>
                    <button
                      onClick={() => {
                        onClose();
                        onNavigate(`#/studies/${st.id}`);
                      }}
                      className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-brand-50/40 transition"
                    >
                      <span className="font-mono text-xs text-slate-500">{st.code}</span>
                      <span className="text-sm text-slate-800 truncate flex-1">{st.title}</span>
                      {st.closed && <Pill tone="neutral">closed</Pill>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Configurable profile sections */}
          {siteFields.length === 0 && (
            <div className="text-sm text-slate-500">
              No site fields configured. Add them in the Field Designer → Site tab.
            </div>
          )}
          {sections.map((section) => {
            const sectionFields = siteFields.filter((f) => f.section === section);
            return (
              <section key={section}>
                <div className="text-xs font-semibold text-slate-500 mb-2">{section}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sectionFields.map((f) => (
                    <SiteFieldEditor
                      key={f.id}
                      field={f}
                      value={siteFieldValue(site, f.key)}
                      editable={isAdmin}
                      onSave={(v) => writeField(f, v)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- inline field editor (site flavor) ---------- */

function SiteFieldEditor({
  field,
  value,
  editable,
  onSave,
}: {
  field: FieldDefinitionRow;
  value: unknown;
  editable: boolean;
  onSave: (v: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));

  const display =
    value === null || value === undefined || value === "" ? (
      <span className="text-slate-400 italic">—</span>
    ) : field.field_type === "boolean" ? (
      value ? "Yes" : "No"
    ) : (
      String(value)
    );

  if (!editable) {
    return (
      <div>
        <div className="text-[11px] font-semibold text-slate-500 mb-1">{field.label}</div>
        <div className="text-sm text-slate-900">{display}</div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="group">
        <div className="text-[11px] font-semibold text-slate-500 mb-1">
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </div>
        <button
          onClick={() => {
            setDraft(value == null ? "" : String(value));
            setEditing(true);
          }}
          className="text-left w-full text-sm text-slate-900 hover:text-brand-700 transition rounded px-1.5 py-0.5 -mx-1.5 hover:bg-brand-50/50 flex items-center gap-2"
        >
          {display}
          <span className="opacity-0 group-hover:opacity-100 transition text-[11px] font-semibold text-brand-600">
            edit
          </span>
        </button>
      </div>
    );
  }

  const commit = async () => {
    let v: unknown = draft;
    if (field.field_type === ("number" as FieldType)) v = draft === "" ? null : Number(draft);
    if (field.field_type === ("boolean" as FieldType)) v = draft === "true";
    await onSave(v);
    setEditing(false);
  };

  const opts = (field.options as { values?: string[] } | null)?.values ?? [];

  return (
    <div>
      <div className="text-[11px] font-semibold text-slate-500 mb-1">{field.label}</div>
      <div className="flex items-center gap-1.5">
        {field.field_type === "dropdown" && opts.length > 0 ? (
          <Select value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
            <option value="">— Select —</option>
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        ) : field.field_type === "boolean" ? (
          <Select value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        ) : (
          <Input
            type={field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void commit();
            }}
          />
        )}
        <Button size="sm" variant="primary" onClick={commit}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}
