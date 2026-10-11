// Generates `src/anchor/unicode/unicode-17.0.0.generated.ts`, the Unicode data of the derived-anchor rule (proposal §6.3), from
// the Unicode Character Database 17.0.0. Run by hand, never in CI, from `js/`:
//
//   node packages/core/scripts/generate-unicode.mjs [--ucd DIR]
//
// It downloads the five UCD files below, or with `--ucd` reads them from DIR at the same relative paths, refuses any whose
// SHA-256 differs from the one written here, and writes range tables. A download that fails with
// UNABLE_TO_GET_ISSUER_CERT_LOCALLY is a local trust-store problem: Node does not trust a certificate authority that the machine
// does (a TLS-inspecting proxy, for one). Point NODE_EXTRA_CA_CERTS at that authority's PEM file, or fetch the files with another
// tool and pass `--ucd`.
//
// The UCD files are not committed. Raising the Unicode version means new URLs and hashes here, a new generated file, the Node
// pin in `js/.node-version` raised to a release with that Unicode version, and the conformance suite's version
// (conformance/README.md).
//
// What it reads (field numbers count from 0, as UAX #44 §4.2.1 numbers them):
//   PropList.txt                          field 1 = White_Space                    → White_Space (steps 4 and 5)
//   DerivedCoreProperties.txt             field 1 = Default_Ignorable_Code_Point   → Default_Ignorable_Code_Point (step 2)
//   extracted/DerivedGeneralCategory.txt  field 1 in L*, M*, Nd, Pc                → the categories step 5 keeps
//   UnicodeData.txt                       field 13, Simple_Lowercase_Mapping
//   SpecialCasing.txt                     field 1, the lower-case mapping, of entries with no condition list (field 4)
//
// Step 3 maps each code point by the unconditional entry of SpecialCasing.txt where there is one, and otherwise by
// UnicodeData.txt's simple mapping. Conditional entries (Final_Sigma, the language-specific ones) are left out.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const VERSION = "17.0.0";
const BASE_URL = `https://www.unicode.org/Public/${VERSION}/ucd/`;

/** Each input with its SHA-256, taken when the generator was written (2026-10-10). */
const INPUTS = {
  "PropList.txt": "130dcddcaadaf071008bdfce1e7743e04fdfbc910886f017d9f9ac931d8c64dd",
  "DerivedCoreProperties.txt": "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
  "extracted/DerivedGeneralCategory.txt": "d62e5bab70ca74f099343f71224fa051cb1fdd61a1ab45c0488c44cfc0b6102e",
  "UnicodeData.txt": "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  "SpecialCasing.txt": "efc25faf19de21b92c1194c111c932e03d2a5eaf18194e33f1156e96de4c9588",
};

/** General_Category values of L (letters), M (marks), Nd and Pc: UAX #44 §5.7.1, Table 12. */
const KEPT_CATEGORIES = new Set(["Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Pc"]);

const MAX_CODE_POINT = 0x10ffff;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const coreDir = join(scriptDir, "..");
const outFile = join(coreDir, "src", "anchor", "unicode", `unicode-${VERSION}.generated.ts`);

const { values: options } = parseArgs({ options: { ucd: { type: "string" } } });

/** Reads one input from `--ucd` or the UCD's site, and checks its hash and its first line. */
async function readInput(name) {
  let bytes;
  if (options.ucd !== undefined) {
    bytes = await readFile(join(options.ucd, name));
  } else {
    const response = await fetch(BASE_URL + name);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== INPUTS[name]) throw new Error(`${name}: SHA-256 ${hash}, expected ${INPUTS[name]}`);
  const text = bytes.toString("utf8");
  // UnicodeData.txt has no header; the other files name themselves and their version on the first line.
  const header = `# ${name.split("/").pop().replace(".txt", `-${VERSION}.txt`)}`;
  if (name !== "UnicodeData.txt" && !text.startsWith(header)) throw new Error(`${name}: does not start with "${header}"`);
  return text;
}

/** The data lines of a UCD file, comments removed, as trimmed fields. */
function* records(text) {
  for (const line of text.split("\n")) {
    const data = line.split("#", 1)[0].trim();
    if (data !== "") yield data.split(";").map((field) => field.trim());
  }
}

/** `0041` or `0041..005A` → [first, last]. */
function parseRange(field) {
  const [first, last = first] = field.split("..");
  return [Number.parseInt(first, 16), Number.parseInt(last, 16)];
}

/** The code points whose field 1 satisfies `accept`, as a membership array over every code point. */
function propertySet(text, accept) {
  const member = new Uint8Array(MAX_CODE_POINT + 1);
  for (const fields of records(text)) {
    if (!accept(fields[1])) continue;
    const [first, last] = parseRange(fields[0]);
    member.fill(1, first, last + 1);
  }
  return member;
}

/** Disjoint ranges of a membership array as [gap, length] pairs, each gap counted from the end of the previous range. */
function encodeRanges(member) {
  const encoded = [];
  let previousEnd = 0;
  let count = 0;
  for (let cp = 0; cp <= MAX_CODE_POINT; ) {
    if (!member[cp]) {
      cp++;
      continue;
    }
    const start = cp;
    while (cp <= MAX_CODE_POINT && member[cp]) cp++;
    encoded.push(start - previousEnd, cp - start);
    previousEnd = cp;
    count++;
  }
  return { encoded, count };
}

