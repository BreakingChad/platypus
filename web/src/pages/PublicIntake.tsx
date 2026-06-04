import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { missingRequired, type FormFieldSnapshot } from "../lib/forms";
import type { IntakeFormRow } from "../lib/types";

/** PublicIntake — the UNAUTHENTICATED surface (Wave G).
 *
 *  #/f            → landing page listing every ACTIVE form (the evergreen link)
 *  #/f/{slug}     → one form: render its frozen field snapshot, enforce
 *                   required fields, insert the submission. No drafts, by
 *                   design — a submission either arrives complete or not at all.
 *
 *  Renders OUTSIDE AuthGate/AppShell: anon Supabase key + RLS policies are
 *  the entire security model (active forms readable; submissions insertable
 *  only against active forms).
 */

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

export function PublicIntake({ hash }: { hash: string }) {
  const slug = hash.startsWith("#/f/") ? decodeURIComponent(hash.slice(4).split("?")[0]) : null;
  return (
    <div className="min-h-screen bg-[#faf8f4]">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-2xl mx-auto px-4 md:px-6 2xl:px-12 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-gradient flex items-center justify-center text-white font-display font-extrabold">
            P
          </div>
          <div>
            <div className="font-display font-extrabold text-slate-900 leading-tight">Platypus</div>
            <div className="text-[11px] text-slate-500 leading-tight">Study intake</div>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 md:px-6 2xl:px-12 py-8">
        {slug ? <PublicForm slug={slug} /> : <PublicLanding />}
      </main>
      <footer className="max-w-2xl mx-auto px-4 md:px-6 2xl:px-12 pb-10">
        <p className="text-[11px] text-slate-400">
          Submissions go directly to the research site's startup team.
        </p>
      </footer>
    </div>
  );
}

/* ---------- landing: every active form ---------- */

