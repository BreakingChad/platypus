import { friendlyError } from "../lib/errors";
import { useModalA11y } from "../lib/useModalA11y";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { uniqueChannelName } from "../lib/uniqueChannel";
import { verifyChain } from "../lib/auditLog";
import {
  ACTION_TYPES,
  categoryByKey,
  docTypeByKey,
  formatFileSize,
  getDocumentSignedUrl,
  sendForAction,
  setVersionArchived,
  type DocActionType,
} from "../lib/documents";
import { useToast } from "../lib/Toast";
import type {
  AuditEventRow,
  DocumentRow,
  DocumentVersionRow,
  StudyRow,
} from "../lib/types";

import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Icon } from "../components/ui/Icon";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { stamped } from "../lib/stamp";

/** DocumentDetailPanel (LL4) — right-side drawer for a single document.
 *
 *  Two sections:
 *   - Version history: every document_versions row, newest first, with a
 *     per-version download (signed URL) and, for admins, archive/restore of
 *     superseded versions (the current head is never archivable from here).
 *   - Audit trail: the per-document hash-chained log with a chain verifier,
 *     the document-scoped analogue of the study Audit tab.
 *
 *  Both lists self-update over realtime. All writes route through
 *  lib/documents helpers so the audit chain stays intact.
 */
