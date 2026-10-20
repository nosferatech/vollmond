// Property: the local index changes nothing a check, or a listing of every reference, reports, and a check over it parses only what changed. Over a generated
// store and a random sequence of edits, additions, removals, renames, schema edits, configuration edits and alias edits, a
// check with the index reports exactly what a check without it reports, and parses exactly the records whose bytes it has not
// seen, or whose binding to a changed schema it has not seen. The oracle of the first part is the check without the index; the
// second is a model of what the index holds, kept beside the store.

import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";
import { parseRecord as libraryParseRecord } from "../format/parse-record.js";
import { createMemoryIndexCache, type IndexCache } from "../index/cache.js";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";
import { gitBlobId } from "../value/digest.js";

vi.mock("../format/parse-record.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../format/parse-record.js")>();
  return { ...original, parseRecord: vi.fn(original.parseRecord) };
});
const parseRecord = vi.mocked(libraryParseRecord);

const NAMES = ["a", "b", "c", "d"] as const;
const FRAGMENTS = ["", "#intro", "#details", "#nothing", "#steps/build", "#steps/test"] as const;

/** The schemas the collection of runs may have; the last cannot be used. */
const SCHEMAS = [
  {
    properties: {
      see: { type: "string", format: "uri-reference", "x-vmd-ref": {} },
      steps: { type: "array", "x-vmd-list": { type: "map", keys: ["name"] } },
    },
  },
  {
    required: ["see"],
    properties: {
      see: { type: "string", format: "uri-reference", "x-vmd-ref": { targets: ["d/**"], anchors: "explicit" } },
      steps: { type: "array", "x-vmd-list": { type: "multimap", keys: ["name"] } },
    },
  },
  { type: 5 },
] as const;

/** The members a configuration may add after its collection. */
const SETTINGS = [
  "",
  "issues:\n  ref-derived-anchor: off\n",
  "uniqueness: lenient\n",
  "issues:\n  ref-dangling: error\n  duplicate-key: warning\n",
] as const;

/** A store as the model holds it. */
interface State {
  readonly files: Readonly<Record<string, string>>;
  readonly schema: number;
  readonly settings: number;
  readonly aliases: readonly string[];
}

const target = fc.record({
  kind: fc.constantFrom("d", "r"),
  name: fc.constantFrom(...NAMES),
  fragment: fc.constantFrom(...FRAGMENTS),
});
type Target = typeof target extends fc.Arbitrary<infer T> ? T : never;

function href(from: "d" | "r", to: Target): string {
  const file = `${to.name}.${to.kind === "d" ? "md" : "json"}`;
  return `${from === to.kind ? "" : `../${to.kind}/`}${file}${to.fragment}`;
}

const documentText = fc
  .record({
    links: fc.array(target, { maxLength: 3 }),
    anchored: fc.boolean(),
    repeat: fc.boolean(),
  })
  .map(({ links, anchored, repeat }) =>
    [
      "# Document",
      "",
      links.map((to, i) => `[link ${i}](${href("d", to)})`).join(" "),
      "",
      anchored ? '## Intro <a id="intro"></a>' : "## Intro",
      "",
      "Text.",
      "",
      "## Details",
      "",
      repeat ? "## Details\n" : "",
    ].join("\n"),
  );

const runText = fc.oneof(
  fc.record({ see: fc.option(target, { nil: undefined }), repeat: fc.boolean() }).map(({ see, repeat }) =>
    JSON.stringify({
      ...(see === undefined ? {} : { see: href("r", see) }),
      steps: [{ name: "build" }, { name: repeat ? "build" : "test" }],
    }),
  ),
  fc.constant("{"),
);

const pathOf = fc.record({ kind: fc.constantFrom("d", "r"), name: fc.constantFrom(...NAMES) });

const operation = fc.oneof(
  fc.record({ op: fc.constant("write" as const), path: pathOf, document: documentText, run: runText }),
  fc.record({ op: fc.constant("remove" as const), path: pathOf }),
  fc.record({ op: fc.constant("rename" as const), from: pathOf, to: fc.constantFrom(...NAMES) }),
  fc.record({ op: fc.constant("schema" as const), schema: fc.integer({ min: 0, max: SCHEMAS.length - 1 }) }),
  fc.record({ op: fc.constant("settings" as const), settings: fc.integer({ min: 0, max: SETTINGS.length - 1 }) }),
  fc.record({ op: fc.constant("alias" as const), from: fc.constantFrom(...NAMES), to: fc.constantFrom(...NAMES) }),
);
type Operation = typeof operation extends fc.Arbitrary<infer T> ? T : never;

