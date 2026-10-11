import { describe, expect, test } from "vitest";
import { decodeSource } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";
import { NodeIndexBuilder } from "./node-index.js";
import { checkShape, nodeLocator, type ShapeUnit } from "./shape.js";

/** The code and `at` of each issue `checkShape` raises for `value` in `unit`, in order. */
function issuesOf(value: Value, unit: ShapeUnit = "record", at = ""): [string, string | null][] {
  return checkShape(unit, value as ValueObject, at, { path: "r.json" }).map((issue) => [issue.code, issue.at]);
}

describe("sections in a JSON or YAML record", () => {
  test("a well-formed record raises nothing", () => {
    const record = {
      $schema: "https://example.com/s.json",
      $title: "T",
      $anchor: "top",
      $tags: ["a", "b"],
      status: "open",
      $body: "text",
      $sections: [{ $title: "S", $anchor: "s", $tags: [], $body: "b", $sections: [{ $title: "U" }] }],
    };
    expect(issuesOf(record)).toEqual([]);
  });

  test.each([
    ["$title", 1],
    ["$body", null],
    ["$anchor", ["a"]],
    ["$tags", "a"],
    ["$tags", ["a", 1]],
    ["$sections", {}],
    ["$sections", [{ $title: "S" }, "x"]],
  ])("reserved-member-type for %s = %j, at the member", (name, value) => {
    expect(issuesOf({ [name]: value })).toEqual([["reserved-member-type", `/${name}`]]);
  });

  test("the same on an item of $sections", () => {
    expect(issuesOf({ $sections: [{ $title: "S", $body: 2 }] })).toEqual([["reserved-member-type", "/$sections/0/$body"]]);
  });

  test("section-title-missing at the item; a $title of the wrong type is a type error instead", () => {
    expect(issuesOf({ $sections: [{ $body: "b" }] })).toEqual([["section-title-missing", "/$sections/0"]]);
    expect(issuesOf({ $sections: [{ $title: 1 }] })).toEqual([["reserved-member-type", "/$sections/0/$title"]]);
    expect(issuesOf({ $body: "a root needs no title" })).toEqual([]);
    // An empty title is a title: only the Markdown serializer refuses it.
    expect(issuesOf({ $sections: [{ $title: "" }] })).toEqual([]);
  });

  test("dollar-member for $key on a section and $schema below the root", () => {
    expect(issuesOf({ $key: "k" })).toEqual([["dollar-member", "/$key"]]);
    expect(issuesOf({ $sections: [{ $title: "S", $key: "k" }] })).toEqual([["dollar-member", "/$sections/0/$key"]]);
    expect(issuesOf({ $sections: [{ $title: "S", $schema: "x" }] })).toEqual([["dollar-member", "/$sections/0/$schema"]]);
  });

  test("feature-unsupported for another $ member on a section", () => {
    expect(issuesOf({ $foo: 1 })).toEqual([["feature-unsupported", "/$foo"]]);
    expect(issuesOf({ $sections: [{ $title: "S", $ref: "x.md" }] })).toEqual([["feature-unsupported", "/$sections/0/$ref"]]);
  });

  test("a section's member names are escaped in exact paths", () => {
    expect(issuesOf({ "a/b": { $ref: 1 } })).toEqual([["ref-malformed", "/a~1b"]]);
  });

  test("an item of $sections reports every issue it has, and so does its parent", () => {
    expect(issuesOf({ $foo: 1, $sections: [{ $key: "k" }] })).toEqual([
      ["feature-unsupported", "/$foo"],
      ["section-title-missing", "/$sections/0"],
      ["dollar-member", "/$sections/0/$key"],
    ]);
  });
});

describe("field values", () => {
  test("$ members inside a field's value are data, as the suite's near misses have it", () => {
    expect(issuesOf({ data: { $key: 1, $schema: 2, $foo: 3, $title: 4 }, list: [{ $sections: 5, $body: 6 }] })).toEqual([]);
  });

  test("ref-malformed for a $ref object with another member or a $ref that is not a string, at the object", () => {
    expect(issuesOf({ parent: { $ref: "x.md", a: 1 }, child: { $ref: 1 } })).toEqual([
      ["ref-malformed", "/parent"],
      ["ref-malformed", "/child"],
    ]);
    expect(issuesOf({ deep: [{ x: { $ref: "a", $anchor: "b" } }] })).toEqual([["ref-malformed", "/deep/0/x"]]);
  });

  test("a well-formed $ref object, and $refs, are fine", () => {
    expect(issuesOf({ parent: { $ref: "x.md" }, other: { $refs: "x.md", a: 1 } })).toEqual([]);
  });

  test("$anchor and $tags on any object have their types", () => {
    expect(issuesOf({ contact: { $anchor: 1 } })).toEqual([["reserved-member-type", "/contact/$anchor"]]);
    expect(issuesOf({ shelf: { $tags: "a" } })).toEqual([["reserved-member-type", "/shelf/$tags"]]);
    expect(issuesOf({ shelf: [{ $tags: [true] }] })).toEqual([["reserved-member-type", "/shelf/0/$tags"]]);
    expect(issuesOf({ contact: { $anchor: "c", $tags: ["x"] } })).toEqual([]);
  });

  test("a malformed $ref object's other members are still checked", () => {
    expect(issuesOf({ x: { $ref: "a", $anchor: 2, inner: { $ref: 3 } } })).toEqual([
      ["ref-malformed", "/x"],
      ["reserved-member-type", "/x/$anchor"],
      ["ref-malformed", "/x/inner"],
    ]);
  });

  test("the root's $schema is not read", () => {
    expect(issuesOf({ $schema: { $ref: 1, $anchor: 2 } })).toEqual([]);
  });
});

