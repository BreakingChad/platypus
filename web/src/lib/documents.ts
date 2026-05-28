import { supabase } from "./supabase";
import { writeAuditEvent } from "./auditLog";
import type { DocumentRow, DocumentVersionRow, StudyRow } from "./types";

/** Documents catalog — CDISC-aligned categories + a document-type registry
 *  that drives the upload modal's required-metadata fields.
 *
 *  Categories are stored as text on documents.category so admins can add
 *  custom values (audit-trail logs them per project policy — no
 *  'Miscellaneous' bucket).
 *  Document types are also stored as text (doc_type) with a short code
 *  (doc_type_code) used in auto-generated filenames.
 */

export type DocCategory = {
  key: string;
  label: string;
  description: string;
};

export const CDISC_CATEGORIES: DocCategory[] = [
  { key: "protocol",          label: "Protocol",                  description: "Approved protocol + amendments." },
  { key: "irb",               label: "IRB / Ethics",              description: "IRB approvals, correspondence, ethics committee documents." },
  { key: "consent",           label: "Informed Consent",          description: "ICF templates, signed ICFs, translation logs." },
  { key: "regulatory",        label: "Regulatory",                description: "IND/IDE, FDA correspondence, regulatory filings." },
  { key: "investigational_product", label: "Investigational Product", description: "IB, accountability logs, shipping, destruction." },
  { key: "lab",               label: "Lab",                       description: "Central + local lab manuals, accreditations, normal ranges." },
  { key: "safety",            label: "Safety",                    description: "Safety reports, SUSARs, DSMB minutes." },
  { key: "site",              label: "Site",                      description: "Site-specific docs, monitoring visits, deviations." },
  { key: "training",          label: "Training",                  description: "Training logs, certifications, attestations." },
  { key: "administrative",    label: "Administrative",            description: "Contracts, budgets, financial disclosures, CTAs." },
  { key: "amendments",        label: "Amendments",                description: "Protocol + ICF amendments, change tracking." },
];

export type DocTypeField = {
  key: string;
  label: string;
  kind: "text" | "date" | "number";
  required?: boolean;
  description?: string;
};

export type DocType = {
  /** Free-form key stored in documents.doc_type. */
  key: string;
  /** Short code used in auto-generated filenames. */
  code: string;
  label: string;
  /** Default category for this type — admin can override per-doc. */
  defaultCategory: string;
  /** Type-specific required metadata fields. */
  metadataFields: DocTypeField[];
};

