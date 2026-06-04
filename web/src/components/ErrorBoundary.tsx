import { Component, type ReactNode } from "react";
import { Button } from "./ui/Button";
import { BrandMark } from "./ui/BrandMark";

type State = { error: Error | null };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#faf8f4] px-6">
          <div className="max-w-md w-full text-center">
            <div className="flex justify-center mb-6"><BrandMark size={48} /></div>
            <h1 className="text-2xl font-display font-extrabold tracking-tight text-slate-900 mb-2">
              Something broke.
            </h1>
            <p className="text-sm text-slate-600 mb-6 leading-relaxed">
              The app hit an unexpected error. Your data is safe in Supabase — this is a UI
              crash. Reload to recover.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left mb-6">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">
                Error
              </div>
              <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </div>
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
              Reload Platypus
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
