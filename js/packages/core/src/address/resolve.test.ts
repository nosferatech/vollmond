import { describe, expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import type { Outcome } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import { parseAddress } from "./address.js";
import { canonicalAddress, resolveAddress, resolveStoreAddress, type Target } from "./resolve.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The record of a file that parses, failing the test otherwise. */
function record(path: string, text: string): ParsedRecord {
  const outcome = parseRecord(path, utf8(text));
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

/** Resolves the fragment of `address` (`#` and what follows) in `parsed`. */
function resolve(parsed: ParsedRecord, address: string, use: "singular" | "selector"): Outcome<readonly Target[]> {
  const read = parseAddress(`${parsed.path}${address}`);
  if (!read.ok) throw new Error(`malformed: ${address}`);
  return resolveAddress(parsed, read.value.fragment, use);
}

/** The exact paths that `address` resolves to as a selector. */
const selected = (parsed: ParsedRecord, address: string) => {
  const outcome = resolve(parsed, address, "selector");
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => issue.message).join(", ")}`);
  return outcome.value.map((target) => target.at);
};

/** The one target that `address` resolves to as a singular address, failing the test otherwise. */
function singular(parsed: ParsedRecord, address: string): Target {
  const outcome = resolve(parsed, address, "singular");
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  expect(outcome.value).toHaveLength(1);
  return outcome.value[0] as Target;
}

/** The codes of the issues of a singular address that fails, with path and `at`. */
function failure(parsed: ParsedRecord, address: string): [string, string | null, string | null][] {
  const outcome = resolve(parsed, address, "singular");
  if (outcome.ok) throw new Error(`${address} resolves`);
  return outcome.issues.map((issue) => [issue.code, issue.path, issue.at]);
}

const DESIGN = `---
status: Draft
links: [first, second]
config:
  retries: 3
---

# Design notes

Overview text.

## Background

### History<a id="past"></a>

Long ago.

#### Sources

Old mail.

## Decision<a id="choice" class="adopted"></a>

\`\`\`yaml data
votes: 3
\`\`\`

We chose this.
`;

describe("exact paths", () => {
  const design = record("notes/design.md", DESIGN);

  test("resolve to the node of a JSON Pointer, and to nothing past it", () => {
    expect(singular(design, "#/config/retries").at).toBe("/config/retries");
    expect(singular(design, "#/$sections/1/votes").at).toBe("/$sections/1/votes");
    expect(selected(design, "#/config/retries/x")).toEqual([]);
    expect(selected(design, "#/missing")).toEqual([]);
  });

  test("reach an array item only by an index without leading zeros, and never by `-`", () => {
    expect(singular(design, "#/links/1").at).toBe("/links/1");
    for (const index of ["01", "-", "1.0", "+1", "1e0", "2"]) expect(selected(design, `#/links/${index}`), index).toEqual([]);
  });

  test("reach a member named like an index, and the member with the empty name", () => {
    const data = record("d.json", '{"01": 1, "": {"a": 2}, "~/": 3}');
    expect(singular(data, "#/01").at).toBe("/01");
    expect(singular(data, "#/").at).toBe("/");
    expect(singular(data, "#//a").at).toBe("//a");
    expect(singular(data, "#/~0~1").at).toBe("/~0~1");
  });

  test("reach `__proto__` only as a member that the record has", () => {
    expect(selected(record("a.json", '{"a": 1}'), "#/__proto__")).toEqual([]);
    expect(selected(record("a.json", '{"a": 1}'), "#__proto__")).toEqual([]);
    expect(selected(record("a.json", '{"a": 1}'), "#constructor")).toEqual([]);
    expect(singular(record("b.json", '{"__proto__": {"x": 1}}'), "#__proto__/x").at).toBe("/__proto__/x");
  });
});

describe("semantic paths", () => {
  const design = record("notes/design.md", DESIGN);

  test("step through fields, members and array items by index", () => {
    expect(singular(design, "#config/retries").at).toBe("/config/retries");
    expect(singular(design, "#links/0").at).toBe("/links/0");
  });

  test("take an index step only in decimal without leading zeros", () => {
    for (const index of ["01", "-", "1.0", "+1", "1e0", "0x1", "%201", "2", "4294967296"]) {
      expect(selected(design, `#links/${index}`), index).toEqual([]);
    }
  });

  test("step to child sections by key, through the section or through its `$sections`, never by index", () => {
    expect(singular(design, "#background/past/sources").at).toBe("/$sections/0/$sections/0/$sections/0");
    expect(singular(design, "#$sections/background/$sections/past").at).toBe("/$sections/0/$sections/0");
    expect(selected(design, "#$sections/0")).toEqual([]);
    expect(selected(design, "#background/history")).toEqual([]);
  });

  test("name the section members, and a section's fields only from that section", () => {
    expect(singular(design, "#$title").at).toBe("/$title");
    expect(singular(design, "#choice/$tags/0").at).toBe("/$sections/1/$tags/0");
    expect(singular(design, "#choice/votes").at).toBe("/$sections/1/votes");
    expect(selected(design, "#votes")).toEqual([]);
  });

  test("match anchors at the first step only, and never a tag", () => {
    expect(singular(design, "#sources").at).toBe("/$sections/0/$sections/0/$sections/0");
    expect(singular(design, "#history").at).toBe("/$sections/0/$sections/0");
    expect(selected(design, "#background/choice")).toEqual([]);
    expect(selected(design, "#adopted")).toEqual([]);
  });

  test("count a node that its key, its explicit anchor and its derived anchor all name as one match", () => {
    const done = record("t.md", '# T\n\n## Done<a id="done"></a>\n\nText.\n');
    expect(selected(done, "#done")).toEqual(["/$sections/0"]);
    expect(singular(done, "#done").at).toBe("/$sections/0");
  });

  test("treat a `$sections` inside a field's value as data, an array that is not keyed", () => {
    const data = record("d.json", '{"x": {"$sections": [{"$title": "T"}]}}');
    expect(singular(data, "#x/$sections/0/$title").at).toBe("/x/$sections/0/$title");
    expect(selected(data, "#x/$sections/t")).toEqual([]);
  });

  test("reach a JSON object by its explicit anchor, and a JSON section by its title's slug", () => {
    const data = record(
      "d.json",
      '{"o": {"$anchor": "owner", "n": 1}, "$sections": [{"$title": "What *is* done", "$body": "x"}]}',
    );
    expect(singular(data, "#owner/n").at).toBe("/o/n");
    expect(singular(data, "#what-is-done/$body").at).toBe("/$sections/0/$body");
  });

  test("resolve a block anchor at the first step to its range of the `$body`, which no later step goes into", () => {
    const blocks = record("b.md", '# B\n\nIntro.\n\n- <a id="hall"></a>Hall.\n- Two.\n');
    expect(singular(blocks, "#hall")).toEqual({ path: "b.md", at: "/$body", address: "#hall", range: { start: 8, end: 32 } });
    expect(selected(blocks, "#hall/x")).toEqual([]);
  });
});

describe("cardinality", () => {
  const twin = record("twin.md", "# Twin\n\n## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n");
  const nested = record("same.md", '# S\n\n## Alpha<a id="same"></a>\n\nOne.\n\n### Beta<a id="same"></a>\n\nTwo.\n');
  const shadow = record("shadow.md", "---\nnotes: Kept.\n---\n\n# S\n\n## Background\n\n### Notes\n\nOld.\n");

  test("address-ambiguous fires on a singular address that matches several nodes, with each as a candidate", () => {
    const outcome = resolve(twin, "#notes", "singular");
    expect(outcome.ok).toBe(false);
    expect(outcome.issues).toHaveLength(1);
    const [issue] = outcome.issues;
    expect(issue).toMatchObject({ code: "address-ambiguous", severity: "error", class: "operation", path: "twin.md", at: null });
    expect(issue?.candidates).toEqual([
      { path: "twin.md", at: "/$sections/0", address: "#/$sections/0" },
      { path: "twin.md", at: "/$sections/1", address: "#notes-1" },
    ]);
    // The near miss: the derived anchor of the second, which names one node.
    expect(singular(twin, "#notes-1").at).toBe("/$sections/1");
  });

  test("a selector returns every match instead", () => {
    expect(selected(twin, "#notes")).toEqual(["/$sections/0", "/$sections/1"]);
  });

  test("a first step that matches a root member and another node's anchor is ambiguous", () => {
    expect(failure(shadow, "#notes")).toEqual([["address-ambiguous", "shadow.md", null]]);
    expect(selected(shadow, "#notes")).toEqual(["/notes", "/$sections/0/$sections/0"]);
    expect(singular(shadow, "#background/notes").at).toBe("/$sections/0/$sections/0");
  });

  test("a singular address is ambiguous at the step that meets the duplicate, even when a later step names one node", () => {
    expect(failure(nested, "#same/same")).toEqual([["address-ambiguous", "same.md", null]]);
    const [first] = resolve(nested, "#same/same", "singular").issues;
    expect(first?.message).toBe('same.md#same/same: its step 1, "same", matches 2 nodes');
    expect(first?.hint).toMatch(/^the candidates are what that step matches/);
    expect(first?.candidates?.map((candidate) => candidate.at)).toEqual(["/$sections/0", "/$sections/0/$sections/0"]);
    const week = record("w.md", "# W\n\n## Log\n\n### Entry\n\nMon.\n\n### Entry\n\nTue.\n");
    const [last] = resolve(week, "#log/entry", "singular").issues;
    expect(last?.message).toBe('w.md#log/entry: its step 2, "entry", matches 2 nodes');
    expect(last?.hint).toMatch(/^use the address of the candidate you mean/);
    expect(selected(nested, "#same/same")).toEqual(["/$sections/0/$sections/0"]);
  });

  test("an explicit anchor on two nodes is ambiguous, and a selector over it takes both", () => {
    const people = record("p.yaml", "people:\n  - $anchor: person\n    name: Ada\n  - $anchor: person\n    name: Grace\n");
    expect(failure(people, "#person")).toEqual([["address-ambiguous", "p.yaml", null]]);
    expect(selected(people, "#person/name")).toEqual(["/people/0/name", "/people/1/name"]);
  });

  test("a field and a child section of one key are ambiguous below the root too", () => {
    const sections = record("s.md", "# S\n\n## A\n\n```yaml data\nb: 1\n```\n\n### B\n\nText.\n");
    expect(failure(sections, "#a/b")).toEqual([["address-ambiguous", "s.md", null]]);
    expect(selected(sections, "#a/b")).toEqual(["/$sections/0/b", "/$sections/0/$sections/0"]);
  });

  test("address-not-found fires on a singular address that matches nothing, and a selector gives an empty list", () => {
    const design = record("notes/design.md", DESIGN);
    expect(failure(design, "#nothing")).toEqual([["address-not-found", "notes/design.md", null]]);
    expect(failure(design, "#/links/01")).toEqual([["address-not-found", "notes/design.md", null]]);
    expect(failure(design, "#links/01")).toEqual([["address-not-found", "notes/design.md", null]]);
    expect(selected(design, "#nothing")).toEqual([]);
    // The near misses.
    expect(singular(design, "#status").at).toBe("/status");
    expect(singular(design, "#links/1").at).toBe("/links/1");
  });

  test("the root is the node of no fragment", () => {
    const design = record("notes/design.md", DESIGN);
    expect(resolveAddress(design, null, "singular")).toEqual({
      ok: true,
      value: [{ path: "notes/design.md", at: "", address: "" }],
      issues: [],
    });
  });
});

describe("canonical addresses", () => {
  const design = record("notes/design.md", DESIGN);

  test('are `""` for the root, even when its title heading has an explicit anchor', () => {
    expect(canonicalAddress(design, "")).toBe("");
    expect(canonicalAddress(record("r.md", '# R<a id="r"></a>\n\nx\n'), "")).toBe("");
  });

  test("use the node's explicit anchor first, then the path from its nearest anchored ancestor or the root", () => {
    expect(canonicalAddress(design, "/$sections/0/$sections/0")).toBe("#past");
    expect(canonicalAddress(design, "/$sections/0/$sections/0/$sections/0")).toBe("#past/sources");
    expect(canonicalAddress(design, "/$sections/0/$sections/0/$sections/0/$body")).toBe("#past/sources/$body");
    expect(canonicalAddress(design, "/$sections/1/votes")).toBe("#choice/votes");
    expect(canonicalAddress(design, "/config/retries")).toBe("#config/retries");
    expect(canonicalAddress(design, "/links/1")).toBe("#links/1");
    expect(canonicalAddress(design, "/$sections")).toBe("#$sections");
    expect(canonicalAddress(record("o.yaml", "o:\n  $anchor: owner-of-record\n  name: Ada\n"), "/o/name")).toBe(
      "#owner-of-record/name",
    );
  });

  test("fall through to the derived anchor, and then to the exact path", () => {
    const twin = record("twin.md", "# Twin\n\n## Notes\n\nFirst.\n\n## Notes\n\nSecond.\n");
    expect(canonicalAddress(twin, "/$sections/0")).toBe("#/$sections/0");
    expect(canonicalAddress(twin, "/$sections/1")).toBe("#notes-1");
    expect(canonicalAddress(twin, "/$sections/1/$body")).toBe("#/$sections/1/$body");
    const nested = record("same.md", '# S\n\n## Alpha<a id="same"></a>\n\nOne.\n\n### Beta<a id="same"></a>\n\nTwo.\n');
    expect(canonicalAddress(nested, "/$sections/0")).toBe("#alpha");
    expect(canonicalAddress(nested, "/$sections/0/$sections/0")).toBe("#beta");
  });

  test("never use an empty key as a step", () => {
    const empty = record("e.md", "# E\n\n## ?!\n\nNo key.\n\n### Child\n\nBelow.\n");
    expect(canonicalAddress(empty, "/$sections/0")).toBe("#/$sections/0");
    expect(canonicalAddress(empty, "/$sections/0/$sections/0")).toBe("#child");
    expect(canonicalAddress(empty, "/$sections/0/$sections/0/$body")).toBe("#/$sections/0/$sections/0/$body");
    const name = record("n.json", '{"": {"a": 1}}');
    expect(canonicalAddress(name, "/")).toBe("#/");
    expect(canonicalAddress(name, "//a")).toBe("#//a");
  });

  test("are percent-encoded", () => {
    const data = record("d.json", '{"a/b": 1, "name with space": [2], "été": 3, "100%": 4, "x:y": 5, "~": 6}');
    expect(canonicalAddress(data, "/a~1b")).toBe("#a%2Fb");
    expect(canonicalAddress(data, "/name with space/0")).toBe("#name%20with%20space/0");
    expect(canonicalAddress(data, "/été")).toBe("#%C3%A9t%C3%A9");
    expect(canonicalAddress(data, "/100%")).toBe("#100%25");
    expect(canonicalAddress(data, "/x:y")).toBe("#x:y");
    expect(canonicalAddress(data, "/~0")).toBe("#~");
  });

  test("throw a RangeError for a path with no node", () => {
    expect(() => canonicalAddress(design, "/missing")).toThrow(RangeError);
  });
});

describe("resolving in a store", () => {
  const files = new Map([
    ["notes/design.md", utf8(DESIGN)],
    ["broken.json", utf8('{"a": 1, "a": 2}')],
  ]);
  const lookup = async (path: string) => {
    const bytes = files.get(path);
    return bytes === undefined ? null : parseRecord(path, bytes);
  };

  test("resolves an address in the record it names", async () => {
    const outcome = await resolveStoreAddress(lookup, "notes/design.md#past", "singular");
    if (!outcome.ok) throw new Error("failed");
    expect(outcome.value.targets).toEqual([{ path: "notes/design.md", at: "/$sections/0/$sections/0", address: "#past" }]);
    // The record the lookup read comes back, for the targets' values and computed fields.
    expect(outcome.value.record.path).toBe("notes/design.md");
    expect(outcome.value.record.nodes.node("/$sections/0/$sections/0")?.kind).toBe("section");
    expect(outcome.issues).toEqual([]);
  });

  test("address-not-found fires on a record the store does not hold, as a singular address and as a selector", async () => {
    for (const use of ["singular", "selector"] as const) {
      const outcome = await resolveStoreAddress(lookup, "notes/missing.md#x", use);
      expect(outcome.ok).toBe(false);
      expect(outcome.issues.map((issue) => [issue.code, issue.path, issue.at])).toEqual([
        ["address-not-found", "notes/missing.md", null],
      ]);
    }
  });

  test("fails with the structural errors of the record, also for its root", async () => {
    const outcome = await resolveStoreAddress(lookup, "broken.json", "singular");
    expect(outcome.ok).toBe(false);
    expect(outcome.issues.map((issue) => [issue.code, issue.path, issue.at])).toEqual([
      ["duplicate-member", "broken.json", "/a"],
    ]);
  });

  test("fails with address-malformed before reading the record", async () => {
    let reads = 0;
    const counting = async (path: string) => {
      reads++;
      return lookup(path);
    };
    const outcome = await resolveStoreAddress(counting, "notes/design.md#a//b", "selector");
    expect(outcome.issues.map((issue) => [issue.code, issue.path, issue.at])).toEqual([
      ["address-malformed", "notes/design.md", null],
    ]);
    expect(reads).toBe(0);
  });

  test("reads characters outside a fragment raw when asked", async () => {
    const outcome = await resolveStoreAddress(lookup, "notes/design.md#config/retries", "singular", { raw: true });
    expect(outcome.ok).toBe(true);
  });
});
