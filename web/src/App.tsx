import { useEffect, useState, type ReactNode } from "react";
import { AuthGate } from "./auth/AuthGate";
import { OrgProvider } from "./lib/OrgContext";
import { ToastProvider } from "./lib/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { FieldsDesigner } from "./pages/FieldsDesigner";
import { StageDesigner } from "./pages/StageDesigner";
import { StudiesList } from "./pages/StudiesList";
import { TeamBuilder } from "./pages/TeamBuilder";
import { AccessRoles } from "./pages/AccessRoles";
import { StudyDetail } from "./pages/StudyDetail";
import { PipelineView } from "./pages/PipelineView";
import { OrgSettings } from "./pages/OrgSettings";
import { Profile } from "./pages/Profile";
import { Members } from "./pages/Members";
import { NavDesigner } from "./pages/NavDesigner";
import { PageLayoutDesigner } from "./pages/PageLayoutDesigner";
import { Inbox } from "./pages/Inbox";
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
    return { node: <TeamBuilder /> };
  }
  if (hash === "#/settings/access") {
    return { node: <AccessRoles /> };
  }

  // Workspace stubs
  if (hash.startsWith("#/studies/")) {
    const id = hash.slice("#/studies/".length).trim();
    if (id) return { node: <StudyDetail studyId={id} onBack={() => navigate("#/studies")} /> };
  }
  if (hash === "#/studies") {
    return { node: <StudiesList onNavigate={navigate} /> };
  }
  if (hash === "#/pipeline") {
    return { node: <PipelineView onNavigate={navigate} /> };
  }
  if (hash === "#/inbox") {
    return { node: <Inbox onNavigate={navigate} /> };
  }

  // Configure: org
  if (hash === "#/settings/org") {
    return { node: <OrgSettings /> };
  }

  // Configure: members
  if (hash === "#/settings/members") {
    return { node: <Members /> };
  }

  // Configure: nav designer
  if (hash === "#/settings/nav") {
    return { node: <NavDesigner /> };
  }

  // Configure: page layout designer
  if (hash === "#/settings/pages") {
    return { node: <PageLayoutDesigner /> };
  }

  // You: profile
  if (hash === "#/profile") {
    return { node: <Profile /> };
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
