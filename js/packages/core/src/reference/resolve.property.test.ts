// Resolving through aliases does not depend on what was resolved before: each reference of a record, resolved by one resolver
// in the record's order, is resolved as a resolver that resolves that reference alone resolves it, which walks each alias
// chain once from its start, with nothing kept from earlier walks. The stores are small, so that chains, cycles, live names on
// and off them, directories, an asset (`p3`, which has no record extension) and old paths meet often, and the links are most
// of the store's in a random order, some twice.

import fc from "fast-check";
import { expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore } from "../store/store.js";
import type { Reference } from "./reference.js";

const PATHS = ["p0.md", "p1.md", "p2.md", "p3", "p4.md"];
const NAMES = ["a", "b", "c", "d"];
const at = "2026-10-09T08:00:00Z";

/** What is at a path: nothing, a directory, or a record with explicit anchors, a heading Y below some of them. */
const place = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ kind: "absent" as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: "directory" as const }) },
  {
    weight: 3,
    arbitrary: fc
      .subarray(NAMES)
      .chain((names) =>
        fc.tuple(fc.constant(names), fc.array(fc.boolean(), { minLength: names.length, maxLength: names.length })),
      )
      .map(([names, below]) => ({ kind: "record" as const, names, below })),
  },
);

// Aliases come in chains, each from one name to the next, so that chains and, where a name repeats, cycles are common.
const recordChain = fc
  .array(fc.constantFrom(...PATHS), { minLength: 2, maxLength: 7 })
  .map((paths) => paths.slice(1).map((to, n) => ({ kind: "record", from: `docs/${paths[n] as string}`, to: `docs/${to}`, at })));
const anchorChain = fc
  .tuple(fc.constantFrom(...PATHS), fc.array(fc.constantFrom(...NAMES), { minLength: 2, maxLength: 7 }))
  .map(([record, names]) =>
    names.slice(1).map((to, n) => ({ kind: "anchor", record: `docs/${record}`, from: names[n] as string, to, at })),
  );

/** A link from `docs/r.md`: a path, with no fragment, a name, or a name and the step `y`. */
const link = fc
  .tuple(fc.constantFrom(...PATHS), fc.constantFrom<string | null>(null, ...NAMES), fc.boolean())
  .map(([path, name, below]) => (name === null ? path : `${path}#${name}${below ? "/y" : ""}`));

/** Every link the universe has. */
const LINKS = PATHS.flatMap((path) => [path, ...NAMES.flatMap((name) => [`${path}#${name}`, `${path}#${name}/y`])]);

const store = fc.record({
  places: fc.array(place, { minLength: PATHS.length, maxLength: PATHS.length }),
  aliases: fc.array(fc.oneof(recordChain, anchorChain), { minLength: 1, maxLength: 7 }).map((chains) => chains.flat()),
  // Most links of the universe in a random order, then some again, so that walks meet what earlier walks kept.
  links: fc
    .tuple(fc.shuffledSubarray(LINKS, { minLength: 1 }), fc.array(link, { maxLength: 6 }))
    .map(([first, again]) => [...first, ...again]),
});

type Store = typeof store extends fc.Arbitrary<infer T> ? T : never;

/** The files of a store, with `docs/r.md` holding the links given. */
function filesOf(shape: Store, links: readonly string[]): Record<string, string> {
  const files: Record<string, string> = {
    ".vmd/config.yaml": "vmd: 1\n",
    ".vmd/aliases.jsonl": shape.aliases.map((alias) => `${JSON.stringify(alias)}\n`).join(""),
    "docs/r.md": `# R\n\n${links.map((target) => `[x](${target})`).join(" ")}\n`,
  };
  shape.places.forEach((where, index) => {
    const path = `docs/${PATHS[index] as string}`;
    if (where.kind === "directory") files[`${path}/inner.txt`] = "x";
    if (where.kind === "record") {
      const sections = where.names.map(
        (name, n) => `## Heading ${n} <a id="${name}"></a>\n\n${where.below[n] ? "### Y\n\n" : ""}`,
      );
      files[path] = `# Record ${index}\n\n${sections.join("")}`;
    }
  });
  return files;
}

/** The references of `docs/r.md` in a store of these files, as their status, targets and issue codes. */
async function referencesOf(files: Record<string, string>): Promise<string[]> {
  const opened = successValue(await openStore(createMemoryStorage({ files })));
  const references = successValue(await opened.references({ from: "docs/r.md" }));
  return references.map((reference: Reference) =>
    JSON.stringify([reference.status, reference.targets, reference.issues.map((issue) => issue.code)]),
  );
}

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

test("resolves each reference through the aliases as it is resolved alone, whatever was resolved before it", async () => {
  await fc.assert(
    fc.asyncProperty(store, async (shape) => {
      const together = await referencesOf(filesOf(shape, shape.links));
      const alone: string[] = [];
      for (const target of shape.links) alone.push(...(await referencesOf(filesOf(shape, [target]))));
      expect(together).toEqual(alone);
    }),
    { numRuns: 1500 },
  );
  // About 15 seconds alone, more under a parallel run.
}, 60_000);
