import { describe, expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import type { Issue } from "../issue/issue.js";
import { applySeverities, isDeclaredDuplicate, type SeverityConfiguration } from "../issue/severity.js";
import type { ParsedRecord } from "../record/record.js";
import { type CollectionSchema, spineOf } from "../schema/collection-schema.js";
import { record, usable } from "../schema/schema.testkit.js";
import { bindRecord } from "./binding.js";

/** A Markdown record that must parse. */
function markdown(text: string, path = "r.md"): ParsedRecord {
  const parsed = parseRecord(path, new TextEncoder().encode(text));
  if (!parsed.ok) expect.fail(`expected the record to parse, got ${JSON.stringify(parsed.issues)}`);
  return parsed.value;
}

/** The code and node of each issue. */
const shown = (issues: readonly Issue[]) => issues.map((issue) => `${issue.code} ${issue.at}`);

/** A configuration with the defaults, under the uniqueness mode given. */
const mode = (uniqueness: "strict" | "lenient"): SeverityConfiguration => ({
  uniqueness,
  yamlQuoting: "compatible",
  issues: new Map(),
});

const benchmarks = (list: Record<string, unknown>, items: Record<string, unknown> = {}) => ({
  properties: { benchmarks: { type: "array", items, "x-vmd-list": list } },
});

describe("a keyed list keyed by a member", () => {
  test("keys each item by its key member's string value, and gives the list's type", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["name"] }));
    const binding = bindRecord(record('{"benchmarks": [{"name": "append-4k"}, {"name": "read-4k"}]}'), schema);
    const list = binding.lists.get("/benchmarks");
    expect(list?.type).toBe("map");
    expect([list?.keyOf(0), list?.keyOf(1)]).toEqual(["append-4k", "read-4k"]);
    expect(list?.indexesOf("read-4k")).toEqual([1]);
    expect(list?.indexesOf("other")).toEqual([]);
    expect(binding.issues).toEqual([]);
  });

  test("a key member given as a JSON Pointer names the member by its exact name", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["/@key"] }));
    const binding = bindRecord(record('{"benchmarks": [{"@key": "a"}]}'), schema);
    expect(binding.lists.get("/benchmarks")?.keyOf(0)).toBe("a");
  });

  test("an item without its key member, or whose key is not a string, has no key and a schema-violation", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["name"] }));
    const binding = bindRecord(
      record('{"benchmarks": [{"name": "a"}, {"other": 1}, {"name": 7}, "plain", {"name": "b"}]}'),
      schema,
    );
    const list = binding.lists.get("/benchmarks");
    expect([0, 1, 2, 3, 4].map((index) => list?.keyOf(index))).toEqual(["a", null, null, null, "b"]);
    expect(shown(binding.issues)).toEqual([
      "schema-violation /benchmarks/1",
      "schema-violation /benchmarks/2",
      "schema-violation /benchmarks/3",
    ]);
    expect(binding.issues[0]?.message).toContain('has no key member "name"');
    expect(binding.issues[1]?.message).toContain('its key member "name" is not a string');
  });

  test("a key repeated under type: map is a duplicate-key at each item after the first, declared; under multimap, nothing", async () => {
    const text = '{"benchmarks": [{"name": "a"}, {"name": "b"}, {"name": "a"}, {"name": "a"}]}';
    const map = bindRecord(record(text), await usable(benchmarks({ type: "map", keys: ["name"] })));
    expect(shown(map.issues)).toEqual(["duplicate-key /benchmarks/2", "duplicate-key /benchmarks/3"]);
    expect(map.issues[0]?.message).toContain("/benchmarks/0");
    expect(map.issues.every(isDeclaredDuplicate)).toBe(true);
    expect(shown(applySeverities(map.issues, mode("lenient"))).length).toBe(2);
    expect(applySeverities(map.issues, mode("lenient")).every((issue) => issue.severity === "error")).toBe(true);
    const multimap = bindRecord(record(text), await usable(benchmarks({ type: "multimap", keys: ["name"] })));
    expect(multimap.issues).toEqual([]);
    expect(multimap.lists.get("/benchmarks")?.indexesOf("a")).toEqual([0, 2, 3]);
  });

  test("an item matches the per-key schema of its key, merged with what items requires into one issue", async () => {
    const schema = await usable({
      ...benchmarks(
        { type: "map", keys: ["name"], items: { a: { required: ["p99_us"] }, b: { $ref: "#/$defs/fast" } } },
        { properties: { p99_us: { type: "number" } } },
      ),
      $defs: { fast: { properties: { p99_us: { maximum: 100 } } } },
    });
    const text = '{"benchmarks": [{"name": "a", "p99_us": "x"}, {"name": "a2"}, {"name": "b", "p99_us": 900}]}';
    const issues = bindRecord(record(text), schema).issues;
    expect(shown(issues)).toEqual(["schema-violation /benchmarks/0/p99_us", "schema-violation /benchmarks/2/p99_us"]);
    const near = bindRecord(record('{"benchmarks": [{"name": "a", "p99_us": 1}, {"name": "b", "p99_us": 9}]}'), schema);
    expect(near.issues).toEqual([]);
    // A failure of the per-key schema and one of items, at one value, are one issue.
    const both = await usable(
      benchmarks({ type: "map", keys: ["name"], items: { a: { required: ["x"] } } }, { required: ["y"] }),
    );
    const merged = bindRecord(record('{"benchmarks": [{"name": "a"}]}'), both).issues;
    expect(shown(merged)).toEqual(["schema-violation /benchmarks/0"]);
    expect(merged[0]?.message).toContain("y");
    expect(merged[0]?.message).toContain("x");
  });

  test("a required key without an item is a schema-violation at the list", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["name"], required: ["a", "b"] }));
    const issues = bindRecord(record('{"benchmarks": [{"name": "a"}]}'), schema).issues;
    expect(shown(issues)).toEqual(["schema-violation /benchmarks"]);
    expect(issues[0]?.message).toContain('"b"');
    expect(bindRecord(record('{"benchmarks": [{"name": "b"}, {"name": "a"}]}'), schema).issues).toEqual([]);
    // A list that is not there requires nothing, as the standard compilation's contains would not apply either.
    expect(bindRecord(record("{}"), schema).issues).toEqual([]);
  });

  test("additional: false refuses an item with a key items does not name; a schema applies to such items", async () => {
    const closed = await usable(benchmarks({ type: "map", keys: ["name"], items: { a: true }, additional: false }));
    expect(shown(bindRecord(record('{"benchmarks": [{"name": "a"}, {"name": "z"}]}'), closed).issues)).toEqual([
      "schema-violation /benchmarks/1",
    ]);
    expect(bindRecord(record('{"benchmarks": [{"name": "a"}]}'), closed).issues).toEqual([]);
    const other = await usable(
      benchmarks({ type: "map", keys: ["name"], items: { a: true }, additional: { required: ["note"] } }),
    );
    expect(shown(bindRecord(record('{"benchmarks": [{"name": "a"}, {"name": "z"}]}'), other).issues)).toEqual([
      "schema-violation /benchmarks/1",
    ]);
    expect(bindRecord(record('{"benchmarks": [{"name": "z", "note": 1}]}'), other).issues).toEqual([]);
  });

  test("an array without x-vmd-list is no keyed list", async () => {
    const schema = await usable({ properties: { links: { type: "array" } } });
    const binding = bindRecord(record('{"links": [{"name": "a"}, {"name": "a"}]}'), schema);
    expect(binding.lists.has("/links")).toBe(false);
    expect(binding.issues).toEqual([]);
  });

  test("a keyed list below an item of another one is keyed too, through the outer list's items", async () => {
    const schema = await usable(
      benchmarks(
        { type: "map", keys: ["name"] },
        { properties: { runs: { type: "array", "x-vmd-list": { type: "multimap", keys: ["id"] } } } },
      ),
    );
    const binding = bindRecord(record('{"benchmarks": [{"name": "a", "runs": [{"id": "r1"}, {"id": "r1"}]}]}'), schema);
    expect(binding.lists.get("/benchmarks/0/runs")?.type).toBe("multimap");
    expect(binding.issues).toEqual([]);
    expect(binding.shape("/benchmarks/0/runs")?.multimap).toBe(true);
  });

  // Predicted bug (design, testing): two patterns that bring unequal declarations to one member give that member a
  // schema-violation, and leave the array unkeyed.
  test("two patterns bringing unequal declarations to a member give it a schema-violation, and no keyed list", async () => {
    const schema = await usable({
      patternProperties: {
        "^l": { type: "array", "x-vmd-list": { type: "map", keys: ["k"] } },
        ts$: { type: "array", "x-vmd-list": { type: "multimap", keys: ["k"] } },
      },
    });
    const binding = bindRecord(record('{"lists": [{"k": "a"}, {"k": "a"}], "left": [{"k": "a"}, {"k": "a"}]}'), schema);
    expect(shown(binding.issues)).toEqual(["schema-violation /lists", "duplicate-key /left/1"]);
    expect(binding.issues[0]?.message).toContain("^l");
    expect(binding.issues[0]?.message).toContain("ts$");
    expect(binding.lists.has("/lists")).toBe(false);
    expect(binding.lists.get("/left")?.type).toBe("map");
  });
});

