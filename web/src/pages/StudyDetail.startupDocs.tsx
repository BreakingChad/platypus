import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/useOrgTable";
import { useCurrentOrg } from "../lib/OrgContext";
import { useAuth } from "../auth/useAuth";
import { useToast } from "../lib/Toast";
import { friendlyError } from "../lib/errors";
import { confirmDialog } from "../lib/confirm";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import { fmtDay } from "../lib/dates";
import type { StartupDocumentRow, StudyRow } from "../lib/types";
import { Icon } from "../components/ui/Icon";
import { Pill } from "../components/ui/Pill";

/** StartupDocsTab — drag a file into a bucket, name it, done. (Simple-mode
 *  rebuild, Chad 2026-06-09: eReg parked, version/track/filing ceremony
 *  removed. Three buckets, real files, click-to-rename. Anyone can do it.)
 */

const BUCKETS: { key: string; label: string; tone: "info" | "warning" | "brand"; hint: string }[] = [
  { key: "operations", label: "Operations", tone: "info", hint: "budgets, contracts, logistics" },
  { key: "regulatory", label: "Regulatory", tone: "warning", hint: "IRB, 1572s, CVs, consents" },
  { key: "startup", label: "Startup", tone: "brand", hint: "everything else from startup" },
];

const STORAGE_BUCKET = "startup-docs";
const MAX_FILE_MB = 50;

function fmtSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StartupDocsTab({ study }: { study: StudyRow }) {
  const { orgId } = useCurrentOrg();
  const auth = useAuth();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;
  const toast = useToast();

  /** Every doc action lands in the study's audit chain (0047 review fix). */
  const audit = (action: string, payload: Record<string, unknown>) => {
    if (!orgId || !userId) return;
    void writeAuditEvent({
      orgId, actorId: userId, actorEmail: userEmail,
      entityType: "study", entityId: study.id,
      action, payload,
    });
  };

  const { rows, loading, error, insert, update, remove } = useOrgTable<StartupDocumentRow>(
    "startup_documents",
    { orderBy: "created_at", realtime: true }
  );
  const docs = useMemo(
    () => rows.filter((d) => d.study_id === study.id && d.status !== "archived"),
    [rows, study.id]
  );

  const [dragOver, setDragOver] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  /* ---- add files (drop or browse) ---- */
  const addFiles = async (files: File[] | FileList, bucketKey: string) => {
    if (!orgId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(bucketKey);
    let ok = 0;
    try {
      for (const f of list) {
        if (f.size > MAX_FILE_MB * 1024 * 1024) {
          toast.error(`"${f.name}" is over ${MAX_FILE_MB} MB — skipped.`);
          continue;
        }
        const safeName = f.name.replace(/[^\w.\- ()]+/g, "_");
        const path = `${orgId}/${study.id}/${crypto.randomUUID().slice(0, 8)}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, f, { contentType: f.type || undefined });
        if (upErr) throw upErr;
        await insert({
          study_id: study.id,
          bucket: bucketKey,
          title: f.name.replace(/\.[^.]+$/, ""),
          status: "staged",
          created_by: userId,
          file_path: path,
          content_type: f.type || null,
          size_bytes: f.size,
        } as Partial<StartupDocumentRow>);
        audit("startup_doc_added", { title: f.name, bucket: bucketKey, size_bytes: f.size });
        ok += 1;
      }
      if (ok > 0) {
        toast.success(
          stamped(`${ok} file${ok === 1 ? "" : "s"} added to ${BUCKETS.find((b) => b.key === bucketKey)?.label}`)
        );
      }
    } catch (e: any) {
      toast.error(friendlyError(e, "Upload failed — has migration 0045 been applied?"));
    } finally {
      setUploading(null);
    }
  };

  /* ---- open / download via signed URL ---- */
  const openFile = async (d: StartupDocumentRow) => {
    if (!d.file_path) return;
    try {
      const { data, error: sErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(d.file_path, 300);
      if (sErr || !data?.signedUrl) throw sErr ?? new Error("No URL");
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't open the file"));
    }
  };

  /* ---- rename / move / delete ---- */
  const rename = (d: StartupDocumentRow, title: string) => {
    const t = title.trim();
    if (!t || t === d.title) return;
    update(d.id, { title: t })
      .then(() => audit("startup_doc_renamed", { from: d.title, to: t, bucket: d.bucket }))
      .catch((e: any) => toast.error(friendlyError(e, "Couldn't rename")));
  };

  const moveTo = (d: StartupDocumentRow, bucketKey: string) => {
    if (d.bucket === bucketKey) return;
    update(d.id, { bucket: bucketKey })
      .then(() => audit("startup_doc_moved", { title: d.title, from: d.bucket, to: bucketKey }))
      .catch((e: any) => toast.error(friendlyError(e, "Couldn't move it")));
  };

  const removeDoc = async (d: StartupDocumentRow) => {
    const ok = await confirmDialog({
      title: "Delete document",
      message: `Delete "${d.title}"${d.file_path ? " and its file" : ""}? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      if (d.file_path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([d.file_path]);
      }
      await remove(d.id);
      audit("startup_doc_deleted", { title: d.title, bucket: d.bucket, had_file: !!d.file_path });
      toast.success(stamped(`"${d.title}" deleted`));
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't delete it"));
    }
  };

  /* ---- drag plumbing: OS files in, cards between buckets ---- */
  const onDrop = (e: React.DragEvent, bucketKey: string) => {
    e.preventDefault();
    setDragOver(null);
    const movedId = e.dataTransfer.getData("text/startup-doc-id");
    if (movedId) {
      const d = docs.find((x) => x.id === movedId);
      if (d) moveTo(d, bucketKey);
      return;
    }
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files, bucketKey);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 leading-relaxed">
        Drag files into a bucket — or click a bucket to browse. Click a name to rename.
        Drag cards between buckets to reorganize. That&rsquo;s it.
      </p>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}
      {loading && docs.length === 0 && <div className="text-sm text-slate-500">Loading…</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        {BUCKETS.map((b) => {
          const items = docs.filter((d) => d.bucket === b.key);
          const isOver = dragOver === b.key;
          return (
            <div
              key={b.key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(b.key);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragOver(null);
              }}
              onDrop={(e) => onDrop(e, b.key)}
              className={
                "rounded-xl border-2 overflow-hidden transition " +
                (isOver
                  ? "border-brand-400 bg-brand-50/40 border-dashed"
                  : "border-slate-200 bg-slate-50/40")
              }
            >
              <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center gap-2">
                <Pill tone={b.tone}>{b.label}</Pill>
                <span className="text-[10px] text-slate-400 truncate">{b.hint}</span>
                <span className="ml-auto text-[11px] font-mono text-slate-400">{items.length}</span>
              </div>

              <div className="p-2 space-y-2">
                {items.map((d) => (
                  <DocCard
                    key={d.id}
                    doc={d}
                    onOpen={() => void openFile(d)}
                    onRename={(t) => rename(d, t)}
                    onDelete={() => void removeDoc(d)}
                  />
                ))}

                <DropTarget
                  bucketLabel={b.label}
                  uploading={uploading === b.key}
                  onPick={(files) => void addFiles(files, b.key)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- one document card ---------- */

function DocCard({
  doc,
  onOpen,
  onRename,
  onDelete,
}: {
  doc: StartupDocumentRow;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(doc.title);

  const commit = () => {
    setEditing(false);
    onRename(draft);
  };

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => e.dataTransfer.setData("text/startup-doc-id", doc.id)}
      className="group rounded-lg border border-slate-200 bg-white p-2.5 cursor-grab active:cursor-grabbing hover:border-slate-300 transition"
    >
      <div className="flex items-center gap-2">
        <Icon
          name="file"
          size={14}
          className={doc.file_path ? "text-brand-500 flex-shrink-0" : "text-slate-300 flex-shrink-0"}
        />
        {editing ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(doc.title);
                setEditing(false);
              }
            }}
            className="flex-1 min-w-0 rounded border border-brand-300 px-1.5 py-0.5 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(doc.title);
              setEditing(true);
            }}
            className="flex-1 min-w-0 text-left text-sm font-semibold text-slate-900 truncate hover:text-brand-700 transition"
            title="Click to rename"
          >
            {doc.title}
          </button>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
          {doc.file_path && (
            <button
              onClick={onOpen}
              title="Open file"
              aria-label={`Open file ${doc.title}`}
              className="p-1 rounded text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition"
            >
              <Icon name="external" size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            title="Delete"
            aria-label={`Delete ${doc.title}`}
            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      <div className="mt-1 pl-6 text-[10px] text-slate-400 font-mono">
        {[fmtSize(doc.size_bytes), fmtDay(doc.created_at)].filter(Boolean).join(" · ")}
        {!doc.file_path && " · name only (no file attached)"}
      </div>
    </div>
  );
}

/* ---------- per-bucket drop/browse target ---------- */

function DropTarget({
  bucketLabel,
  uploading,
  onPick,
}: {
  bucketLabel: string;
  uploading: boolean;
  onPick: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-full rounded-lg border border-dashed border-slate-300 bg-white/60 px-3 py-3 text-[11px] font-semibold text-slate-400 hover:text-brand-700 hover:border-brand-300 transition"
      >
        {uploading ? "Uploading…" : `Drop files here or click to add to ${bucketLabel}`}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPick(e.target.files);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}
