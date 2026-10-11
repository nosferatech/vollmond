import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The `suite.json` of a temporary suite unless a test gives another. */
export const SUITE_JSON = '{ "version": "0.6.0-dev", "case_format": 1 }';

/** A declaration that claims the Read profile and skips nothing. */
export const DECLARATION = '{ "name": "test", "version": "0.0.0", "profiles": ["read"], "skip": [] }';

/**
 * Writes a suite into a new temporary directory and returns its path. `files` maps paths relative to the suite to contents,
 * text being written as UTF-8. `suite.json` and `declaration.json` are added unless `files` gives them, and `null` leaves one
 * out.
 */
export async function makeSuite(files: Readonly<Record<string, string | Uint8Array | null>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vmd-conformance-"));
  const all = { "suite.json": SUITE_JSON, "declaration.json": DECLARATION, ...files };
  for (const [path, content] of Object.entries(all)) {
    if (content === null) {
      continue;
    }
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  return directory;
}

/** Returns the text of a case file holding `cases`, with `defaults` when given. */
export function caseFile(cases: readonly object[], defaults?: object): string {
  return JSON.stringify(defaults === undefined ? { cases } : { defaults, cases }, null, 2);
}

/** Returns a `compare` case with the given id, comparing `a` and `b` and expecting `result`. */
export function compareCase(id: string, a: unknown, b: unknown, result: boolean): object {
  return {
    id,
    description: "A comparison.",
    spec: ["5.8"],
    profiles: [],
    operation: "compare",
    input: { a, b },
    expect: { result },
  };
}

/** Returns a case of `operation` reading `record` in the store `store`, with the members of `extra` added or replaced. */
export function storeCase(id: string, operation: string, extra: object = {}): object {
  return {
    id,
    description: "A case over a store.",
    spec: ["5.3"],
    profiles: ["read"],
    operation,
    input: { store: "store", record: "a.md" },
    expect: { result: { title: "A" } },
    ...extra,
  };
}

/** The files of a fixture store at `path` with one record `a.md`. */
export function storeFiles(path: string, record = "# A\n"): Record<string, string> {
  return { [`${path}/.vmd/config.yaml`]: "vmd: 1\n", [`${path}/a.md`]: record };
}
