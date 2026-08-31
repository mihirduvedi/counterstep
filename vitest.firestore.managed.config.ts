import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(
        import.meta.dirname,
        "./tests/helpers/serverOnly.ts",
      ),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/integration/firestoreCounterstepRepository.managed.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
