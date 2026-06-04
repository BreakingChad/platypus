import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { uniqueChannelName } from "../lib/uniqueChannel";
import { useAuth } from "../auth/useAuth";
import { useCurrentOrg } from "../lib/OrgContext";
import { useToast } from "../lib/Toast";
import { writeAuditEvent } from "../lib/auditLog";
import { stamped } from "../lib/stamp";
import type { StudyNoteRow } from "../lib/types";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";

/** NotesCard — lightweight, append-only study notes. Any org member can add
 *  one; each lands in the study's audit chain (note_added) so the record is
 *  defensible. Realtime so the team sees notes as they land. This is the
 *  "stop using email as the comms layer" surface.
 */
export function NotesCard({ studyId }: { studyId: string }) {
  const auth = useAuth();
  const { orgId } = useCurrentOrg();
  const toast = useToast();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const userEmail = auth.status === "signedIn" ? auth.user.email ?? null : null;

  const [notes, setNotes] = useState<StudyNoteRow[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("study_notes")
        .select("*")
        .eq("study_id", studyId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        setUnavailable(true);
        setNotes([]);
        return;
      }
      setNotes((data ?? []) as StudyNoteRow[]);
    })();

    const ch = supabase
      .channel(uniqueChannelName(`notes-${studyId}`))
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "study_notes", filter: `study_id=eq.${studyId}` },
        (payload: any) => {
          if (cancelled) return;
          setNotes((prev) => {
            const row = payload.new as StudyNoteRow;
            if (prev?.some((n) => n.id === row.id)) return prev;
            return [row, ...(prev ?? [])];
          });
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [studyId]);

  const add = async () => {
    if (!draft.trim() || !orgId || !userId) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("study_notes").insert({
        org_id: orgId,
        study_id: studyId,
        body: draft.trim(),
        author_id: userId,
        author_email: userEmail,
      } as any);
      if (error) throw error;
      void writeAuditEvent({
        orgId,
        actorId: userId,
        actorEmail: userEmail,
        entityType: "study",
        entityId: studyId,
        action: "note_added",
        payload: { excerpt: draft.trim().slice(0, 140) },
      });
      setDraft("");
      toast.success(stamped("Note added"));
    } catch (e: any) {
      toast.error(e?.message || "Couldn't add note. Has migration 0013 been applied?");
    } finally {
      setBusy(false);
    }
  };

  if (unavailable) return null; // pre-migration: collapse quietly

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Icon name="file" size={14} className="text-slate-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes</span>
        {notes && notes.length > 0 && (
          <span className="text-[10px] font-mono text-slate-400">{notes.length}</span>
        )}
      </div>

      <div className="flex items-start gap-2 mb-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add();
          }}
          placeholder="Add a note — decisions, sponsor calls, context the next person needs."
          rows={2}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition resize-y"
        />
        <Button variant="primary" size="sm" onClick={add} disabled={busy || !draft.trim()}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>

      {notes === null && <div className="text-sm text-slate-500">Loading notes…</div>}
      {notes && notes.length === 0 && (
        <div className="text-sm text-slate-500">
          No notes yet. Notes are timestamped, attributed, and land in the audit trail — context
          that used to live in email threads.
        </div>
      )}
      {notes && notes.length > 0 && (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-brand-gradient text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                {(n.author_email?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-700">
                    {n.author_email ?? "unknown"}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{n.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