export function DocumentDetailPanel({
  document: doc,
  study,
  orgId,
  actorUserId,
  actorEmail,
  canEdit,
  onClose,
}: {
  document: DocumentRow;
  study: Pick<StudyRow, "code" | "title">;
  orgId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const dlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [versions, setVersions] = useState<DocumentVersionRow[] | null>(null);
  const [events, setEvents] = useState<AuditEventRow[] | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  // Version history + realtime.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("document_versions")
        .select("*")
        .eq("document_id", doc.id)
        .order("uploaded_at", { ascending: false });
      if (!cancelled) setVersions((data ?? []) as DocumentVersionRow[]);
    };
    void load();

    const ch = supabase
      .channel(uniqueChannelName(`doc-versions-${doc.id}`))
      .on(
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: "document_versions",
          filter: `document_id=eq.${doc.id}`,
        },
        () => {
          if (!cancelled) void load();
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [doc.id]);

  // Per-document audit chain + realtime.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("audit_events")
        .select("*")
        .eq("entity_type", "document")
        .eq("entity_id", doc.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled) setEvents((data ?? []) as AuditEventRow[]);
    })();

    const ch = supabase
      .channel(uniqueChannelName(`doc-audit-${doc.id}`))
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "audit_events",
          filter: `entity_id=eq.${doc.id}`,
        },
        (payload: any) => {
          if (cancelled) return;
          const row = payload.new as AuditEventRow;
          if (row.entity_type !== "document") return;
          setEvents((prev) => [row, ...(prev ?? [])]);
          setVerifyResult(null);
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [doc.id]);

  const runVerify = useCallback(() => {
    if (!events) return;
    const result = verifyChain(events as any);
    if (result.ok) {
      setVerifyResult(
        `Chain integrity verified — ${result.count} event${result.count === 1 ? "" : "s"} hash-chained for this document.`
      );
    } else {
      setVerifyResult(
        `Chain broken at event ${result.brokenAtEventId.slice(0, 8)}: ${result.reason}`
      );
    }
  }, [events]);

  const download = async (v: DocumentVersionRow) => {
    const url = await getDocumentSignedUrl(v.file_path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Couldn't generate download link");
  };

  const toggleVersionArchive = async (v: DocumentVersionRow) => {
    if (!orgId || !actorUserId) return;
    setBusyVersionId(v.id);
    try {
      await setVersionArchived({
        orgId,
        document: doc,
        version: v,
        actorUserId,
        actorEmail,
        archived: !v.archived,
      });
      toast.success(
        v.archived ? `Restored ${v.version_label}` : `Archived ${v.version_label}`
      );
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't update version"));
    } finally {
      setBusyVersionId(null);
    }
  };

  const typeMeta = docTypeByKey(doc.doc_type);
  const metaEntries = useMemo(
    () =>
      Object.entries(doc.metadata ?? {}).filter(
        ([, val]) => val !== null && val !== undefined && val !== ""
      ),
    [doc.metadata]
  );

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Document detail — ${doc.title}`}
        className="h-full w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col"
      >
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider truncate">
              {study.code} · {study.title}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Icon name="file" size={16} className="text-slate-400 flex-shrink-0" />
              <h2 className="text-lg font-display font-bold text-slate-900 truncate">
                {doc.title}
              </h2>
              <Pill tone={doc.archived ? "neutral" : "brand"}>
                {doc.archived ? "archived" : String(doc.status)}
              </Pill>
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
              <span>{typeMeta?.label ?? doc.doc_type}</span>
              <span className="text-slate-300">·</span>
              <span>{categoryByKey(doc.category)?.label ?? doc.category}</span>
              {doc.doc_type_code && (
                <>
                  <span className="text-slate-300">·</span>
                  <code className="font-mono">{doc.doc_type_code}</code>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-900 transition flex-shrink-0"
            title="Close"
            aria-label="Close document detail"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {canEdit && !doc.archived && (
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={() => setSendOpen(true)}>
                <Icon name="inbox" size={12} /> Send for action
              </Button>
            </div>
          )}
          {doc.description && (
            <p className="text-sm text-slate-600 leading-relaxed">{doc.description}</p>
          )}

          {/* METADATA */}
          {metaEntries.length > 0 && (
            <section>
              <SectionHeading icon="info" label="Document details" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {metaEntries.map(([k, val]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {metaFieldLabel(doc.doc_type, k)}
                    </dt>
                    <dd className="text-sm text-slate-800">{String(val)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {/* VERSION HISTORY */}
          <section>
            <SectionHeading
              icon="layers"
              label="Version history"
              count={versions?.length}
            />
            {!versions && <div className="text-sm text-slate-500">Loading versions…</div>}
            {versions && versions.length === 0 && (
              <div className="text-sm text-slate-500">No versions recorded.</div>
            )}
            {versions && versions.length > 0 && (
              <ol className="relative border-l border-slate-200 ml-1.5 space-y-3">
                {versions.map((v) => {
                  const isCurrent = v.id === doc.current_version_id;
                  return (
                    <li key={v.id} className="ml-4">
                      <span
                        className={
                          "absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full border-2 border-white " +
                          (isCurrent
                            ? "bg-brand-500"
                            : v.archived
                            ? "bg-slate-300"
                            : "bg-slate-400")
                        }
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-900 font-mono">
                              {v.version_label}
                            </span>
                            {isCurrent && <Pill tone="success">current</Pill>}
                            {v.archived && <Pill tone="neutral">archived</Pill>}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="truncate" title={v.original_filename ?? ""}>
                              {v.original_filename ?? "no file"}
                            </span>
                            {v.file_size > 0 && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="font-mono">
                                  {formatFileSize(v.file_size)}
                                </span>
                              </>
                            )}
                            <span className="text-slate-300">·</span>
                            <span className="font-mono">
                              {new Date(v.uploaded_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!v.file_path || v.file_path === "pending"}
                            onClick={() => void download(v)}
                            title="Download this version"
                          >
                            <Icon name="external" size={12} /> Open
                          </Button>
                          {canEdit && !isCurrent && (
                            <button
                              onClick={() => void toggleVersionArchive(v)}
                              disabled={busyVersionId === v.id}
                              className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 transition disabled:opacity-40"
                              title={v.archived ? "Restore version" : "Archive version"}
                            >
                              {v.archived ? "restore" : "archive"}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* AUDIT CHAIN */}
          <section>
            <div className="flex items-center justify-between gap-3 mb-2">
              <SectionHeading icon="shield" label="Audit trail" count={events?.length} inline />
              <Button
                size="sm"
                variant="primary"
                disabled={!events || events.length === 0}
                onClick={runVerify}
              >
                <Icon name="shield" size={12} /> Verify chain
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
              Every action on this document is appended to a hash-chained log — each
              event carries the previous event's hash. Verify walks every link.
            </p>
            {verifyResult && (
              <div
                className={
                  "mb-3 rounded-lg border px-3 py-2 text-xs " +
                  (verifyResult.startsWith("Chain integrity")
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-800")
                }
              >
                {verifyResult}
              </div>
            )}
            {!events && <div className="text-sm text-slate-500">Loading audit trail…</div>}
            {events && events.length === 0 && (
              <div className="text-sm text-slate-500">No audit events recorded.</div>
            )}
            {events && events.length > 0 && (
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                {events.map((e) => (
                  <li key={e.id} className="px-3 py-2.5 flex items-start gap-2.5">
                    <DocActionIcon action={e.action} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900">
                          {docActionLabel(e)}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {e.actor_email ?? "system"}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1 text-[10px] font-mono text-slate-500">
                        <div>
                          <span className="text-slate-400 uppercase tracking-wider">prev</span>{" "}
                          {e.prev_hash || "—"}
                        </div>
                        <div>
                          <span className="text-slate-400 uppercase tracking-wider">hash</span>{" "}
                          {e.event_hash}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
    {sendOpen && actorUserId && (
      <SendForActionModal
        orgId={orgId}
        document={doc}
        actorUserId={actorUserId}
        actorEmail={actorEmail}
        onClose={() => setSendOpen(false)}
        onSent={() => {
          setSendOpen(false);
          toast.success(stamped("Sent for action"));
        }}
      />
    )}
    </>
  );
}

function SectionHeading({
  icon,
  label,
  count,
  inline,
}: {
  icon: string;
  label: string;
  count?: number;
  inline?: boolean;
}) {
  return (
    <div className={inline ? "flex items-center gap-2" : "flex items-center gap-2 mb-2"}>
      <Icon name={icon} size={14} className="text-slate-400" />
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      {typeof count === "number" && (
        <span className="text-[10px] font-mono text-slate-400">{count}</span>
      )}
    </div>
  );
}

function DocActionIcon({ action }: { action: string }) {
  let icon = "info";
  let tone = "bg-slate-100 text-slate-500";
  if (action === "created") {
    icon = "plus";
    tone = "bg-brand-50 text-brand-600";
  } else if (action === "version_uploaded") {
    icon = "layers";
    tone = "bg-sky-50 text-sky-600";
  } else if (action === "archived" || action === "version_archived") {
    icon = "lock";
    tone = "bg-slate-100 text-slate-600";
  } else if (action === "restored" || action === "version_restored") {
    icon = "check";
    tone = "bg-emerald-50 text-emerald-700";
  } else if (action === "reclassified") {
    icon = "folder";
    tone = "bg-amber-50 text-amber-700";
  } else if (action === "sent_for_action") {
    icon = "inbox";
    tone = "bg-violet-50 text-violet-700";
  } else if (
    action === "signed" ||
    action === "acknowledged" ||
    action === "reviewed" ||
    action === "attested"
  ) {
    icon = "shield";
    tone = "bg-emerald-50 text-emerald-700";
  }
  return (
    <div
      className={
        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 " + tone
      }
    >
      <Icon name={icon} size={13} />
    </div>
  );
}

function docActionLabel(e: AuditEventRow): string {
  const ver = e.payload?.version_label ? ` ${String(e.payload.version_label)}` : "";
  switch (e.action) {
    case "created":
      return "Document created";
    case "version_uploaded":
      return `Uploaded version${ver}`;
    case "archived":
      return "Document archived";
    case "restored":
      return "Document restored";
    case "version_archived":
      return `Archived version${ver}`;
    case "version_restored":
      return `Restored version${ver}`;
    case "reclassified":
      return "Reclassified";
    case "sent_for_action":
      return `Sent for ${String(e.payload?.action_type ?? "action")}`;
    case "signed":
      return `Signed${e.payload?.signer_name ? ` \u2014 ${String(e.payload.signer_name)}` : ""}`;
    case "acknowledged":
      return `Acknowledged${e.payload?.signer_name ? ` \u2014 ${String(e.payload.signer_name)}` : ""}`;
    case "reviewed":
      return `Reviewed${e.payload?.signer_name ? ` \u2014 ${String(e.payload.signer_name)}` : ""}`;
    case "attested":
      return `Training attested${e.payload?.signer_name ? ` \u2014 ${String(e.payload.signer_name)}` : ""}`;
    default:
      return e.action;
  }
}

function metaFieldLabel(docTypeKey: string, fieldKey: string): string {
  const t = docTypeByKey(docTypeKey);
  const f = t?.metadataFields.find((mf) => mf.key === fieldKey);
  if (f) return f.label;
  return fieldKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


function SendForActionModal({
  orgId,
  document: doc,
  actorUserId,
  actorEmail,
  onClose,
  onSent,
}: {
  orgId: string;
  document: DocumentRow;
  actorUserId: string | null;
  actorEmail: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const sendDlgRef = useModalA11y<HTMLDivElement>(onClose);
  const [members, setMembers] = useState<{ user_id: string; label: string }[] | null>(null);
  const [actionType, setActionType] = useState<DocActionType>("sign");
  const [assignee, setAssignee] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: mems } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId);
      const ids = (mems ?? []).map((m: any) => m.user_id as string);
      let profs: any[] = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from("profiles")
          .select("id, email, full_name")
          .in("id", ids);
        profs = data ?? [];
      }
      const byId: Record<string, any> = {};
      profs.forEach((p) => (byId[p.id] = p));
      const list = ids.map((id) => ({
        user_id: id,
        label: byId[id]?.full_name || byId[id]?.email || "(unknown)",
      }));
      if (cancelled) return;
      setMembers(list);
      if (actorUserId && list.some((m) => m.user_id === actorUserId)) setAssignee(actorUserId);
      else if (list[0]) setAssignee(list[0].user_id);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, actorUserId]);

  const submit = async () => {
    setError(null);
    if (!actorUserId) return;
    if (!assignee) {
      setError("Pick someone to send this to.");
      return;
    }
    setBusy(true);
    try {
      const label = members?.find((m) => m.user_id === assignee)?.label ?? null;
      await sendForAction({
        orgId,
        document: doc,
        actionType,
        assigneeUserId: assignee,
        assigneeLabel: label,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        note: note.trim() || null,
        actorUserId,
        actorEmail,
      });
      onSent();
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Has migration 0011 been applied?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={sendDlgRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send document for action"
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider truncate">
            {doc.title}
          </div>
          <h2 className="text-lg font-display font-bold text-slate-900">Send for action</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Files a task into the recipient&rsquo;s inbox. Signatures are recorded on the
            document&rsquo;s audit chain.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Action
            </span>
            <Select value={actionType} onChange={(e) => setActionType(e.target.value as DocActionType)}>
              {ACTION_TYPES.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Assign to
            </span>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {!members && <option value="">Loading…</option>}
              {members?.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Due date (optional)
            </span>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              Note (optional)
            </span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for the recipient"
            />
          </label>
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !assignee}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
