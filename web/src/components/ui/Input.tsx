import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={
        "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 " +
        "placeholder:text-slate-400 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 " +
        "disabled:bg-slate-50 disabled:cursor-not-allowed transition " +
        className
      }
    />
  );
});
