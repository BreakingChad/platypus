/** The Platypus mark — geometric platypus silhouette on the brand gradient.
 *  Used in the sign-in screen, app shell left rail, and any branded surface. */
export function BrandMark({ size = 40, withTile = true }: { size?: number; withTile?: boolean }) {
  const sz = size;
  return (
    <div
      className={
        "inline-flex items-center justify-center flex-shrink-0 " +
        (withTile ? "rounded-lg bg-brand-gradient shadow-sm shadow-brand-500/20" : "")
      }
      style={{ width: sz, height: sz }}
    >
      <svg viewBox="0 0 300 300" width={sz * 0.62} height={sz * 0.62}>
        <path
          fill="#ffffff"
          d="M 268 155 C 269 147 263 142 251 141 L 210 141 C 197 140 189 132 181 119 C 170 101 148 94 125 97 C 101 100 83 112 73 130 C 67 140 63 147 60 154 C 50 147 34 150 26 163 C 18 176 20 194 33 204 C 45 213 62 210 72 198 C 86 206 106 211 130 211 C 168 212 202 203 226 184 C 243 171 256 163 264 159 C 268 157 268 157 268 155 Z"
        />
        <circle cx="166" cy="121" r="9" fill="#4F46E5" />
      </svg>
    </div>
  );
}
