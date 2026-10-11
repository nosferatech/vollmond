// The contract test suite of the storage contract's read side, which every backend runs: `core` over its memory backend,
// and `cli` over the filesystem. It is not a test file itself, and it is not built.
import { describe, expect, test } from "vitest";
import type { Outcome } from "../issue/outcome.js";
import { gitBlobId } from "../value/digest.js";
import type { StorageReader } from "./storage.js";

/** The files of one test's store, by store path, and which of them the backend must fail to read. */
export interface ContractFixture {
  readonly files: Readonly<Record<string, Uint8Array | string>>;
  readonly unreadable?: readonly string[];
}

/** A backend under test: how to create one over a fixture, and what it can simulate. */
export interface ContractBackend {
  readonly name: string;
  create(fixture: ContractFixture): Promise<StorageReader>;
  /** Whether the backend can make a file unreadable; false for a filesystem when the tests run as root. */
  readonly canMakeUnreadable: boolean;
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/** Returns the value of a successful outcome, and fails the test with its issues otherwise. */
function successValue<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) expect.fail(`expected success, got ${JSON.stringify(outcome.issues)}`);
  return outcome.value;
}

/** Returns the issue codes of a failed outcome, and fails the test when it succeeded. */
function failureCodes(outcome: Outcome<unknown>): string[] {
  expect(outcome.ok).toBe(false);
  return outcome.issues.map((issue) => issue.code);
}

