// Addresses through keyed lists: resolution by key, the proof that a singular address names one node, canonical addresses
// and `@key`.

import { describe, expect, test } from "vitest";
import { bindRecord, type RecordBinding } from "../binding/binding.js";
import { parseRecord } from "../format/parse-record.js";
import { computeFields } from "../meta/computed-fields.js";
import type { ParsedRecord } from "../record/record.js";
import { usable } from "../schema/schema.testkit.js";
import { parseAddress } from "./address.js";
import { canonicalAddress, resolveAddress, resolveAddressSteps } from "./resolve.js";

/** A record that must parse. */
function parsed(path: string, text: string): ParsedRecord {
  const outcome = parseRecord(path, new TextEncoder().encode(text));
  if (!outcome.ok) expect.fail(`expected the record to parse, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** A record bound to the schema given as a JSON value. */
async function bound(path: string, text: string, schema: unknown): Promise<RecordBinding> {
  return bindRecord(parsed(path, text), await usable(schema));
}

/** The fragment of an address in a record. */
function fragmentOf(address: string) {
  const read = parseAddress(`r.json${address}`);
  if (!read.ok) expect.fail(`malformed: ${address}`);
  return read.value.fragment;
}

/** The exact paths an address resolves to as a selector. */
function selected(subject: ParsedRecord | RecordBinding, address: string): string[] {
  const outcome = resolveAddress(subject, fragmentOf(address), "selector");
  if (!outcome.ok) expect.fail(`failed: ${JSON.stringify(outcome.issues)}`);
  return outcome.value.map((target) => target.at);
}

/** What an address resolves to as a singular address: the exact path and canonical address, or the failure's code. */
function singular(subject: ParsedRecord | RecordBinding, address: string): string {
  const outcome = resolveAddress(subject, fragmentOf(address), "singular");
  if (!outcome.ok) return outcome.issues.map((issue) => `${issue.code} ${issue.path} ${issue.at}`).join(", ");
  return outcome.value.map((target) => `${target.at} ${target.address}`).join(", ");
}

const RUN = JSON.stringify({
  host: "perf-box",
  benchmarks: [
    { name: "append-4k", p99_us: 120, runs: [{ id: "r1" }, { id: "r1" }] },
    { name: "read-4k", p99_us: 80 },
    { p99_us: 1 },
  ],
});

const keyedBy = (type: string, items: unknown = {}) => ({
  properties: { benchmarks: { type: "array", items, "x-vmd-list": { type, keys: ["name"] } } },
});

describe("a step into a keyed list", () => {
  test("matches the item whose key it is, and never an index; without the binding the same step matches nothing", async () => {
    const binding = await bound("r.json", RUN, keyedBy("map"));
    expect(singular(binding, "#benchmarks/append-4k/p99_us")).toBe("/benchmarks/0/p99_us #benchmarks/append-4k/p99_us");
    expect(singular(binding, "#benchmarks/read-4k")).toBe("/benchmarks/1 #benchmarks/read-4k");
    expect(selected(binding, "#benchmarks/0")).toEqual([]);
    expect(selected(binding, "#benchmarks/nothing")).toEqual([]);
    // The record alone resolves as without a schema: by index.
    expect(selected(binding.record, "#benchmarks/append-4k")).toEqual([]);
    expect(selected(binding.record, "#benchmarks/0")).toEqual(["/benchmarks/0"]);
  });

  test("reports that the step matched by a keyed-list key", async () => {
    const binding = await bound("r.json", RUN, keyedBy("map"));
    const outcome = resolveAddressSteps(binding, fragmentOf("#benchmarks/read-4k/p99_us"), "singular");
    if (!outcome.ok) expect.fail(JSON.stringify(outcome.issues));
    expect(outcome.value.steps).toEqual([["member"], ["list-key"], ["member"]]);
  });

  test("a key repeated in a map is ambiguous where it is evaluated, the proof having accepted it", async () => {
    const text = JSON.stringify({ benchmarks: [{ name: "a" }, { name: "a" }] });
    const binding = await bound("r.json", text, keyedBy("map"));
    expect(singular(binding, "#benchmarks/a")).toBe("address-ambiguous r.json null");
    expect(selected(binding, "#benchmarks/a")).toEqual(["/benchmarks/0", "/benchmarks/1"]);
  });
});

describe("the proof that a singular address names one node", () => {
  test("refuses a step through a list declared multimap, whatever the data holds, and lets a selector through", async () => {
    const binding = await bound("r.json", RUN, keyedBy("multimap"));
    expect(singular(binding, "#benchmarks/read-4k")).toBe("address-not-singular r.json null");
    expect(singular(binding, "#benchmarks/nothing")).toBe("address-not-singular r.json null");
    expect(selected(binding, "#benchmarks/read-4k")).toEqual(["/benchmarks/1"]);
    expect(selected(binding, "#benchmarks/nothing")).toEqual([]);
    // A step that stops before the level, and an exact path through it, are singular.
    expect(singular(binding, "#benchmarks")).toBe("/benchmarks #benchmarks");
    expect(singular(binding, "#/benchmarks/1/p99_us")).toBe("/benchmarks/1/p99_us #/benchmarks/1/p99_us");
    const outcome = resolveAddress(binding, fragmentOf("#benchmarks/read-4k"), "singular");
    expect(outcome.ok ? "" : outcome.issues[0]?.message).toContain('"read-4k"');
  });

  // Predicted bug (design, section 4.4): a rule that took the per-key schema in place of the array's items missed this.
  test("refuses a multimap declared under items, beside the list's per-key schema", async () => {
    const schema = {
      properties: {
        benchmarks: {
          type: "array",
          "x-vmd-list": { type: "map", keys: ["name"], items: { "append-4k": { required: ["p99_us"] } } },
          items: { properties: { runs: { type: "array", "x-vmd-list": { type: "multimap", keys: ["id"] } } } },
        },
      },
    };
    const binding = await bound("r.json", RUN, schema);
    expect(singular(binding, "#benchmarks/append-4k/runs/r1")).toBe("address-not-singular r.json null");
    expect(singular(binding, "#benchmarks/append-4k/runs")).toBe("/benchmarks/0/runs #benchmarks/append-4k/runs");
    // A multimap under a per-key schema counts too, and under a prefixItems entry, which a key step may also be at.
    const perKey = {
      properties: {
        benchmarks: {
          type: "array",
          "x-vmd-list": {
            type: "map",
            keys: ["name"],
            items: { "append-4k": { properties: { runs: { "x-vmd-list": { type: "multimap", keys: ["id"] } } } } },
          },
        },
      },
    };
    expect(singular(await bound("r.json", RUN, perKey), "#benchmarks/append-4k/runs/r1")).toBe(
      "address-not-singular r.json null",
    );
    const prefix = {
      properties: {
        benchmarks: {
          type: "array",
          "x-vmd-list": { type: "map", keys: ["name"] },
          prefixItems: [{ properties: { runs: { "x-vmd-list": { type: "multimap", keys: ["id"] } } } }],
        },
      },
    };
    expect(singular(await bound("r.json", RUN, prefix), "#benchmarks/read-4k/runs/r1")).toBe("address-not-singular r.json null");
  });

  test("refuses a step through sections whose level is declared multimap, and accepts every other step", async () => {
    const schema = {
      properties: {
        $sections: { items: { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } } },
      },
    };
    const text = "# Week 41\n\n## Log\n\n### Entry\n\nMonday.\n\n### Entry\n\nTuesday.\n\n## Summary\n\nQuiet week.\n";
    const binding = await bound("journal/week-41.md", text, schema);
    expect(singular(binding, "#log/entry")).toBe("address-not-singular journal/week-41.md null");
    expect(singular(binding, "#log/entry-1")).toBe("address-not-singular journal/week-41.md null");
    // A field step and a section member's step cross that level too, since a section may have that key there.
    expect(singular(binding, "#log/$body")).toBe("address-not-singular journal/week-41.md null");
    expect(singular(binding, "#log")).toBe("/$sections/0 #log");
    expect(singular(binding, "#entry")).toBe("/$sections/0/$sections/0 #entry");
    expect(singular(binding, "#summary")).toBe("/$sections/1 #summary");
    expect(selected(binding, "#log/entry")).toEqual(["/$sections/0/$sections/0", "/$sections/0/$sections/1"]);
    // The schema alone cannot tell that no root section is keyed summary, or entry-1, beside the one the data has, and every
    // root section's children are declared multimap: so a second step after either crosses such a level too.
    expect(singular(binding, "#summary/$body")).toBe("address-not-singular journal/week-41.md null");
    expect(singular(binding, "#entry-1/$body")).toBe("address-not-singular journal/week-41.md null");
    expect(canonicalAddress(binding, "/$sections/1/$body")).toBe("#/$sections/1/$body");
    // Below a level the schema leaves undeclared, the same steps are singular.
    const plain = bindRecord(binding.record, await usable({ type: "object" }));
    expect(singular(plain, "#summary/$body")).toBe("/$sections/1/$body #summary/$body");
  });

  // Review of #108, B1: prefixItems and items bring unequal keyed lists to one member of an item at an unknown position. Their
  // union declares no list, yet the item at each position is keyed by one of them, so a key step must still be followed.
  test("follows a key step where the positions of an item bring unequal keyed lists, and finds the multimap below", async () => {
    const inner = (key: string) => ({
      type: "array",
      "x-vmd-list": { type: "map", keys: [key] },
      items: { type: "object", properties: { deep: { type: "array", "x-vmd-list": { type: "multimap", keys: ["id"] } } } },
    });
    const schema = {
      properties: {
        outer: {
          type: "array",
          "x-vmd-list": { type: "map", keys: ["k"] },
          prefixItems: [{ type: "object", properties: { inner: inner("name") } }],
          items: { type: "object", properties: { inner: inner("other") } },
        },
      },
    };
    const text = JSON.stringify({ outer: [{ k: "a", inner: [{ name: "x", deep: [{ id: "z" }, { id: "z" }] }] }] });
    const binding = await bound("r.json", text, schema);
    expect(binding.issues).toEqual([]);
    expect(singular(binding, "#outer/a/inner/x/deep/z")).toBe("address-not-singular r.json null");
    expect(singular(binding, "#outer/a/inner/x/deep")).toBe("/outer/0/inner/0/deep #outer/a/inner/x/deep");
  });

  test("the same through sections whose prefixItems and items bring keyed lists that differ only in required", async () => {
    const runs = (required: string[]) => ({
      type: "array",
      "x-vmd-list": { type: "map", keys: ["id"], required },
      items: { type: "object", properties: { deep: { type: "array", "x-vmd-list": { type: "multimap", keys: ["id"] } } } },
    });
    const schema = {
      properties: {
        $sections: {
          type: "array",
          prefixItems: [{ type: "object", properties: { runs: runs([]) } }],
          items: { type: "object", properties: { runs: runs(["r"]) } },
        },
      },
    };
    const text = JSON.stringify({ $sections: [{ $title: "A", runs: [{ id: "r", deep: [{ id: "z" }] }] }] });
    const binding = await bound("r.json", text, schema);
    expect(singular(binding, "#a/runs/r/deep/z")).toBe("address-not-singular r.json null");
    expect(canonicalAddress(binding, "/$sections/0/runs/0/deep/0")).toBe("#/$sections/0/runs/0/deep/0");
  });

  // Review of #108, S1: a derived anchor in the first step leads to the section whose level a later step crosses.
  test("continues from the section a first step's derived anchor names", async () => {
    const level = (sections: unknown) => ({ type: "object", properties: { $sections: sections } });
    const schema = level({
      type: "array",
      "x-vmd-list": { type: "map", keys: ["@key"] },
      items: level({
        type: "array",
        "x-vmd-list": { type: "map", keys: ["@key"] },
        items: level({ type: "array", "x-vmd-list": { type: "multimap", keys: ["@key"] } }),
      }),
    });
    const binding = await bound("r.md", "# T\n\n## A\n\n### Notes\n\n#### X\n\none\n\n#### X\n\ntwo\n", schema);
    expect(singular(binding, "#notes/x")).toBe("address-not-singular r.md null");
    expect(singular(binding, "#notes")).toBe("/$sections/0/$sections/0 #a/notes");
  });

  test("continues from the node a first step's anchor names", async () => {
    const schema = {
      properties: {
        groups: { type: "array", items: { properties: { runs: { "x-vmd-list": { type: "multimap", keys: ["id"] } } } } },
      },
    };
    const text = JSON.stringify({ groups: [{ $anchor: "g", runs: [{ id: "r1" }] }] });
    const binding = await bound("r.json", text, schema);
    expect(singular(binding, "#g/runs/r1")).toBe("address-not-singular r.json null");
    expect(singular(binding, "#g/runs")).toBe("/groups/0/runs #g/runs");
  });

  test("a root whose sections are declared multimap leaves no first step singular, explicit anchors included", async () => {
    const schema = { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } };
    const text = JSON.stringify({ $title: "R", status: "x", $sections: [{ $title: "Done", $anchor: "done" }] });
    const binding = await bound("r.json", text, schema);
    expect(singular(binding, "#done")).toBe("address-not-singular r.json null");
    expect(singular(binding, "#status")).toBe("address-not-singular r.json null");
    expect(canonicalAddress(binding, "/$sections/0")).toBe("#/$sections/0");
    expect(canonicalAddress(binding.record, "/$sections/0")).toBe("#done");
  });

  test("two patterns that bring a multimap and a map to one member make a step through it unprovable", async () => {
    const schema = {
      patternProperties: {
        "^l": { type: "array", "x-vmd-list": { type: "multimap", keys: ["k"] } },
        ts$: { type: "array", "x-vmd-list": { type: "map", keys: ["k"] } },
      },
    };
    const text = JSON.stringify({ lists: [{ k: "a" }], lefts: [{ k: "a" }] });
    const binding = await bound("r.json", text, schema);
    expect(singular(binding, "#lists/a")).toBe("address-not-singular r.json null");
    // Unequal maps leave the array unkeyed: a key step matches nothing, and an index its item, as the binding says.
    const maps = {
      patternProperties: {
        "^l": { type: "array", "x-vmd-list": { type: "map", keys: ["k"] } },
        ts$: { type: "array", "x-vmd-list": { type: "map", keys: ["k"], required: ["a"] } },
      },
    };
    const both = await bound("r.json", text, maps);
    expect(selected(both, "#lists/a")).toEqual([]);
    expect(singular(both, "#lists/0")).toBe("/lists/0 #lists/0");
  });
});

describe("canonical addresses and @key of keyed-list items", () => {
  test("an item of a map is written by its key, one without a key by its exact path", async () => {
    const binding = await bound("r.json", RUN, keyedBy("map"));
    expect(canonicalAddress(binding, "/benchmarks/1/p99_us")).toBe("#benchmarks/read-4k/p99_us");
    expect(canonicalAddress(binding, "/benchmarks/0")).toBe("#benchmarks/append-4k");
    expect(canonicalAddress(binding, "/benchmarks/2/p99_us")).toBe("#/benchmarks/2/p99_us");
    expect(canonicalAddress(binding.record, "/benchmarks/1/p99_us")).toBe("#benchmarks/1/p99_us");
  });

  test("an item of a multimap, which form 2 cannot name, falls to its exact path in data", async () => {
    const binding = await bound("r.json", RUN, keyedBy("multimap"));
    expect(canonicalAddress(binding, "/benchmarks/1/p99_us")).toBe("#/benchmarks/1/p99_us");
    expect(canonicalAddress(binding, "/benchmarks")).toBe("#benchmarks");
  });

  test("@key of an item is its key, or its index without one", async () => {
    const binding = await bound("r.json", RUN, keyedBy("map"));
    const key = async (at: string) => (await computeFields(binding, at, ["@key"]))["@key"];
    expect(await key("/benchmarks/1")).toBe("read-4k");
    expect(await key("/benchmarks/2")).toBe(2);
    expect(await key("/benchmarks/0/runs/1")).toBe(1);
    expect((await computeFields(binding.record, "/benchmarks/1", ["@key"]))["@key"]).toBe(1);
  });
});
