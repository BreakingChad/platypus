import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { Icon } from "../components/ui/Icon";

type Kind = "success" | "error" | "info";
type Toast = { id: string; message: string; kind: Kind };

type Ctx = {
  show: (message: string, kind?: Kind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
};

const ToastContext = createContext<Ctx>({
  show: () => {}, success: () => {}, error: () => {}, info: () => {},
});

export function useToast() { return useContext(ToastContext); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const show = useCallback((message: string, kind: Kind = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    const tm = window.setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
    timers.current.set(id, tm);
  }, [dismiss]);

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  return (
    <ToastContext.Provider
      value={{
        show,
        success: (m) => show(m, "success"),
        error:   (m) => show(m, "error"),
        info:    (m) => show(m, "info"),
      }}
    >
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => <ToastCard key={t.id} t={t} onDismiss={() => onDismiss(t.id)} />)}
    </div>
  );
}

const KIND_STYLES: Record<Kind, { bg: string; border: string; icon: string; iconName: string }> = {
  success: { bg: "bg-emerald-50",  border: "border-emerald-200", icon: "text-emerald-600", iconName: "check" },
  error:   { bg: "bg-red-50",      border: "border-red-200",     icon: "text-red-600",     iconName: "alert" },
  info:    { bg: "bg-white",       border: "border-slate-200",   icon: "text-brand-500",   iconName: "info"  },
};

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const s = KIND_STYLES[t.kind];
  return (
    <div
      className={`flex items-start gap-2.5 px-3.5 py-3 rounded-xl border shadow-lg ${s.bg} ${s.border} animate-in fade-in slide-in-from-bottom-4`}
      role="status"
    >
      <Icon name={s.iconName} className={`w-4 h-4 mt-0.5 ${s.icon}`} />
      <div className="flex-1 text-sm text-slate-800 leading-snug">{t.message}</div>
      <button
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-700 leading-none ml-1"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
