import { HEALTH_TONE, type HealthInfo } from "../../lib/studyHealth";

/** Tiny health indicator. Three variants:
 *    dot   — just the colored dot (compact use)
 *    pill  — dot + label (e.g. "Healthy", "Overdue")
 *    chip  — full chip with the summary text
 */
export function HealthDot({
  health,
  variant = "dot",
  className = "",
}: {
  health: HealthInfo;
  variant?: "dot" | "pill" | "chip";
  className?: string;
}) {
  const tone = HEALTH_TONE[health.level];

  if (variant === "dot") {
    return (
      <span
        title={health.summary}
        className={
          "inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 " + tone.dot + " " + className
        }
        aria-label={`Health: ${tone.label}. ${health.summary}`}
      />
    );
  }

  if (variant === "pill") {
    return (
      <span
        title={health.summary}
        className={
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap " +
          tone.bg +
          " " +
          tone.text +
          " " +
          tone.border +
          " " +
          className
        }
      >
        <span className={"w-1.5 h-1.5 rounded-full " + tone.dot} />
        {tone.label}
      </span>
    );
  }

  // chip variant — fuller treatment with the summary text
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap " +
        tone.bg +
        " " +
        tone.text +
        " " +
        tone.border +
        " " +
        className
      }
      title={health.summary}
    >
      <span className={"w-1.5 h-1.5 rounded-full " + tone.dot} />
      {tone.label}
      <span className="text-slate-500 font-mono text-[10px]">{health.summary}</span>
    </span>
  );
}
