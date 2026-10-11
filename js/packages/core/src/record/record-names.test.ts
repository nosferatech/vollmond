import { describe, expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import { ISSUE_CODES } from "../issue/codes.js";
import type { ParsedRecord } from "./record.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

/** The record of a file that parses, failing the test otherwise. */
function record(path: string, text: string): ParsedRecord {
  const outcome = parseRecord(path, utf8(text));
  if (!outcome.ok) throw new Error(`failed: ${outcome.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return outcome.value;
}

/** The anchors of a record as the suite lists them: name, kind and exact path. */
function anchorsOf(path: string, text: string): string[] {
  return record(path, text).anchors.anchors.map((entry) => `${entry.kind} ${entry.name} ${entry.at}`);
}

/** The code and `at` of each issue of the codes that names raise. */
function nameIssues(path: string, text: string): [string, string | null][] {
  return record(path, text)
    .issues.filter((issue) => ["anchor-invalid", "duplicate-anchor", "duplicate-key"].includes(issue.code))
    .map((issue) => [issue.code, issue.at]);
}

describe("the anchor table", () => {
  test("lists a Markdown heading's explicit anchor before its derived one, and block anchors with their ranges", () => {
    const text =
      '# Title<a id="top" class="a b"></a>\n\n<a id="room"></a>Room.\n\n## Done<a id="done"></a>\n\n- <a id="item"></a>One\n';
    const table = record("r.md", text).anchors;
    expect(table.anchors.map((entry) => `${entry.kind} ${entry.name} ${entry.at}`)).toEqual([
      "explicit top ",
      "derived title ",
      "block room /$body",
      "explicit done /$sections/0",
      "derived done /$sections/0",
      "block item /$sections/0/$body",
    ]);
    expect(table.tags).toEqual([
      { tag: "a", at: "" },
      { tag: "b", at: "" },
    ]);
    expect(table.named("done").map((entry) => entry.kind)).toEqual(["explicit", "derived"]);
    expect(table.of("/$sections/0").map((entry) => entry.kind)).toEqual(["explicit", "derived"]);
    expect(table.of("/$body")).toEqual([]);
    expect(table.named("room")).toEqual([
      { name: "room", kind: "block", at: "/$body", range: { start: 0, end: 22 }, fileRange: { start: 37, end: 59 } },
    ]);
    expect(table.named("missing")).toEqual([]);
    expect(Object.isFrozen(table.anchors[0])).toBe(true);
  });

  test("labels JSON and YAML objects at any depth, the root and sections included, with no derived anchors", () => {
    const json =
      '{"$anchor": "root", "$tags": ["t"], "a": [[{"$anchor": "deep"}]], "$sections": [{"$title": "S", "$anchor": "s"}]}';
    expect(anchorsOf("r.json", json)).toEqual(["explicit root ", "explicit deep /a/0/0", "explicit s /$sections/0"]);
    expect(record("r.json", json).anchors.tags).toEqual([{ tag: "t", at: "" }]);
    expect(anchorsOf("r.yaml", "shelf:\n  $anchor: shelf\n  items:\n    - $anchor: milk\n")).toEqual([
      "explicit shelf /shelf",
      "explicit milk /shelf/items/0",
    ]);
  });

  test("labels objects in front matter and in a data block", () => {
    const text = "---\ncontact:\n  $anchor: desk\n---\n# Help\n\n## Notes\n\n```yaml data\nowner:\n  $anchor: me\n```\n";
    expect(anchorsOf("r.md", text)).toEqual([
      "explicit desk /contact",
      "derived help ",
      "derived notes /$sections/0",
      "explicit me /$sections/0/owner",
    ]);
  });

  test("does not look into the root's $schema, which is stored data", () => {
    expect(anchorsOf("r.json", '{"$schema": {"$anchor": "inside", "$tags": ["x"]}, "a": {"$anchor": "a"}}')).toEqual([
      "explicit a /a",
    ]);
    expect(record("r.json", '{"$schema": {"$tags": ["x"]}}').anchors.tags).toEqual([]);
  });

  test("looks into other $ members of a field's value, which are data", () => {
    expect(anchorsOf("r.json", '{"a": {"$data": {"$anchor": "x"}, "$sections": [{"$anchor": "y"}]}}')).toEqual([
      "explicit x /a/$data",
      "explicit y /a/$sections/0",
    ]);
  });

  test("lists tags in document order of their nodes, and in each node's order", () => {
    const yaml = "$tags: [r]\nb:\n  $tags: [b2, b1]\n  c:\n    $tags: [c]\nd:\n  $tags: [d]\n";
    expect(record("r.yaml", yaml).anchors.tags.map((entry) => `${entry.tag} ${entry.at}`)).toEqual([
      "r ",
      "b2 /b",
      "b1 /b",
      "c /b/c",
      "d /d",
    ]);
  });

  test("lists a tag repeated in a data $tags array once for its node", () => {
    expect(record("r.yaml", "$tags: [a, b, a]\n").anchors.tags).toEqual([
      { tag: "a", at: "" },
      { tag: "b", at: "" },
    ]);
  });

  test("lists anchors in document order, not in the order of the value's members, which puts integer-like names first", () => {
    const json = '{"b": {"$anchor": "x"}, "2": {"$anchor": "y"}, "1": {"$anchor": "z"}}';
    expect(anchorsOf("r.json", json)).toEqual(["explicit x /b", "explicit y /2", "explicit z /1"]);
  });
});

describe("section keys", () => {
  test("are the $anchor, or else the slug: a Markdown heading's, or a data $title's read as heading content", () => {
    const markdown = record("r.md", '# T\n\n## What *is* done\n\n## Other<a id="x"></a>\n\n## Notes\n\n## Notes\n');
    expect([...markdown.sectionKeys]).toEqual([
      ["/$sections/0", "what-is-done"],
      ["/$sections/1", "x"],
      ["/$sections/2", "notes"],
      ["/$sections/3", "notes"],
    ]);
    const yaml = record("r.yaml", '$sections:\n  - $title: "A [link](x.md) &amp; more"\n  - $title: B\n    $anchor: b\n');
    expect([...yaml.sectionKeys]).toEqual([
      ["/$sections/0", "a-link--more"],
      ["/$sections/1", "b"],
    ]);
  });

  test("of nested sections, by their exact paths; the root has none", () => {
    const keys = record(
      "r.json",
      '{"$title": "Root", "$sections": [{"$title": "A", "$sections": [{"$title": "B"}]}]}',
    ).sectionKeys;
    expect([...keys].sort()).toEqual([
      ["/$sections/0", "a"],
      ["/$sections/0/$sections/0", "b"],
    ]);
  });

  test("a heading whose slug is empty has the empty key", () => {
    expect([...record("r.md", "## !\n").sectionKeys]).toEqual([["/$sections/0", ""]]);
  });
});

describe("anchor-invalid", () => {
  test("fires once for each anchor and each tag that is not a name, at the node that carries it", () => {
    expect(nameIssues("r.yaml", "first:\n  $anchor: 1st\nsecond:\n  $tags: [ok, -bad]\n")).toEqual([
      ["anchor-invalid", "/first"],
      ["anchor-invalid", "/second"],
    ]);
    expect(nameIssues("r.yaml", "a:\n  $anchor: 1st\n  $tags: [_x]\n")).toEqual([
      ["anchor-invalid", "/a"],
      ["anchor-invalid", "/a"],
    ]);
  });

  test("fires for a heading's id and class, and an empty id, at the section", () => {
    const text =
      '# T\n\n## A<a id="1a"></a>\n\n## B<a class="_b"></a>\n\n## C<a id=""></a>\n\n## D<a id="Shelf_A-1" class="x-1 Y_"></a>\n';
    expect(nameIssues("r.md", text)).toEqual([
      ["anchor-invalid", "/$sections/0"],
      ["anchor-invalid", "/$sections/1"],
      ["anchor-invalid", "/$sections/2"],
    ]);
  });

  test("fires for a block anchor at the $body that holds it, with the block's offset in the body", () => {
    const issues = record("r.md", 'Intro.\n\n<a id="9"></a>Nine.\n').issues.filter((issue) => issue.code === "anchor-invalid");
    expect(issues.map((issue) => [issue.at, issue.offset, issue.position?.line])).toEqual([["/$body", 8, 3]]);
  });

  test("near miss: names of letters, digits, _ and -, starting with a letter, raise none; a derived anchor is never checked", () => {
    expect(nameIssues("r.md", '# 1 Title\n\n## Größe<a id="A-1_b" class="t"></a>\n\n<a id="z9"></a>Text.\n')).toEqual([]);
    expect(nameIssues("r.json", '{"a": {"$anchor": "Shelf_A-1", "$tags": ["x", "Y-2"]}}')).toEqual([]);
  });

  test("is a validation error at the node's position", () => {
    const [issue] = record("r.json", '{"a": {"$anchor": "1"}}').issues;
    expect([issue?.severity, issue?.class, issue?.position?.col]).toEqual(["error", "validation", 8]);
    expect(ISSUE_CODES["anchor-invalid"].classes).toEqual(["validation"]);
  });
});

describe("duplicate-anchor", () => {
  test("fires once for each node after the first that an anchor names, in document order", () => {
    const text = '# T\n\n## A<a id="same"></a>\n\n### B<a id="same"></a>\n\n#### C<a id="same"></a>\n';
    expect(nameIssues("r.md", text)).toEqual([
      ["duplicate-anchor", "/$sections/0/$sections/0"],
      ["duplicate-anchor", "/$sections/0/$sections/0/$sections/0"],
    ]);
  });

  test("near miss: a node's explicit and derived anchors of one name, and names that differ only in letter case", () => {
    expect(nameIssues("r.md", '# T\n\n## Done<a id="done"></a>\n')).toEqual([]);
    expect(nameIssues("r.md", '# T\n\n## Done\n\n## Later<a id="Done"></a>\n')).toEqual([]);
  });

  test("fires once for a heading whose explicit and derived anchors both repeat an earlier block anchor", () => {
    expect(nameIssues("r.md", '# T\n\n<a id="room"></a>Seats ten.\n\n## Room<a id="room"></a>\n')).toEqual([
      ["duplicate-anchor", "/$sections/0"],
    ]);
  });

  test("names in its message the anchor that repeats, not the node's first one", () => {
    const issue = record("r.md", '# T\n\n<a id="room"></a>Seats ten.\n\n## Room<a id="hall"></a>\n').issues[0];
    expect([issue?.code, issue?.message]).toEqual([
      "duplicate-anchor",
      'the anchor "room" also names an earlier node, at "/$body"',
    ]);
  });

  test("tells two block anchors of one $body apart, though they share its exact path", () => {
    const issues = record("r.md", '<a id="x"></a>One.\n\n- <a id="x"></a>Two.\n').issues;
    expect(issues.map((issue) => [issue.code, issue.at, issue.offset])).toEqual([["duplicate-anchor", "/$body", 20]]);
  });

  test("is attached to a block anchor's $body when the block repeats its own section's anchor", () => {
    expect(nameIssues("r.md", '# T\n\n## Room\n\n<a id="room"></a>Seats ten.\n')).toEqual([
      ["duplicate-anchor", "/$sections/0/$body"],
    ]);
  });

  test("orders front matter before the title heading, so the heading is the repeat", () => {
    expect(nameIssues("r.md", "---\ncontact:\n  $anchor: help\n---\n# Help\n")).toEqual([["duplicate-anchor", ""]]);
  });

  test("orders JSON members by their place in the file, not by the value's order of members", () => {
    expect(nameIssues("r.json", '{"2": {"$anchor": "x"}, "1": {"$anchor": "x"}}')).toEqual([["duplicate-anchor", "/1"]]);
  });

  test("counts explicit anchors on data objects in the one namespace", () => {
    expect(nameIssues("r.yaml", "people:\n  - $anchor: person\n  - $anchor: person\n")).toEqual([
      ["duplicate-anchor", "/people/1"],
    ]);
  });
});

describe("duplicate-key", () => {
  test("fires for a front-matter field and a section key of the root, at the section, which comes later", () => {
    expect(nameIssues("r.md", "---\nstatus: open\n---\n# T\n\n## Status\n")).toEqual([["duplicate-key", "/$sections/0"]]);
  });

  test("fires for a JSON field after the $sections that hold its key, at the field", () => {
    expect(nameIssues("r.json", '{"$sections": [{"$title": "Status"}], "status": 1}')).toEqual([["duplicate-key", "/status"]]);
  });

  test("orders an integer-like field by its place in the file", () => {
    expect(nameIssues("r.json", '{"$sections": [{"$title": "1"}], "1": true}')).toEqual([["duplicate-key", "/1"]]);
  });

  test("fires for a data block's field and a child section's key", () => {
    const text = "# T\n\n## Parent\n\n```yaml data\nnotes: 1\n```\n\n### Notes\n";
    expect(nameIssues("r.md", text)).toEqual([["duplicate-key", "/$sections/0/$sections/0"]]);
  });

  test("fires once for each repeat of a key among siblings, keys from anchors included", () => {
    const text = '# T\n\n## Notes\n\n## Notes\n\n## Other<a id="notes"></a>\n';
    expect(nameIssues("r.md", text)).toEqual([
      ["duplicate-key", "/$sections/1"],
      ["duplicate-anchor", "/$sections/2"],
      ["duplicate-key", "/$sections/2"],
    ]);
  });

  test("fires for two JSON sections whose titles slug alike as Markdown", () => {
    expect(nameIssues("r.json", '{"$sections": [{"$title": "What *is* done"}, {"$title": "What is done"}]}')).toEqual([
      ["duplicate-key", "/$sections/1"],
    ]);
  });

  test("near miss: the same key at different levels, and a field whose name differs in letter case", () => {
    expect(nameIssues("r.md", "# T\n\n## Notes\n\n### Notes\n")).toEqual([]);
    expect(nameIssues("r.md", "---\nStatus: open\n---\n# T\n\n## status\n")).toEqual([]);
  });
});
