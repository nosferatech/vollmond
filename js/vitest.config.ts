import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      // A package's `source` export condition gives its sources, so that the tests of one package run against another's
      // sources rather than its build, and `npm test` needs no build. Tests run in Vite's server environment, whose
      // conditions these are; the others are Vite's defaults for it.
      conditions: ["source", "module", "node", "development|production"],
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
  },
});
