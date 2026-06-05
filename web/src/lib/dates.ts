/** Shared date formatters — one voice for every date in the app.
 *
 *  fmtDate     -> "Jun 3, 2026"
 *  fmtDateTime -> "Jun 3, 2026, 2:41 PM"
 *
 *  Locale is fixed to en-US so audits, demos, and screenshots read
 *  identically on every machine. Null/invalid inputs render the em-dash,
 *  matching the table convention everywhere else.
 */

type DateInput = string | number | Date | null | undefined;

function toDate(d: DateInput): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

export function fmtDate(d: DateInput): string {
  const dt = toDate(d);
  if (!dt) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(d: DateInput): string {
  const dt = toDate(d);
  if (!dt) return "—";
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact day for tight columns: "Jun 10", with the year only when it
 *  isn't the current one ("Jun 10, 2027"). Never wraps. */
export function fmtDay(d: DateInput): string {
  const dt = toDate(d);
  if (!dt) return "—";
  const opts: Intl.DateTimeFormatOptions =
    dt.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return dt.toLocaleDateString("en-US", opts);
}
