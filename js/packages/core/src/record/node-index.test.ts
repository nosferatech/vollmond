import { describe, expect, test } from "vitest";
import { childPath } from "./exact-path.js";
import { NodeIndexBuilder } from "./node-index.js";

const r = (start: number, end: number) => ({ start, end });

describe("childPath", () => {
  test("escapes ~ before /, as RFC 6901 requires", () => {
    expect(childPath("", "a")).toBe("/a");
    expect(childPath("/a", 0)).toBe("/a/0");
    expect(childPath("", "a/b")).toBe("/a~1b");
    expect(childPath("", "m~n")).toBe("/m~0n");
    // `~1` written as data must not read back as `/`: escaping `/` first would give `~01`, read as `~1`.
    expect(childPath("", "~1")).toBe("/~01");
    expect(childPath("", "/~")).toBe("/~1~0");
    expect(childPath("", "")).toBe("/");
  });
});

/** The index of `{"$title": "T", "tags": [1], "$sections": [{"$title": "S", "$sections": [{"$title": "U"}]}]}`, roughly. */
function sampleIndex() {
  const builder = new NodeIndexBuilder({ range: r(0, 100) });
  builder.add("", "$title", { kind: "string", range: r(11, 14), memberRange: r(1, 14) });
  const tags = builder.add("", "tags", { kind: "array", range: r(24, 27), memberRange: r(16, 27) });
  builder.add(tags, 0, { kind: "number", range: r(25, 26) });
  const sections = builder.add("", "$sections", { kind: "array", range: r(42, 99), memberRange: r(29, 99) });
  const first = builder.add(sections, 0, { kind: "object", range: r(43, 98) });
  builder.add(first, "$title", { kind: "string", range: r(54, 57), memberRange: r(44, 57) });
  const nested = builder.add(first, "$sections", { kind: "array", range: r(72, 97), memberRange: r(59, 97) });
  builder.add(nested, 0, { kind: "object", range: r(73, 96) });
  return builder.build();
}

describe("NodeIndexBuilder", () => {
  test("indexes every node with its exact path, parent, key, kind and ranges", () => {
    const index = sampleIndex();
    expect(index.node("")).toMatchObject({ at: "", parent: null, key: null, kind: "section", range: r(0, 100), depth: 0 });
    expect(index.node("/tags")).toEqual({
      at: "/tags",
      parent: "",
      key: "tags",
      kind: "array",
      range: r(24, 27),
      memberRange: r(16, 27),
    });
    expect(index.node("/tags/0")).toEqual({ at: "/tags/0", parent: "/tags", key: 0, kind: "number", range: r(25, 26) });
    expect(index.node("/missing")).toBeUndefined();
  });

  test("keeps children in the order they were added", () => {
    const index = sampleIndex();
    expect(index.children("").map((node) => node.key)).toEqual(["$title", "tags", "$sections"]);
    expect(index.children("/tags/0")).toEqual([]);
    expect(index.children("/missing")).toEqual([]);
  });

  test("makes the object items of a section's $sections sections, with their depth", () => {
    const index = sampleIndex();
    expect(index.sections().map((section) => [section.at, section.depth, section.heading])).toEqual([
      ["", 0, null],
      ["/$sections/0", 1, null],
      ["/$sections/0/$sections/0", 2, null],
    ]);
    expect(index.node("/$sections")?.kind).toBe("array");
  });

  test("leaves a $sections inside a field's value as data", () => {
    const builder = new NodeIndexBuilder({ range: r(0, 50) });
    const field = builder.add("", "data", { kind: "object", range: r(8, 49) });
    const list = builder.add(field, "$sections", { kind: "array", range: r(21, 48) });
    builder.add(list, 0, { kind: "object", range: r(22, 47) });
    const index = builder.build();
    expect(index.node("/data/$sections/0")?.kind).toBe("object");
    expect(index.sections().map((section) => section.at)).toEqual([""]);
  });

  test("an item of $sections that is not an object stays its kind", () => {
    const builder = new NodeIndexBuilder({ range: r(0, 20) });
    const list = builder.add("", "$sections", { kind: "array", range: r(13, 19) });
    builder.add(list, 0, { kind: "string", range: r(14, 17) });
    expect(builder.build().node("/$sections/0")?.kind).toBe("string");
  });

  test("gives Markdown headings their derived anchors at build", () => {
    const builder = new NodeIndexBuilder({ range: r(0, 40), heading: { level: 1, range: r(0, 8) } });
    const list = builder.add("", "$sections", { kind: "array", range: r(10, 40) });
    builder.add(list, 0, { kind: "object", range: r(10, 25), heading: { level: 2, range: r(10, 20) } });
    builder.add(list, 1, { kind: "object", range: r(25, 40), heading: { level: 2, range: r(25, 35) } });
    const index = builder.build(new Map([["/$sections/0", "notes"]]));
    expect(index.sections().map((section) => section.heading)).toEqual([
      { level: 1, range: r(0, 8), derivedAnchor: null },
      { level: 2, range: r(10, 20), derivedAnchor: "notes" },
      { level: 2, range: r(25, 35), derivedAnchor: null },
    ]);
  });

  test("kind tells a section from a value node, for the type checker too", () => {
    const depths = [...sampleIndex().children(""), sampleIndex().node("")].map((node) =>
      // Only a section has a depth; on a value node the member does not exist for the type checker.
      node?.kind === "section" ? node.depth : node?.kind,
    );
    expect(depths).toEqual(["string", "array", "array", 0]);
    expect(sampleIndex().node("/tags")).not.toHaveProperty("depth");
    expect(sampleIndex().node("/tags")).not.toHaveProperty("heading");
  });

  test("builds an immutable index", () => {
    const index = sampleIndex();
    expect(Object.isFrozen(index.node("/tags"))).toBe(true);
    expect(Object.isFrozen(index.children(""))).toBe(true);
    expect(Object.isFrozen(index.sections())).toBe(true);
    expect(Object.isFrozen(index.sections()[0])).toBe(true);
  });
});

