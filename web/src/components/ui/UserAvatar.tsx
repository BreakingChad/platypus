/** UserAvatar — the one initials/photo circle (B-series profile work).
 *
 *  Photo when `src` is set (profiles.avatar_url), otherwise initials from
 *  the first two name words, otherwise the email's first letter. Replaces
 *  the hand-rolled circles that had drifted across Members, WorkloadBlock,
 *  notes, and the AppShell header.
 */
export function UserAvatar({
  name,
  email,
  src,
  size = 28,
  className = "",
}: {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const label = (name ?? "").trim() || (email ?? "").trim() || "?";

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        title={label}
        style={{ width: size, height: size }}
        className={"rounded-full object-cover flex-shrink-0 " + className}
        referrerPolicy="no-referrer"
      />
    );
  }

  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") ||
    ((email ?? "")[0] ?? "?").toUpperCase();

  const fontSize = size <= 24 ? 10 : size <= 32 ? 11 : size <= 48 ? 16 : 22;

  return (
    <div
      title={label}
      style={{ width: size, height: size, fontSize }}
      className={
        "rounded-full bg-brand-gradient text-white flex items-center justify-center font-bold flex-shrink-0 " +
        className
      }
    >
      {initials}
    </div>
  );
}
