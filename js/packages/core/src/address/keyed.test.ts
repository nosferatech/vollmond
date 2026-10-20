// Addresses through keyed lists: resolution by key, the proof that a singular address names one node, canonical addresses
// and `@key`.

import { describe, expect, test } from "vitest";
import { bindRecord, type RecordBinding } from "../binding/binding.js";
import { parseRecord } from "../format/parse-record.js";
import { computeFields } from "../meta/computed-fields.js";
import type { ParsedRecord } from "../record/record.js";
import { usable } from "../schema/schema.testkit.js";
import { parseAddress } from "./address.js";
import { proveSingular } from "./prove.js";
import { canonicalAddress, resolveAddress, resolveAddressSteps, semanticMatchCount } from "./resolve.js";

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

  // Review of #108, N2: each candidate's canonical address evaluated the ambiguous step again, finding every match each time.
  test("the candidates of an ambiguous step find their matches once, not once per candidate", async () => {
    for (const m of [1000, 4000]) {
      const text = JSON.stringify({ benchmarks: Array.from({ length: m }, () => ({ name: "x" })) });
      const binding = await bound("r.json", text, keyedBy("map"));
      const before = semanticMatchCount();
      const outcome = resolveAddress(binding, fragmentOf("#benchmarks/x"), "singular");
      expect(outcome.ok ? [] : outcome.issues[0]?.candidates?.map((target) => target.address).slice(0, 2)).toEqual([
        "#/benchmarks/0",
        "#/benchmarks/1",
      ]);
      // The step's own evaluation and the one of form 2 that every candidate shares, each finding the m matches: 2m, and
      // the first step's match each time; not m times m.
      expect(semanticMatchCount() - before).toBeLessThanOrEqual(2 * m + 4);
    }
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
    expect(singular(binding, "#log")).toBe("/$sections/0 #log");
    expect(singular(binding, "#entry")).toBe("/$sections/0/$sections/0 #entry");
    expect(singular(binding, "#summary")).toBe("/$sections/1 #summary");
    expect(selected(binding, "#log/entry")).toEqual(["/$sections/0/$sections/0", "/$sections/0/$sections/1"]);
    // The schema alone cannot tell that no root section is keyed summary beside the one the data has, and every root
    // section's children are declared multimap: so a name step after it crosses such a level.
    expect(singular(binding, "#summary/notes")).toBe("address-not-singular journal/week-41.md null");
  });

  // Card AD (project owner, 2026-10-12): no section key of a valid record begins with `$`, so a `$` step from a section names the section's own
  // member and crosses no level of its child sections.
  test("a $ step from a section names the section's own member, below a level declared multimap too", async () => {
    const schema = {
      properties: {
        $sections: { items: { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } } },
      },
    };
    const text = "# Week 41\n\n## Log\n\n### Entry\n\nMonday.\n\n### Entry\n\nTuesday.\n\n## Summary\n\nQuiet week.\n";
    const binding = await bound("journal/week-41.md", text, schema);
    expect(singular(binding, "#summary/$body")).toBe("/$sections/1/$body #summary/$body");
    expect(singular(binding, "#summary/$title")).toBe("/$sections/1/$title #summary/$title");
    expect(singular(binding, "#log/$title")).toBe("/$sections/0/$title #log/$title");
    expect(canonicalAddress(binding, "/$sections/1/$body")).toBe("#summary/$body");
    // A section reached by its anchor is the section itself, wherever its level sits. Its $body's canonical address is still
    // the exact path: form 2 starts at an explicit anchor or the root, and goes through the level declared multimap.
    expect(singular(binding, "#entry-1/$body")).toBe("/$sections/0/$sections/1/$body #/$sections/0/$sections/1/$body");
    // $sections is the section's own member too, but a step into it is a key of the level declared multimap.
    expect(singular(binding, "#log/$sections")).toBe("/$sections/0/$sections #log/$sections");
    expect(singular(binding, "#log/$sections/entry")).toBe("address-not-singular journal/week-41.md null");
    expect(singular(binding, "#log/$sections/0")).toBe("address-not-singular journal/week-41.md null");
    // A section reached through the level declared multimap is not singular, nor are its members.
    expect(singular(binding, "#log/entry/$body")).toBe("address-not-singular journal/week-41.md null");
    expect(singular(binding, "#log/entry/$title")).toBe("address-not-singular journal/week-41.md null");
  });

  test("a $ step leads to the section's member only, never to a child section that a later step could cross from", async () => {
    // The grandchildren of every root section are declared multimap, so a child section keyed $title would be refused below.
    const schema = {
      properties: {
        $sections: {
          items: {
            properties: {
              $sections: { items: { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } } },
            },
          },
        },
      },
    };
    const binding = await bound("r.md", "# W\n\n## Summary\n\nQuiet.\n", schema);
    expect(singular(binding, "#summary/$title/x")).toBe("address-not-found r.md null");
    expect(singular(binding, "#summary/notes/x")).toBe("address-not-singular r.md null");
  });

  // Review of #117: an invalid explicit anchor still becomes the section's key, so in a record with anchor-invalid a section key
  // can begin with $. The proof then accepts a $ step that evaluation finds ambiguous, one of §7.4's cases left to evaluation.
  // This pins today's behaviour, so that a change to it shows up here.
  test("a section keyed by an invalid anchor beginning with $ passes the proof, and evaluation reports the ambiguity", async () => {
    const level = (sections: unknown) => ({ type: "object", properties: { $sections: sections } });
    const map = (items?: unknown) => ({
      type: "array",
      "x-vmd-list": { type: "map", keys: ["@key"] },
      ...(items === undefined ? {} : { items }),
    });
    const schema = level(map(level(map(level({ type: "array", "x-vmd-list": { type: "multimap", keys: ["@key"] } })))));
    const text = JSON.stringify({
      $sections: [{ $title: "A", $sections: [{ $anchor: "$x", $title: "X", $sections: [{ $title: "B" }, { $title: "B" }] }] }],
    });
    const binding = await bound("r.json", text, schema);
    expect(binding.issues.map((issue) => `${issue.code} ${issue.at}`)).toContain("anchor-invalid /$sections/0/$sections/0");
    expect(proveSingular(binding, fragmentOf("#a/$x/b")).ok).toBe(true);
    expect(singular(binding, "#a/$x/b")).toBe("address-ambiguous r.json null");
    expect(selected(binding, "#a/$x/b")).toEqual([
      "/$sections/0/$sections/0/$sections/0",
      "/$sections/0/$sections/0/$sections/1",
    ]);
  });

  test("a $ step into a data list declared multimap is a key like any other, and stays refused", async () => {
    // Only section keys never begin with $; a data list's key member may hold any string.
    const text = JSON.stringify({ benchmarks: [{ name: "$x" }, { name: "$x" }] });
    const binding = await bound("r.json", text, keyedBy("multimap"));
    expect(singular(binding, "#benchmarks/$x")).toBe("address-not-singular r.json null");
    expect(selected(binding, "#benchmarks/$x")).toEqual(["/benchmarks/0", "/benchmarks/1"]);
  });

  test("a $ step from a root whose sections are declared multimap names the root's own member", async () => {
    const schema = { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } };
    const text = JSON.stringify({ $title: "R", status: "x", $sections: [{ $title: "Done" }] });
    const binding = await bound("r.json", text, schema);
    expect(singular(binding, "#$title")).toBe("/$title #$title");
    expect(singular(binding, "#$sections")).toBe("/$sections #$sections");
    expect(singular(binding, "#$sections/done")).toBe("address-not-singular r.json null");
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

  // Card AO (project owner, 2026-10-20): where the schema cannot prove the first step, the proof looks it up in the record, and
  // the step is singular when it names exactly one node there; the steps after it are still proved from the schema.
  describe("through a root whose sections are declared multimap", () => {
    const repeating = { "x-vmd-list": { type: "multimap", keys: ["@key"] } };
    // Every level of sections may repeat its keys.
    const journal = { properties: { $sections: { ...repeating, items: { properties: { $sections: repeating } } } } };
    const text = [
      "# J",
      '## Done <a id="done"></a>',
      "Finished.",
      "### Later",
      "Soon.",
      "## Monday",
      "One.",
      "## Monday",
      "Two.",
      '### Errand <a id="errand"></a>',
      "Milk.",
      "",
    ].join("\n\n");

    test("a first step that names one node in the record is singular: an explicit anchor, at the top level or below", async () => {
      const binding = await bound("j.md", text, journal);
      expect(singular(binding, "#done")).toBe("/$sections/0 #done");
      expect(singular(binding, "#done/$body")).toBe("/$sections/0/$body #done/$body");
      expect(singular(binding, "#errand")).toBe("/$sections/2/$sections/0 #errand");
      expect(singular(binding, "#errand/$title")).toBe("/$sections/2/$sections/0/$title #errand/$title");
      // A derived anchor that names one node is a first step like any other.
      expect(singular(binding, "#monday-1")).toBe("/$sections/2 #monday-1");
      // The canonical addresses follow: the explicit anchor is form 1, and a repeated section's unique derived anchor form 3.
      expect(canonicalAddress(binding, "/$sections/0")).toBe("#done");
      expect(canonicalAddress(binding, "/$sections/2")).toBe("#monday-1");
    });

    test("a first step that names several nodes in the record, or none, stays unprovable", async () => {
      const binding = await bound("j.md", text, journal);
      expect(singular(binding, "#monday")).toBe("address-not-singular j.md null");
      expect(singular(binding, "#monday/$body")).toBe("address-not-singular j.md null");
      expect(singular(binding, "#nothing")).toBe("address-not-singular j.md null");
      expect(selected(binding, "#monday")).toEqual(["/$sections/1", "/$sections/2"]);
      // The first Monday's derived anchor is also the key of both, so its canonical address is its exact path.
      expect(canonicalAddress(binding, "/$sections/1")).toBe("#/$sections/1");
    });

    test("the steps after the first are still proved from the schema", async () => {
      const binding = await bound("j.md", text, journal);
      // One Later exists, but done's child sections are declared multimap.
      expect(singular(binding, "#done/later")).toBe("address-not-singular j.md null");
      // Errand's own child sections are not declared, so the step after it is unique by the strict default, and matches nothing.
      expect(singular(binding, "#errand/nothing")).toBe("address-not-found j.md null");
      // The near miss: where done's child sections are not declared, the same step is unique by the strict default.
      const rootOnly = { properties: { $sections: repeating } };
      expect(singular(await bound("j.md", text, rootOnly), "#done/later")).toBe("/$sections/0/$sections/0 #done/later");
    });

    test("an explicit anchor that a top-level key repeats names two nodes, and stays unprovable", async () => {
      const both = '# J\n\n## Done\n\nA.\n\n## Week\n\n### Finished <a id="done"></a>\n\nB.\n';
      const binding = await bound("j.md", both, journal);
      expect(singular(binding, "#done")).toBe("address-not-singular j.md null");
      // The near miss: with no level declared, the proof accepts the step, and evaluation finds it ambiguous (§7.3).
      expect(singular(await bound("j.md", both, {}), "#done")).toBe("address-ambiguous j.md null");
    });

    // Review of #147, M9: a block anchor is one of the first step's matches, and dropping it from the count passed every test.
    test("a block anchor counts among the first step's matches, alone or beside a top-level key", async () => {
      const blocks =
        '---\nroom: 1\n---\n# J\n\n## Log\n\nA.\n\n## Monday\n\n<a id="room"></a>B.\n\n## Monday\n\n<a id="desk"></a>C.\n';
      const binding = await bound("j.md", blocks, { properties: { $sections: repeating } });
      expect(binding.issues).toEqual([]);
      // The field room and the block anchor room are two matches.
      expect(singular(binding, "#room")).toBe("address-not-singular j.md null");
      const desk = resolveAddress(binding, fragmentOf("#desk"), "singular");
      if (!desk.ok) expect.fail(JSON.stringify(desk.issues));
      expect(desk.value).toEqual([{ path: "j.md", at: "/$sections/2/$body", address: "#desk", range: expect.anything() }]);
    });

    test("a unique top-level key is singular, a field's and a section's", async () => {
      const json = JSON.stringify({ $title: "R", status: "x", $sections: [{ $title: "Done" }, { $title: "Log" }] });
      const binding = await bound("r.json", json, journal);
      expect(singular(binding, "#status")).toBe("/status #status");
      expect(singular(binding, "#log")).toBe("/$sections/1 #log");
      expect(singular(binding, "#log/$title")).toBe("/$sections/1/$title #log/$title");
      expect(singular(binding, "#log/entry")).toBe("address-not-singular r.json null");
      const markdown = await bound("j.md", "# J\n\n## Summary\n\nQuiet.\n\n## Monday\n\n## Monday\n", journal);
      expect(singular(markdown, "#summary")).toBe("/$sections/0 #summary");
    });
  });

  // Review of Draft v0.16 against #147: the record decided the first step only at a root declared multimap, so declaring more
  // repeats made #notes/a provable.
  test("the record decides the first step wherever the schema cannot prove the address, at any root", async () => {
    const repeating = { "x-vmd-list": { type: "multimap", keys: ["@key"] } };
    const below = { items: { properties: { $sections: repeating } } };
    const text = JSON.stringify({ $title: "R", notes: { a: 1 }, $sections: [{ $title: "Log" }] });
    for (const root of [{ "x-vmd-list": { type: "map", keys: ["@key"] } }, {}, repeating]) {
      const binding = await bound("r.json", text, { properties: { $sections: { ...root, ...below } } });
      // The schema alone cannot tell the field notes from a root section notes, whose child sections may repeat.
      expect(singular(binding, "#notes/a")).toBe("/notes/a #notes/a");
      // Log is the one root section keyed log, and its child sections are declared multimap all the same.
      expect(singular(binding, "#log/a")).toBe("address-not-singular r.json null");
      expect(singular(binding, "#nothing/a")).toBe("address-not-singular r.json null");
    }
  });

  // Re-review of #147: removing either guard below failed no test, and each leaves the proof unsound.
  test("a first step that the record decides keeps its place: a $ step is not looked up, and a section stays a section", async () => {
    const repeating = { "x-vmd-list": { type: "multimap", keys: ["@key"] } };
    const schema = { properties: { $sections: { items: { properties: { $sections: repeating } } } } };
    const binding = await bound("j.md", "# J\n\n## Done\n\n### Later\n\nA.\n\n### Later\n\nB.\n", schema);
    expect(binding.issues).toEqual([]);
    // $sections is the root's own member, which the schema reads as the root's child sections, whose children may repeat.
    expect(singular(binding, "#$sections/done/later")).toBe("address-not-singular j.md null");
    // Done is the one root section keyed done, and the step after it crosses its child sections, declared multimap.
    expect(singular(binding, "#done/later")).toBe("address-not-singular j.md null");
  });

  test("an unprovable address says how many nodes its first step names in the record, and which", async () => {
    const schema = { properties: { $sections: { "x-vmd-list": { type: "multimap", keys: ["@key"] } } } };
    const both = '# J\n\n## Done\n\nA.\n\n## Week\n\n### Finished <a id="done"></a>\n\nB.\n';
    const message = (outcome: ReturnType<typeof proveSingular>) => (outcome.ok ? "proved" : outcome.issues[0]?.message);
    const binding = await bound("j.md", both, schema);
    expect(message(proveSingular(binding, fragmentOf("#done")))).toBe(
      'j.md#done: its step 1, "done", crosses a level its schema declares multimap, where keys may repeat, and it names 2 nodes in the record, /$sections/0 and /$sections/1/$sections/0, so it cannot be proved to name one node',
    );
    expect(message(proveSingular(binding, fragmentOf("#nothing")))).toBe(
      'j.md#nothing: its step 1, "nothing", crosses a level its schema declares multimap, where keys may repeat, and it names no node in the record, so it cannot be proved to name one node',
    );
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
