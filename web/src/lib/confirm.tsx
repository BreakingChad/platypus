import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";

/** Promise-based confirm dialog — a styled, on-brand replacement for the
 *  native window.confirm(). Call confirmDialog({...}) from anywhere (no hook
 *  rules); a single <ConfirmRoot/> mounted in App renders the modal and
 *  resolves the promise. Falls back to window.confirm if the root isn't
 *  mounted (e.g. in unit tests).
 */
export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Req = ConfirmOptions & { resolve: (v: boolean) => void };

let notify: ((r: Req | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!notify) {
      resolve(typeof window !== "undefined" ? window.confirm(opts.message) : false);
      return;
    }
    notify({ ...opts, resolve });
  });
}

export function ConfirmRoot() {
  const [req, setReq] = useState<Req | null>(null);

  useEffect(() => {
    notify = setReq;
    return () => {
      notify = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        req.resolve(false);
        setReq(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;

  const close = (v: boolean) => {
    req.resolve(v);
    setReq(null);
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={req.title ?? "Confirm"}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="p-5">
          <h2 className="text-lg font-display font-bold text-slate-900">
            {req.title ?? "Are you sure?"}
          </h2>
          <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{req.message}</p>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>
            {req.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            autoFocus
            variant={req.danger ? "danger" : "primary"}
            onClick={() => close(true)}
          >
            {req.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
