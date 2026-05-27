import type { HTMLAttributes, ReactNode, Ref } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Reduce default padding. */
  flush?: boolean;
  /** Highlight as the primary card on the page (brand-tinted border). */
  primary?: boolean;
  /** Optional ref to attach to the underlying div. */
  innerRef?: Ref<HTMLDivElement>;
};

export function Card({
  children,
  flush,
  primary,
  innerRef,
  className = "",
  ...rest
}: Props) {
  const cls =
    "bg-white rounded-2xl shadow-sm " +
    (primary ? "border-2 border-brand-100 " : "border border-slate-200 ") +
    (flush ? "" : "p-5 ") +
    className;
  return (
    <div {...rest} ref={innerRef} className={cls.trim()}>
      {children}
    </div>
  );
}
