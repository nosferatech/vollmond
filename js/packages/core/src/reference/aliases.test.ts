import { describe, expect, test } from "vitest";
import { readAliases } from "./aliases.js";

const at = "2026-10-09T08:00:00Z";
const encode = (text: string) => new TextEncoder().encode(text);

describe("readAliases", () => {
  test("skips a byte order mark at the start, as every file vmd reads, and refuses one elsewhere", () => {
    const line = JSON.stringify({ kind: "record", from: "docs/old.md", to: "docs/b.md", at });
    const read = readAliases(encode(`\uFEFF${line}\n`));
    expect(read.ok && read.value.recordMove("docs/old.md")).toBe("docs/b.md");
    // Its near miss: a mark at the start of a later line is not white space, so the file is not JSON Lines.
    expect(readAliases(encode(`${line}\n\uFEFF${line}\n`)).ok).toBe(false);
  });

  test("refuses an anchor alias whose record is not a store path", () => {
    const read = readAliases(encode(`${JSON.stringify({ kind: "anchor", record: "../a.md", from: "x", to: "y", at })}\n`));
    expect(read.ok).toBe(false);
    expect(read.issues[0]?.message).toMatch(/record that is not a store path/);
    // Its near miss: the same alias of a record inside the store.
    expect(readAliases(encode(`${JSON.stringify({ kind: "anchor", record: "a.md", from: "x", to: "y", at })}\n`)).ok).toBe(true);
  });
});
