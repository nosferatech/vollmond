// A stand-in for `npm ci` on a machine where npm's TLS fails and curl's works: installs into node_modules exactly the
// packages fetched-deps.txt lists, each at its version and place, with curl.
//
//   node fetch-deps.mjs              install the lock list; fail if the registry's integrity for a version differs from it
//   node fetch-deps.mjs --update     resolve package.json's ranges as the registry has them now, install, rewrite the list
//
// What the integrity check proves: the tarball matches the sha512 the registry publishes for that version, and that sha512 is
// the one recorded in the lock list. Both come from the registry, so the check guards against a changed or corrupted download
// and a changed registry entry, not against a package the registry served wrongly from the start; nothing here verifies a
// signature or provenance.
//
// The validator measurements of docs/design/i2-validate.md ran with 23 of the listed packages (the validators and their
// dependencies), installed at the versions the list gives. The Markdown probes ran with the packages js/ installs, which are
// core's; the list's Markdown packages have the same top-level versions, and their own dependencies may be newer.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const packuments = new Map();
function packument(name) {
  let p = packuments.get(name);
  if (p === undefined) {
    const url = `https://registry.npmjs.org/${name.replaceAll("/", "%2f")}`;
    p = JSON.parse(execFileSync("curl", ["-sS", "--max-time", "60", url], { maxBuffer: 1 << 28 }).toString());
    packuments.set(name, p);
  }
  return p;
}
const parse = (v) => v.split("-")[0].split(".").map(Number);
const cmp = (a, b) => {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
function satisfies(v, range) {
  if (v.includes("-")) return false;
  return range.split("||").some((alt) =>
    alt.trim().split(/\s+/).every((r) => {
      if (r === "*" || r === "" || r === "latest") return true;
      const m = /^(\^|~|>=|<=|>|<|=)?v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?/.exec(r);
      if (!m) return false;
      const [, op = "", ma, mi = "x", pa = "x"] = m;
      const lo = `${ma}.${mi === "x" ? 0 : mi}.${pa === "x" ? 0 : pa}`;
      const [V, L] = [parse(v), parse(lo)];
      if (op === ">=") return cmp(v, lo) >= 0;
      if (op === ">") return cmp(v, lo) > 0;
      if (op === "<") return cmp(v, lo) < 0;
      if (op === "<=") return cmp(v, lo) <= 0;
      if (op === "^") {
        if (cmp(v, lo) < 0) return false;
        if (L[0] > 0) return V[0] === L[0];
        if (L[1] > 0) return V[0] === 0 && V[1] === L[1];
        return V[0] === 0 && V[1] === 0 && V[2] === L[2];
      }
      if (op === "~") return cmp(v, lo) >= 0 && V[0] === L[0] && V[1] === L[1];
      if (mi === "x") return V[0] === Number(ma);
      if (pa === "x") return V[0] === Number(ma) && V[1] === Number(mi);
      return cmp(v, lo) === 0;
    }),
  );
}
function pick(name, range) {
  const p = packument(name);
  const versions = Object.keys(p.versions).filter((v) => satisfies(v, range)).sort(cmp);
  if (versions.length === 0) throw new Error(`no version of ${name} satisfies ${range}`);
  return p.versions[versions.at(-1)];
}
function unpack(meta, directory) {
  if (existsSync(join(directory, "package.json"))) return;
  const tgz = execFileSync("curl", ["-sS", "--max-time", "120", meta.dist.tarball], { maxBuffer: 1 << 28 });
  const [algo, digest] = meta.dist.integrity.split("-");
  if (createHash(algo).update(tgz).digest("base64") !== digest) throw new Error(`integrity of ${meta.name}@${meta.version}`);
  mkdirSync(directory, { recursive: true });
  execFileSync("tar", ["-xzf", "-", "-C", directory, "--strip-components=1"], { input: tgz });
}
const lockPath = join(here, "fetched-deps.txt");

// Every run starts from an empty node_modules, as `npm ci` does, so that a file changed after an earlier install is replaced
// rather than trusted because its package directory exists.
rmSync(join(here, "node_modules"), { recursive: true, force: true });

if (process.argv.includes("--update")) {
  // Resolves package.json's ranges as the registry has them today, installs, and rewrites the lock list.
  const top = JSON.parse(readFileSync(join(here, "package.json"), "utf8")).dependencies;
  const installed = new Map(); // hoisted name -> version
  const lock = [];
  function install(name, range, parentDir) {
    const meta = pick(name, range);
    const hoisted = installed.get(name);
    let directory;
    if (hoisted === undefined) {
      installed.set(name, meta.version);
      directory = join(here, "node_modules", name);
    } else if (hoisted === meta.version) {
      return;
    } else {
      directory = join(parentDir, "node_modules", name);
    }
    unpack(meta, directory);
    lock.push(`${name}@${meta.version} ${meta.dist.integrity} ${directory.slice(here.length)}`);
    for (const [dep, r] of Object.entries(meta.dependencies ?? {})) install(dep, r, directory);
  }
  for (const [name, version] of Object.entries(top)) install(name, version, here);
  writeFileSync(lockPath, `${lock.sort().join("\n")}\n`);
  console.log(`${lock.length} packages; ${lockPath} rewritten`);
} else {
  // Installs exactly the lock list: each package at its locked version, where the lock places it, and fails when the
  // registry's integrity for that version differs from the locked one, or the tarball from it.
  let count = 0;
  for (const line of readFileSync(lockPath, "utf8").split("\n").filter(Boolean)) {
    const [spec, integrity, place] = line.split(" ");
    const at = spec.lastIndexOf("@");
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    const meta = packument(name).versions[version];
    if (meta === undefined) throw new Error(`${spec} is not on the registry`);
    if (meta.dist.integrity !== integrity) throw new Error(`${spec}: the registry's integrity differs from the lock's`);
    unpack(meta, join(here, place));
    count++;
  }
  console.log(`${count} packages, as ${lockPath} lists them`);
}
