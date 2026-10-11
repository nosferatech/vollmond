import { describe, expect, test } from "vitest";
import { createMemoryStorage } from "./memory.js";
import { describeStorageContract } from "./storage-contract.testkit.js";

describeStorageContract({
  name: "memory",
  canMakeUnreadable: true,
  async create(fixture) {
    const unreadable = new Set(fixture.unreadable ?? []);
    const files = Object.fromEntries(
      Object.entries(fixture.files).map(([path, content]) => [path, { content, unreadable: unreadable.has(path) }]),
    );
    return createMemoryStorage({ files });
  },
});

describe("createMemoryStorage", () => {
  test("copies the files it is given, so later changes do not reach it", async () => {
    const bytes = new TextEncoder().encode("abc");
    const storage = createMemoryStorage({ files: { "a.md": bytes } });
    bytes.fill(0x7a);
    const read = await storage.read("a.md");
    expect(read.ok && new TextDecoder().decode(read.value.content)).toBe("abc");
  });

  test("gives the head and modification times it is given, and null for each when omitted", async () => {
    const storage = createMemoryStorage({
      files: { "a.md": { content: "a", modified: "2026-10-10T12:00:00.000Z" }, "b.md": "b" },
      head: "7e0a6a7",
    });
    expect(await storage.head()).toEqual({ ok: true, value: "7e0a6a7", issues: [] });
    const page = await storage.list({ prefix: "", limit: 10 });
    expect(page.ok && page.value.items.map((item) => item.modified)).toEqual(["2026-10-10T12:00:00.000Z", null]);
    expect(await createMemoryStorage({ files: {} }).head()).toEqual({ ok: true, value: null, issues: [] });
    expect(storage.history).toBeNull();
  });

  test("throws on a file whose path is not a store path", () => {
    expect(() => createMemoryStorage({ files: { "../a.md": "a" } })).toThrow(RangeError);
    expect(() => createMemoryStorage({ files: { "a/b.md": "a" } })).not.toThrow();
  });
});
