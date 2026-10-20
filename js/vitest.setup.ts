// Runs before every test file: points the per-user cache directory at a temporary directory of the test file's own, so that
// no test reads or writes the cache of the user who runs them, even through a default that resolves the real one.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const cache = mkdtempSync(join(tmpdir(), "vmd-test-cache-"));
process.env.XDG_CACHE_HOME = cache;
afterAll(() => rmSync(cache, { recursive: true, force: true }));
