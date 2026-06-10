import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** DataTable — the one sortable table (Tier-3 seed, built for Analytics).
 *  Sticky header, click-to-sort with indicators, zebra rows. Pages can
 *  migrate onto this over time instead of hand-rolling div-grids.
 */
export type DataColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Cell renderer; defaults to String(row[key]). */
  render?: (row: T) => ReactNode;
  /** Sort value; defaults to row[key]. */
  sortValue?: (row: T) => string | number;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  initialSort,
  emptyLabel = "No rows.",
}: {
  columns: DataColumn<T>[];
  rows: T[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyLabel?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = (r: T): string | number =>
      col?.sortValue ? col.sortValue(r) : ((r[sort.key] as string | number) ?? "");
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div className="overflow-auto max-h-[60vh] rounded-xl border border-slate-200">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={
                  "sticky top-0 z-10 bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 select-none cursor-pointer whitespace-nowrap " +
                  (c.align === "right" ? "text-right" : "text-left")
                }
                onClick={() => toggle(c.key)}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sort?.key === c.key && (
                    <Icon name="chevron-down" size={10} className={sort.dir === "asc" ? "rotate-180" : ""} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
          {sorted.map((r, i) => (
            <tr key={i} className={i % 2 === 1 ? "bg-slate-50/50" : "bg-white"}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={
                    "px-3 py-2 border-b border-slate-100 text-slate-800 " +
                    (c.align === "right" ? "text-right font-mono text-xs" : "text-left")
                  }
                >
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
