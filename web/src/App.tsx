import { AuthGate } from "./auth/AuthGate";
import { Welcome } from "./pages/Welcome";

export function App() {
  return (
    <AuthGate>
      <Welcome />
    </AuthGate>
  );
}