export const DOC_TYPES: DocType[] = [
  {
    key: "protocol",
    code: "PROT",
    label: "Protocol",
    defaultCategory: "protocol",
    metadataFields: [
      { key: "protocol_version", label: "Protocol version",  kind: "text", required: true, description: "e.g. v3.0" },
      { key: "protocol_date",    label: "Protocol date",     kind: "date", required: true },
    ],
  },
  {
    key: "protocol_amendment",
    code: "AMD",
    label: "Protocol amendment",
    defaultCategory: "amendments",
    metadataFields: [
      { key: "amendment_number", label: "Amendment #",       kind: "text", required: true },
      { key: "amendment_date",   label: "Amendment date",    kind: "date", required: true },
    ],
  },
  {
    key: "icf",
    code: "ICF",
    label: "Informed Consent Form",
    defaultCategory: "consent",
    metadataFields: [
      { key: "icf_version",      label: "ICF version",       kind: "text", required: true },
      { key: "irb_approval_date", label: "IRB approval date", kind: "date", required: true },
    ],
  },
  {
    key: "irb_approval",
    code: "IRB-APV",
    label: "IRB approval letter",
    defaultCategory: "irb",
    metadataFields: [
      { key: "irb_protocol_number", label: "IRB protocol #", kind: "text", required: false },
      { key: "approval_date",       label: "Approval date",  kind: "date", required: true },
      { key: "expiration_date",     label: "Expiration date", kind: "date", required: false },
    ],
  },
  {
    key: "ib",
    code: "IB",
    label: "Investigator's Brochure",
    defaultCategory: "investigational_product",
    metadataFields: [
      { key: "ib_version", label: "IB version", kind: "text", required: true },
      { key: "ib_date",    label: "IB date",    kind: "date", required: true },
    ],
  },
  {
    key: "cta",
    code: "CTA",
    label: "Clinical Trial Agreement",
    defaultCategory: "administrative",
    metadataFields: [
      { key: "executed_date", label: "Executed date", kind: "date", required: false },
    ],
  },
  {
    key: "budget",
    code: "BUDGET",
    label: "Budget",
    defaultCategory: "administrative",
    metadataFields: [
      { key: "budget_version", label: "Budget version", kind: "text", required: false },
    ],
  },
  {
    key: "training_log",
    code: "TRN",
    label: "Training log",
    defaultCategory: "training",
    metadataFields: [],
  },
  {
    key: "monitoring_report",
    code: "MON",
    label: "Monitoring report",
    defaultCategory: "site",
    metadataFields: [
      { key: "visit_date", label: "Visit date", kind: "date", required: false },
    ],
  },
  {
    key: "lab_manual",
    code: "LAB",
    label: "Lab manual",
    defaultCategory: "lab",
    metadataFields: [
      { key: "lab_version", label: "Manual version", kind: "text", required: false },
    ],
  },
  {
    key: "safety_report",
    code: "SAFE",
    label: "Safety report",
    defaultCategory: "safety",
    metadataFields: [
      { key: "report_date", label: "Report date", kind: "date", required: false },
    ],
  },
  {
    key: "other",
    code: "DOC",
    label: "Other document",
    defaultCategory: "administrative",
    metadataFields: [],
  },
];

export function docTypeByKey(key: string): DocType | undefined {
  return DOC_TYPES.find((t) => t.key === key);
}
export function categoryByKey(key: string): DocCategory | undefined {
  return CDISC_CATEGORIES.find((c) => c.key === key);
}

/* ============================================================================
 * Filename generation
 * ========================================================================== */

/** Auto-generate the storage filename for a document version. The user never
 *  picks this — the file path is derived from study code + doc-type code +
 *  version + date. Falls back gracefully when fields are missing.
 *
 *  Pattern: {studyCode}_{docTypeCode}_v{version}_{YYYYMMDD}.{ext}
 *  Example: STU-001_PROT_v2_20260527.pdf
 */
