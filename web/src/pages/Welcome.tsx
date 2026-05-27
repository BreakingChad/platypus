import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";

type Org = { id: string; name: string; sponsor_mode: "site" | "sponsor"; created_at: string };

export function Welcome() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    (async () => {
      const { data, error } = await supabase
        .from("orgs")
        .select("id, name, sponsor_mode, created_at")
        .order("created_at", { ascending: true });
      if (error) setLoadError(error.message);
      else setOrgs(data as Org[]);
    })();
  }, [auth.status]);

  if (auth.status !== "signedIn") return null;
  const { user } = auth;

  return (
    <div className="min-h-screen bg-[#faf8f4]">
      {/* header */}
      <header className="bg-brand-gradient text-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center">
              <PlatypusMark />
            </div>
            <span className="text-2xl font-display font-extrabold tracking-tight">Platypus</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="opacity-90">{user.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-md border border-white/30 px-3 py-1.5 text-xs font-semibold hover:bg-white/10 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* body */}
      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-display font-extrabold tracking-tight text-slate-900 mb-2">
          You're in.
        </h1>
        <p className="text-slate-600 mb-8 max-w-2xl leading-relaxed">
          This is the Supabase-backed real app. Schema, auth, and a live database query are
          working. Next we'll port the operating model — pipeline stages, teams, workflows,
          fields — onto this foundation.
        </p>

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-bold text-slate-900">Your organizations</h2>
            <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">
              live from supabase
            </span>
          </div>

          {loadError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              <strong>Couldn't load orgs:</strong> {loadError}
              <div className="mt-2 text-xs text-red-600">
                If you haven't applied the initial migration yet, run it in Supabase Studio →
                SQL Editor. See <code>supabase/README.md</code>.
              </div>
            </div>
          )}

          {!loadError && orgs === null && (
            <div className="text-sm text-slate-500">Loading…</div>
          )}

          {orgs && orgs.length === 0 && (
            <div className="text-sm text-slate-500">
              No orgs yet. The signup trigger should have created one automatically — if you
              don't see it here, the migration may not be applied.
            </div>
          )}

          {orgs && orgs.length > 0 && (
            <ul className="divide-y divide-slate-200">
              {orgs.map((o) => (
                <li key={o.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{o.name}</div>
                    <div className="text-xs text-slate-500 font-mono">
                      {o.sponsor_mode === "sponsor" ? "Sponsor mode" : "Site mode"} ·
                      created {new Date(o.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <code className="text-xs text-slate-400 font-mono">{o.id.slice(0, 8)}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-slate-500 mt-8">
          Next up: Phase B — pipeline_stages, teams, workflows, studies (with custom_field_values JSONB),
          and a generic <code>useOrgTable&lt;T&gt;</code> hook to replace the demo's localStorage layer.
        </p>
      </main>
    </div>
  );
}

function PlatypusMark() {
  return (
    <svg viewBox="0 0 300 300" className="w-6 h-6">
      <path fill="#ffffff" d="M 268 155 C 269 147 263 142 251 141 L 210 141 C 197 140 189 132 181 119 C 170 101 148 94 125 97 C 101 100 83 112 73 130 C 67 140 63 147 60 154 C 50 147 34 150 26 163 C 18 176 20 194 33 204 C 45 213 62 210 72 198 C 86 206 106 211 130 211 C 168 212 202 203 226 184 C 243 171 256 163 264 159 C 268 157 268 157 268 155 Z" />
      <circle cx="166" cy="121" r="9" fill="#4F46E5" />
    </svg>
  );
}
