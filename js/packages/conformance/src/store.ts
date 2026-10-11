import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { gitBlobId } from "./blob.js";
import { isFile } from "./cases.js";
import { type Checked, invalid } from "./checked.js";
import { isJsonObject, readJson } from "./json.js";
import type { FixtureStore } from "./operation.js";

/** A git blob id as a versions manifest gives it. */
const BLOB_ID = /^[0-9a-f]{40}$/;

/**
 * Reads the fixture stores of a suite, each once, and checks each against its versions manifest. A store is read only when a
 * case that runs needs it, so a skipped case never reads one.
 */
export class FixtureStores {
  readonly #suiteDirectory: string;
  readonly #stores = new Map<string, Promise<Checked<ReadonlyMap<string, Uint8Array>>>>();

  /** Creates the reader for the suite at `suiteDirectory`, an absolute path. */
  constructor(suiteDirectory: string) {
    this.#suiteDirectory = suiteDirectory;
  }

  /**
   * Returns the store a case names, `store` being relative to the case file's `directory`, and with the configuration file
   * that `config` names in its `.vmd/` directory. Fails when the store leaves the suite, is not a directory holding
   * `.vmd/config.yaml`, does not match its versions manifest, or lacks the configuration file.
   */
  async open(directory: string, store: unknown, config: unknown): Promise<Checked<FixtureStore>> {
    if (typeof store !== "string" || store === "" || store.includes("\\") || isAbsolute(store)) {
      return invalid("input.store must be a relative path written with /");
    }
    if (config !== undefined && (typeof config !== "string" || !isFileName(config))) {
      return invalid("input.config must be a file name without /");
    }
    const root = resolve(directory, store);
    const inSuite = relative(this.#suiteDirectory, root);
    if (inSuite === "" || inSuite === ".." || inSuite.startsWith(`..${sep}`) || isAbsolute(inSuite)) {
      return invalid(`the store ${store} is not inside the suite`);
    }
    let files = this.#stores.get(root);
    if (files === undefined) {
      files = readStore(root, store);
      this.#stores.set(root, files);
    }
    const read = await files;
    if (!read.ok) {
      return read;
    }
    if (config === undefined) {
      return { ok: true, value: { files: read.value } };
    }
    const configBytes = read.value.get(`.vmd/${config}`);
    return configBytes === undefined
      ? invalid(`the store ${store} has no configuration file .vmd/${config}`)
      : { ok: true, value: { files: read.value, config: configBytes } };
  }
}

/** Whether a configuration name is a single file name, with no `/` and none of the special names `.` and `..`. */
function isFileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
}

/**
 * Reads every file of the store at `root` by store path, and checks the files its versions manifest lists, the manifest being
 * the file beside the store named after it with `.versions.json` added. A store without a manifest is not checked.
 */
async function readStore(root: string, name: string): Promise<Checked<ReadonlyMap<string, Uint8Array>>> {
  if (!(await isFile(join(root, ".vmd", "config.yaml")))) {
    return invalid(`the store ${name} is missing: no .vmd/config.yaml in it`);
  }
  const files = new Map<string, Uint8Array>();
  await readFiles(root, root, files);
  const manifestPath = `${root}.versions.json`;
  if (!(await isFile(manifestPath))) {
    return { ok: true, value: files };
  }
  const mismatch = checkVersions(await readFile(manifestPath), files);
  return mismatch === undefined ? { ok: true, value: files } : invalid(`${name}: ${mismatch}`);
}

/** Adds each regular file below `directory` to `files`, under its store path relative to `root`. */
async function readFiles(root: string, directory: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await readFiles(root, path, files);
    } else if (entry.isFile()) {
      files.set(relative(root, path).split(sep).join("/"), new Uint8Array(await readFile(path)));
    }
  }
}

/**
 * Checks a store's files against its versions manifest, a JSON object from store paths to git blob ids. Returns why they do
 * not match, naming every file that differs or is missing, or `undefined` when they match.
 */
export function checkVersions(manifest: Uint8Array, files: ReadonlyMap<string, Uint8Array>): string | undefined {
  const reading = readJson(manifest);
  if (!reading.ok || reading.problems.length > 0 || !isJsonObject(reading.value)) {
    return "the versions manifest cannot be read";
  }
  const mismatches: string[] = [];
  for (const [path, expected] of Object.entries(reading.value)) {
    if (typeof expected !== "string" || !BLOB_ID.test(expected)) {
      return `the versions manifest gives ${path} no git blob id`;
    }
    const content = files.get(path);
    if (content === undefined) {
      mismatches.push(`${path} is missing`);
      continue;
    }
    const actual = gitBlobId(content);
    if (actual !== expected) {
      mismatches.push(`${path}: version ${expected} expected, the file has ${actual}`);
    }
  }
  return mismatches.length === 0 ? undefined : mismatches.join("; ");
}
