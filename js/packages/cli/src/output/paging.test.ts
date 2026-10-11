import { describe, expect, test } from "vitest";
import {
  DEFAULT_LIMITS,
  formatPageRemainder,
  formatUnreadableRecords,
  MAX_LIMIT,
  PAGE_OPTIONS,
  readLimit,
  shellWord,
} from "./paging.js";

test("the default limits are 100 for ls, 50 for grep and 20 for query", () => {
  expect(DEFAULT_LIMITS).toEqual({ ls: 100, grep: 50, query: 20 });
});

test("a paged listing takes -n and --cursor", () => {
  expect(PAGE_OPTIONS).toEqual({ limit: { type: "string", short: "n" }, cursor: { type: "string" } });
});

describe("readLimit", () => {
  test("gives the default when -n is absent", () => {
    expect(readLimit(undefined, 100)).toEqual({ ok: true, limit: 100 });
  });

  test.each([
    ["1", 1],
    ["20", 20],
    [String(MAX_LIMIT), MAX_LIMIT],
  ])("reads %s", (text, limit) => {
    expect(readLimit(text, 100)).toEqual({ ok: true, limit });
  });

  test.each(["", " 5", "5 ", "0", "-1", "+5", "1.5", "1e2", "0x10", "05", "five", String(MAX_LIMIT + 1)])(
    "refuses %j, though Number reads some such strings",
    (text) => {
      const reading = readLimit(text, 100);
      expect(reading.ok).toBe(false);
      expect(reading.ok ? "" : reading.message).toContain("-n");
    },
  );
});

describe("shellWord", () => {
  test("keeps a path as it is", () => {
    expect(shellWord("tickets/0171-x.md")).toBe("tickets/0171-x.md");
  });

  test("quotes what a shell would read otherwise", () => {
    expect(shellWord("a b")).toBe("'a b'");
    expect(shellWord("$body")).toBe("'$body'");
    expect(shellWord("")).toBe("''");
  });

  test("quotes a single quote", () => {
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
  });
});

describe("formatPageRemainder", () => {
  test("says how many remain and gives the cursor", () => {
    expect(formatPageRemainder({ remaining: 1234, cursor: "tickets/0171-x.md" })).toBe(
      "… 1,234 more (--cursor tickets/0171-x.md)\n",
    );
  });

  test("says more remain when the listing does not count them", () => {
    expect(formatPageRemainder({ remaining: null, cursor: "c" })).toBe("… more (--cursor c)\n");
  });

  test("quotes a cursor that a shell would split, so the line can be pasted", () => {
    expect(formatPageRemainder({ remaining: 3, cursor: "a b" })).toBe("… 3 more (--cursor 'a b')\n");
  });
});

describe("formatUnreadableRecords", () => {
  test("says nothing for none", () => {
    expect(formatUnreadableRecords(0, "page")).toBe("");
  });

  test("says the count is of the printed page", () => {
    expect(formatUnreadableRecords(1, "page")).toBe("1 record on this page could not be read\n");
    expect(formatUnreadableRecords(1200, "page")).toBe("1,200 records on this page could not be read\n");
  });

  test("says nothing of a page for a count over the store", () => {
    expect(formatUnreadableRecords(2, "store")).toBe("2 records could not be read\n");
  });
});
