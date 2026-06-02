import { useModalA11y } from "../lib/useModalA11y";
import { stamped } from "../lib/stamp";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useCurrentMember } from "../lib/useCurrentMember";
import { useToast } from "../lib/Toast";
import { uniqueChannelName } from "../lib/uniqueChannel";
import {
  CDISC_CATEGORIES,
  DOC_TYPES,
  categoryByKey,
  docTypeByKey,
  formatFileSize,
  getDocumentSignedUrl,
  uploadNewDocument,
  uploadNewVersion,
  setDocumentArchived,
  parseEmlMetadata,
  type DocType,
} from "../lib/documents";
import type {
  DocumentRow,
  DocumentVersionRow,
  StudyRow,
} from "../lib/types";

import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { EmptyState } from "../components/ui/EmptyState";
import { DocumentDetailPanel } from "./StudyDetail.documentDetail";

/** DocumentsTab — per-study binder. Sidebar of categories + main pane with
 *  the filtered document list. Admin opens the upload modal from the
 *  category sidebar or the empty-state CTA.
 */
export function DocumentsTab({ study }: { study: StudyRow }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const { isAdmin } = useCurrentMember();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [versions, setVersions] = useState<Record<string, DocumentVersionRow>>({});
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [sponsorMode, setSponsorMode] = useState<string | null>(null);

  // Binder type follows the org sponsor mode: site -> ISF, sponsor -> TMF.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("orgs")
        .select("sponsor_mode")
        .eq("id", orgId)
        .maybeSingle();
      if (!cancelled) setSponsorMode((data as any)?.sponsor_mode ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Load + realtime-subscribe to documents for this study.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("documents")
        .select("*")
        .eq("study_id", study.id)
        .order("created_at", { ascending: false });
      if (!cancelled) setDocs((data ?? []) as DocumentRow[]);
    })();

    const ch = supabase
      .channel(uniqueChannelName(`docs-${study.id}`))
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "documents", filter: `study_id=eq.${study.id}` },
        (payload: any) => {
          if (cancelled) return;
          setDocs((prev) => {
            if (!prev) return prev;
            if (payload.eventType === "INSERT") return [payload.new as DocumentRow, ...prev];
            if (payload.eventType === "UPDATE")
              return prev.map((d) => (d.id === payload.new.id ? (payload.new as DocumentRow) : d));
            if (payload.eventType === "DELETE")
              return prev.filter((d) => d.id !== payload.old.id);
            return prev;
          });
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [study.id]);

  // Load current versions for the visible docs.
  useEffect(() => {
    if (!docs || docs.length === 0) {
      setVersions({});
      return;
    }
    let cancelled = false;
    const verIds = docs.map((d) => d.current_version_id).filter((id): id is string => Boolean(id));
    if (verIds.length === 0) {
      setVersions({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("document_versions")
        .select("*")
        .in("id", verIds);
      if (cancelled) return;
      const map: Record<string, DocumentVersionRow> = {};
      (data ?? []).forEach((v: any) => (map[v.id] = v as DocumentVersionRow));
      setVersions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [docs]);

  // Per-category counts (for the sidebar). All categories from CDISC catalog
  // plus any custom values present in the data.
  const { counts, totalActive, customCategories } = useMemo(() => {
    const c: Record<string, number> = {};
    const knownKeys = new Set(CDISC_CATEGORIES.map((cat) => cat.key));
    const customSet = new Set<string>();
    let total = 0;
    for (const d of docs ?? []) {
      if (!showArchived && d.archived) continue;
      c[d.category] = (c[d.category] ?? 0) + 1;
      total += 1;
      if (!knownKeys.has(d.category)) customSet.add(d.category);
    }
    return {
      counts: c,
      totalActive: total,
      customCategories: Array.from(customSet).sort(),
    };
  }, [docs, showArchived]);

  // Filtered docs for the main pane.
  const filtered = useMemo(() => {
    if (!docs) return [];
    return docs
      .filter((d) => (showArchived ? true : !d.archived))
      .filter((d) => selectedCategory === "all" || d.category === selectedCategory);
  }, [docs, selectedCategory, showArchived]);

  // The doc shown in the detail drawer — resolved live from `docs` so the
  // header (status / current version) tracks realtime updates.
  const detailDoc = useMemo(
    () => (detailDocId ? docs?.find((d) => d.id === detailDocId) ?? null : null),
    [detailDocId, docs]
  );

  if (!isAdmin && (docs?.length ?? 0) === 0) {
    return (
      <Card>
        <EmptyState
          iconName="folder"
          title="No documents yet"
          sub="When admins upload protocol, ICF, IRB approvals, and other regulatory artifacts for this study, they'll appear here."
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
      {/* CATEGORY SIDEBAR */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Categories
          </span>
          {sponsorMode && (
            <Pill tone="neutral">{sponsorMode === "sponsor" ? "TMF" : "ISF"}</Pill>
          )}
        </div>
        <Card flush>
          <CategoryRow
            label="All documents"
            count={totalActive}
            active={selectedCategory === "all"}
            onClick={() => setSelectedCategory("all")}
          />
          <div className="border-t border-slate-100" />
          {CDISC_CATEGORIES.map((cat) => (
            <CategoryRow
              key={cat.key}
              label={cat.label}
              count={counts[cat.key] ?? 0}
              active={selectedCategory === cat.key}
              onClick={() => setSelectedCategory(cat.key)}
            />
          ))}
          {customCategories.length > 0 && (
            <>
              <div className="border-t border-slate-100" />
              <div className="px-3 py-1.5 text-[9px] font-mono uppercase tracking-wider text-slate-400">
                Custom
              </div>
              {customCategories.map((k) => (
                <CategoryRow
                  key={k}
                  label={k}
                  count={counts[k] ?? 0}
                  active={selectedCategory === k}
                  onClick={() => setSelectedCategory(k)}
                />
              ))}
            </>
          )}
        </Card>

        <div className="mt-3 space-y-2">
          {isAdmin && (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => setUploadModalOpen(true)}
              disabled={uploading}
            >
              <Icon name="plus" size={14} /> Upload document
            </Button>
          )}
          <label className="flex items-center gap-2 text-[11px] text-slate-600 px-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-brand-500 w-3.5 h-3.5"
            />
            Show archived
          </label>
        </div>
      </div>

      {/* MAIN PANE */}
      <div>
        {!docs && (
          <Card>
            <div className="text-sm text-slate-500">Loading documents…</div>
          </Card>
        )}
        {docs && filtered.length === 0 && (
          <Card>
            <EmptyState
              iconName="folder"
              title={selectedCategory === "all" ? "No documents yet" : `No ${categoryByKey(selectedCategory)?.label ?? selectedCategory} documents`}
              sub={
                isAdmin
                  ? "Upload protocol, ICF, IRB approvals, and other regulatory artifacts. They'll show up here organized by CDISC category."
                  : "An admin will upload regulatory artifacts here. Check back."
              }
              action={
                isAdmin && (
                  <Button variant="primary" onClick={() => setUploadModalOpen(true)}>
                    <Icon name="plus" size={12} /> Upload first document
                  </Button>
                )
              }
            />
          </Card>
        )}
        {docs && filtered.length > 0 && (
          <Card flush>
            <ul className="divide-y divide-slate-100">
              {filtered.map((d) => {
                const v = d.current_version_id ? versions[d.current_version_id] : null;
                const typeMeta = docTypeByKey(d.doc_type);
                return (
                  <DocumentRowView
                    key={d.id}
                    onOpenDetail={() => setDetailDocId(d.id)}
                    doc={d}
                    version={v}
                    typeMeta={typeMeta}
                    canEdit={isAdmin}
                    onDownload={async () => {
                      if (!v) return;
                      const url = await getDocumentSignedUrl(v.file_path);
                      if (url) {
                        window.open(url, "_blank", "noopener");
                      } else {
                        toast.error("Couldn't generate download link");
                      }
                    }}
                    onNewVersion={async (file, versionLabel) => {
                      if (!orgId || !userId) return;
                      setUploading(true);
                      try {
                        await uploadNewVersion({
                          orgId,
                          document: d,
                          actorUserId: userId,
                          actorEmail: userEmail,
                          versionLabel,
                          file,
                        });
                        toast.success(stamped(`Uploaded ${versionLabel} of ${d.title}`));
                      } catch (e: any) {
                        toast.error(e?.message || "Upload failed");
                      } finally {
                        setUploading(false);
                      }
                    }}
                    onToggleArchive={async () => {
                      if (!orgId || !userId) return;
                      try {
                        await setDocumentArchived({
                          orgId,
                          document: d,
                          actorUserId: userId,
                          actorEmail: userEmail,
                          archived: !d.archived,
                        });
                        toast.success(stamped(d.archived ? "Restored" : "Archived"));
                      } catch (e: any) {
                        toast.error(e?.message || "Archive failed");
                      }
                    }}
                  />
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      {uploadModalOpen && orgId && userId && (
        <UploadDocumentModal
          orgId={orgId}
          actorUserId={userId}
          actorEmail={userEmail}
          study={study}
          initialCategory={selectedCategory === "all" ? "protocol" : selectedCategory}
          onClose={() => setUploadModalOpen(false)}
          onUploaded={() => {
            toast.success(stamped("Document uploaded"));
            setUploadModalOpen(false);
          }}
        />
      )}

      {detailDoc && orgId && (
        <DocumentDetailPanel
          document={detailDoc}
          study={study}
          orgId={orgId}
          actorUserId={userId}
          actorEmail={userEmail}
          canEdit={isAdmin}
          onClose={() => setDetailDocId(null)}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * Category row
 * ========================================================================== */

function CategoryRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition " +
        (active
          ? "bg-brand-50 text-brand-700 font-semibold"
          : "text-slate-700 hover:bg-slate-50")
      }
    >
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={
            "text-[10px] font-mono " + (active ? "text-brand-700" : "text-slate-400")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ============================================================================
 * Document row
 * ========================================================================== */

function DocumentRowView({
  doc,
  version,
  typeMeta,
  canEdit,
  onOpenDetail,
  onDownload,
  onNewVersion,
  onToggleArchive,
}: {
  doc: DocumentRow;
  version: DocumentVersionRow | null;
  typeMeta: DocType | undefined;
  canEdit: boolean;
  onOpenDetail: () => void;
  onDownload: () => Promise<void> | void;
  onNewVersion: (file: File, versionLabel: string) => Promise<void>;
  onToggleArchive: () => Promise<void>;
}) {
  const [downloading, setDownloading] = useState(false);
  return (
    <li className={"px-4 py-3 hover:bg-slate-50/60 transition " + (doc.archived ? "opacity-60" : "")}>
      <div className="grid grid-cols-[1fr_120px_140px_150px] gap-3 items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon name="file" size={14} className="text-slate-400 flex-shrink-0" />
            <button
              onClick={onOpenDetail}
              className="text-sm font-semibold text-slate-900 truncate text-left hover:text-brand-700 hover:underline transition"
              title="Open document detail"
            >
              {doc.title}
            </button>
            <Pill tone={doc.archived ? "neutral" : "brand"}>
              {doc.archived ? "archived" : doc.status}
            </Pill>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{typeMeta?.label ?? doc.doc_type}</span>
            <span className="text-slate-300">·</span>
            <span>{categoryByKey(doc.category)?.label ?? doc.category}</span>
            {version && (
              <>
                <span className="text-slate-300">·</span>
                <span className="font-mono">{version.version_label}</span>
                {version.file_size > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono">{formatFileSize(version.file_size)}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {version?.uploaded_at
            ? new Date(version.uploaded_at).toLocaleDateString()
            : new Date(doc.created_at).toLocaleDateString()}
        </div>
        <div className="text-xs text-slate-500 truncate" title={version?.original_filename ?? ""}>
          {version?.original_filename ?? <span className="italic text-slate-400">no file</span>}
        </div>
        <div className="flex items-center gap-1 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenDetail}
            title="Version history & audit trail"
          >
            <Icon name="layers" size={12} /> History
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!version || downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await onDownload();
              } finally {
                setDownloading(false);
              }
            }}
            title="Download / open"
          >
            <Icon name="external" size={12} /> Open
          </Button>
          {canEdit && (
            <NewVersionButton onUpload={onNewVersion} disabled={doc.archived} />
          )}
          {canEdit && (
            <button
              onClick={onToggleArchive}
              className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 transition"
              title={doc.archived ? "Restore document" : "Archive document"}
            >
              {doc.archived ? "restore" : "archive"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function NewVersionButton({
  onUpload,
  disabled,
}: {
  onUpload: (file: File, versionLabel: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("v2");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Upload a new version"
      >
        <Icon name="plus" size={11} /> Version
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-lg font-display font-bold text-slate-900">
                Upload new version
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                The current head version will be archived (audit-trail preserved).
              </p>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Version label
                </span>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="v2"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  File
                </span>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 file:font-semibold file:px-3 file:py-1.5 file:text-xs hover:file:bg-brand-100"
                />
                {file && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    {file.name} · {formatFileSize(file.size)}
                  </p>
                )}
              </label>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!file || !label.trim() || busy}
                onClick={async () => {
                  if (!file) return;
                  setBusy(true);
                  try {
                    await onUpload(file, label.trim());
                    setOpen(false);
                    setFile(null);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================================
 * Upload Document Modal (new document)
 * ========================================================================== */

function UploadDocumentModal({
  orgId,
  actorUserId,
  actorEmail,
  study,
  initialCategory,
  onClose,
  onUploaded,
}: {
  orgId: string;
  actorUserId: string;
  actorEmail: string | null;
  study: StudyRow;
  initialCategory: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [docTypeKey, setDocTypeKey] = useState<string>(DOC_TYPES[0].key);
  const docType = DOC_TYPES.find((t) => t.key === docTypeKey) ?? DOC_TYPES[0];

  const [category, setCategory] = useState<string>(
    docType.defaultCategory || initialCategory
  );
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [pendingEml, setPendingEml] = useState<Record<string, string> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the doc type changes, default category + reset metadata.
  useEffect(() => {
    setCategory(docType.defaultCategory);
    setMetadata({});
  }, [docTypeKey]);

  // Apply parsed .eml header metadata after the doc-type reset above runs.
  useEffect(() => {
    if (!pendingEml) return;
    setMetadata((m) => ({ ...m, ...pendingEml }));
    setPendingEml(null);
  }, [pendingEml]);

  const onSubmit = async () => {
    setError(null);
    if (!file) {
      setError("Pick a file to upload.");
      return;
    }
    if (!title.trim()) {
      setError("Give the document a title.");
      return;
    }
    // Required metadata validation
    for (const f of docType.metadataFields) {
      if (f.required && !metadata[f.key]) {
        setError(`${f.label} is required for ${docType.label}.`);
        return;
      }
    }
    setBusy(true);
    try {
      await uploadNewDocument({
        orgId,
        study,
        actorUserId,
        actorEmail,
        title: title.trim(),
        category,
        docType,
        description: description.trim() || null,
        metadata,
        file,
      });
      onUploaded();
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
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
        aria-label="Upload document"
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              {study.code} · {study.title}
            </div>
            <h2 className="text-lg font-display font-bold text-slate-900">
              Upload document
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 transition"
            title="Close"
            aria-label="Close upload"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Document type
              </span>
              <Select value={docTypeKey} onChange={(e) => setDocTypeKey(e.target.value)}>
                {DOC_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <p className="text-[10px] text-slate-500 mt-1">
                code: <code className="font-mono">{docType.code}</code>
              </p>
            </label>
            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Category
              </span>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CDISC_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Title <span className="text-red-500">*</span>
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Protocol Amendment 03"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Description (optional)
            </span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Free-text — purpose, scope, what changed."
            />
          </label>

          {/* Type-specific required metadata */}
          {docType.metadataFields.length > 0 && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                {docType.label} details
              </div>
              <div className="grid grid-cols-2 gap-3">
                {docType.metadataFields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      {f.label}
                      {f.required && <span className="text-red-500 ml-1">*</span>}
                    </span>
                    <Input
                      type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"}
                      value={metadata[f.key] ?? ""}
                      onChange={(e) =>
                        setMetadata({ ...metadata, [f.key]: e.target.value })
                      }
                      placeholder={f.description ?? ""}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* File picker */}
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              File <span className="text-red-500">*</span>
            </span>
            <input
              type="file"
              onChange={async (e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && f.name.toLowerCase().endsWith(".eml")) {
                  try {
                    const meta = parseEmlMetadata(await f.text());
                    setDocTypeKey("email");
                    if (meta.subject && !title.trim()) setTitle(meta.subject);
                    setPendingEml({
                      ...(meta.from ? { email_from: meta.from } : {}),
                      ...(meta.subject ? { email_subject: meta.subject } : {}),
                      ...(meta.date ? { email_date: meta.date } : {}),
                    });
                  } catch {
                    /* best-effort header parse */
                  }
                }
              }}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 file:font-semibold file:px-3 file:py-1.5 file:text-xs hover:file:bg-brand-100"
            />
            {file && (
              <p className="text-[11px] text-slate-500 mt-1">
                {file.name} · {formatFileSize(file.size)}
              </p>
            )}
            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
              Filename in storage will be auto-generated from study code + type +
              version + date. Your original filename is logged for reference.
            </p>
          </label>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <Pill tone="brand">v1 · live upload</Pill>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSubmit} disabled={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
