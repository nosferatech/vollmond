import { fromMarkdown as libraryFromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, test, vi } from "vitest";
import { createMemoryStorage } from "../storage/memory.js";
import type { StorageReader } from "../storage/storage.js";
import { leastTimeRatio } from "../timing.testkit.js";
import { openStore, type Store } from "./store.js";

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
/** How many times smaller the document whose outline gives the baseline time is. */
const SCALE = 8;
/** How many times each document is outlined after a first outline of the smaller one; the least time of each is compared. */
const RUNS = 3;
/**
 * The most that outlining the document may cost, as a multiple of outlining the one {@link SCALE} times smaller. The multiple
 * is about {@link SCALE} when the cost is linear in the text, and grows toward its square when a step is quadratic: 5.2 to
 * 8.05 on a laptop under a load average of up to 40, and 26 to 29 with a loop over the whole text for each line. A step
 * that encodes the text before each line again gives 11 to 16, and passes.
 */
const MAX_RATIO = 2 * SCALE;

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

/** Opens a store over one Markdown file, `design.md` holding `content`, whose backend counts its reads. */
async function storeOf(content: Uint8Array): Promise<{ readonly store: Store; readonly reads: { count: number } }> {
  const inner = createMemoryStorage({ files: { ".vmd/config.yaml": "vmd: 1\n", "design.md": content } });
  const reads = { count: 0 };
  const backend: StorageReader = {
    list: (query) => inner.list(query),
    stat: (path) => inner.stat(path),
    read: (path, options) => {
      reads.count += 1;
      return inner.read(path, options);
    },
    grep: (query) => inner.grep(query),
    head: () => inner.head(),
    history: inner.history,
  };
  const opened = await openStore(backend);
  if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
  reads.count = 0;
  return { store: opened.value, reads };
}

/** Outlines `design.md` in a new store over `content`, and gives the time the outline took, in milliseconds. */
async function outlineTime(content: Uint8Array): Promise<number> {
  const { store } = await storeOf(content);
  const started = performance.now();
  const outline = await store.outline("design.md");
  const elapsed = performance.now() - started;
  if (!outline.ok) throw new Error(JSON.stringify(outline.issues));
  return elapsed;
}

describe("the outline of a large document", () => {
  test("parses and outlines 673 KB with one read and one parse", async () => {
    const content = new TextEncoder().encode(designDocument(DOCUMENT_BYTES));
    const { store, reads } = await storeOf(content);
    fromMarkdown.mockClear();
    const outline = await store.outline("design.md");

    // One read of the file, and one Markdown parse of its body, shared by the outline, the keys and the canonical addresses.
    expect(reads.count).toBe(1);
    expect(fromMarkdown).toHaveBeenCalledTimes(1);

    const parsed = store.recordRead("design.md");
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

  test("outlines 673 KB in time far from quadratic", async () => {
    // The time is compared with that of a document SCALE times smaller, the least of RUNS runs each. It catches a step of
    // vmd's own whose cost grows with the square of the text, such as a loop over the whole text for each line. Both
    // documents have the same 48 sections and 240 anchored blocks, so a step quadratic in the headings or the anchors is not
    // caught.
    // Deviation from the I1 design, recorded in issue #20: the design bounds the time at 1.5 s, which is close to what CI
    // takes, and a fixed bound fails on a busy machine.
    const large = new TextEncoder().encode(designDocument(DOCUMENT_BYTES));
    const small = new TextEncoder().encode(designDocument(DOCUMENT_BYTES / SCALE));
    expect(
      await leastTimeRatio(
        () => outlineTime(small),
        () => outlineTime(large),
        RUNS,
      ),
    ).toBeLessThan(MAX_RATIO);
  }, 60_000);
});