function filePath(path: { kind: string; name: string }): string {
  return `${path.kind}/${path.name}.${path.kind === "d" ? "md" : "json"}`;
}

function apply(state: State, change: Operation): State {
  const files = { ...state.files };
  switch (change.op) {
    case "write":
      files[filePath(change.path)] = change.path.kind === "d" ? change.document : change.run;
      return { ...state, files };
    case "remove":
      delete files[filePath(change.path)];
      return { ...state, files };
    case "rename": {
      const from = filePath(change.from);
      const content = files[from];
      if (content === undefined) return state;
      delete files[from];
      files[filePath({ kind: change.from.kind, name: change.to })] = content;
      return { ...state, files };
    }
    case "schema":
      return { ...state, schema: change.schema };
    case "settings":
      return { ...state, settings: change.settings };
    case "alias": {
      const line = JSON.stringify({
        kind: "record",
        from: `d/${change.from}-old.md`,
        to: `d/${change.to}.md`,
        at: "2026-10-09T08:00:00Z",
      });
      return { ...state, aliases: [...state.aliases, line] };
    }
  }
}

function storeFiles(state: State): Record<string, string> {
  return {
    ".vmd/config.yaml": `vmd: 1\ncollections:\n  runs:\n    match: ["r/*.json"]\n    schema: run.schema.json\n${SETTINGS[state.settings]}`,
    ".vmd/schema/run.schema.json": JSON.stringify(SCHEMAS[state.schema]),
    ...(state.aliases.length === 0 ? {} : { ".vmd/aliases.jsonl": `${state.aliases.join("\n")}\n` }),
    ...state.files,
  };
}

async function storeOf(state: State, index?: IndexCache): Promise<Store> {
  const opened: Outcome<Store> = await openStore(
    createMemoryStorage({ files: storeFiles(state) }),
    index === undefined ? {} : { index },
  );
  if (!opened.ok) expect.fail(JSON.stringify(opened.issues));
  return opened.value;
}

describe("a check over the local index", () => {
  // About 2 s alone; the bound leaves room for a loaded machine running every test file at once.
  test("reports what a check without it reports, and parses only the records it has not seen", { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operation, { minLength: 1, maxLength: 10 }), async (operations) => {
        const cache = createMemoryIndexCache();
        // What the index holds, as the model sees it: parses by version, and bindings by version and schema.
        const parses = new Set<string>();
        const bindings = new Set<string>();
        let state: State = {
          files: { "d/a.md": "# A\n\n## Intro\n", "r/a.json": '{"steps": []}' },
          schema: 0,
          settings: 0,
          aliases: [],
        };
        for (const change of [null, ...operations]) {
          if (change !== null) state = apply(state, change);
          const plain = await storeOf(state);
          const expected = await plain.check();
          const expectedReferences = await plain.references();
          const expectedParses = new Set<string>();
          const versions = new Map<string, string>();
          for (const [path, content] of Object.entries(state.files)) {
            const version = await gitBlobId(new TextEncoder().encode(content));
            versions.set(path, version);
            const readable = content !== "{";
            const bound = path.startsWith("r/") && readable && state.schema !== SCHEMAS.length - 1;
            if (!parses.has(version) || (bound && !bindings.has(`${version} ${state.schema}`))) expectedParses.add(path);
          }
          parseRecord.mockClear();
          const indexed = await storeOf(state, cache);
          const outcome = await indexed.check();
          // As text, so that the order of members counts too, as it does in the command line's JSON.
          expect(JSON.stringify(outcome)).toBe(JSON.stringify(expected));
          const parsed = parseRecord.mock.calls.map(([path]) => path);
          expect(parsed.length).toBe(new Set(parsed).size);
          expect(new Set(parsed)).toEqual(expectedParses);
          // Every reference, resolved over the entries the check left, as a store without them resolves it.
          expect(JSON.stringify(await (await storeOf(state, cache)).references())).toBe(JSON.stringify(expectedReferences));
          for (const [path, version] of versions) {
            parses.add(version);
            const readable = state.files[path] !== "{";
            if (path.startsWith("r/") && readable && state.schema !== SCHEMAS.length - 1)
              bindings.add(`${version} ${state.schema}`);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