describe("the sections of a record", () => {
  const sectionsOf = (list: Record<string, unknown>) => ({
    properties: { $sections: { type: "array", items: { properties: { $sections: { "x-vmd-list": list } } } } },
  });
  const log = "# Week\n\n## Log\n\n### Entry\n\nMonday.\n\n### Entry\n\nTuesday.\n\n## Summary\n\nQuiet.\n";

  test("every $sections is a keyed list by the section keys, undeclared without a schema", () => {
    const binding = bindRecord(markdown(log), null);
    expect(binding.lists.get("/$sections")?.type).toBe("undeclared");
    expect(binding.lists.get("/$sections")?.keyOf(1)).toBe("summary");
    expect(binding.lists.get("/$sections/0/$sections")?.indexesOf("entry")).toEqual([0, 1]);
    // The parse's duplicate stays as it is, an error under strict uniqueness and a warning under lenient.
    expect(shown(binding.issues)).toEqual(["duplicate-key /$sections/0/$sections/1"]);
    expect(isDeclaredDuplicate(binding.issues[0] as Issue)).toBe(false);
    expect(binding.shape("/$sections/0")).toBeNull();
  });

  test("a repeated section key at a level declared multimap is allowed, and at a level declared map stays an error", async () => {
    const multimap = bindRecord(markdown(log), await usable(sectionsOf({ type: "multimap", keys: ["@key"] })));
    expect(multimap.lists.get("/$sections/0/$sections")?.type).toBe("multimap");
    expect(multimap.issues).toEqual([]);
    const map = bindRecord(markdown(log), await usable(sectionsOf({ type: "map", keys: ["@key"] })));
    expect(shown(map.issues)).toEqual(["duplicate-key /$sections/0/$sections/1"]);
    expect(isDeclaredDuplicate(map.issues[0] as Issue)).toBe(true);
    expect(applySeverities(map.issues, mode("lenient"))[0]?.severity).toBe("error");
  });

  test("a field and a section that share a name stay a duplicate by the store's default, at a multimap level too", async () => {
    const schema = await usable(sectionsOf({ type: "multimap", keys: ["@key"] }));
    // The field comes first in the file, so each Entry repeats it; the second Entry also repeats the first, which is allowed.
    const text = JSON.stringify({
      $title: "W",
      $sections: [{ $title: "Log", entry: 1, $sections: [{ $title: "Entry" }, { $title: "Entry" }] }],
    });
    const binding = bindRecord(record(text), schema);
    expect(shown(binding.issues)).toEqual(["duplicate-key /$sections/0/$sections/0", "duplicate-key /$sections/0/$sections/1"]);
    expect(binding.issues.some(isDeclaredDuplicate)).toBe(false);
    // With the field after the sections, the field is the repeat, and the second Entry's repeat of the first is allowed.
    const after = JSON.stringify({
      $title: "W",
      $sections: [{ $title: "Log", $sections: [{ $title: "Entry" }, { $title: "Entry" }], entry: 1 }],
    });
    expect(shown(bindRecord(record(after), schema).issues)).toEqual(["duplicate-key /$sections/0/entry"]);
  });

  test("sections are checked against the per-key schemas, required keys and additional of their level", async () => {
    const schema = await usable({
      properties: {
        $sections: {
          type: "array",
          "x-vmd-list": {
            type: "map",
            keys: ["@key"],
            required: ["summary", "risks"],
            items: { log: { required: ["$sections"] }, summary: true, risks: true },
            additional: false,
          },
        },
      },
    });
    const issues = bindRecord(markdown("# Week\n\n## Log\n\nNone.\n\n## Summary\n\nQuiet.\n\n## Extra\n\nX.\n"), schema).issues;
    expect(shown(issues)).toEqual([
      "schema-violation /$sections/0",
      "schema-violation /$sections/2",
      "schema-violation /$sections",
    ]);
    expect(issues[2]?.message).toContain('"risks"');
  });
});

