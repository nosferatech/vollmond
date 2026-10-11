import { fromMarkdown as libraryFromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, test, vi } from "vitest";
import { createMemoryStorage } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { openStore } from "./store.js";

// The Markdown library's parse, counted.
vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { ...original, fromMarkdown: vi.fn(original.fromMarkdown) };
});
const fromMarkdown = vi.mocked(libraryFromMarkdown);

/** The size of the generated document, in bytes: that of the largest design document the demonstration reads. */
const DOCUMENT_BYTES = 673_000;
/** The top-level sections of the generated document, each with {@link SUBSECTIONS} subsections. */
const SECTIONS = 12;
const SUBSECTIONS = 3;
/** The anchored list items in each section and subsection; each also has one anchored paragraph. */
const ANCHORED_ITEMS = 4;

/**
 * Generates a Markdown document shaped like a long design document: a title heading and a table, sections and subsections
 * with explicit anchors, anchored list items and paragraphs, prose with code spans, emphasis, links and autolink literals,
 * tables and fenced code, repeated until the document holds `bytes` bytes. The same `bytes` gives the same document.
 */
function designDocument(bytes: number): string {
  const sectionCount = SECTIONS * (SUBSECTIONS + 1);
  const heads: string[] = [];
  for (let s = 0; s < SECTIONS; s++) {
    heads.push(`## ${s}. Section ${s} <a id="section-${s}"></a>`);
    for (let u = 1; u <= SUBSECTIONS; u++) heads.push(`### ${s}.${u} Part ${u} of section ${s} <a id="part-${s}-${u}"></a>`);
  }
  const prose = (k: number) =>
    `The \`writer\` appends entry ${k} to the **tail**, and the _flusher_ makes it durable; see [the contract](#section-${k % SECTIONS}) ` +
    `and https://example.com/log/${k} for the measurement. A reader that holds\nposition ${k} never sees a torn entry, ` +
    "since the commit record is written last and checked first.\n\n";
  const bodies = heads.map((_, n) => {
    const items = Array.from(
      { length: ANCHORED_ITEMS },
      (_, i) => `- <a id="item-${n}-${i}"></a>**Term ${n}.${i}.** What the term means, with \`code\` in it.\n`,
    ).join("");
    const extras =
      (n % 4 === 0 ? "| Field | Bytes |\n| --- | --- |\n| `lsn` | 8 |\n| `crc` | 4 |\n\n" : "") +
      (n % 3 === 0 ? "```rust\nfn append(&mut self, entry: &[u8]) -> Lsn {\n    self.tail.push(entry)\n}\n```\n\n" : "");
    return `<a id="rule-${n}"></a>**Rule ${n}.** An anchored paragraph.\n\n${items}\n${extras}`;
  });
  const head = "# Design document\n\n| | |\n| --- | --- |\n| **Type** | Design |\n\nAn introduction.\n\n";
  const fixed = head.length + heads.reduce((sum, h, n) => sum + h.length + 2 + (bodies[n] as string).length, 0);
  // Prose fills each section in turn until the document reaches its size; the text is ASCII, so characters are bytes.
  const fill: string[] = heads.map(() => "");
  let length = fixed;
  for (let k = 0; length < bytes; k++) {
    const paragraph = prose(k);
    fill[k % sectionCount] += paragraph;
    length += paragraph.length;
  }
  return head + heads.map((h, n) => `${h}\n\n${bodies[n]}${fill[n]}`).join("");
}

describe("the outline of a large document", () => {
  test("parses and outlines 673 KB in time far from quadratic", async () => {
    const text = designDocument(DOCUMENT_BYTES);
    const content = new TextEncoder().encode(text);
    const inner = createMemoryStorage({ files: { ".vmd/config.yaml": "vmd: 1\n", "design.md": content } });
    let reads = 0;
    const backend: StorageReader = {
      list: (query) => inner.list(query),
      stat: (path) => inner.stat(path),
      read: (path, options) => {
        reads += 1;
        return inner.read(path, options);
      },
      grep: (query) => inner.grep(query),
      head: () => inner.head(),
      history: inner.history,
    };
    const opened = await openStore(backend);
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
    reads = 0;
    fromMarkdown.mockClear();

    const started = performance.now();
    const outline = await opened.value.outline("design.md");
    const elapsed = performance.now() - started;

    // What can be counted exactly is: one read of the file, and one Markdown parse of its body, shared by the outline, the
    // keys and the canonical addresses.
    expect(reads).toBe(1);
    expect(fromMarkdown).toHaveBeenCalledTimes(1);
    // The time cannot be counted. The library's parse is most of it: about 0.4 s on a laptop, and a few times that on a
    // loaded machine. The bound is far from that, so that a loaded machine does not fail it, and it catches only a gross
    // step of vmd's own: a loop over the whole text for each line takes this test to about 6 s, while encoding the text
    // before each line again adds only about 0.6 s and passes.
    // Deviation from the I1 design, recorded in issue #20: the design's bound is 1.5 s, close to what a slow or loaded
    // machine takes, and it would not catch the second step either.
    expect(elapsed).toBeLessThan(5000);

    const parsed = opened.value.recordRead("design.md");
    expect(content.length).toBeGreaterThanOrEqual(DOCUMENT_BYTES);
    if (!outline.ok || !parsed?.ok) throw new Error("the generated document does not parse");
    const sections = SECTIONS * (SUBSECTIONS + 1);
    expect(outline.value.sections).toHaveLength(sections);
    expect(outline.value.sections.map((entry) => entry.address).slice(0, 2)).toEqual(["#section-0", "#part-0-1"]);
    const kinds = parsed.value.anchors.anchors.map((entry) => entry.kind);
    expect(kinds.filter((kind) => kind === "explicit")).toHaveLength(sections);
    expect(kinds.filter((kind) => kind === "block")).toHaveLength(sections * (ANCHORED_ITEMS + 1));
    expect(parsed.value.issues).toEqual([]);
  }, 60_000);
});
