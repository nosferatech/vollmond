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

  test("a $title of more than 4,096 runs is a syntax-error at the root, whatever section it titles", () => {
    const title = (runs: number) => "*a* ".repeat(runs / 2);
    expect(issuesOf({ $title: title(4096), $sections: [{ $title: title(4096) }] })).toEqual([]);
    expect(issuesOf({ $title: `${title(4096)}_b_` })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $sections: [{ $title: `${title(4096)}_b_` }] })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $sections: [{ $title: "S", $sections: [{ $title: `${title(4096)}~b~` }] }] })).toEqual([
      ["syntax-error", ""],
    ]);
  });

  test("near miss: the runs of a $title count on their own, not with those of another title or of a $body", () => {
    const title = "*a* ".repeat(2048);
    expect(issuesOf({ $title: title, $body: title, $sections: [{ $title: title, $body: title }, { $title: title }] })).toEqual(
      [],
    );
    expect(issuesOf({ $title: "\\* ".repeat(5000) })).toEqual([]);
  });

  test("the link reference definitions of the record's $body values are in scope for a $title's runs, as in Markdown", () => {
    // The `*` of a defined label are not runs, since the library reads the label without its text constructs.
    const title = "[a][*b*] ".repeat(2049);
    expect(issuesOf({ $body: "[*b*]: /x", $sections: [{ $title: title }] })).toEqual([]);
    expect(issuesOf({ $sections: [{ $title: title, $body: "[*b*]: /x" }] })).toEqual([]);
    expect(issuesOf({ $sections: [{ $title: "S", $body: "[*b*]: /x", $sections: [{ $title: title }] }] })).toEqual([]);
    // Without the definition they are runs: 4,098 of them.
    expect(issuesOf({ $sections: [{ $title: title }] })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: "[b]: /x", $sections: [{ $title: title }] })).toEqual([["syntax-error", ""]]);
  });

  test("a reference link that a definition makes counts as an inline level of a $title, as in Markdown", () => {
    const around = (levels: number) => `${"*a ".repeat(levels)}[b][r]${" a*".repeat(levels)}`;
    const definition = "[r]: /x";
    expect(issuesOf({ $body: definition, $sections: [{ $title: around(255) }] })).toEqual([]);
    expect(issuesOf({ $body: definition, $sections: [{ $title: around(256) }] })).toEqual([["syntax-error", ""]]);
    // Without the definition it is text, and 256 levels of emphasis are within the limit.
    expect(issuesOf({ $sections: [{ $title: around(256) }] })).toEqual([]);
  });

  test("a record with several titles beyond a limit has one syntax-error, at the first", () => {
    const title = "*a* ".repeat(2049);
    const nested = `${"*a ".repeat(257)}b${" a*".repeat(257)}`;
    expect(issuesOf({ $title: title, $sections: [{ $title: title }, { $title: nested }] })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $sections: [{ $title: "S" }, { $title: nested }, { $title: title }] })).toEqual([["syntax-error", ""]]);
  });

  test("a $body past a Markdown limit is a syntax-error at the root, in every section's $body", () => {
    const quotes = (levels: number) => `${">".repeat(levels)} a`;
    const runs = (count: number) => "*a* ".repeat(count / 2);
    const emphasis = (levels: number) => `${"*a ".repeat(levels)}b${" a*".repeat(levels)}`;
    expect(issuesOf({ $body: quotes(257) })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $sections: [{ $title: "S", $body: quotes(257) }] })).toEqual([["syntax-error", ""]]);
    const nested = { $sections: [{ $title: "S", $sections: [{ $title: "U", $body: `Text.\n\n${runs(4096)}_b_` }] }] };
    expect(issuesOf(nested)).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: emphasis(257) })).toEqual([["syntax-error", ""]]);
    // A list item is a container as a block quote is, and a table cell holds its own runs.
    expect(issuesOf({ $body: `${"- ".repeat(257)}a` })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: `| h |\n| - |\n| ${runs(4096)}_b_ |` })).toEqual([["syntax-error", ""]]);
  });

  test("a U+FEFF that starts a $body is a character, not a byte order mark that the Markdown library skips", () => {
    const quotes = `\uFEFF${">".repeat(257)} a`;
    expect(issuesOf({ $body: quotes, $sections: [{ $title: "S", $body: quotes }] })).toEqual([]);
    expect(issuesOf({ $body: `\uFEFF    ${"*a* ".repeat(2049)}` })).toEqual([["syntax-error", ""]]);
    // Nor does a definition after it define anything, for its own $body or another.
    const references = "[a][*b*] ".repeat(2049);
    expect(issuesOf({ $body: `\uFEFF[*b*]: /x\n\n${references}` })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: "\uFEFF[*b*]: /x", $sections: [{ $title: "S", $body: references }] })).toEqual([
      ["syntax-error", ""],
    ]);
  });

  test("near miss: a $body at the limits reads, and its runs count per paragraph, not for the whole $body", () => {
    const runs = "*a* ".repeat(2048);
    expect(issuesOf({ $body: `${">".repeat(256)} a` })).toEqual([]);
    expect(issuesOf({ $body: `${"*a ".repeat(256)}b${" a*".repeat(256)}` })).toEqual([]);
    expect(issuesOf({ $sections: [{ $title: "S", $body: `${runs}\n\n${runs}\n\n# ${runs}\n\n| ${runs} |\n| - |` }] })).toEqual(
      [],
    );
    // The text of a `$body` is not inline content as a title's is: escaped and fenced characters are no runs.
    expect(issuesOf({ $body: `${"\\* ".repeat(5000)}\n\n\`\`\`\n${"*a* ".repeat(5000)}\n\`\`\`` })).toEqual([]);
  });

  test("the link reference definitions of a $body are in scope for its own runs, as in a Markdown file", () => {
    // The `*` of a defined label are not runs, since the library reads the label without its text constructs.
    const references = "[a][*b*] ".repeat(2049);
    expect(issuesOf({ $body: `${references}\n\n[*b*]: /x` })).toEqual([]);
    expect(issuesOf({ $sections: [{ $title: "S", $body: `[*b*]: /x\n\n${references}` }] })).toEqual([]);
    // Without the definition they are runs: 4,098 of them.
    expect(issuesOf({ $body: `[b]: /x\n\n${references}` })).toEqual([["syntax-error", ""]]);
  });

  test("every $body has the definitions of all the record's $body values in scope, as one Markdown file has", () => {
    const references = "[a][*b*] ".repeat(2049);
    // The definition before the text, after it, and in a section that is neither its parent nor its child.
    expect(issuesOf({ $body: "[*b*]: /x", $sections: [{ $title: "S", $body: references }] })).toEqual([]);
    expect(issuesOf({ $body: references, $sections: [{ $title: "S", $body: "[*b*]: /x" }] })).toEqual([]);
    const siblings = [
      { $title: "S", $sections: [{ $title: "U", $body: references }] },
      { $title: "V", $body: "[*b*]: /x" },
    ];
    expect(issuesOf({ $sections: siblings })).toEqual([]);
    // A definition of another label leaves them runs.
    expect(issuesOf({ $body: "[b]: /x", $sections: [{ $title: "S", $body: references }] })).toEqual([["syntax-error", ""]]);
    // A reference link that another $body defines is an inline level, as in Markdown.
    const around = (levels: number) => `${"*a ".repeat(levels)}[b][r]${" a*".repeat(levels)}`;
    expect(issuesOf({ $body: "[r]: /x", $sections: [{ $title: "S", $body: around(255) }] })).toEqual([]);
    expect(issuesOf({ $body: "[r]: /x", $sections: [{ $title: "S", $body: around(256) }] })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: "[s]: /x", $sections: [{ $title: "S", $body: around(256) }] })).toEqual([]);
  });

  test("a $body whose own text passes a limit only without the record's definitions still defines its labels", () => {
    // The section's $body holds 4,098 runs unless the root's definition is in scope, and defines `c`, which makes the
    // title's `[t][c]` a reference link, a 257th inline level.
    const body = `[c]: /y\n\n${"[a][*b*] ".repeat(2049)}`;
    const title = `${"*a ".repeat(256)}[t][c]${" a*".repeat(256)}`;
    expect(issuesOf({ $body: "[*b*]: /x", $sections: [{ $title: "S", $body: body }] })).toEqual([]);
    expect(issuesOf({ $body: "[*b*]: /x", $sections: [{ $title: "S", $body: body }, { $title: title }] })).toEqual([
      ["syntax-error", ""],
    ]);
  });

  test("a record with several $body values or titles past a limit has one syntax-error, at the first", () => {
    const deep = `${">".repeat(257)} a`;
    const title = "*a* ".repeat(2049);
    expect(
      issuesOf({
        $body: deep,
        $sections: [
          { $title: "S", $body: deep },
          { $title: "U", $body: deep },
        ],
      }),
    ).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $title: title, $body: deep, $sections: [{ $title: title, $body: deep }] })).toEqual([["syntax-error", ""]]);
    expect(issuesOf({ $body: deep, $title: title })).toEqual([["syntax-error", ""]]);
  });

  test("a $body past a limit is positioned at its member, and is not parsed when it is not a string", () => {
    const decoded = decodeSource("r.json", new TextEncoder().encode(" ".repeat(40)));
    if (!decoded.ok) throw new Error("not UTF-8");
    const builder = new NodeIndexBuilder({ range: { start: 0, end: 40 } });
    builder.add("", "$title", { kind: "string", range: { start: 10, end: 13 }, memberRange: { start: 1, end: 13 } });
    builder.add("", "$body", { kind: "string", range: { start: 24, end: 39 }, memberRange: { start: 15, end: 39 } });
    const locate = nodeLocator(builder.build(), decoded.value);
    const [issue, ...others] = checkShape("record", { $title: "T", $body: `${">".repeat(257)} a` }, "", {
      path: "r.json",
      locate,
    });
    expect([issue?.code, issue?.at, issue?.position?.offset, others]).toEqual(["syntax-error", "", 15, []]);
    expect(issuesOf({ $body: ["> ".repeat(257)] })).toEqual([["reserved-member-type", "/$body"]]);
  });

  test("a title with too many runs is positioned at its member, and is not looked at when it is not a string", () => {
    const decoded = decodeSource("r.json", new TextEncoder().encode(" ".repeat(40)));
    if (!decoded.ok) throw new Error("not UTF-8");
    const builder = new NodeIndexBuilder({ range: { start: 0, end: 40 } });
    const sections = builder.add("", "$sections", { kind: "array", range: { start: 14, end: 40 } });
    const section = builder.add(sections, 0, { kind: "object", range: { start: 15, end: 39 } });
    builder.add(section, "$title", { kind: "string", range: { start: 25, end: 30 }, memberRange: { start: 17, end: 30 } });
    const locate = nodeLocator(builder.build(), decoded.value);
    const value = { $sections: [{ $title: "*a* ".repeat(2049) }] };
    const [issue] = checkShape("record", value, "", { path: "r.json", locate });
    expect([issue?.code, issue?.at, issue?.position?.offset]).toEqual(["syntax-error", "", 17]);
    expect(issuesOf({ $title: 1 })).toEqual([["reserved-member-type", "/$title"]]);
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

  test("issues follow the object's member order, which lists integer-like names first", () => {
    expect(issuesOf({ b: { $ref: 1 }, "10": { $ref: 1 }, a: { $ref: 1 }, "2": { $ref: 1 } })).toEqual([
      ["ref-malformed", "/2"],
      ["ref-malformed", "/10"],
      ["ref-malformed", "/b"],
      ["ref-malformed", "/a"],
    ]);
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
