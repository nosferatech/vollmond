import { describe, expect, test } from "vitest";
import { parseAddress } from "../address/address.js";
import { resolveAddress, type Target } from "../address/resolve.js";
import { parseRecord } from "../format/parse-record.js";
import type { ParsedRecord } from "../record/record.js";
import { nodeVersion } from "../value/digest.js";
import { COMPUTED_FIELD_NAMES, computeFields, NOT_COMPUTED_FIELDS } from "./computed-fields.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The record of a file that parses, failing the test otherwise. */
function record(path: string, text: string): ParsedRecord {
  const outcome = parseRecord(path, utf8(text));
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

/** The targets that a fragment selects in a record. */
function targets(parsed: ParsedRecord, fragment: string): readonly Target[] {
  const address = parseAddress(`${parsed.path}${fragment}`);
  const outcome = address.ok ? resolveAddress(parsed, address.value.fragment, "selector") : address;
  if (!outcome.ok) throw new Error(`${fragment} does not resolve`);
  return outcome.value;
}

const TICKET = `---
status: In progress
component: [log-v3]
---

# A crash inside a contiguous transition can leave a clean root in a scattered record

Recovery repairs the state.

## What is confirmed

- A contiguous transition writes the changed units and the header into one slot range.

## What was done <a id="done" class="decision"></a>

Recovery of a clean root makes the record contiguous.
`;

describe("computed fields", () => {
  const ticket = record("tickets/0171.md", TICKET);

  test("give every field but @nodes for `all`, as the specification's example of a section does", async () => {
    const fields = await computeFields(ticket, "/$sections/1", "all");
    const value = ticket.value.$sections as readonly unknown[];
    const start = TICKET.indexOf("## What was done");
    expect(fields).toEqual({
      "@path": "tickets/0171.md",
      "@at": "/$sections/1",
      "@address": "#done",
      "@key": "done",
      "@anchors": [
        { name: "done", kind: "explicit" },
        { name: "what-was-done", kind: "derived" },
      ],
      "@version": await nodeVersion(value[1] as never),
      "@source": { range: { start, end: TICKET.length }, line: 14, col: 1 },
      "@issues": [],
      "@refs": null,
      "@depth": 1,
    });
    expect(Object.keys(fields)).toEqual([
      "@path",
      "@at",
      "@address",
      "@key",
      "@anchors",
      "@version",
      "@source",
      "@issues",
      "@refs",
      "@depth",
    ]);
  });

  test("give the root no @key, the empty address, and depth 0", async () => {
    expect(await computeFields(ticket, "", ["@key", "@address", "@depth", "@at"])).toEqual({
      "@address": "",
      "@depth": 0,
      "@at": "",
    });
  });

  test("give a field its member name and an item its index as @key, its member range, and no @depth", async () => {
    const field = await computeFields(ticket, "/status", ["@key", "@source", "@depth", "@address"]);
    expect(field).toEqual({
      "@key": "status",
      "@source": {
        range: { start: 12, end: 23 },
        line: 2,
        col: 9,
        memberRange: { start: 4, end: 23 },
      },
      "@address": "#status",
    });
    expect(await computeFields(ticket, "/component/0", ["@key"])).toEqual({ "@key": 0 });
  });

  test("give each field in the order asked, each once", async () => {
    const fields = await computeFields(ticket, "/status", ["@key", "@path", "@key"]);
    expect(Object.keys(fields)).toEqual(["@key", "@path"]);
  });

  test("give @refs, which is not computed yet, as null, and leave @collection out for a record in no collection", async () => {
    expect(await computeFields(ticket, "/status", ["@refs", "@collection", "@path"])).toEqual({
      "@refs": null,
      "@path": "tickets/0171.md",
    });
    expect(NOT_COMPUTED_FIELDS).toEqual(["@refs"]);
  });

  test("give @collection from the context, for every node and every section below a section", async () => {
    const context = { collection: "tickets" };
    expect(await computeFields(ticket, "/status", ["@collection"], context)).toEqual({ "@collection": "tickets" });
    const fields = await computeFields(ticket, "", ["@collection", "@nodes"], context);
    expect(fields["@collection"]).toBe("tickets");
    expect(Object.values(fields["@nodes"] ?? {}).map((inner) => inner["@collection"])).toEqual(["tickets", "tickets"]);
  });

  test("give @issues with the severities of the context's configuration, leaving out those that are off", async () => {
    const parsed = record("d.md", '# T\n\n## A <a id="x"></a>\n\n## B <a id="x"></a>\n\n<b>bold</b>\n');
    const lenient = { severities: { uniqueness: "lenient", yamlQuoting: "compatible", issues: new Map() } } as const;
    const severities = async (context?: Parameters<typeof computeFields>[3]) =>
      ((await computeFields(parsed, "/$sections/1", ["@issues"], context))["@issues"] ?? []).map(
        (issue) => `${issue.code} ${issue.severity}`,
      );
    expect(await severities()).toEqual(["duplicate-anchor error", "duplicate-key error"]);
    expect(await severities(lenient)).toEqual(["duplicate-anchor warning", "duplicate-key warning"]);
    const off = {
      severities: { ...lenient.severities, issues: new Map([["duplicate-key", "off"]] as const) },
    };
    expect(await severities(off)).toEqual(["duplicate-anchor warning"]);
    const nested = await computeFields(parsed, "", ["@nodes"], { severities: lenient.severities });
    expect(Object.values(nested["@nodes"] ?? {})).toEqual([{}, {}]);
    const nestedIssues = await computeFields(parsed, "", ["@issues", "@nodes"], lenient);
    expect(nestedIssues["@nodes"]?.["/$sections/1"]?.["@issues"]?.map((issue) => issue.severity)).toEqual(["warning", "warning"]);
  });

  test("hash the value, not its source text, for @version", async () => {
    const lf = record("a.md", "---\nx: [1, 2]\n---\n\n# T\n\nBody.\n");
    const crlf = record("a.md", "---\r\nx:\r\n  - 1\r\n  - 2.0\r\n---\r\n\r\n# T\r\n\r\nBody.\r\n");
    for (const at of ["", "/x", "/$body"]) {
      const [a, b] = await Promise.all([lf, crlf].map((parsed) => computeFields(parsed, at, ["@version"])));
      expect(a, at).toEqual(b);
    }
    expect((await computeFields(lf, "/x", ["@version"]))["@version"]).toBe(await nodeVersion([1, 2]));
    const proto = record("p.json", '{"__proto__": {"a": 1}}');
    expect((await computeFields(proto, "/__proto__", ["@version"]))["@version"]).toBe(await nodeVersion({ a: 1 } as never));
  });

  test("give the issues attached to the node, and to a block those at its offset", async () => {
    const text = '# T\n\n<a id="9"></a>Nine.\n\n<a id="ok"></a>Fine.\n\n## A<a id="1st"></a>\n\nx\n';
    const parsed = record("i.md", text);
    expect((await computeFields(parsed, "/$sections/0", ["@issues"]))["@issues"]).toEqual([
      { code: "anchor-invalid", severity: "error", at: "/$sections/0", message: expect.any(String) },
    ]);
    expect((await computeFields(parsed, "/$body", ["@issues"]))["@issues"]).toHaveLength(1);
    const [nine] = targets(parsed, "#9");
    const [ok] = targets(parsed, "#ok");
    expect((await computeFields(parsed, nine as Target, ["@issues"]))["@issues"]).toHaveLength(1);
    expect((await computeFields(parsed, ok as Target, ["@issues"]))["@issues"]).toEqual([]);
    expect((await computeFields(parsed, "", ["@issues"]))["@issues"]).toEqual([]);
  });

  test("describe a block anchor by its `$body`, its range, its own anchor and its block in the file", async () => {
    const text = '# Minimal log\n\n- <a id="room"></a>**Room.** Seats ten.\n- Two chairs.\n';
    const parsed = record("m.md", text);
    const [room] = targets(parsed, "#room");
    const fields = await computeFields(parsed, room as Target, "all");
    const start = text.indexOf("- <a");
    const item = '- <a id="room"></a>**Room.** Seats ten.';
    expect(fields).toEqual({
      "@path": "m.md",
      "@at": "/$body",
      "@address": "#room",
      "@anchors": [{ name: "room", kind: "block" }],
      "@version": await nodeVersion('- <a id="room"></a>**Room.** Seats ten.'),
      "@source": { range: { start, end: start + item.length }, line: 3, col: 1 },
      "@range": { start: 0, end: item.length },
      "@issues": [],
      "@refs": null,
    });
  });

  test("give a duplicated block anchor the address of its `$body`", async () => {
    const parsed = record("d.md", '# D\n\n<a id="x"></a>One.\n\n<a id="x"></a>Two.\n');
    const [first, second] = targets(parsed, "#x");
    expect(first).toMatchObject({ address: "#$body", range: { start: 0, end: 18 } });
    expect(second).toMatchObject({ address: "#$body", range: { start: 20, end: 38 } });
    expect((await computeFields(parsed, first as Target, ["@address"]))["@address"]).toBe("#$body");
  });

  test("give @nodes, on request only, for each section below a section", async () => {
    const fields = await computeFields(ticket, "", ["@key", "@address", "@nodes"]);
    expect(fields).toEqual({
      "@address": "",
      "@nodes": {
        "/$sections/0": { "@key": "what-is-confirmed", "@address": "#what-is-confirmed" },
        "/$sections/1": { "@key": "done", "@address": "#done" },
      },
    });
    expect(await computeFields(ticket, "/$sections/1", ["@nodes"])).toEqual({ "@nodes": {} });
    // Every section below, at any depth, not only the children.
    const nested = record("n.md", "# R\n\n## A\n\n### B\n\n#### D\n\nx\n\n## C\n\ny\n");
    expect(await computeFields(nested, "", ["@key", "@nodes"])).toEqual({
      "@nodes": {
        "/$sections/0": { "@key": "a" },
        "/$sections/0/$sections/0": { "@key": "b" },
        "/$sections/0/$sections/0/$sections/0": { "@key": "d" },
        "/$sections/1": { "@key": "c" },
      },
    });
    expect(await computeFields(nested, "/$sections/0", ["@depth", "@nodes"])).toEqual({
      "@depth": 1,
      "@nodes": { "/$sections/0/$sections/0": { "@depth": 2 }, "/$sections/0/$sections/0/$sections/0": { "@depth": 3 } },
    });
    expect(await computeFields(ticket, "/status", ["@nodes"])).toEqual({});
  });

  test("throw a RangeError for a node or block the record does not have", async () => {
    await expect(computeFields(ticket, "/missing", ["@path"])).rejects.toThrow(RangeError);
    const body = { path: ticket.path, at: "/$body", address: "#$body" };
    await expect(computeFields(ticket, { ...body, range: { start: 0, end: 3 } }, ["@path"])).rejects.toThrow(RangeError);
    await expect(computeFields(ticket, { ...body, path: "other.md" }, ["@path"])).rejects.toThrow(RangeError);
    expect(await computeFields(ticket, body, ["@path"])).toEqual({ "@path": ticket.path });
  });

  test("names every computed field of the specification", () => {
    expect(COMPUTED_FIELD_NAMES).toEqual([
      "@path",
      "@at",
      "@address",
      "@key",
      "@anchors",
      "@version",
      "@source",
      "@range",
      "@issues",
      "@refs",
      "@collection",
      "@depth",
      "@nodes",
    ]);
  });
});
