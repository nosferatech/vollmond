// The strict read mode: which records a strict store refuses to single-record reads and counts as unreadable in a listing, and
// the near misses it reads, each of which a best-effort store reads too.

import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type ReadMode, type Store } from "./store.js";

const config = (uniqueness: "strict" | "lenient") =>
  [
    "vmd: 1",
    `uniqueness: ${uniqueness}`,
    "collections:",
    "  runs:",
    '    match: ["runs/*.json"]',
    "    schema: run.schema.json",
    "  book:",
    '    match: ["book/*.md"]',
    "    schema: book.schema.json",
    "  tickets:",
    '    match: ["tickets/*.md"]',
    '    filename: "^[0-9]{4}-"',
    "  both:",
    '    match: ["runs/both.json"]',
    "",
  ].join("\n");

const RUN_SCHEMA = {
  properties: {
    started: { type: "string", format: "date" },
    benchmarks: {
      type: "array",
      "x-vmd-list": { type: "map", keys: ["name"], items: { "read-4k": { required: ["p99_us"] } } },
    },
    groups: { type: "array", "x-vmd-list": { type: "multimap", keys: ["name"] } },
  },
};
// The root's sections are a map: two child sections of the root with one key are a declared duplicate.
const BOOK_SCHEMA = { properties: { $sections: { "x-vmd-list": { type: "map", keys: ["@key"] } } } };

const files = (uniqueness: "strict" | "lenient") => ({
  ".vmd/config.yaml": config(uniqueness),
  ".vmd/schema/run.schema.json": JSON.stringify(RUN_SCHEMA),
  ".vmd/schema/book.schema.json": JSON.stringify(BOOK_SCHEMA),
  // Valid, with a repeat at a multimap level, which is allowed.
  "runs/ok.json": JSON.stringify({ started: "2026-10-19", groups: [{ name: "g" }, { name: "g" }] }),
  "runs/violation.json": JSON.stringify({ benchmarks: [{ name: "read-4k" }] }),
  "runs/bad-date.json": JSON.stringify({ started: "2026-13-01" }),
  "runs/dup.json": JSON.stringify({ benchmarks: [{ name: "a" }, { name: "a" }] }),
  // A schema violation beside a duplicate anchor, which does not refuse.
  "runs/mixed.json": JSON.stringify({ benchmarks: [{ name: "read-4k" }], tags: [{ $anchor: "x" }, { $anchor: "x" }] }),
  // Two collections claim it, so it is read without a schema, and its repeated key is not a declared one.
  "runs/both.json": JSON.stringify({ benchmarks: [{ name: "a" }, { name: "a" }] }),
  "book/twice.md": "# B\n\n## Part\n\nOne, after [cites](../cites.md).\n\n## Part\n\nTwo.\n",
  "book/once.md": "# B\n\n## Part\n\nOne.\n\n## Other\n\nTwo.\n",
  "tickets/0001-a.md": "# A\n",
  "tickets/a.md": "# A\n",
  // In no collection: an undeclared repeated section key, a duplicate anchor and a dangling link.
  "loose.md": "# L\n\n## Entry\n\nOne.\n\n## Entry\n\nTwo.\n",
  "anchors.json": JSON.stringify({ items: [{ $anchor: "x" }, { $anchor: "x" }] }),
  "links.md": "# L\n\nSee [x](missing.md#a).\n",
  // Links below the root of records a strict store refuses.
  "cites.md":
    "# C\n\n[v](runs/violation.json#benchmarks), [d](runs/bad-date.json#started) and [t](book/twice.md#/$sections/0).\n",
  "broken.json": "{",
});

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function store(
  readMode?: ReadMode,
  uniqueness: "strict" | "lenient" = "strict",
  extra: Readonly<Record<string, string>> = {},
): Promise<Store> {
  const options = readMode === undefined ? {} : { readMode };
  return successValue(await openStore(createMemoryStorage({ files: { ...files(uniqueness), ...extra } }), options));
}

/** A collection whose schema file is missing, so that its schema cannot be used, and a record of it. */
const UNUSABLE_SCHEMA = {
  ".vmd/config.yaml": `${config("strict")}  bad:\n    match: ["bad/*.md"]\n    schema: missing.schema.json\n`,
  "bad/x.md": "# X\n",
};

