import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The packages build their tests into `dist`; only the TypeScript sources are run.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
