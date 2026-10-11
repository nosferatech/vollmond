import fc from "fast-check";
import { expect, test } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import type { NodeInfo } from "../record/node-index.js";
import type { ParsedRecord } from "../record/record.js";
import { encodeStep, parseAddress } from "./address.js";
import { blockAnchorAddress, canonicalAddress, resolveAddress } from "./resolve.js";

// Records whose names collide and need encoding: member names with `/`, `~`, `%`, spaces, non-ASCII, the empty name,
// index-like names and `__proto__`; explicit anchors repeated across objects and sections, and equal to root members; and
// sections whose titles repeat or slug to nothing. Every node's canonical address must read back and resolve, as a singular
// address, to that node alone.

const NAMES = ["a", "b", "x y", "a/b", "~0", "~1", "100%", "été", "", "01", "1", "__proto__", "entry", "notes", "?:@", "#"];
const ANCHORS = ["entry", "notes", "a", "dup", "x-1", "past"];
const TITLES = ["Notes", "Entry", "notes", "A", "?!", "Past", "x 1", "Dup"];

const name = fc.constantFrom(...NAMES);
const anchor = fc.constantFrom(...ANCHORS);
const scalar = fc.oneof(fc.integer({ min: -5, max: 5 }), fc.boolean(), fc.constant(null), fc.constantFrom("s", "é"));

/** A field's value: scalars, arrays, and objects that may carry an `$anchor` or an ordinary `$` member. */
const fieldValue = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    scalar,
    fc.array(tie("value"), { maxLength: 3 }),
    fc
      .tuple(
        fc.uniqueArray(fc.tuple(name, tie("value")), { selector: ([key]) => key, maxLength: 3 }),
        fc.option(anchor, { nil: undefined }),
        fc.boolean(),
      )
      .map(([members, label, dollar]) => {
        const object = Object.fromEntries(members);
        if (label !== undefined) object.$anchor = label;
        if (dollar) object.$x = 1;
        return object;
      }),
  ),
})).value;

/** A data section: a title, an optional anchor, fields and child sections. */
const section = fc.letrec<{ section: Record<string, unknown> }>((tie) => ({
  section: fc
    .tuple(
      fc.constantFrom(...TITLES),
      fc.option(anchor, { nil: undefined }),
      fc.uniqueArray(fc.tuple(name, fieldValue), { selector: ([key]) => key, maxLength: 2 }),
      fc.oneof({ depthSize: "small" }, fc.constant([]), fc.array(tie("section"), { maxLength: 2 })),
    )
    .map(([title, label, fields, children]) => {
      const object: Record<string, unknown> = { $title: title, ...Object.fromEntries(fields) };
      if (label !== undefined) object.$anchor = label;
      if (children.length > 0) object.$sections = children;
      return object;
    }),
})).section;

const jsonRecord = fc
  .tuple(
    fc.uniqueArray(fc.tuple(name, fieldValue), { selector: ([key]) => key, maxLength: 4 }),
    fc.array(section, { maxLength: 3 }),
  )
  .map(([fields, sections]) => {
    const root: Record<string, unknown> = Object.fromEntries(fields);
    if (sections.length > 0) root.$sections = sections;
    return JSON.stringify(root);
  });

/** A Markdown record: front matter, headings at several levels, some with anchor elements, and block anchors. */
const markdownRecord = fc
  .tuple(
    fc.uniqueArray(fc.constantFrom("notes", "entry", "status", "a"), { maxLength: 2 }),
    fc.array(
      fc.tuple(
        fc.integer({ min: 2, max: 4 }),
        fc.constantFrom(...TITLES),
        fc.option(anchor, { nil: undefined }),
        fc.option(anchor, { nil: undefined }),
      ),
      { maxLength: 6 },
    ),
  )
  .map(([fields, headings]) => {
    const front = fields.length === 0 ? "" : `---\n${fields.map((field) => `${field}: 1`).join("\n")}\n---\n\n`;
    const body = headings
      .map(([level, title, label, block]) => {
        const element = label === undefined ? "" : `<a id="${label}"></a>`;
        const paragraph = block === undefined ? "Text." : `<a id="${block}"></a>Text.`;
        return `${"#".repeat(level)} ${title}${element}\n\n${paragraph}\n`;
      })
      .join("\n");
    return `${front}# Root\n\nIntro.\n\n${body}`;
  });

