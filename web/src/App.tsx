import { useEffect, useState } from "react";
import { AuthGate } from "./auth/AuthGate";
import { OrgProvider } from "./lib/OrgContext";
import { Welcome } from "./pages/Welcome";
import { FieldsDesigner } from "./pages/FieldsDesigner";

/** Simple hash-based router. No dep on react-router yet; we'll add one in a
 *  later phase when routes multiply. For now: #/settings/fields or empty. */
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = (next: string) => {
    window.location.hash = next;
  };
  return { hash, navigate };
}

export function App() {
  const { hash, navigate } = useHashRoute();

  return (
    <OrgProvider>
      <AuthGate>
        {hash === "#/settings/fields" ? (
          <FieldsDesigner onBack={() => navigate("")} />
        ) : (
          <Welcome onNavigate={navigate} />
        )}
      </AuthGate>
    </OrgProvider>
  );
}
