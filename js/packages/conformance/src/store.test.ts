import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { gitBlobId } from "./blob.js";
import { FixtureStores } from "./store.js";
import { makeSuite, storeFiles } from "./testing/temp-suite.js";

const encode = (text: string) => new TextEncoder().encode(text);
const REAL_SUITE = fileURLToPath(new URL("../../../../conformance/", import.meta.url));

describe("FixtureStores", () => {
  test("reads every file of a store, .vmd included, with the bytes checked in, and the configuration the case names", async () => {
    const suite = await makeSuite({
      ...storeFiles("cases/t/store", "# A\r\n"),
      "cases/t/store/.vmd/lenient.yaml": "x",
      "cases/t/store/d/b.json": "{}",
    });
    const opened = await new FixtureStores(suite).open(join(suite, "cases/t"), "store", "lenient.yaml");
    expect(opened.ok && Object.fromEntries(opened.value.files)).toEqual({
      ".vmd/config.yaml": encode("vmd: 1\n"),
      ".vmd/lenient.yaml": encode("x"),
      "a.md": encode("# A\r\n"),
      "d/b.json": encode("{}"),
    });
    expect(opened.ok && opened.value.config).toEqual(encode("x"));
  });

  test("reaches a shared store with .., inside the suite", async () => {
    const suite = await makeSuite(storeFiles("stores/shared"));
    expect((await new FixtureStores(suite).open(join(suite, "cases/t"), "../../stores/shared", undefined)).ok).toBe(true);
  });

  test.each([
    ["a store outside the suite", "../../..", undefined, "is not inside the suite"],
    ["the suite itself", "../..", undefined, "is not inside the suite"],
    ["a directory beside the suite", "../../../elsewhere", undefined, "is not inside the suite"],
    ["an absolute path", "/tmp", undefined, "relative path"],
    ["a missing store", "nothing", undefined, "is missing"],
    ["a missing configuration file", "store", "strict.yaml", "has no configuration file .vmd/strict.yaml"],
    ["a configuration path", "store", "../config.yaml", "file name without /"],
  ])("rejects %s", async (_name, store, config, detail) => {
    const suite = await makeSuite(storeFiles("cases/t/store"));
    const opened = await new FixtureStores(suite).open(join(suite, "cases/t"), store, config);
    expect(opened.ok ? "" : opened.detail).toContain(detail);
  });

  test("accepts a store whose files match its versions manifest", async () => {
    const suite = await makeSuite({
      ...storeFiles("cases/t/store", "# A\r\n"),
      "cases/t/store.versions.json": JSON.stringify({ "a.md": gitBlobId(encode("# A\r\n")) }),
    });
    expect((await new FixtureStores(suite).open(join(suite, "cases/t"), "store", undefined)).ok).toBe(true);
  });

  test("rejects a store with an edited file or a missing file, naming each", async () => {
    const suite = await makeSuite({
      ...storeFiles("cases/t/store", "# A\n"),
      "cases/t/store.versions.json": JSON.stringify({ "a.md": gitBlobId(encode("# A\r\n")), "gone.md": gitBlobId(encode("")) }),
    });
    const opened = await new FixtureStores(suite).open(join(suite, "cases/t"), "store", undefined);
    expect(opened.ok ? "" : opened.detail).toBe(
      `store: a.md: version ${gitBlobId(encode("# A\r\n"))} expected, the file has ${gitBlobId(encode("# A\n"))}; gone.md is missing`,
    );
  });

  test("rejects a store whose manifest cannot be read", async () => {
    const suite = await makeSuite({ ...storeFiles("cases/t/store"), "cases/t/store.versions.json": '{"a.md": "short"}' });
    const opened = await new FixtureStores(suite).open(join(suite, "cases/t"), "store", undefined);
    expect(opened.ok ? "" : opened.detail).toBe("store: the versions manifest gives a.md no git blob id");
  });

  test("finds every store of the real suite that has a manifest to match it", async () => {
    const manifests = (await readdir(REAL_SUITE, { recursive: true })).filter((path) => path.endsWith(".versions.json"));
    expect(manifests.length).toBeGreaterThan(20);
    const stores = new FixtureStores(REAL_SUITE);
    for (const manifest of manifests) {
      const store = join(REAL_SUITE, manifest.slice(0, -".versions.json".length));
      const opened = await stores.open(dirname(store), relative(dirname(store), store), undefined);
      expect(opened, manifest).toMatchObject({ ok: true });
    }
  });
});
