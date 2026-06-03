import { useEffect, useState } from "react";
import { Icon } from "./ui/Icon";

/** HelpOverlay — global modal listing keyboard shortcuts.
 *  Trigger: '?' key (when not in input). Esc dismisses.
 */
export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // '?' = shift + / on most layouts
      if (e.key === "?" && !inInput(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
        aria-modal="true"
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
              Reference
            </div>
            <h2 className="text-lg font-display font-bold text-slate-900">
              Keyboard shortcuts
            </h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-slate-400 hover:text-slate-900 transition"
            title="Close (Esc)"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <Section title="Global">
            <Shortcut keys={["⌘", "K"]} alt={["Ctrl", "K"]} label="Open universal search" />
            <Shortcut keys={["/"]} label="Open universal search (from anywhere)" />
            <Shortcut keys={["?"]} label="Toggle this shortcuts overlay" />
            <Shortcut keys={["Esc"]} label="Close the current modal / palette" />
          </Section>
          <Section title="Universal search">
            <Shortcut keys={["↑", "↓"]} label="Move selection" />
            <Shortcut keys={["↵"]} label="Open the selected result" />
          </Section>
          <Section title="Designers (Nav & Page Layouts)">
            <Shortcut keys={["Space"]} label="Pick up a draggable item (keyboard sensor)" />
            <Shortcut keys={["↑", "↓"]} label="Move the picked item" />
            <Shortcut keys={["Space"]} label="Drop the item at its new position" />
          </Section>
          <Section title="Pipeline kanban">
            <Shortcut keys={["Click+drag"]} label="Move a study card across stage columns (admin)" />
            <Shortcut keys={["Click"]} label="Open the study detail page" />
          </Section>
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600 leading-relaxed">
            <strong>Tip:</strong> shortcuts are suppressed while you're focused in any input,
            textarea, or select so typing doesn't trigger them.
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Shortcut({
  keys,
  alt,
  label,
}: {
  keys: string[];
  alt?: string[];
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-700">{label}</span>
      <div className="flex items-center gap-1">
        {alt && (
          <>
            <span className="flex items-center gap-0.5">
              {alt.map((k) => (
                <kbd key={k} className="text-[10px] font-mono border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
                  {k}
                </kbd>
              ))}
            </span>
            <span className="text-[10px] font-mono text-slate-400">or</span>
          </>
        )}
        <span className="flex items-center gap-0.5">
          {keys.map((k) => (
            <kbd key={k} className="text-[10px] font-mono border border-slate-200 bg-slate-50 rounded px-1.5 py-0.5">
              {k}
            </kbd>
          ))}
        </span>
      </div>
    </div>
  );
}

function inInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable
  );
}
