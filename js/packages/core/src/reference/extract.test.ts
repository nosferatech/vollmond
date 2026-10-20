import { describe, expect, test, vi } from "vitest";
import { parseRecord } from "../format/parse-record.js";
import { occurrencesOf } from "./extract.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("the cost of a record's link reference definitions", () => {
  test("is paid once per record, not once per $body or $title that holds a `[`", () => {
    // L definitions in the root's $body, and S sections whose $title and $body each hold a `[`, which makes each of them
    // look the definitions up. A label is normalized with `toUpperCase`, once per label and once per lookup, so the calls
    // grow with L + S when the record's labels are shared, and with L × S when each parse takes them in again.
    const definitions = 2000;
    const sections = 200;
    const record = {
      $body: Array.from({ length: definitions }, (_, i) => `[d${i}]: /x`).join("\n"),
      $sections: Array.from({ length: sections }, (_, i) => ({ $title: `[t${i}`, $body: `[d${i}] and [` })),
    };
    const upper = vi.spyOn(String.prototype, "toUpperCase");
    try {
      const outcome = parseRecord("a.json", bytes(JSON.stringify(record)));
      if (!outcome.ok) throw new Error("the record does not read");
      expect(occurrencesOf(outcome.value)).toHaveLength(definitions);
      expect(upper.mock.calls.length).toBeLessThan(20 * (definitions + sections));
    } finally {
      upper.mockRestore();
    }
  });

  test("gives the offsets of a $body's links by encoding its text once, not once per link", () => {
    const body = Array.from({ length: 2000 }, (_, i) => `Über [d${i}](/x) and`).join("\n");
    const outcome = parseRecord("a.json", bytes(JSON.stringify({ $body: body })));
    if (!outcome.ok) throw new Error("the record does not read");
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      const occurrences = occurrencesOf(outcome.value);
      expect(occurrences.map((occurrence) => occurrence.offset).slice(0, 2)).toEqual([
        6,
        bytes("Über [d0](/x) and\nÜber ").length,
      ]);
      const encoded = encode.mock.calls.reduce((sum, [text]) => sum + (text?.length ?? 0), 0);
      expect(encoded).toBeLessThan(2 * body.length);
    } finally {
      encode.mockRestore();
    }
  });

  test("sorts the occurrences by looking each one's node up once", () => {
    const outcome = parseRecord("a.md", bytes(`# T\n\n${"[a](b) ".repeat(2000)}\n`));
    if (!outcome.ok) throw new Error("the record does not read");
    const lookups = vi.spyOn(outcome.value.nodes, "node");
    try {
      expect(occurrencesOf(outcome.value)).toHaveLength(2000);
      expect(lookups.mock.calls.length).toBeLessThanOrEqual(2000);
    } finally {
      lookups.mockRestore();
    }
  });
});

describe("a record with more occurrences than a call takes arguments", () => {
  // Node 24 takes about 125,000 arguments in a call. The links are empty and side by side, with no text around them: the
  // Markdown library's search for autolink literals takes time that grows faster than the text nodes of a tree, and each
  // character of a link's text or destination costs time too.
  test("gives every link of a $body of 150,000 links", () => {
    const outcome = parseRecord("a.json", bytes(JSON.stringify({ $body: "[]()".repeat(150_000) })));
    if (!outcome.ok) throw new Error("the record does not read");
    expect(occurrencesOf(outcome.value)).toHaveLength(150_000);
  }, 60_000);
});
