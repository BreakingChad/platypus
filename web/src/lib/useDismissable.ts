import { useEffect } from "react";

/** Close popovers/panels on outside-mousedown or Escape.
 *
 *  Pass a CSS selector that wraps BOTH the trigger and the panel — the
 *  convention is a data attribute on the popover root, e.g.
 *
 *    <div className="relative" data-site-scope>
 *      ...
 *    useDismissable("[data-site-scope]", () => setOpen(false), open);
 *
 *  Same pattern the header's gear and user menus use, shared.
 */
export function useDismissable(selector: string, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(selector)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [selector, onClose, active]);
}
