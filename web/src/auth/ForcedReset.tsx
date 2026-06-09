import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/** ForcedReset — shown INSTEAD of the app when a user signs in with a
 *  developer-issued temp password (user_metadata.must_reset_password).
 *  They set their own password and confirm who they are; only then does
 *  the app open. (Wave M2)
 */
export function ForcedReset({ user }: { user: User }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill whatever the org already knows about them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const d = data as any;
      // Pre-0042 rows may only carry full_name — split for the inputs.
      const [legacyFirst, ...legacyRest] = ((d.full_name as string) ?? "").trim().split(/\s+/);
      setFirstName(d.first_name ?? legacyFirst ?? "");
      setLastName(d.last_name ?? legacyRest.join(" "));
      setTitle(d.title ?? "");
      setPhone(d.phone ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim()) return setError("Tell us your first name — tasks and signatures carry it.");
    if (pw1.length < 8) return setError("Password needs at least 8 characters.");
    if (pw1 !== pw2) return setError("Passwords don't match.");
    if (/^platypus-/i.test(pw1)) return setError("Pick your own password — not the temporary one.");
    setBusy(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          title: title.trim() || null,
          phone: phone.trim() || null,
        } as any)
        .eq("id", user.id);
      if (pErr) throw pErr;
      const { error: uErr } = await supabase.auth.updateUser({
        password: pw1,
        data: { must_reset_password: false },
      });
      if (uErr) throw uErr;
      // Session metadata refreshes via onAuthStateChange; reload is belt-and-braces.
      window.location.reload();
    } catch (err: any) {
      setError(err?.message ?? "Couldn't save — try again.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#faf8f4]">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-brand-gradient flex items-center justify-center shadow-md shadow-brand-500/25 text-white font-display font-extrabold text-xl">
            P
          </div>
          <span className="text-3xl font-display font-extrabold tracking-tight text-slate-900">Platypus</span>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-4">
          <div>
            <h1 className="text-xl font-display font-bold text-slate-900">Welcome — make this account yours</h1>
            <p className="text-sm text-slate-600 mt-1">
              You signed in with a temporary password. Set your own and confirm your details —
              they appear on tasks, approvals, and the audit trail.
            </p>
          </div>

          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">Email</span>
            <input value={user.email ?? ""} disabled className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="reset-input" placeholder="Jane" autoFocus />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Last name</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="reset-input" placeholder="Rivera" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Title (optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="reset-input" placeholder="Startup Coordinator" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Phone (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="reset-input" placeholder="(555) 010-2030" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">New password</span>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} className="reset-input" autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-slate-700 mb-1">Repeat it</span>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="reset-input" autoComplete="new-password" />
            </label>
          </div>

          {error && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-brand-gradient text-white font-display font-bold py-3 shadow-md shadow-brand-500/25 hover:opacity-95 transition disabled:opacity-60"
          >
            {busy ? "Saving…" : "Set password & enter Platypus"}
          </button>
        </form>
        <style>{`.reset-input{width:100%;border:1px solid #e2e8f0;border-radius:0.5rem;background:#fff;padding:0.6rem 0.75rem;font-size:0.875rem;color:#0f172a;outline:none}.reset-input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}`}</style>
      </div>
    </div>
  );
}