export function autoGenerateFilename(opts: {
  studyCode: string;
  docTypeCode: string;
  version: string;
  uploadedAt?: Date;
  originalFilename: string;
}): string {
  const date = (opts.uploadedAt ?? new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const ext = (opts.originalFilename.match(/\.([^./\\]+)$/)?.[1] || "bin").toLowerCase();
  const safeCode = (opts.studyCode || "STUDY").replace(/[^a-zA-Z0-9-]/g, "_");
  const safeType = (opts.docTypeCode || "DOC").replace(/[^a-zA-Z0-9-]/g, "_");
  const safeVer = (opts.version || "v1").replace(/[^a-zA-Z0-9.]/g, "");
  return `${safeCode}_${safeType}_${safeVer}_${date}.${ext}`;
}

/** Storage path inside the 'study-documents' bucket. Convention enforced by
 *  storage RLS: {org_id}/{study_id}/{document_id}/{version_id}.{ext} */
export function buildStoragePath(opts: {
  orgId: string;
  studyId: string;
  documentId: string;
  versionId: string;
  ext: string;
}): string {
  return `${opts.orgId}/${opts.studyId}/${opts.documentId}/${opts.versionId}.${opts.ext}`;
}

/* ============================================================================
 * Upload + version helpers
 * ========================================================================== */

export type UploadDocumentResult = {
  document: DocumentRow;
  version: DocumentVersionRow;
};

/** Upload a NEW document — creates the documents row, uploads the file to
 *  storage at the conventional path, and creates the first version with
 *  current_version_id wired up. Logs an audit event 'created' against the
 *  document entity.
 */
export async function uploadNewDocument(opts: {
  orgId: string;
  study: Pick<StudyRow, "id" | "code">;
  actorUserId: string;
  actorEmail: string | null;
  title: string;
  category: string;
  docType: DocType;
  description?: string | null;
  metadata?: Record<string, unknown>;
  versionLabel?: string;       // default 'v1'
  file: File;
}): Promise<UploadDocumentResult> {
  const versionLabel = opts.versionLabel ?? "v1";

  // 1. Insert the documents row (status='active', current_version_id null
  //    for now; we'll patch it after the version insert).
  const { data: docInsert, error: docErr } = await supabase
    .from("documents")
    .insert({
      org_id: opts.orgId,
      study_id: opts.study.id,
      category: opts.category,
      doc_type: opts.docType.key,
      doc_type_code: opts.docType.code,
      title: opts.title,
      description: opts.description ?? null,
      metadata: opts.metadata ?? {},
      status: "active",
      created_by: opts.actorUserId,
    } as any)
    .select("*")
    .single();
  if (docErr || !docInsert) throw docErr ?? new Error("document insert failed");
  const document = docInsert as DocumentRow;

  // 2. Generate the storage path. We need a version id for the path, so we
  //    insert the version row FIRST without file_path, then upload, then
  //    update the row with the resolved path. Two-step but keeps the path
  //    deterministic from the actual row id.
  const { data: verInsert, error: verErr } = await supabase
    .from("document_versions")
    .insert({
      document_id: document.id,
      version_label: versionLabel,
      file_path: "pending",   // temp placeholder; updated below
      original_filename: opts.file.name,
      file_size: opts.file.size,
      mime_type: opts.file.type || null,
      uploaded_by: opts.actorUserId,
    } as any)
    .select("*")
    .single();
  if (verErr || !verInsert) throw verErr ?? new Error("version insert failed");
  const version = verInsert as DocumentVersionRow;

  const ext = (opts.file.name.match(/\.([^./\\]+)$/)?.[1] || "bin").toLowerCase();
  const storagePath = buildStoragePath({
    orgId: opts.orgId,
    studyId: opts.study.id,
    documentId: document.id,
    versionId: version.id,
    ext,
  });

  // 3. Upload the file.
  const { error: upErr } = await supabase.storage
    .from("study-documents")
    .upload(storagePath, opts.file, {
      contentType: opts.file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    // Roll back the document + version we just created. Best-effort.
    await supabase.from("documents").delete().eq("id", document.id);
    throw upErr;
  }

  // 4. Update the version with the real path; set documents.current_version_id.
  await supabase
    .from("document_versions")
    .update({ file_path: storagePath } as any)
    .eq("id", version.id);
  await supabase
    .from("documents")
    .update({ current_version_id: version.id } as any)
    .eq("id", document.id);

  version.file_path = storagePath;
  document.current_version_id = version.id;

  // 5. Audit log.
  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "document",
    entityId: document.id,
    action: "created",
    payload: {
      study_id: opts.study.id,
      title: document.title,
      category: document.category,
      doc_type: document.doc_type,
      version_label: version.version_label,
      file_size: version.file_size,
      mime_type: version.mime_type,
    },
  });

  return { document, version };
}

/** Upload a NEW VERSION of an existing document. The previous head version
 *  is auto-archived (smart archive). New version becomes current.
 */