describe("duplicate-tag", () => {
  test("one warning per repeat after the first, at the node that holds the array", () => {
    const issues = checkShape(
      "record",
      { $tags: ["open", "review", "open"], item: { $anchor: "item", $tags: ["a", "a", "a"] } },
      "",
      {
        path: "repeated-tags.yaml",
      },
    );
    expect(issues.map((issue) => [issue.code, issue.severity, issue.class, issue.at])).toEqual([
      ["duplicate-tag", "warning", "validation", ""],
      ["duplicate-tag", "warning", "validation", "/item"],
      ["duplicate-tag", "warning", "validation", "/item"],
    ]);
  });

  test("distinct tags raise nothing", () => {
    expect(issuesOf({ $tags: ["a", "A", "b"] })).toEqual([]);
  });
});

describe("front matter and data blocks", () => {
  test.each(["$key", "$title", "$anchor", "$tags", "$body", "$sections"])(
    "%s at the top of front matter is dollar-member",
    (name) => {
      expect(issuesOf({ [name]: "x" }, "front-matter")).toEqual([["dollar-member", `/${name}`]]);
    },
  );

  test("$schema in front matter is the root's; in a data block it is dollar-member", () => {
    expect(issuesOf({ $schema: "s" }, "front-matter")).toEqual([]);
    expect(issuesOf({ $schema: "s" }, "data-block", "/$sections/2")).toEqual([["dollar-member", "/$sections/2/$schema"]]);
  });

  test("another $ member is feature-unsupported, at the member below the section's path", () => {
    expect(issuesOf({ $foo: 1 }, "data-block", "/$sections/0")).toEqual([["feature-unsupported", "/$sections/0/$foo"]]);
    expect(issuesOf({ $foo: 1 }, "front-matter")).toEqual([["feature-unsupported", "/$foo"]]);
  });

  test("fields are checked as field values", () => {
    expect(issuesOf({ parent: { $ref: "x.md", a: 1 } }, "front-matter")).toEqual([["ref-malformed", "/parent"]]);
    expect(issuesOf({ runs: ["R1"], note: { $key: 1 } }, "data-block", "/$sections/0")).toEqual([]);
  });
});

describe("positions", () => {
  test("come from the node index: the member's range for a member, the node's otherwise", () => {
    const text = '{\n  "p": {"$ref": 1},\n  "$foo": 2}';
    const decoded = decodeSource("r.json", new TextEncoder().encode(text));
    if (!decoded.ok) throw new Error("not decoded");
    const builder = new NodeIndexBuilder({ range: { start: 0, end: text.length } });
    const p = builder.add("", "p", { kind: "object", range: { start: 9, end: 20 }, memberRange: { start: 4, end: 20 } });
    builder.add(p, "$ref", { kind: "number", range: { start: 18, end: 19 }, memberRange: { start: 10, end: 19 } });
    builder.add("", "$foo", { kind: "number", range: { start: 32, end: 33 }, memberRange: { start: 24, end: 33 } });
    const locate = nodeLocator(builder.build(), decoded.value);
    const issues = checkShape("record", { p: { $ref: 1 }, $foo: 2 }, "", { path: "r.json", locate });
    expect(issues.map((issue) => [issue.code, issue.position])).toEqual([
      ["ref-malformed", { offset: 4, line: 2, col: 3 }],
      ["feature-unsupported", { offset: 24, line: 3, col: 3 }],
    ]);
    expect(locate("/nowhere")).toBeUndefined();
  });

  test("are left out without a locator", () => {
    const [issue] = checkShape("record", { $foo: 1 }, "", { path: "r.json" });
    expect(issue).not.toHaveProperty("position");
    expect(issue?.path).toBe("r.json");
  });
});