describe("NodeIndexBuilder refuses a parser's mistakes", () => {
  const fresh = () => {
    const builder = new NodeIndexBuilder({ range: r(0, 10) });
    const list = builder.add("", "list", { kind: "array", range: r(1, 9) });
    builder.add(list, 0, { kind: "string", range: r(2, 3) });
    return builder;
  };

  test.each([
    ["an unknown parent", (b: NodeIndexBuilder) => b.add("/nope", "a", { kind: "null", range: r(0, 1) })],
    ["a scalar parent", (b: NodeIndexBuilder) => b.add("/list/0", "a", { kind: "null", range: r(0, 1) })],
    ["an index out of order", (b: NodeIndexBuilder) => b.add("/list", 2, { kind: "null", range: r(0, 1) })],
    ["a name under an array", (b: NodeIndexBuilder) => b.add("/list", "1", { kind: "null", range: r(0, 1) })],
    ["an index under an object", (b: NodeIndexBuilder) => b.add("", 0, { kind: "null", range: r(0, 1) })],
    ["a repeated member", (b: NodeIndexBuilder) => b.add("", "list", { kind: "null", range: r(0, 1) })],
    [
      "a member range on an item",
      (b: NodeIndexBuilder) => b.add("/list", 1, { kind: "null", range: r(3, 4), memberRange: r(3, 4) }),
    ],
    [
      "a heading on a field",
      (b: NodeIndexBuilder) => b.add("", "x", { kind: "object", range: r(0, 1), heading: { level: 2, range: r(0, 1) } }),
    ],
    ["a reversed range", (b: NodeIndexBuilder) => b.add("", "x", { kind: "null", range: r(5, 4) })],
    ["a fractional range", (b: NodeIndexBuilder) => b.add("", "x", { kind: "null", range: r(0.5, 4) })],
    ["a derived anchor for a section without a heading", (b: NodeIndexBuilder) => b.build(new Map([["", "x"]]))],
    ["a derived anchor for a field", (b: NodeIndexBuilder) => b.build(new Map([["/list", "x"]]))],
  ])("%s", (_name, misuse) => {
    const builder = fresh();
    expect(() => misuse(builder)).toThrow(RangeError);
    // The builder is unchanged: the near miss still goes in.
    builder.add("/list", 1, { kind: "null", range: r(3, 4) });
    builder.add("", "x", { kind: "null", range: r(5, 6), memberRange: r(4, 6) });
    expect(
      builder
        .build()
        .children("")
        .map((node) => node.key),
    ).toEqual(["list", "x"]);
  });

  test("any call after build", () => {
    const builder = fresh();
    builder.build();
    expect(() => builder.add("", "x", { kind: "null", range: r(0, 1) })).toThrow(RangeError);
    expect(() => builder.build()).toThrow(RangeError);
  });

  test("a range on the root that is not a range", () => {
    expect(() => new NodeIndexBuilder({ range: r(3, 1) })).toThrow(RangeError);
    expect(new NodeIndexBuilder({ range: r(0, 0) }).build().sections()).toHaveLength(1);
  });
});
