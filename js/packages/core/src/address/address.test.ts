import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { type Address, encodeExactPath, encodeStep, type Fragment, formatAddress, parseAddress } from "./address.js";

/** The address that `text` reads as, failing the test when it does not read. */
function read(text: string, raw = false): Address {
  const outcome = parseAddress(text, { raw });
  if (!outcome.ok) throw new Error(`malformed: ${outcome.issues.map((issue) => issue.message).join(", ")}`);
  return outcome.value;
}

/** The fragment of an address, failing the test when the address does not read. */
const fragmentOf = (text: string, raw = false): Fragment | null => read(text, raw).fragment;

/** The issues of an address that does not read, as code, path and `at`. */
function malformed(text: string, raw = false): [string, string | null, string | null][] {
  const outcome = parseAddress(text, { raw });
  if (outcome.ok) throw new Error(`${text} reads`);
  return outcome.issues.map((issue) => [issue.code, issue.path, issue.at]);
}

describe("reading an address", () => {
  test("reads no fragment, and a `#` alone, as the root", () => {
    expect(read("tickets/a.md")).toEqual({ record: "tickets/a.md", fragment: null });
    expect(read("tickets/a.md#")).toEqual({ record: "tickets/a.md", fragment: null });
  });

  test("reads `#/` as the exact path to the member with the empty name, not the root", () => {
    expect(fragmentOf("a.json#/")).toEqual({ kind: "exact", tokens: [""] });
    expect(fragmentOf("a.json#//a")).toEqual({ kind: "exact", tokens: ["", "a"] });
  });

  test("splits a semantic path into steps", () => {
    expect(fragmentOf("a.md#config/retries")).toEqual({ kind: "semantic", steps: ["config", "retries"] });
    expect(fragmentOf("a.md#$sections/background")).toEqual({ kind: "semantic", steps: ["$sections", "background"] });
  });

  test("decodes an exact path before splitting it, and a semantic path after", () => {
    expect(fragmentOf("a.json#/a%2Fb")).toEqual({ kind: "exact", tokens: ["a", "b"] });
    expect(fragmentOf("a.json#a%2Fb")).toEqual({ kind: "semantic", steps: ["a/b"] });
  });

  test("unescapes an exact path's tokens after splitting it, `~1` before `~0`", () => {
    expect(fragmentOf("a.json#/a~1b")).toEqual({ kind: "exact", tokens: ["a/b"] });
    expect(fragmentOf("a.json#/a~0b")).toEqual({ kind: "exact", tokens: ["a~b"] });
    // RFC 6901 section 4: `~01` is `~1`, not `/`.
    expect(fragmentOf("a.json#/~01")).toEqual({ kind: "exact", tokens: ["~1"] });
    expect(fragmentOf("a.json#/%7E1")).toEqual({ kind: "exact", tokens: ["/"] });
  });

  test("leaves `~` in a semantic step as it is", () => {
    expect(fragmentOf("a.json#a~1b")).toEqual({ kind: "semantic", steps: ["a~1b"] });
  });

  test("decodes percent-encoded UTF-8, in either case of hexadecimal digit", () => {
    expect(fragmentOf("a.json#/%C3%A9t%C3%A9")).toEqual({ kind: "exact", tokens: ["été"] });
    expect(fragmentOf("a.json#%c3%a9")).toEqual({ kind: "semantic", steps: ["é"] });
    expect(fragmentOf("a.json#/100%25")).toEqual({ kind: "exact", tokens: ["100%"] });
    expect(fragmentOf("a.json#%F0%9F%98%80")).toEqual({ kind: "semantic", steps: ["😀"] });
  });

  test("keeps an escaped U+FEFF at the start of a step or a token, which is a character and not a byte order mark", () => {
    expect(fragmentOf("a.json#%EF%BB%BFa")).toEqual({ kind: "semantic", steps: ["﻿a"] });
    expect(fragmentOf("a.json#/%EF%BB%BF")).toEqual({ kind: "exact", tokens: ["﻿"] });
  });

  test("takes every fragment character but `/` in a step: pchar and `?`", () => {
    const step = "Az09-._~!$&'()*+,;=:@?";
    expect(fragmentOf(`a.json#${step}`)).toEqual({ kind: "semantic", steps: [step] });
    expect(fragmentOf(`a.json#/${step.replace("~", "~0")}`)).toEqual({ kind: "exact", tokens: [step] });
  });

  test("reads a step that names a computed field's prefix or a member like `__proto__` as an ordinary step", () => {
    expect(fragmentOf("a.json#__proto__/@key")).toEqual({ kind: "semantic", steps: ["__proto__", "@key"] });
  });

  test("keeps the record part as a store path, without decoding it", () => {
    expect(read("notes/a%20b.md#x").record).toBe("notes/a%20b.md");
  });
});

