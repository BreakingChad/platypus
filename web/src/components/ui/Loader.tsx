export function Loader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="animate-spin w-4 h-4 text-brand-500" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Skeleton block — use as placeholder while a list loads. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}
