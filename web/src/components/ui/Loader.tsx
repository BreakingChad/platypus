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

/** Shimmer placeholder rows for list/table surfaces — content-shaped
 *  loading beats a spinner for perceived speed. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="px-4 py-3 space-y-3.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-28 hidden sm:block" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