/** Every node of a record, the root first, depth first in source order. */
function nodesOf(record: ParsedRecord): NodeInfo[] {
  const nodes: NodeInfo[] = [];
  const pending = [record.nodes.node("") as NodeInfo];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    nodes.push(node);
    pending.push(...[...record.nodes.children(node.at)].reverse());
  }
  return nodes;
}

/** Whether the first step `step` can only mean the node at `at`: no other node by member, child section key or anchor. */
function firstStepNamesOnly(record: ParsedRecord, step: string, at: string): boolean {
  const others = [
    ...(Object.hasOwn(record.value, step) ? [`/${step.replaceAll("~", "~0").replaceAll("/", "~1")}`] : []),
    ...[...record.sectionKeys].filter(([path, key]) => key === step && /^\/\$sections\/\d+$/u.test(path)).map(([path]) => path),
    ...record.anchors.named(step).map((entry) => (entry.kind === "block" ? `${entry.at} block ${entry.range.start}` : entry.at)),
  ];
  return others.every((other) => other === at);
}

/** Checks that every node's and block anchor's canonical address reads back and resolves to it alone. */
function checkCanonicalAddresses(path: string, text: string): void {
  const outcome = parseRecord(path, new TextEncoder().encode(text));
  if (!outcome.ok) throw new Error(`${text} does not parse: ${outcome.issues.map((issue) => issue.code).join(", ")}`);
  const record = outcome.value;
  for (const node of nodesOf(record)) {
    const address = canonicalAddress(record, node.at);
    expect(address === "", address).toBe(node.at === "");
    const read = parseAddress(`${path}${address}`);
    if (!read.ok) throw new Error(`${address} does not read`);
    const resolved = resolveAddress(record, read.value.fragment, "singular");
    expect(resolved.ok, `${address} for ${node.at}`).toBe(true);
    if (resolved.ok) expect(resolved.value.map((target) => target.at)).toEqual([node.at]);
    // An explicit anchor that names this node alone is its canonical address, whatever else the node has.
    const explicit = record.anchors.of(node.at).find((entry) => entry.kind === "explicit");
    if (node.at !== "" && explicit !== undefined && firstStepNamesOnly(record, explicit.name, node.at)) {
      expect(address).toBe(`#${encodeStep(explicit.name)}`);
    }
  }
  for (const entry of record.anchors.anchors) {
    if (entry.kind !== "block") continue;
    const address = blockAnchorAddress(record, entry);
    const read = parseAddress(`${path}${address}`);
    if (!read.ok) throw new Error(`${address} does not read`);
    const resolved = resolveAddress(record, read.value.fragment, "singular");
    if (!resolved.ok) throw new Error(`${address} does not resolve`);
    const [target] = resolved.value;
    // A block anchor that its name does not name alone falls back to its `$body`.
    if (target?.range === undefined) {
      expect(target?.at).toBe(entry.at);
      expect(resolveAddress(record, { kind: "semantic", steps: [entry.name] }, "singular").ok).toBe(false);
    } else {
      expect(target.range).toEqual(entry.range);
    }
  }
}

test("a canonical address resolves back to its node, in JSON records", () => {
  fc.assert(
    fc.property(jsonRecord, (text) => checkCanonicalAddresses("r.json", text)),
    { numRuns: 500 },
  );
});

test("a canonical address resolves back to its node, in Markdown records with repeated headings and anchors", () => {
  fc.assert(
    fc.property(markdownRecord, (text) => checkCanonicalAddresses("r.md", text)),
    { numRuns: 500 },
  );
});