// Counts, not times: the timeout only leaves room for a loaded machine.
describe("the cost of a long list", { timeout: 120_000 }, () => {
  test("100,000 items with unique keys bind with a few shape steps and no issue", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["name"], items: { k7: { required: ["v"] } } }));
    const items = Array.from({ length: 100_000 }, (_, index) => ({ name: `k${index}`, v: index }));
    const before = stepsOf(schema);
    const binding = bindRecord(record(JSON.stringify({ benchmarks: items })), schema);
    expect(binding.issues).toEqual([]);
    // The root's step to benchmarks, an item by the key items names and one by any other key, and each one's name and v.
    expect(stepsOf(schema) - before).toBe(7);
    expect(binding.lists.get("/benchmarks")?.indexesOf("k99999")).toEqual([99_999]);
  });

  test("100,000 items with one key repeated give 99,999 duplicate-key issues", async () => {
    const schema = await usable(benchmarks({ type: "map", keys: ["name"] }));
    const items = Array.from({ length: 100_000 }, () => ({ name: "same" }));
    const binding = bindRecord(record(JSON.stringify({ benchmarks: items })), schema);
    expect(binding.issues.length).toBe(99_999);
    expect(binding.issues.at(-1)?.at).toBe("/benchmarks/99999");
  });
});

/** How many shape steps the schema's spine has computed so far. */
function stepsOf(schema: CollectionSchema): number {
  return spineOf(schema)?.stepsComputed ?? Number.NaN;
}
