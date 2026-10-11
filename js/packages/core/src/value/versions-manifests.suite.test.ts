// Reads the conformance suite from the repository, so it needs Node's `fs`, and is type checked by tsconfig.suite.json, away
// from core. Deviation from the I1 design, recorded in issue #10: a test of core that reads files, which the design keeps out
// of core's tests; the conformance runner's package, once it exists, is its place.
import { globSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { gitBlobId } from "./digest.js";

const conformance = new URL("../../../../../conformance/", import.meta.url);
const manifests = globSync("**/*.versions.json", { cwd: conformance }).sort();

describe("gitBlobId against the suite's versions manifests", () => {
  test("the manifests were found", () => {
    expect(manifests.length).toBeGreaterThan(5);
  });

  test.each(manifests)("%s", async (manifest) => {
    const store = new URL(`${manifest.slice(0, -".versions.json".length)}/`, conformance);
    const versions = JSON.parse(readFileSync(new URL(manifest, conformance), "utf8")) as Record<string, string>;
    const entries = Object.entries(versions);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, version] of entries) {
      expect({ path, version: await gitBlobId(readFileSync(new URL(path, store))) }).toEqual({ path, version });
    }
  });
});
