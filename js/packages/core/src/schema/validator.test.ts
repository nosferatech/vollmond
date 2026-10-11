import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { createMemoryStorage } from "../storage/memory.js";
import { openStore, type Store } from "../store/store.js";
import { load, usable, violationsAt } from "./schema.testkit.js";
import { MAX_REGISTERED_SETS, registeredSetCount } from "./validator.js";

const CONFIG = 'vmd: 1\ncollections:\n  things:\n    match: ["*.json"]\n    schema: s.json\n';

function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

async function storeWith(schema: string): Promise<Store> {
  const files = { ".vmd/config.yaml": CONFIG, ".vmd/schema/s.json": schema, "a.json": '{"n": "x"}' };
  return successValue(await openStore(createMemoryStorage({ files })));
}

describe("the validator's process-wide registry", () => {
  // Predicted bug: hyperjump throws "already registered" for a URI registered twice, as two opens of one store would.
  test("one store's configuration opened twice in a process checks the same both times", async () => {
    const schema = '{"properties": {"n": {"type": "number"}}}';
    for (let open = 0; open < 2; open++) {
      const checked = await (await storeWith(schema)).check();
      expect(checked.ok).toBe(true);
      expect(checked.issues.map((issue) => [issue.code, issue.at])).toEqual([["schema-violation", "/n"]]);
    }
  });

  test("a schema edited between two opens is the edited one the second time", async () => {
    const first = await (await storeWith('{"properties": {"n": {"type": "number"}}}')).check();
    expect(first.issues.map((issue) => issue.code)).toEqual(["schema-violation"]);
    const second = await (await storeWith('{"properties": {"n": {"type": "string"}}}')).check();
    expect(second.issues).toEqual([]);
  });

  test("the same bytes compiled for two collections of one set give each its own root", async () => {
    const files = {
      "a.json": '{"$ref": "b.json"}',
      "b.json": '{"type": "object", "properties": {"x": {"$ref": "a.json"}}, "required": ["y"]}',
    };
    const a = await load(files, "a.json");
    const b = await load(files, "b.json");
    if (!a.ok || !b.ok) expect.fail("both load");
    expect(a.value.digest).toBe(b.value.digest);
    expect(violationsAt(a.value, "{}")).toEqual([""]);
  });

  test("at most a bounded number of schema sets stay registered, and an evicted one still validates and loads again", async () => {
    const first = await usable({ properties: { evicted: { type: "number" } } });
    for (let index = 0; index <= MAX_REGISTERED_SETS; index++)
      await usable({ properties: { [`p${index}`]: { type: "number" } } });
    expect(registeredSetCount()).toBeLessThanOrEqual(MAX_REGISTERED_SETS);
    expect(violationsAt(first, '{"evicted": "x"}')).toEqual(["/evicted"]);
    const again = await usable({ properties: { evicted: { type: "number" } } });
    expect(violationsAt(again, '{"evicted": "x"}')).toEqual(["/evicted"]);
  });
});