/** The full default lower-case mapping of every code point that has one other than itself, as arrays of code points. */
function lowerCaseMappings(unicodeData, specialCasing) {
  const mappings = new Map();
  for (const fields of records(unicodeData)) {
    if (fields[13] !== "") mappings.set(Number.parseInt(fields[0], 16), [Number.parseInt(fields[13], 16)]);
  }
  for (const fields of records(specialCasing)) {
    // <code>; <lower>; <title>; <upper>; (<condition_list>;)? The trailing ";" leaves one empty field.
    const conditions = fields[4] ?? "";
    if (conditions !== "") continue;
    const cp = Number.parseInt(fields[0], 16);
    const lower = fields[1].split(/\s+/).map((hex) => Number.parseInt(hex, 16));
    if (lower.length === 1 && lower[0] === cp) mappings.delete(cp);
    else mappings.set(cp, lower);
  }
  return mappings;
}

/**
 * Single-code-point mappings as runs of [start gap, count, stride, delta]: `count` code points from `start`, `stride` apart,
 * each mapping to itself plus `delta`. The start gap is counted from the previous run's start. A run of stride 2 only skips code
 * points that map to themselves, so runs never interleave and a lookup can search them by start.
 */
function encodeLowerCaseRuns(mappings) {
  const delta = (cp) => {
    const lower = mappings.get(cp);
    return lower?.length === 1 ? lower[0] - cp : undefined;
  };
  const singles = [...mappings.keys()].filter((cp) => delta(cp) !== undefined).sort((a, b) => a - b);
  const encoded = [];
  let previousStart = 0;
  let count = 0;
  for (let i = 0; i < singles.length; ) {
    const start = singles[i];
    const d = delta(start);
    let stride = 1;
    if (delta(start + 1) !== d && delta(start + 2) === d && !mappings.has(start + 1)) stride = 2;
    let length = 1;
    while (delta(start + length * stride) === d && (stride === 1 || !mappings.has(start + length * stride - 1))) length++;
    encoded.push(start - previousStart, length, stride, d);
    previousStart = start;
    count++;
    // A run's members are exactly the next `length` single mappings: a stride of 2 skips only code points without one.
    i += length;
  }
  return { encoded, count };
}

function hex(cp) {
  return `0x${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

const texts = Object.fromEntries(await Promise.all(Object.keys(INPUTS).map(async (name) => [name, await readInput(name)])));

const whiteSpace = encodeRanges(propertySet(texts["PropList.txt"], (value) => value === "White_Space"));
const defaultIgnorable = encodeRanges(
  propertySet(texts["DerivedCoreProperties.txt"], (value) => value === "Default_Ignorable_Code_Point"),
);
const kept = encodeRanges(propertySet(texts["extracted/DerivedGeneralCategory.txt"], (value) => KEPT_CATEGORIES.has(value)));
const mappings = lowerCaseMappings(texts["UnicodeData.txt"], texts["SpecialCasing.txt"]);
const runs = encodeLowerCaseRuns(mappings);
const expansions = [...mappings].filter(([, lower]) => lower.length > 1).sort(([a], [b]) => a - b);

const inputLines = Object.entries(INPUTS).map(([name, hash]) => `//   ${name}  sha256 ${hash}`);
const generatedBy = "Generated by js/packages/core/scripts/generate-unicode.mjs";
const expansionLiterals = expansions.map(([cp, lower]) => `[${[cp, ...lower].map(hex).join(", ")}]`);
const output = `// ${generatedBy} from the Unicode Character Database ${VERSION}. Do not edit.
// Inputs, from ${BASE_URL}:
${inputLines.join("\n")}
// Encodings and lookups are in unicode.ts.

/** The Unicode version of these tables. */
export const UNICODE_VERSION = "${VERSION}";

/** White_Space (PropList.txt): ${whiteSpace.count} ranges as [gap, length] pairs. */
export const WHITE_SPACE: readonly number[] = [${whiteSpace.encoded.join(", ")}];

/** Default_Ignorable_Code_Point (DerivedCoreProperties.txt): ${defaultIgnorable.count} ranges as [gap, length] pairs. */
export const DEFAULT_IGNORABLE_CODE_POINT: readonly number[] = [${defaultIgnorable.encoded.join(", ")}];

/** General_Category L, M, Nd or Pc (extracted/DerivedGeneralCategory.txt): ${kept.count} ranges as [gap, length] pairs. */
export const LETTER_MARK_DIGIT_CONNECTOR: readonly number[] = [${kept.encoded.join(", ")}];

/**
 * Lower-case mappings to one other code point (UnicodeData.txt field 13, overridden by SpecialCasing.txt's unconditional
 * entries): ${runs.count} runs as [start gap, count, stride, delta].
 */
export const LOWER_CASE_RUNS: readonly number[] = [${runs.encoded.join(", ")}];

/** Lower-case mappings to more than one code point (SpecialCasing.txt, unconditional): [code point, ...mapping]. */
export const LOWER_CASE_EXPANSIONS: readonly (readonly number[])[] = [${expansionLiterals.join(", ")}];
`;

await writeFile(outFile, output);
// The workspace's pinned Biome formats the file as `npm run lint` expects it.
execFileSync(join(coreDir, "..", "..", "node_modules", ".bin", "biome"), ["format", "--write", outFile], { stdio: "inherit" });
console.log(
  `${outFile}: White_Space ${whiteSpace.count} ranges, Default_Ignorable_Code_Point ${defaultIgnorable.count}, ` +
    `L/M/Nd/Pc ${kept.count}, lower case ${runs.count} runs and ${expansions.length} expansions`,
);