export async function uploadNewVersion(opts: {
  orgId: string;
  document: DocumentRow;
  actorUserId: string;
  actorEmail: string | null;
  versionLabel: string;
  file: File;
  metadata?: Record<string, unknown>;
}): Promise<DocumentVersionRow> {
  // 1. Insert the new version row.
  const { data: verInsert, error: verErr } = await supabase
    .from("document_versions")
    .insert({
      document_id: opts.document.id,
      version_label: opts.versionLabel,
      file_path: "pending",
      original_filename: opts.file.name,
      file_size: opts.file.size,
      mime_type: opts.file.type || null,
      uploaded_by: opts.actorUserId,
      metadata: opts.metadata ?? {},
    } as any)
    .select("*")
    .single();
  if (verErr || !verInsert) throw verErr ?? new Error("version insert failed");
  const version = verInsert as DocumentVersionRow;

  // 2. Upload the file.
  const ext = (opts.file.name.match(/\.([^./\\]+)$/)?.[1] || "bin").toLowerCase();
  const storagePath = buildStoragePath({
    orgId: opts.orgId,
    studyId: opts.document.study_id,
    documentId: opts.document.id,
    versionId: version.id,
    ext,
  });
  const { error: upErr } = await supabase.storage
    .from("study-documents")
    .upload(storagePath, opts.file, {
      contentType: opts.file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    await supabase.from("document_versions").delete().eq("id", version.id);
    throw upErr;
  }

  // 3. Update path + flip current_version_id.
  await supabase
    .from("document_versions")
    .update({ file_path: storagePath } as any)
    .eq("id", version.id);

  // Smart archive previous head.
  if (opts.document.current_version_id) {
    await supabase
      .from("document_versions")
      .update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_by: opts.actorUserId,
      } as any)
      .eq("id", opts.document.current_version_id);
  }

  await supabase
    .from("documents")
    .update({ current_version_id: version.id, status: "active" } as any)
    .eq("id", opts.document.id);

  version.file_path = storagePath;

  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "document",
    entityId: opts.document.id,
    action: "version_uploaded",
    payload: {
      version_label: version.version_label,
      previous_version_id: opts.document.current_version_id,
      file_size: version.file_size,
      mime_type: version.mime_type,
    },
  });

  return version;
}

/** Get a short-lived signed URL for a document version (download / preview). */
export async function getDocumentSignedUrl(filePath: string, expiresInSec = 300): Promise<string | null> {
  if (!filePath || filePath === "pending") return null;
  const { data, error } = await supabase.storage
    .from("study-documents")
    .createSignedUrl(filePath, expiresInSec);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Archive (or restore) a document. Doesn't remove the file from storage —
 *  audit-friendly soft-delete. */
export async function setDocumentArchived(opts: {
  orgId: string;
  document: DocumentRow;
  actorUserId: string;
  actorEmail: string | null;
  archived: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update({
      archived: opts.archived,
      archived_at: opts.archived ? new Date().toISOString() : null,
      archived_by: opts.archived ? opts.actorUserId : null,
      status: opts.archived ? "archived" : "active",
    } as any)
    .eq("id", opts.document.id);
  if (error) throw error;
  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "document",
    entityId: opts.document.id,
    action: opts.archived ? "archived" : "restored",
    payload: { title: opts.document.title },
  });
}

/** Format a file size in human-readable units. */
export function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}


/** Archive (or restore) a single document VERSION. Used from the document
 *  detail panel for binder hygiene on superseded versions. The current head
 *  version is never archived from here (guarded in the UI). Logs the action
 *  against the parent document so it lands in the document's audit chain. */
export async function setVersionArchived(opts: {
  orgId: string;
  document: DocumentRow;
  version: DocumentVersionRow;
  actorUserId: string;
  actorEmail: string | null;
  archived: boolean;
}): Promise<void> {
  const { error } = await supabase
    .from("document_versions")
    .update({
      archived: opts.archived,
      archived_at: opts.archived ? new Date().toISOString() : null,
      archived_by: opts.archived ? opts.actorUserId : null,
    } as any)
    .eq("id", opts.version.id);
  if (error) throw error;
  void writeAuditEvent({
    orgId: opts.orgId,
    actorId: opts.actorUserId,
    actorEmail: opts.actorEmail,
    entityType: "document",
    entityId: opts.document.id,
    action: opts.archived ? "version_archived" : "version_restored",
    payload: {
      version_id: opts.version.id,
      version_label: opts.version.version_label,
    },
  });
}
