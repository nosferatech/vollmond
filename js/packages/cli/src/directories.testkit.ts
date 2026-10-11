// Temporary directories for the CLI's tests, removed after them.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";

const created: string[] = [];

afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

/** Creates an empty temporary directory, removed after the tests, and returns its real path. */
export function temporaryDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vmd-cli-")));
  created.push(directory);
  return directory;
}

/** Writes files below `root`, by `/`-separated relative path, creating their directories, and returns `root`. */
export function writeFiles(root: string, files: Readonly<Record<string, string | Uint8Array>>): string {
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

/** Creates directories below `root`, by `/`-separated relative path, and returns the absolute path of the first. */
export function makeDirectories(root: string, ...paths: string[]): string {
  for (const path of paths) mkdirSync(join(root, ...path.split("/")), { recursive: true });
  return join(root, ...(paths[0] ?? "").split("/"));
}
