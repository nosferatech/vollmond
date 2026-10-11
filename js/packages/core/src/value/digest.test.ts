import { describe, expect, test } from "vitest";
import { gitBlobId, nodeVersion } from "./digest.js";

const utf8 = (text: string) => new TextEncoder().encode(text);

describe("gitBlobId", () => {
  // Expected ids printed by `git hash-object --no-filters` for files with these bytes.
  test.each([
    ["the empty file", new Uint8Array(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],
    ["hello and a line feed", utf8("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a"],
    [
      "a byte order mark, a and CRLF",
      new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]),
      "f4daaaa1e76a2a149d105a7d9f59736034bc29c2",
    ],
  ])("matches git for %s", async (_name, content, id) => {
    expect(await gitBlobId(content)).toBe(id);
  });

  test("hashes only the view's bytes when given a subarray", async () => {
    const buffer = utf8("xxhello\nyy");
    expect(await gitBlobId(buffer.subarray(2, 8))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("nodeVersion", () => {
  // Expected digests from `shasum -a 256` over the canonical JSON.
  test.each([
    ["{}", {}, "44136fa355b3678a"],
    ["null", null, "74234e98afe7498f"],
    ['{"a":[1,"é"],"b":null}', { b: null, a: [1, "é"] }, "1e02bc81a26af2f0"],
  ])("is the first 16 hex digits of SHA-256 over %s", async (_canonical, value, version) => {
    expect(await nodeVersion(value)).toBe(version);
  });

  test("is the same for equal values, member order and -0 aside", async () => {
    expect(await nodeVersion({ a: 1, b: -0 })).toBe(await nodeVersion({ b: 0, a: 1.0 }));
    expect(await nodeVersion({ a: 1 })).not.toBe(await nodeVersion({ a: 2 }));
  });

  test("rejects a value outside the data model", async () => {
    await expect(nodeVersion(Number.NaN)).rejects.toThrow(TypeError);
  });
});
