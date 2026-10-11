import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests of one package import another's sources rather than its build, so that `npm test` needs no build.
    alias: { "@vollmond/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
