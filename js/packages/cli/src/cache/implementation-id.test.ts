// The implementation id: the build's, written by the build script, and the runtime's Unicode version with it.

import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { temporaryDirectory } from "../directories.testkit.js";
import { implementationIdOf } from "./implementation-id.js";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "core", "scripts", "write-implementation-id.mjs");

/** Lays out a workspace with core's sources, runs the build script in it, and gives the id it wrote. */
async function idOf(files: Readonly<Record<string, string>>): Promise<string> {
  const workspace = temporaryDirectory();
  const scripts = join(workspace, "packages", "core", "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(SCRIPT, join(scripts, "write-implementation-id.mjs"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), content);
  }
  await promisify(execFile)(process.execPath, [join(scripts, "write-implementation-id.mjs")]);
  return JSON.parse(readFileSync(join(workspace, "packages", "core", "dist", "implementation-id.json"), "utf8")).id;
}

const BASE = {
  "packages/core/src/a.ts": "export const a = 1;\n",
  "packages/core/src/format/b.ts": "export const b = 2;\n",
  "packages/core/package.json": '{"dependencies": {"micromark": "4.0.3"}}\n',
  "package-lock.json": '{"lockfileVersion": 3}\n',
};

describe("the build's implementation id", () => {
  test("is the same for the same sources, and changes with a source, a dependency or the lock file", async () => {
    const id = await idOf(BASE);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await idOf(BASE)).toBe(id);
    expect(await idOf({ ...BASE, "packages/core/src/format/b.ts": "export const b = 3;\n" })).not.toBe(id);
    expect(await idOf({ ...BASE, "packages/core/src/c.ts": "" })).not.toBe(id);
    expect(await idOf({ ...BASE, "packages/core/package.json": '{"dependencies": {"micromark": "4.0.4"}}\n' })).not.toBe(id);
    expect(await idOf({ ...BASE, "package-lock.json": '{"lockfileVersion": 4}\n' })).not.toBe(id);
  });

  test("with the runtime's Unicode version makes the cache's id, which differs between Unicode versions", () => {
    const build = "a".repeat(64);
    expect(implementationIdOf(build, "17.0")).toBe(implementationIdOf(build, "17.0"));
    expect(implementationIdOf(build, "17.0")).not.toBe(implementationIdOf(build, "16.0"));
    expect(implementationIdOf(build, "17.0")).not.toBe(implementationIdOf("b".repeat(64), "17.0"));
  });
});
