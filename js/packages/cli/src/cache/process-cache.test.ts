// The local index of a `vmd` process: where `main` keeps it, from the process's own environment.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { processCacheSettings } from "./process-cache.js";

const saved = { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, HOME: process.env.HOME };

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the cache settings of a process", () => {
  const implementation = "0".repeat(64);

  test("say that XDG_CACHE_HOME set the directory, as it is under the tests' setup", () => {
    expect(process.env.XDG_CACHE_HOME?.startsWith(tmpdir())).toBe(true);
    expect(processCacheSettings(implementation)).toEqual({
      directory: join(process.env.XDG_CACHE_HOME as string, "vmd"),
      explicit: true,
      implementation,
    });
  });

  test("say that the directory is the default when XDG_CACHE_HOME is not set", () => {
    delete process.env.XDG_CACHE_HOME;
    // A home of the test's own; the settings only name directories, and nothing is read or written.
    process.env.HOME = join(tmpdir(), "vmd-test-home");
    const settings = processCacheSettings(implementation);
    expect(settings?.explicit).toBe(false);
    expect(settings?.directory.startsWith(join(tmpdir(), "vmd-test-home"))).toBe(true);
  });

  test("are none without an implementation id", () => {
    expect(processCacheSettings(null)).toBeNull();
  });
});
