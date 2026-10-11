import { describe, expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import { blockText, valueAt } from "./node-value.js";
import type { ParsedRecord } from "./record.js";

/** The record of a file that parses, failing the test otherwise. */
function record(path: string, text: string): ParsedRecord {
  const outcome = parseRecord(path, new TextEncoder().encode(text));
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => issue.code).join(", ")}`);
  return outcome.value;
}

describe("valueAt", () => {
  const data = record("d.json", '{"a": {"b": [1, {"c": "x"}]}, "__proto__": {"d": 2}, "a/b": 3}');

  test("gives the value of the root and of a node at any depth", () => {
    expect(valueAt(data, "")).toBe(data.value);
    expect(valueAt(data, "/a/b/1/c")).toBe("x");
    expect(valueAt(data, "/a/b")).toEqual([1, { c: "x" }]);
    expect(valueAt(data, "/a~1b")).toBe(3);
  });

  test("gives a member named __proto__ as an ordinary member", () => {
    expect(valueAt(data, "/__proto__")).toEqual({ d: 2 });
  });

  test("gives a Markdown section and its members", () => {
    const md = record("m.md", "# T\n\n## A\n\nText.\n");
    expect(valueAt(md, "/$sections/0/$body")).toBe("Text.");
  });

  test("throws a RangeError for a path with no node", () => {
    expect(() => valueAt(data, "/missing")).toThrow(RangeError);
    expect(() => valueAt(data, "/a/b/2")).toThrow(RangeError);
  });
});

describe("blockText", () => {
  test("gives a block anchor's text by the UTF-8 bytes of its `$body`, after line breaks read as LF", () => {
    const md = record("m.md", '# T\r\n\r\nÉté.\r\n\r\n<a id="room"></a>Röom\r\nsecond line.\r\n');
    const [room] = md.anchors.named("room");
    if (room?.kind !== "block") throw new Error("no block anchor");
    expect(blockText(md, room)).toBe('<a id="room"></a>Röom\nsecond line.');
  });
});