describe("address-malformed", () => {
  test("fires on an empty step, with the record the address names and no node", () => {
    expect(malformed("notes/design.md#config//retries")).toEqual([["address-malformed", "notes/design.md", null]]);
    expect(malformed("a.md#config/")).toEqual([["address-malformed", "a.md", null]]);
    // A trailing `/` of an exact path is not an empty step but a token: the member with the empty name.
    expect(fragmentOf("a.md#/config/")).toEqual({ kind: "exact", tokens: ["config", ""] });
    // The near miss.
    expect(fragmentOf("notes/design.md#config/retries")).toEqual({ kind: "semantic", steps: ["config", "retries"] });
  });

  test("fires on a character outside a fragment, which must be percent-encoded", () => {
    for (const text of ["a.json#name with space", "a.json#/été", "a.json#a#b", "a.json#a[0]", 'a.json#"x"', "a.json#a\\b"]) {
      expect(malformed(text), text).toEqual([["address-malformed", "a.json", null]]);
    }
    expect(fragmentOf("a.json#name%20with%20space")).toEqual({ kind: "semantic", steps: ["name with space"] });
  });

  test("accepts those characters raw when the caller asks, as the command line does", () => {
    expect(fragmentOf("a.json#name with space", true)).toEqual({ kind: "semantic", steps: ["name with space"] });
    expect(fragmentOf("a.json#/été/a#b", true)).toEqual({ kind: "exact", tokens: ["été", "a#b"] });
    expect(fragmentOf("a.json#%C3%A9 x", true)).toEqual({ kind: "semantic", steps: ["é x"] });
    // `/` still separates, and `%` still escapes.
    expect(malformed("a.json#a//b", true)).toEqual([["address-malformed", "a.json", null]]);
    expect(malformed("a.json#100%", true)).toEqual([["address-malformed", "a.json", null]]);
    // A lone surrogate is no character, raw or not, and is not replaced by U+FFFD.
    expect(malformed("a.json#a\ud800", true)).toEqual([["address-malformed", "a.json", null]]);
    expect(malformed("a.json#/\udc00")).toEqual([["address-malformed", "a.json", null]]);
  });

  test("fires on a `%` without two hexadecimal digits", () => {
    for (const text of ["a.json#%", "a.json#a%2", "a.json#%G1", "a.json#/%2G"]) {
      expect(malformed(text), text).toEqual([["address-malformed", "a.json", null]]);
    }
    expect(fragmentOf("a.json#%41")).toEqual({ kind: "semantic", steps: ["A"] });
  });

  test("fires on percent-encoded bytes that are not UTF-8, and does not throw", () => {
    for (const text of ["a.json#%E9", "a.json#/%C3", "a.json#%ED%A0%80", "a.json#%FF", "a.json#%C0%AF"]) {
      expect(malformed(text), text).toEqual([["address-malformed", "a.json", null]]);
    }
    expect(fragmentOf("a.json#%C3%A9")).toEqual({ kind: "semantic", steps: ["é"] });
  });

  test("fires on a `~` in an exact path that is not `~0` or `~1`", () => {
    for (const text of ["a.json#/~", "a.json#/a~2", "a.json#/~a", "a.json#/x/a~"]) {
      expect(malformed(text), text).toEqual([["address-malformed", "a.json", null]]);
    }
    expect(fragmentOf("a.json#/~0~1")).toEqual({ kind: "exact", tokens: ["~/"] });
  });

  test("fires on a record part that is not a store path, with no record", () => {
    for (const text of ["", "#x", "/a.md#x", "../a.md", "a//b.md", "./a.md", "a\\b.md"]) {
      expect(malformed(text), text).toEqual([["address-malformed", null, null]]);
    }
    expect(read("a/b.md").record).toBe("a/b.md");
  });
});

describe("writing an address", () => {
  test("writes the root as the record alone", () => {
    expect(formatAddress({ record: "a.md", fragment: null })).toBe("a.md");
  });

  test("percent-encodes, in upper-case UTF-8, what a fragment does not allow, and `/` in a step and `%`", () => {
    expect(encodeStep("name with space")).toBe("name%20with%20space");
    expect(encodeStep("a/b")).toBe("a%2Fb");
    expect(encodeStep("x:y")).toBe("x:y");
    expect(encodeStep("été")).toBe("%C3%A9t%C3%A9");
    expect(encodeStep("100%")).toBe("100%25");
    expect(encodeStep("q?")).toBe("q?");
    expect(encodeStep("$title")).toBe("$title");
    expect(encodeStep("a#b")).toBe("a%23b");
    expect(encodeStep("😀")).toBe("%F0%9F%98%80");
    expect(encodeStep("Az09-._~!$&'()*+,;=:@?")).toBe("Az09-._~!$&'()*+,;=:@?");
    expect(encodeStep("\u0000\u007f")).toBe("%00%7F");
  });

  test("writes an exact path with RFC 6901's escapes first, and then the same encoding", () => {
    expect(encodeExactPath("/a~1b")).toBe("/a~1b");
    expect(encodeExactPath("/arr x/0")).toBe("/arr%20x/0");
    expect(encodeExactPath("/100%")).toBe("/100%25");
    expect(formatAddress({ record: "a.json", fragment: { kind: "exact", tokens: ["a/b", "~", ""] } })).toBe("a.json#/a~1b/~0/");
    expect(formatAddress({ record: "a.json", fragment: { kind: "semantic", steps: ["a/b", "é"] } })).toBe("a.json#a%2Fb/%C3%A9");
  });

  test("throws for a semantic path that no address can write: no step, or an empty one", () => {
    expect(() => formatAddress({ record: "a.md", fragment: { kind: "semantic", steps: [] } })).toThrow(RangeError);
    expect(() => formatAddress({ record: "a.md", fragment: { kind: "semantic", steps: ["a", ""] } })).toThrow(RangeError);
    expect(() => formatAddress({ record: "a.md", fragment: { kind: "exact", tokens: [] } })).toThrow(RangeError);
  });

  test("reads back what it writes, for any well-formed steps and tokens", () => {
    const name = fc.string({ unit: "grapheme", maxLength: 6 });
    fc.assert(
      fc.property(
        fc.array(
          name.filter((step) => step !== ""),
          { minLength: 1, maxLength: 4 },
        ),
        (steps) => {
          const address: Address = { record: "r.json", fragment: { kind: "semantic", steps } };
          expect(read(formatAddress(address))).toEqual(address);
        },
      ),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.array(name, { minLength: 1, maxLength: 4 }), (tokens) => {
        const address: Address = { record: "r.json", fragment: { kind: "exact", tokens } };
        expect(read(formatAddress(address))).toEqual(address);
      }),
      { numRuns: 500 },
    );
  });
});
