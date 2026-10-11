import { fileURLToPath } from "node:url";
import { parseRecord } from "@vollmond/core";
import { describe, expect, test } from "vitest";
import { loadCases, type SuiteCase } from "../cases.js";
import { isJsonObject } from "../json.js";
import { FixtureStores } from "../store.js";

const REAL_SUITE = fileURLToPath(new URL("../../../../../conformance/", import.meta.url));

// TODO(#14): delete this file when the runner performs `meta`, whose cases then hold the keys to the suite directly.
// The suite tests section keys through `meta`, whose `@address` needs canonical addresses, which this runner does not have yet.
// Each `meta` case's `@key` of every section it lists is compared here with the record's section keys, the root having none,
// so that the keys are held to the suite before the operation lands.
describe("the suite's meta cases, for the @key of each section", async () => {
  const loaded = await loadCases(REAL_SUITE);
  const metas = loaded.cases
    .filter((entry) => entry.ok)
    .map((entry) => entry.case as SuiteCase)
    .filter((suiteCase) => suiteCase.operation === "meta" && suiteCase.expect.result !== undefined);
  const stores = new FixtureStores(REAL_SUITE);

  test("the cases are found, the data/section-keys cases among them", () => {
    expect(metas.length).toBeGreaterThan(10);
    expect(metas.map((suiteCase) => suiteCase.id)).toEqual(
      expect.arrayContaining(["data/section-keys/data-title-slug-yaml", "data/section-keys/data-title-slug-json"]),
    );
  });

  test.each(metas.map((suiteCase) => [suiteCase.id, suiteCase] as const))("%s", async (_, suiteCase) => {
    const opened = await stores.open(suiteCase.directory, suiteCase.input.store, suiteCase.input.config);
    if (!opened.ok) throw new Error(opened.detail);
    const path = suiteCase.input.record as string;
    const outcome = parseRecord(path, opened.value.files.get(path) as Uint8Array);
    if (!outcome.ok) throw new Error(`${path} does not parse`);
    const record = outcome.value;
    const expected = suiteCase.expect.result;
    if (!isJsonObject(expected ?? null)) throw new Error("a meta result is an object");
    const wanted = Object.entries(expected as object).map(([at, fields]) => [at, (fields as Record<string, unknown>)["@key"]]);
    const got = record.nodes
      .sections()
      .map((section) => [section.at, section.at === "" ? null : record.sectionKeys.get(section.at)]);
    expect(got.sort()).toEqual(wanted.sort());
  });
});
