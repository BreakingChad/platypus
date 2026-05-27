import { useEffect, useState, type ReactNode } from "react";
import { AuthGate } from "./auth/AuthGate";
import { OrgProvider } from "./lib/OrgContext";
import { ToastProvider } from "./lib/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { FieldsDesigner } from "./pages/FieldsDesigner";
import { StageDesigner } from "./pages/StageDesigner";
import { ComingSoon } from "./pages/ComingSoon";

/** Simple hash-based router. We'll graduate to react-router when route count
 *  and nesting demand it; for now this keeps the bundle small and the model
 *  obvious. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (next: string) => {
    if (window.location.hash === next) return;
    window.location.hash = next;
  };
  return { hash, navigate };
}

type RouteContent = { node: ReactNode };

function renderRoute(
  hash: string,
  navigate: (h: string) => void
): RouteContent {
  // Home
  if (hash === "" || hash === "#" || hash === "#/") {
    return { node: <Home onNavigate={navigate} /> };
  }

  // Configure
  if (hash === "#/settings/fields") {
    return { node: <FieldsDesigner /> };
  }
  if (hash === "#/settings/stages") {
    return { node: <StageDesigner /> };
  }
  if (hash === "#/settings/teams") {
    return {
      node: (
        <ComingSoon
          kicker="Configure"
          title="Teams & roles"
          description="Build the teams that own the work. Role slots survive turnover; you swap holders, not workflows."
          iconName="users"
          onBackToHome={() => navigate("#/")}
        />
      ),
    };
  }
  if (hash === "#/settings/access") {
    return {
      node: (
        <ComingSoon
          kicker="Configure"
          title="Access roles"
          description="Who can see what. Module-level permissions, portfolio scope, function-level grants."
          iconName="shield"
          onBackToHome={() => navigate("#/")}
        />
      ),
    };
  }

  // Workspace stubs
  if (hash === "#/studies") {
    return {
      node: (
        <ComingSoon
          kicker="Workspace"
          title="Studies"
          description="Every study from intake through closeout, with the fields and lifecycle your team configured."
          iconName="folder"
          onBackToHome={() => navigate("#/")}
        />
      ),
    };
  }
  if (hash === "#/pipeline") {
    return {
      node: (
        <ComingSoon
          kicker="Workspace"
          title="Pipeline"
          description="Studies grouped by stage, owned by the team in front of them. Drag to advance, click into the work."
          iconName="layers"
          onBackToHome={() => navigate("#/")}
        />
      ),
    };
  }
  if (hash === "#/inbox") {
    return {
      node: (
        <ComingSoon
          kicker="Workspace"
          title="Inbox"
          description="Tasks routed to you, plus the send-for-action items waiting on your sign or acknowledge."
          iconName="inbox"
          onBackToHome={() => navigate("#/")}
        />
      ),
    };
  }

  // Unknown route — drop to home.
  return { node: <Home onNavigate={navigate} /> };
}

export function App() {
  const { hash, navigate } = useHashRoute();
  const route = renderRoute(hash, navigate);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <OrgProvider>
          <AuthGate>
            <AppShell currentHash={hash} onNavigate={navigate}>
              {route.node}
            </AppShell>
          </AuthGate>
        </OrgProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
