import { useEffect, useRef, useState } from "react";
import { useCurrentMember } from "../lib/useCurrentMember";
import { Icon } from "./ui/Icon";

/** Global Quick-add FAB. Bottom-right floating button. Click opens a small
 *  menu of context-aware shortcuts. Hotkey: `N` (when not inside an input).
 *
 *  This component doesn't own the modals — it dispatches custom DOM events
 *  that the relevant page components listen for:
 *    'platypus:new-study'    → StudiesList opens NewStudyModal
 *    'platypus:new-task'     → Inbox / current StudyDetail opens task composer
 *  Pages that don't listen still navigate to the right surface first.
 */
export function QuickAddFab({ onNavigate }: { onNavigate: (h: string) => void }) {
  const { isAdmin } = useCurrentMember();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click + Esc to close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Hotkey: 'n' to toggle (when not focused in input/textarea/select/contentEditable)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t as any).isContentEditable)) {
        return;
      }
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fireOrNavigate = (eventName: string, fallbackHash: string) => {
    setOpen(false);
    // Dispatch a custom event the destination page can pick up to open inline.
    window.dispatchEvent(new CustomEvent(eventName));
    // Navigate if we're not already on a page that handles the event natively.
    // Pages that listen also call preventDefault on the event; we always
    // navigate as a safe fallback after a small delay so a fresh listener
    // mounted by the navigation can pick it up.
    setTimeout(() => onNavigate(fallbackHash), 0);
  };

  return (
    <div className="fixed bottom-6 right-6 z-30" ref={ref}>
      {open && (
        <div className="absolute right-0 bottom-full mb-3 w-64 rounded-xl border border-slate-200 bg-white shadow-xl py-1.5 animate-[fadeIn_120ms_ease-out]">
          <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              Quick add
            </span>
            <kbd className="text-[10px] font-mono text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
              N
            </kbd>
          </div>
          <MenuItem
            icon="folder"
            label="New study"
            sub="Create a study from your configured fields"
            onClick={() => fireOrNavigate("platypus:new-study", "#/studies")}
            disabled={!isAdmin}
            disabledHint="Admin only"
          />
          <MenuItem
            icon="check"
            label="New task"
            sub="Add a task to your inbox"
            onClick={() => fireOrNavigate("platypus:new-task", "#/inbox")}
          />
          <MenuItem
            icon="users"
            label="Invite teammate"
            sub="Send a magic-link invite"
            onClick={() => {
              setOpen(false);
              onNavigate("#/settings/members");
            }}
            disabled={!isAdmin}
            disabledHint="Admin only"
          />
          <div className="border-t border-slate-100 my-1" />
          <MenuItem
            icon="search"
            label="Universal search"
            sub="Press ⌘K"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
            }}
          />
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Quick add (press N)"
        className={
          "w-14 h-14 rounded-full bg-brand-gradient text-white shadow-lg shadow-brand-500/40 hover:scale-105 active:scale-95 transition flex items-center justify-center " +
          (open ? "rotate-45" : "")
        }
      >
        <Icon name="plus" size={22} />
      </button>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  sub,
  onClick,
  disabled,
  disabledHint,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={
        "w-full text-left px-3 py-2 flex items-start gap-3 transition " +
        (disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-slate-50")
      }
    >
      <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
        <Icon name={icon} size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          {label}
          {disabled && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
              {disabledHint}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
    </button>
  );
}