/** The code, record and node of each issue, with its severity. */
const shown = (outcome: Outcome<unknown>) =>
  outcome.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path} ${issue.at}`);

/** The records a strict store refuses, each with the issues a single-record read of it fails with. */
const REFUSED: Readonly<Record<string, readonly string[]>> = {
  "runs/violation.json": ["error schema-violation runs/violation.json /benchmarks/0"],
  "runs/bad-date.json": ["error schema-violation runs/bad-date.json /started"],
  "runs/dup.json": ["error duplicate-key runs/dup.json /benchmarks/1"],
  "runs/mixed.json": ["error schema-violation runs/mixed.json /benchmarks/0"],
  "book/twice.md": ["error duplicate-key book/twice.md /$sections/1"],
  "tickets/a.md": ["error filename-mismatch tickets/a.md "],
};

/** Records a strict store reads, though each is near a refused one or has an error that strict reading does not refuse. */
const READ = ["runs/ok.json", "runs/both.json", "book/once.md", "tickets/0001-a.md", "loose.md", "anchors.json", "links.md"];

describe("the strict read mode", () => {
  test("a store reads best-effort unless opened strict", async () => {
    expect((await store()).readMode).toBe("best-effort");
    expect((await store("best-effort")).readMode).toBe("best-effort");
    expect((await store("strict")).readMode).toBe("strict");
  });

  for (const uniqueness of ["strict", "lenient"] as const) {
    describe(`under ${uniqueness} uniqueness`, () => {
      test("get, outline, resolve and references from a node fail on a refused record with its refusing issues", async () => {
        const strict = await store("strict", uniqueness);
        for (const [path, issues] of Object.entries(REFUSED)) {
          expect(shown(await strict.get(path)), path).toEqual(issues);
          expect(shown(await strict.outline(path)), path).toEqual(issues);
          expect(shown(await strict.resolve(path, "singular")), path).toEqual(issues);
          expect(shown(await strict.resolve(`${path}#`, "selector")), path).toEqual(issues);
          expect(shown(await strict.references({ from: path })), path).toEqual(issues);
        }
      });

      test("the store's binding, which references share, binds a refused record in either mode", async () => {
        const strict = await store("strict", uniqueness);
        for (const path of Object.keys(REFUSED)) expect((await strict.binding(path))?.ok, path).toBe(true);
      });

      test("a best-effort store reads every record the strict one refuses", async () => {
        const lenient = await store("best-effort", uniqueness);
        for (const path of Object.keys(REFUSED)) {
          successValue(await lenient.get(path));
          successValue(await lenient.outline(path));
        }
      });

      test("a strict store reads the near misses: undeclared repeats, duplicate anchors, dangling links", async () => {
        const strict = await store("strict", uniqueness);
        for (const path of READ) {
          successValue(await strict.get(path));
          successValue(await strict.outline(path));
        }
        expect(successValue(await strict.get("runs/ok.json#/groups/1/name")).value).toBe("g");
      });
    });
  }

  test("a record with a structural error fails alike in either mode", async () => {
    const strict = shown(await (await store("strict")).get("broken.json"));
    expect(strict).toEqual(shown(await (await store("best-effort")).get("broken.json")));
    expect(strict).not.toEqual([]);
  });

  test("a link into a refused record has the status it has in a best-effort store", async () => {
    const statuses = async (readMode: ReadMode) =>
      successValue(await (await store(readMode)).references({ from: "cites.md" })).map((reference) => reference.status);
    expect(await statuses("best-effort")).toEqual(["ok", "ok", "ok"]);
    expect(await statuses("strict")).toEqual(["ok", "ok", "ok"]);
  });

  test("check reports the same issues in either mode", async () => {
    const strict = shown(await (await store("strict")).check());
    expect(strict).toEqual(shown(await (await store("best-effort")).check()));
    expect(strict).toContain("error schema-violation runs/violation.json /benchmarks/0");
  });

  test("references of every record leave out a refused record's, with its refusing issues as errors", async () => {
    const lenient = await store("best-effort");
    const all = await lenient.references();
    expect(shown(all)).toEqual([]);
    const strict = await (await store("strict")).references();
    const fromRefused = (reference: { readonly from: { readonly path: string } }) => reference.from.path in REFUSED;
    expect(successValue(all).some(fromRefused)).toBe(true);
    expect(successValue(strict)).toEqual(successValue(all).filter((reference) => !fromRefused(reference)));
    const broken = shown(await lenient.get("broken.json"));
    const byPath = Object.entries({ ...REFUSED, "broken.json": broken }).sort(([a], [b]) => (a < b ? -1 : 1));
    expect(shown(strict)).toEqual(byPath.flatMap(([, issues]) => issues));
  });

  test("references of every record fail in a strict store with a collection whose schema cannot be used", async () => {
    const strict = await (await store("strict", "strict", UNUSABLE_SCHEMA)).references();
    expect(strict.ok).toBe(false);
    expect(strict.issues.map((issue) => `${issue.code} ${issue.path}`)).toEqual(["schema-invalid null"]);
    const lenient = await (await store("best-effort", "strict", UNUSABLE_SCHEMA)).references();
    expect(lenient.ok).toBe(true);
    expect(shown(lenient)).toEqual([]);
  });

  test("a strict listing counts refused records as unreadable, without reporting their issues", async () => {
    const all = Object.keys(files("strict")).length;
    const strictPage = successValue(await (await store("strict")).list({ limit: all }));
    const lenientPage = successValue(await (await store("best-effort")).list({ limit: all }));
    // broken.json, which neither mode can read, and each refused record.
    expect(lenientPage.unreadable).toEqual({ count: 1, scope: "page" });
    expect(strictPage.unreadable).toEqual({ count: 1 + Object.keys(REFUSED).length, scope: "page" });
    const unreadable = strictPage.items.filter((item) => item.readable === false).map((item) => item.path);
    expect(unreadable.sort()).toEqual(["broken.json", ...Object.keys(REFUSED)].sort());
    expect(shown(await (await store("strict")).list({ limit: all }))).toEqual([]);
  });
});
