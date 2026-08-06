import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Auth requires an explicit opt-in for the shared in-memory demo tenant.
    // Production ignores this flag; tests exercise the demo path without Supabase.
    env: { QROUTER_DEMO_MODE: "true" },
  },
});
