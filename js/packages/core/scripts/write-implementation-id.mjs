// Writes `dist/implementation-id.json`, the id of this build of core, which the local index keys its entries by, so that a
// build that changes how records are parsed or bound never reads another build's entries. Run by `npm run build`, from `js/`:
//
//   node packages/core/scripts/write-implementation-id.mjs
//
// The id is the SHA-256 of every file below core's `src/`, of core's `package.json`, which pins its direct dependencies, and
// of `js/package-lock.json`, which pins the rest, each with its path relative to `js/` and its length. Tests and test kits are
// in `src/` too, so editing one changes the id: that only costs a cold cache.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = join(core, "..", "..");

/** Every file below a directory, sorted by path. */
function filesBelow(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

const files = [...filesBelow(join(core, "src")), join(core, "package.json"), join(workspace, "package-lock.json")]
  .map((path) => ({ path, name: relative(workspace, path).split(sep).join("/") }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const hash = createHash("sha256");
for (const { path, name } of files) {
  const bytes = readFileSync(path);
  hash.update(`${name}\0${bytes.length}\0`);
  hash.update(bytes);
}
const id = hash.digest("hex");
mkdirSync(join(core, "dist"), { recursive: true });
writeFileSync(join(core, "dist", "implementation-id.json"), `${JSON.stringify({ id })}\n`);
console.log(`implementation id ${id}`);