/** Runs the contract suite against one backend. */
export function describeStorageContract(backend: ContractBackend): void {
  const create = (files: ContractFixture["files"], unreadable?: readonly string[]) =>
    backend.create(unreadable === undefined ? { files } : { files, unreadable });

  describe(`storage contract (read side): ${backend.name}`, () => {
    describe("list", () => {
      // "a-c.md" sorts before "a/b.md" in byte order, since - is 0x2D and / is 0x2F, but a walk that lists a directory's
      // entries in order and descends into each gives "a.md", "a/b.md", "a-c.md". U+E000 is EE 80 80 in UTF-8 and U+1F600 is
      // F0 9F 98 80, while their UTF-16 code units are E000 and D83D, in the other order.
      const files = {
        "a.md": "# A\n",
        "a/b.md": "# B\n",
        "a-c.md": "# C\n",
        "z/\u{1F600}.md": "smile\n",
        "z/\u{E000}.md": "private\n",
      };

      test("lists every file in UTF-8 byte order of the paths", async () => {
        const storage = await create(files);
        const page = successValue(await storage.list({ prefix: "", limit: 100 }));
        expect(page.items.map((item) => item.path)).toEqual(["a-c.md", "a.md", "a/b.md", "z/\u{E000}.md", "z/\u{1F600}.md"]);
        expect(page.cursor).toBeNull();
      });

      test("gives each file's size in bytes and the git blob id of its bytes", async () => {
        const content = utf8("\u{FEFF}é\r\nline\r\n");
        const storage = await create({ "doc.md": content });
        const [item] = successValue(await storage.list({ prefix: "", limit: 10 })).items;
        expect(item?.size).toBe(content.length);
        expect(item?.version).toBe(await gitBlobId(content));
        expect(item?.modified === null || !Number.isNaN(Date.parse(item?.modified ?? ""))).toBe(true);
      });

      test("takes the prefix as a string prefix, not a directory", async () => {
        const storage = await create(files);
        const paths = async (prefix: string) =>
          successValue(await storage.list({ prefix, limit: 100 })).items.map((item) => item.path);
        expect(await paths("a")).toEqual(["a-c.md", "a.md", "a/b.md"]);
        expect(await paths("a/")).toEqual(["a/b.md"]);
        expect(await paths("z/\u{E000}")).toEqual(["z/\u{E000}.md"]);
        expect(await paths("nothing/here/")).toEqual([]);
      });

      test("matches a glob against whole paths: * within a segment, ** across segments", async () => {
        const storage = await create(files);
        const paths = async (glob: string) =>
          successValue(await storage.list({ prefix: "", glob, limit: 100 })).items.map((item) => item.path);
        expect(await paths("*.md")).toEqual(["a-c.md", "a.md"]);
        expect(await paths("**/*.md")).toEqual(["a-c.md", "a.md", "a/b.md", "z/\u{E000}.md", "z/\u{1F600}.md"]);
        expect(await paths("a/**")).toEqual(["a/b.md"]);
        expect(await paths("a.md")).toEqual(["a.md"]);
        expect(await paths("a?md")).toEqual([]);
      });

      test("pages with a cursor, which is null on the last page", async () => {
        const storage = await create(files);
        const first = successValue(await storage.list({ prefix: "", limit: 2 }));
        expect(first.items.map((item) => item.path)).toEqual(["a-c.md", "a.md"]);
        expect(first.cursor).not.toBeNull();
        const second = successValue(await storage.list({ prefix: "", limit: 3, cursor: first.cursor as string }));
        expect(second.items.map((item) => item.path)).toEqual(["a/b.md", "z/\u{E000}.md", "z/\u{1F600}.md"]);
        expect(second.cursor).toBeNull();
      });

      test("throws on a limit below 1, a caller's bug", async () => {
        const storage = await create(files);
        await expect(storage.list({ prefix: "", limit: 0 })).rejects.toThrow(RangeError);
      });

      test("fails with address-malformed for a prefix that leaves the store", async () => {
        const storage = await create(files);
        expect(failureCodes(await storage.list({ prefix: "../", limit: 10 }))).toEqual(["address-malformed"]);
        expect(failureCodes(await storage.list({ prefix: "/a", limit: 10 }))).toEqual(["address-malformed"]);
        // Its near miss: a prefix whose last segment is cut short.
        expect((await storage.list({ prefix: "a/.", limit: 10 })).ok).toBe(true);
      });

      test("fails with query-invalid for a cursor that is not a list cursor", async () => {
        const storage = await create(files);
        expect(failureCodes(await storage.list({ prefix: "", limit: 10, cursor: "../a.md" }))).toEqual(["query-invalid"]);
        expect(failureCodes(await storage.list({ prefix: "", limit: 10, cursor: "" }))).toEqual(["query-invalid"]);
      });
    });

    describe("exact paths", () => {
      // A filesystem that ignores case or Unicode normalization would find these under other names. U+00E9 is the NFC form
      // of e followed by U+0301.
      const files = { "a.md": "a\n", "Dir/b.md": "b\n", "é.md": "nfd\n" };

      test("find a file only by the name it is stored under, byte for byte", async () => {
        const storage = await create(files);
        expect(failureCodes(await storage.stat("A.md"))).toEqual(["address-not-found"]);
        expect(failureCodes(await storage.read("dir/b.md"))).toEqual(["address-not-found"]);
        expect(failureCodes(await storage.stat("é.md"))).toEqual(["address-not-found"]);
        expect((await storage.stat("a.md")).ok).toBe(true);
        expect((await storage.stat("Dir/b.md")).ok).toBe(true);
        expect((await storage.stat("é.md")).ok).toBe(true);
      });

      test("list under a prefix only the paths that start with it, byte for byte", async () => {
        const storage = await create(files);
        const paths = async (prefix: string) =>
          successValue(await storage.list({ prefix, limit: 10 })).items.map((item) => item.path);
        expect(await paths("dir/")).toEqual([]);
        expect(await paths("Dir/")).toEqual(["Dir/b.md"]);
        expect(await paths("é")).toEqual([]);
        expect(await paths("")).toEqual(["Dir/b.md", "a.md", "é.md"]);
      });
    });

    describe("stat", () => {
      test("gives what list gives for the file", async () => {
        const storage = await create({ "x/y.json": '{"a": 1}\n' });
        const listed = successValue(await storage.list({ prefix: "", limit: 1 })).items[0];
        expect(successValue(await storage.stat("x/y.json"))).toEqual(listed);
      });

      test("fails with address-not-found for a missing file and for a directory", async () => {
        const storage = await create({ "x/y.json": "{}" });
        expect(failureCodes(await storage.stat("x/z.json"))).toEqual(["address-not-found"]);
        expect(failureCodes(await storage.stat("x"))).toEqual(["address-not-found"]);
        expect(failureCodes(await storage.stat("x/y.json/z"))).toEqual(["address-not-found"]);
      });

      test.each([[""], ["/x/y.json"], ["x//y.json"], ["x/../x/y.json"], ["./x/y.json"], ["x/y.json/"], ["x\\y.json"]])(
        "fails with address-malformed for %j",
        async (path) => {
          const storage = await create({ "x/y.json": "{}" });
          expect(failureCodes(await storage.stat(path))).toEqual(["address-malformed"]);
        },
      );
    });

    describe("read", () => {
      const content = "one\r\ntwo\rthree\nfour";

      test("returns the bytes with the version and size of the file", async () => {
        const bytes = utf8(content);
        const storage = await create({ "t.md": bytes });
        const read = successValue(await storage.read("t.md"));
        expect(read.content).toEqual(bytes);
        expect(read.range).toEqual({ start: 0, end: bytes.length });
        expect(read.version).toBe(await gitBlobId(bytes));
        expect(read.size).toBe(bytes.length);
      });

      test("reads a byte range, cut at the end of the file, with the version of the whole file", async () => {
        const storage = await create({ "t.md": content });
        const read = successValue(await storage.read("t.md", { range: { unit: "bytes", start: 5, end: 100 } }));
        expect(text(read.content)).toBe("two\rthree\nfour");
        expect(read.range).toEqual({ start: 5, end: 19 });
        expect(read.version).toBe(await gitBlobId(utf8(content)));
      });

      test("reads a line range, with lines ending at LF, CRLF or a lone CR", async () => {
        const storage = await create({ "t.md": content });
        const lines = async (start: number, end: number) =>
          text(successValue(await storage.read("t.md", { range: { unit: "lines", start, end } })).content);
        expect(await lines(1, 2)).toBe("one\r\n");
        expect(await lines(2, 4)).toBe("two\rthree\n");
        expect(await lines(4, 5)).toBe("four");
        expect(await lines(4, 99)).toBe("four");
        expect(await lines(5, 9)).toBe("");
        expect(await lines(3, 3)).toBe("");
      });

      test("returns a copy, which a caller may change", async () => {
        const storage = await create({ "t.md": "abc" });
        const first = successValue(await storage.read("t.md"));
        first.content.fill(0x7a);
        expect(text(successValue(await storage.read("t.md")).content)).toBe("abc");
      });

      test("fails with storage-failed for a past version on a backend without history", async () => {
        const storage = await create({ "t.md": "abc" });
        if (storage.history !== null) return;
        expect(failureCodes(await storage.read("t.md", { at: "HEAD~1" }))).toEqual(["storage-failed"]);
      });

      test("fails with address-not-found for a missing file", async () => {
        const storage = await create({ "t.md": "abc" });
        expect(failureCodes(await storage.read("u.md"))).toEqual(["address-not-found"]);
      });

      test("throws on a reversed range, a caller's bug", async () => {
        const storage = await create({ "t.md": "abc" });
        await expect(storage.read("t.md", { range: { unit: "bytes", start: 2, end: 1 } })).rejects.toThrow(RangeError);
        await expect(storage.read("t.md", { range: { unit: "lines", start: 0, end: 1 } })).rejects.toThrow(RangeError);
      });
    });

    describe("grep", () => {
      const files = {
        "notes/a.md": "\u{FEFF}# Title\r\nalpha beta\r\ngamma\r\n",
        "notes/b.md": "one\ralpha\rtwo\r",
        "notes/c.txt": "\u{1F600}\nalpha\n",
        "other.md": "alpha\n",
      };
      const grep = async (storage: StorageReader, pattern: string, extra: Partial<Parameters<StorageReader["grep"]>[0]> = {}) =>
        successValue(await storage.grep({ pattern, mode: "regex", context: 0, limit: 50, ...extra }));
      const where = (page: { items: readonly { path: string; line: number }[] }) =>
        page.items.map((item) => `${item.path}:${item.line}`);

      test("finds literal matches in byte order of the paths, then by line", async () => {
        const storage = await create(files);
        const page = await grep(storage, "alpha", { mode: "literal" });
        expect(where(page)).toEqual(["notes/a.md:2", "notes/b.md:2", "notes/c.txt:2", "other.md:1"]);
        expect(page.items[0]?.text).toBe("alpha beta");
        expect(page.cursor).toBeNull();
      });

      test("takes a literal pattern literally", async () => {
        const storage = await create({ "a.md": "a.b\naxb\n" });
        expect(where(await grep(storage, "a.b", { mode: "literal" }))).toEqual(["a.md:1"]);
        expect(where(await grep(storage, "a.b"))).toEqual(["a.md:1", "a.md:2"]);
      });

      test("reads U+2028 and U+2029 inside a line as RE2 and Python do: . matches them, and ^ and $ do not", async () => {
        const storage = await create({ "u.md": "a b c\n" });
        expect(where(await grep(storage, "^a.b.c$"))).toEqual(["u.md:1"]);
        expect(where(await grep(storage, "^b"))).toEqual([]);
        expect(where(await grep(storage, "a$"))).toEqual([]);
      });

      test("matches $ at the end of a line that ends in CRLF or a lone CR", async () => {
        const storage = await create(files);
        expect(where(await grep(storage, "^gamma$"))).toEqual(["notes/a.md:3"]);
        expect(where(await grep(storage, "^alpha$"))).toEqual(["notes/b.md:2", "notes/c.txt:2", "other.md:1"]);
      });

      test("drops a byte order mark, so ^ matches the first character of line 1", async () => {
        const storage = await create(files);
        expect(where(await grep(storage, "^# Title$"))).toEqual(["notes/a.md:1"]);
      });

      test("matches . against a whole character above U+FFFF", async () => {
        const storage = await create(files);
        expect(where(await grep(storage, "^.$"))).toEqual(["notes/c.txt:1"]);
      });

      test("matches case-insensitively with the flag i", async () => {
        const storage = await create(files);
        expect(where(await grep(storage, "ALPHA B", { ignoreCase: true }))).toEqual(["notes/a.md:2"]);
        expect(where(await grep(storage, "ALPHA B"))).toEqual([]);
      });

      test("searches only the paths the glob matches", async () => {
        const storage = await create(files);
        expect(where(await grep(storage, "alpha", { glob: "notes/*.md" }))).toEqual(["notes/a.md:2", "notes/b.md:2"]);
      });

      test("returns context lines before and after each match", async () => {
        const storage = await create(files);
        const [match] = (await grep(storage, "beta", { context: 1 })).items;
        expect(match?.before).toEqual(["# Title"]);
        expect(match?.after).toEqual(["gamma"]);
        const [last] = (await grep(storage, "two", { context: 2 })).items;
        expect(last?.before).toEqual(["one", "alpha"]);
        expect(last?.after).toEqual([]);
      });

      test("pages with a cursor that resumes after the last line, across and within files", async () => {
        const storage = await create({ "a.md": "x\nx\nx\n", "b.md": "x\n" });
        const first = await grep(storage, "x", { limit: 2 });
        expect(where(first)).toEqual(["a.md:1", "a.md:2"]);
        const second = await grep(storage, "x", { limit: 2, cursor: first.cursor as string });
        expect(where(second)).toEqual(["a.md:3", "b.md:1"]);
        expect(second.cursor).toBeNull();
      });

      test("fails with an issue for a pattern outside the portable subset", async () => {
        const storage = await create(files);
        const outcome = await storage.grep({ pattern: "(a)\\1", mode: "regex", context: 0, limit: 5 });
        expect(failureCodes(outcome)).toEqual(["query-invalid"]);
        expect(outcome.issues[0]?.message).toContain("backreference");
      });

      test("fails with query-invalid for a cursor that is not a grep cursor", async () => {
        const storage = await create(files);
        expect(failureCodes(await storage.grep({ pattern: "a", mode: "literal", context: 0, limit: 5, cursor: "a.md" }))).toEqual(
          ["query-invalid"],
        );
      });
    });

    describe("unreadable files", () => {
      const files = { "a.md": "alpha\n", "b.md": "alpha\n", "c.md": "alpha\n" };

      test.skipIf(!backend.canMakeUnreadable)("fail stat and read with storage-failed, not address-not-found", async () => {
        const storage = await create(files, ["b.md"]);
        expect(failureCodes(await storage.stat("b.md"))).toEqual(["storage-failed"]);
        expect(failureCodes(await storage.read("b.md"))).toEqual(["storage-failed"]);
        expect((await storage.read("a.md")).ok).toBe(true);
      });

      test.skipIf(!backend.canMakeUnreadable)(
        "are left out of a listing, which succeeds with a storage-failed issue",
        async () => {
          const storage = await create(files, ["b.md"]);
          const outcome = await storage.list({ prefix: "", limit: 10 });
          expect(successValue(outcome).items.map((item) => item.path)).toEqual(["a.md", "c.md"]);
          expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([["storage-failed", "b.md"]]);
        },
      );

      test.skipIf(!backend.canMakeUnreadable)("are skipped by grep, which succeeds with a storage-failed issue", async () => {
        const storage = await create(files, ["b.md"]);
        const outcome = await storage.grep({ pattern: "alpha", mode: "literal", context: 0, limit: 10 });
        expect(successValue(outcome).items.map((item) => item.path)).toEqual(["a.md", "c.md"]);
        expect(outcome.issues.map((issue) => [issue.code, issue.path])).toEqual([["storage-failed", "b.md"]]);
      });
    });
  });
}
