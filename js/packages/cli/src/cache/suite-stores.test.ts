// A second oracle for the local index: every store of the conformance suite, checked, listed and with every reference
// resolved without an index, and then over a memory index cold and warm, must give the same output, as JSON text, so that
// the order of members counts too. The suite's stores were written from the specification, not for the index.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryIndexCache, type IndexCache, openStore, type Store } from "@vollmond/core";
import { expect, test } from "vitest";
import { createFilesystemStorage } from "../backend/filesystem.js";

const CASES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "conformance", "cases");

/** The root of every store below the suite's cases: each directory that holds a `.vmd/`. */
function storeRoots(directory: string): string[] {
  const roots: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".vmd") roots.push(directory);
    else roots.push(...storeRoots(join(directory, entry.name)));
  }
  return roots;
}

/**
 * What a store gives that the index could change: a check, a listing, and every reference, as JSON text. The check's counts
 * of the records it parsed and read from the index are left out, since saying how the index served it is their purpose.
 */
async function outputOf(store: Store): Promise<string> {
  const shown = (value: unknown) => JSON.stringify(value, (_, item) => (item instanceof Map ? [...item] : item));
  const listed = await store.list({ limit: 1000 });
  const listing = listed.ok ? { items: listed.value.items, issues: listed.issues } : listed;
  const checked = await store.check();
  const check = checked.ok ? { ...checked, value: { ...checked.value, parsed: null, fromIndex: null } } : checked;
  return [shown(check), shown(listing), shown(await store.references())].join("\n");
}

async function opened(root: string, index?: IndexCache): Promise<Store | null> {
  const store = await openStore(createFilesystemStorage(root), index === undefined ? {} : { index });
  return store.ok ? store.value : null;
}

// About 10 s alone over the suite's 98 stores; the bound leaves room for a loaded machine.
test("every store of the conformance suite gives the same output over a cold and a warm index as without one", {
  timeout: 300_000,
}, async () => {
  const roots = storeRoots(CASES);
  expect(roots.length).toBeGreaterThan(50);
  let compared = 0;
  for (const root of roots) {
    const plain = await opened(root);
    if (plain === null) continue;
    compared += 1;
    const expected = await outputOf(plain);
    const cache = createMemoryIndexCache();
    for (const phase of ["cold", "warm"]) {
      const got = await outputOf((await opened(root, cache)) as Store);
      expect({ root, phase, got }).toEqual({ root, phase, got: expected });
    }
  }
  expect(compared).toBeGreaterThan(50);
});
