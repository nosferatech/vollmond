// What the vampiredb demonstrations share: where the built vmd and the trial's configuration are, running vmd in a fresh
// process, a digest of a directory tree, the guard on the temporary directory, and timing statistics.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The TypeScript workspace, whose packages the demonstrations run after a build. */
export const js = path.resolve(here, "../../js");
/** The built CLI's entry point. */
export const vmdMain = path.join(js, "packages/cli/dist/main.js");
/** The trial's configuration, with its `schema/` beside it, given to vmd through `--config`. */
export const config = path.join(here, "config.yaml");

/**
 * Runs the built `vmd` in a fresh process over `store` with the trial's configuration, and gives its stdout, stderr, exit
 * status and wall-clock time. A non-zero exit is returned, not thrown. With `cache`, the process gets `XDG_CACHE_HOME` set to
 * it, so that the local index lives there; without it, the environment is passed on unchanged.
 */
export function runVmd(store, args, { cache } = {}) {
  const env = cache === undefined ? process.env : { ...process.env, XDG_CACHE_HOME: cache };
  const started = performance.now();
  let stdout;
  let stderr = "";
  let status = 0;
  try {
    stdout = execFileSync(process.execPath, [vmdMain, "--store", store, "--config", config, ...args], {
      encoding: "utf8",
      env,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
    status = error.status ?? 1;
  }
  return { stdout, stderr, status, ms: performance.now() - started };
}

/**
 * Gives a digest of every entry under `root`, by path and kind, with a file's bytes and a symbolic link's target, and the
 * number of entries: a new, removed or changed file, directory or link changes it.
 */
export function fingerprint(root) {
  const hash = createHash("sha256");
  const entries = fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => ({ entry, relative: path.relative(root, path.join(entry.parentPath, entry.name)) }))
    .sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  for (const { entry, relative } of entries) {
    const absolute = path.join(root, relative);
    const kind = entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "other";
    hash.update(`${relative}\0${kind}\0`);
    if (kind === "file") hash.update(fs.readFileSync(absolute));
    if (kind === "link") hash.update(fs.readlinkSync(absolute));
    hash.update("\0");
  }
  return { entries: entries.length, digest: hash.digest("hex").slice(0, 16) };
}

/**
 * Gives why the system's temporary directory may not be used for a run over `checkout`, or null when it may: it is inside
 * the checkout, so a cache or a copy made there would be inside it too. Both are compared as real paths.
 */
export function temporaryInsideCheckout(checkout) {
  const real = fs.realpathSync(checkout);
  const temporary = fs.realpathSync(os.tmpdir());
  const fromCheckout = path.relative(real, temporary);
  if (fromCheckout.startsWith("..") || path.isAbsolute(fromCheckout)) return null;
  return `the temporary directory ${temporary} is inside ${real}: set TMPDIR to a directory outside the checkout`;
}

/** Gives the minimum, median and maximum of a non-empty list of times. */
export function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { min: sorted[0], median, max: sorted[sorted.length - 1] };
}

/** Formats `stats`' result in milliseconds. */
export const formatStats = (s) => `min ${s.min.toFixed(0)} ms, median ${s.median.toFixed(0)} ms, max ${s.max.toFixed(0)} ms`;
