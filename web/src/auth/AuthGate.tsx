import { useAuth } from "./useAuth";
import { MagicLinkForm } from "./MagicLinkForm";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const state = useAuth();

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500 text-sm font-medium">Loading…</div>
      </div>
    );
  }

  if (state.status === "signedOut") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-[#faf8f4]">
        <div className="w-full max-w-md">
          {/* brand mark + wordmark */}
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-12 h-12 rounded-xl bg-brand-gradient flex items-center justify-center shadow-md shadow-brand-500/25">
              <PlatypusMark />
            </div>
            <span className="text-3xl font-display font-extrabold tracking-tight text-slate-900">Platypus</span>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h1 className="text-xl font-display font-bold text-slate-900 mb-1">Sign in</h1>
            <p className="text-sm text-slate-600 mb-6">
              The operating system for clinical research site operations.
            </p>
            <MagicLinkForm />
          </div>
          <p className="text-xs text-slate-500 text-center mt-6">
            Software built for the people who power clinical research.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function PlatypusMark() {
  return (
    <svg viewBox="0 0 300 300" className="w-7 h-7">
      <path fill="#ffffff" d="M 268 155 C 269 147 263 142 251 141 L 210 141 C 197 140 189 132 181 119 C 170 101 148 94 125 97 C 101 100 83 112 73 130 C 67 140 63 147 60 154 C 50 147 34 150 26 163 C 18 176 20 194 33 204 C 45 213 62 210 72 198 C 86 206 106 211 130 211 C 168 212 202 203 226 184 C 243 171 256 163 264 159 C 268 157 268 157 268 155 Z" />
      <circle cx="166" cy="121" r="9" fill="#4F46E5" />
    </svg>
  );
}
