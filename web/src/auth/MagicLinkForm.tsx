import { useState } from "react";
import { supabase } from "../lib/supabase";

/** Email-only sign-in. Supabase sends a magic link; clicking it returns
 *  here with a session attached to the URL hash, which the client reads. */
export function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"link" | "password">("link");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) return;
    setStatus("sending");
    setErrorMsg(null);
    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setStatus("error");
        setErrorMsg(
          /invalid login/i.test(error.message)
            ? "That email + password combination didn't work."
            : error.message
        );
      }
      // success: session lands via onAuthStateChange — nothing else to do.
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  };

  if (status === "sent") {
    return (
      <div className="text-center">
        <div className="text-2xl font-display font-bold text-slate-900 mb-2">Check your email</div>
        <div className="text-slate-600 leading-relaxed">
          We sent a sign-in link to <strong>{email}</strong>.<br />
          Click the link to enter Platypus.
        </div>
        <button
          onClick={() => { setStatus("idle"); setEmail(""); }}
          className="mt-6 text-sm text-brand-500 font-semibold hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourorg.com"
          className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 transition"
        />
      </div>
      <button
        type="submit"
        disabled={status === "sending" || !email.includes("@")}
        className="w-full rounded-xl bg-brand-gradient px-4 py-3 text-base font-semibold text-white shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {errorMsg && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorMsg}</div>
      )}
      <p className="text-xs text-slate-500 leading-relaxed pt-2">
        We'll email you a single-use sign-in link. No passwords. No SSO setup needed today.
      </p>
          {mode === "password" && (
        <div>
          <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition"
            placeholder="Your password (or the temporary one you were given)"
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          setMode(mode === "link" ? "password" : "link");
          setStatus("idle");
          setErrorMsg(null);
        }}
        className="block w-full text-center text-xs font-semibold text-brand-600 hover:underline"
      >
        {mode === "link" ? "Have a password? Sign in with it instead" : "← Email me a sign-in link instead"}
      </button>
    </form>
  );
}