function PublicLanding() {
  const [state, setState] = useState<LoadState<IntakeFormRow[]>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("intake_forms")
        .select("id, title, description, slug, version, status, org_id, fields, created_at")
        .eq("status", "active")
        .order("title", { ascending: true });
      if (cancelled) return;
      if (error) setState({ status: "error", message: "This page couldn't load. Try again in a minute." });
      else setState({ status: "ready", data: (data ?? []) as IntakeFormRow[] });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p className="text-sm text-slate-500">Loading forms…</p>;
  if (state.status === "error") return <p className="text-sm text-red-600">{state.message}</p>;

  return (
    <>
      <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">Submit a study</h1>
      <p className="text-sm text-slate-600 mb-6">
        Pick the form that fits your study. This page always shows the current forms.
      </p>
      {state.data.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-500">
          No intake forms are open right now — check back soon, or contact the site directly.
        </div>
      ) : (
        <div className="space-y-3">
          {state.data.map((f) => (
            <a
              key={f.id}
              href={`#/f/${f.slug}`}
              className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:shadow-sm transition"
            >
              <div className="font-semibold text-slate-900">{f.title}</div>
              {f.description && <div className="text-xs text-slate-500 mt-0.5">{f.description}</div>}
              <div className="text-[11px] text-brand-700 font-semibold mt-2">Open form →</div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- one form ---------- */

function PublicForm({ slug }: { slug: string }) {
  const [state, setState] = useState<LoadState<IntakeFormRow>>({ status: "loading" });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitter, setSubmitter] = useState({ name: "", email: "" });
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("intake_forms")
        .select("*")
        .eq("slug", slug)
        .eq("status", "active")
        .maybeSingle();
      if (cancelled) return;
      if (error) setState({ status: "error", message: "This form couldn't load. Try again in a minute." });
      else if (!data)
        setState({
          status: "error",
          message: "This form isn't accepting submissions right now. It may have been replaced — check the landing page for current forms.",
        });
      else setState({ status: "ready", data: data as IntakeFormRow });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const fields = useMemo(
    () => (state.status === "ready" ? ((state.data.fields as FormFieldSnapshot[]) ?? []) : []),
    [state]
  );
  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const f of fields) if (!seen.includes(f.section)) seen.push(f.section);
    return seen;
  }, [fields]);

  const submit = async () => {
    if (state.status !== "ready" || busy) return;
    const missing = missingRequired(fields, values);
    if (!submitter.name.trim()) missing.unshift("Your name");
    if (!/.+@.+\..+/.test(submitter.email)) missing.unshift("A valid email");
    setProblems(missing);
    if (missing.length > 0) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("form_submissions").insert({
        org_id: state.data.org_id,
        form_id: state.data.id,
        form_title: state.data.title,
        status: "new",
        values,
        submitter_name: submitter.name.trim(),
        submitter_email: submitter.email.trim(),
      });
      if (error) throw error;
      setDone(true);
    } catch {
      setProblems(["Something went wrong submitting — nothing was saved. Please try again."]);
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") return <p className="text-sm text-slate-500">Loading form…</p>;
  if (state.status === "error")
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <p className="text-sm text-slate-700">{state.message}</p>
        <a href="#/f" className="inline-block mt-3 text-sm font-semibold text-brand-700 hover:underline">
          See current forms →
        </a>
      </div>
    );

  if (done)
    return (
      <div className="bg-white rounded-xl border border-emerald-200 p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl">✓</div>
        <h1 className="text-xl font-display font-extrabold text-slate-900 mt-4">Submission received</h1>
        <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
          The startup team has your study. They'll follow up at{" "}
          <strong>{submitter.email.trim()}</strong> as it moves through intake.
        </p>
        <button
          onClick={() => {
            setDone(false);
            setValues({});
            setProblems([]);
          }}
          className="mt-5 text-sm font-semibold text-brand-700 hover:underline"
        >
          Submit another study
        </button>
      </div>
    );

  const form = state.data;
  return (
    <>
      <h1 className="text-2xl font-display font-extrabold text-slate-900 mb-1">{form.title}</h1>
      {form.description && <p className="text-sm text-slate-600">{form.description}</p>}
      <p className="text-[11px] text-slate-400 mt-1 mb-6">
        Fields marked <span className="text-brand-600 font-bold">*</span> are required — the form
        submits only when they're complete.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="text-xs font-semibold text-slate-500 mb-3">About you</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PubField label="Your name" required>
            <input
              value={submitter.name}
              onChange={(e) => setSubmitter({ ...submitter, name: e.target.value })}
              className="pub-input"
              placeholder="Jane Rivera"
            />
          </PubField>
          <PubField label="Email" required>
            <input
              value={submitter.email}
              onChange={(e) => setSubmitter({ ...submitter, email: e.target.value })}
              className="pub-input"
              placeholder="jane@sponsor.com"
              type="email"
            />
          </PubField>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section} className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
          <div className="text-xs font-semibold text-slate-500 mb-3">{section}</div>
          <div className="space-y-3">
            {fields
              .filter((f) => f.section === section)
              .map((f) => (
                <PubField key={f.key} label={f.label} required={f.required}>
                  <SnapshotInput
                    field={f}
                    value={values[f.key]}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                  />
                </PubField>
              ))}
          </div>
        </div>
      ))}

      {problems.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 mb-4">
          <strong>Still needed:</strong> {problems.join(" · ")}
        </div>
      )}

      <button
        onClick={() => void submit()}
        disabled={busy}
        className="w-full rounded-xl bg-brand-gradient text-white font-display font-bold py-3 shadow-md shadow-brand-500/25 hover:opacity-95 transition disabled:opacity-60"
      >
        {busy ? "Submitting…" : "Submit study"}
      </button>

      <style>{`.pub-input{width:100%;border:1px solid #e2e8f0;border-radius:0.5rem;background:#fff;padding:0.55rem 0.75rem;font-size:0.875rem;color:#0f172a;outline:none}.pub-input:focus{border-color:#4F46E5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}`}</style>
    </>
  );
}

function PubField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 mb-1">
        {label} {required && <span className="text-brand-600 font-bold">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Render a snapshot field — same semantics as the in-app editors, standalone. */
function SnapshotInput({
  field,
  value,
  onChange,
}: {
  field: FormFieldSnapshot;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.field_type) {
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-brand-500 w-4 h-4"
          />
          Yes
        </label>
      );
    case "number":
      return (
        <input
          type="number"
          className="pub-input"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <input
          type="date"
          className="pub-input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "dropdown": {
      const opts = field.values ?? [];
      if (opts.length === 0)
        return <input className="pub-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
      return (
        <select className="pub-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Select —</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case "multiselect": {
      const opts = field.values ?? [];
      const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
      return (
        <div className="flex flex-wrap gap-1.5">
          {opts.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              className={
                "text-xs rounded-full border px-2.5 py-1 transition " +
                (selected.includes(v)
                  ? "border-brand-300 bg-brand-50 text-brand-800 font-semibold"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {selected.includes(v) ? "✓ " : ""}
              {v}
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
              <input
                className="pub-input"
                value={it}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-slate-300 hover:text-red-500 transition px-1"
                aria-label="Remove entry"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className="text-xs font-semibold text-brand-700 hover:underline"
          >
            + Add entry
          </button>
        </div>
      );
    }
    default:
      return (
        <input
          className="pub-input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
