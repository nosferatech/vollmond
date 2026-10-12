import { describe, expect, test } from "vitest";
import { MAX_ALIAS_FILE_BYTES, readAliases } from "./aliases.js";

const at = "2026-10-09T08:00:00Z";
const encode = (text: string) => new TextEncoder().encode(text);

/** An alias file of exactly `size` bytes: one record alias, padded with white space inside its object. */
function aliasFileOfSize(size: number): string {
  const entry = JSON.stringify({ kind: "record", from: "a.md", to: "b.md", at });
  return `${entry.slice(0, -1)}${" ".repeat(size - entry.length - 1)}}\n`;
}

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

  test("refuses an entry whose at is not a date-time, of either kind", () => {
    for (const entry of [
      { kind: "record", from: "a.md", to: "b.md", at: "yesterday" },
      { kind: "anchor", record: "a.md", from: "x", to: "y", at: "yesterday" },
      // A date alone, and a date-time without its offset, are not RFC 3339 date-times.
      { kind: "record", from: "a.md", to: "b.md", at: "2026-10-09" },
      { kind: "record", from: "a.md", to: "b.md", at: "2026-10-09T08:00:00" },
    ]) {
      const read = readAliases(encode(`${JSON.stringify(entry)}\n`));
      expect(read.ok).toBe(false);
      expect(read.issues.map((issue) => issue.code)).toEqual(["alias-file-invalid"]);
      expect(read.issues[0]?.message).toMatch(/line 1 has an at that is not a date-time/);
    }
    // Its near miss: RFC 3339 date-times, with a fraction, an offset and a lower-case separator, are read.
    for (const valid of [at, "2026-10-09T08:00:00.5+02:00", "2026-10-09t08:00:00z"]) {
      const read = readAliases(encode(`${JSON.stringify({ kind: "record", from: "a.md", to: "b.md", at: valid })}\n`));
      expect(read.ok && read.value.entries[0]?.at).toBe(valid);
    }
  });

  test("refuses a file larger than 16 MiB without parsing it, with a message naming the bound and the prune, and reads one of exactly that", () => {
    expect(MAX_ALIAS_FILE_BYTES).toBe(16 * 1024 * 1024);
    expect(aliasFileOfSize(MAX_ALIAS_FILE_BYTES)).toHaveLength(MAX_ALIAS_FILE_BYTES);
    const larger = readAliases(encode(aliasFileOfSize(MAX_ALIAS_FILE_BYTES + 1)));
    expect(larger.ok).toBe(false);
    expect(larger.issues.map((issue) => `${issue.code} ${issue.path} ${issue.at}`)).toEqual(["alias-file-invalid null null"]);
    expect(larger.issues[0]?.message).toContain(`larger than ${MAX_ALIAS_FILE_BYTES} bytes`);
    expect(larger.issues[0]?.message).toContain("vmd alias prune");
    // Its near miss: a file of exactly the bound is read.
    const fits = readAliases(encode(aliasFileOfSize(MAX_ALIAS_FILE_BYTES)));
    expect(fits.ok && fits.value.recordMove("a.md")).toBe("b.md");
    // Reading 16 MiB of alias file takes seconds, more under a parallel run.
  }, 60_000);
});
