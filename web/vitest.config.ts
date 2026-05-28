import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    globals: false,
    reporters: "default",
    // Stub Supabase env so `supabase.ts` module init doesn't throw when
    // tests transitively import it. Tests never hit the network — they
    // only exercise the pure helpers.
    env: {
      VITE_SUPABASE_URL: "https://test.supabase.local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_test_publishable_local",
    },
  },
});
