// Validates the decision records in docs/decisions against their collection's schema, .vmd/schema/decision.schema.yaml, with
// @hyperjump/json-schema 1.18.0, until `vmd check` validates collections, keyed lists included. The validator is a dependency of
// core, so CI runs the script after a build, in js/:
//
//   node scripts/validate-decisions.mjs [STORE]
//
// STORE defaults to ../docs/decisions. Besides what the validator checks, the script checks what vmd adds to JSON Schema, as the
// rules accepted for vmd's validator state them:
//
// - the schema file is at most 1 MiB, holds no `$id`, and reads under vmd's YAML rules, so with no anchor, alias or tag;
// - the collection's name matches `[A-Za-z][A-Za-z0-9_-]*`;
// - `x-vmd-summary` is a boolean, and `x-vmd-ref` stands beside `format: uri-reference`;
// - `x-vmd-list` keys `$sections` by `@key` alone, with no `unevaluatedItems` beside it, and the script evaluates it: every
//   section's key is one the list declares, the required keys are there, and each section is valid against its key's schema.
//
// Formats are asserted with core's checks of the logical types, which core registers with the validator, a process-wide
// setting, when the store first reads a record of the collection; so `date` and `date-time` are checked as vmd checks them.
// Exits with 1 and lists every problem, or prints the number of records validated.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFilesystemStorage } from "../packages/cli/dist/backend/filesystem.js";
import { decodeSource, openStore, parseYamlUnit, sliceUnitText } from "../packages/core/dist/index.js";

const hyperjump = await import("@hyperjump/json-schema/draft-2020-12").catch(() => {
  console.error("@hyperjump/json-schema is not installed: run `npm ci` in js/");
  process.exit(2);
});
const { setShouldValidateFormat } = await import("@hyperjump/json-schema");

const root = resolve(process.argv[2] ?? new URL("../../docs/decisions", import.meta.url).pathname);
const COLLECTION = "decisions";
const SCHEMA_PATH = ".vmd/schema/decision.schema.yaml";
const MAX_SCHEMA_BYTES = 1024 * 1024;
const BASE = "https://vollmond.invalid/decisions/";
const problems = [];
/** Records one problem, under the file it is in. */
const problem = (path, message) => problems.push(`${path}: ${message}`);

const configuration = await readYaml(".vmd/config.yaml");
const collections = Object.keys(configuration?.collections ?? {});
for (const name of collections) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))
    problem(".vmd/config.yaml", `the collection name ${JSON.stringify(name)} is invalid`);
}
if (!collections.includes(COLLECTION)) problem(".vmd/config.yaml", `there is no collection named ${COLLECTION}`);

const schema = await readYaml(SCHEMA_PATH);
if (schema === undefined) finish();
checkVmdKeywords(schema, "");
const list = schema.properties?.$sections?.["x-vmd-list"];

setShouldValidateFormat(true);
hyperjump.registerSchema(schema, `${BASE}schema`);
const itemUris = new Map();
for (const [key, itemSchema] of Object.entries(list?.items ?? {})) {
  const uri = `${BASE}item/${encodeURIComponent(key)}`;
  hyperjump.registerSchema({ $schema: schema.$schema, ...itemSchema, $defs: schema.$defs }, uri);
  itemUris.set(key, uri);
}

const opened = await openStore(createFilesystemStorage(root));
if (!opened.ok) fatal(opened.issues);
const store = opened.value;
const listed = await store.list({ limit: 10000 });
if (!listed.ok) fatal(listed.issues);

let validated = 0;
for (const entry of listed.value.items) {
  if (entry.kind !== "record") continue;
  const read = await store.record(entry.path);
  if (read === null || !read.ok) {
    problem(entry.path, "cannot be read; run scripts/check-decisions.mjs for the reason");
    continue;
  }
  const { value, sectionKeys } = read.value;
  report(entry.path, "", await hyperjump.validate(`${BASE}schema`, value, "BASIC"));
  const sections = Object.hasOwn(value, "$sections") ? value.$sections : [];
  const keys = sections.map((_, index) => sectionKeys.get(`/$sections/${index}`));
  for (const [index, key] of keys.entries()) {
    if (!itemUris.has(key))
      problem(entry.path, `the section "${sections[index].$title}" has the key ${key}, which the schema does not declare`);
    else report(entry.path, `/$sections/${index}`, await hyperjump.validate(itemUris.get(key), sections[index], "BASIC"));
  }
  for (const key of list?.required ?? []) {
    if (!keys.includes(key)) problem(entry.path, `has no section keyed ${key}`);
  }
  validated++;
}
finish();

/** Reads a YAML file of the store under vmd's YAML rules, as a configuration is read, or records why it cannot. */
async function readYaml(path) {
  const bytes = await readFile(join(root, path));
  if (bytes.length > MAX_SCHEMA_BYTES) return void problem(path, `is larger than ${MAX_SCHEMA_BYTES} bytes`);
  const decoded = decodeSource("", bytes, "schema-invalid");
  if (!decoded.ok) return void problem(path, "is not UTF-8");
  const source = decoded.value;
  const unit = parseYamlUnit(source, sliceUnitText(source.text, source.hasBom ? 1 : 0, source.text.length), {
    path: "",
    at: "",
    unit: "front-matter",
  });
  // The codes of a record's shape do not apply to a file that is not a record: its `$` members are JSON Schema's.
  const shape = new Set([
    "dollar-member",
    "feature-unsupported",
    "reserved-member-type",
    "ref-malformed",
    "section-title-missing",
  ]);
  const issues = unit.issues.filter((issue) => !shape.has(issue.code));
  for (const issue of issues) problem(path, `${issue.code}: ${issue.message}`);
  return issues.length > 0 ? undefined : unit.value;
}

/** Checks the rules vmd adds to JSON Schema at a schema object and below it, `at` being its JSON Pointer in the file. */
function checkVmdKeywords(node, at) {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) checkVmdKeywords(item, `${at}/${index}`);
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (Object.hasOwn(node, "$id")) problem(SCHEMA_PATH, `${at || "/"} has $id, which vmd's schemas do not take`);
  if (Object.hasOwn(node, "x-vmd-summary") && typeof node["x-vmd-summary"] !== "boolean") {
    problem(SCHEMA_PATH, `${at}/x-vmd-summary is not a boolean`);
  }
  if (Object.hasOwn(node, "x-vmd-ref") && node.format !== "uri-reference") {
    problem(SCHEMA_PATH, `${at}/x-vmd-ref stands without format: uri-reference`);
  }
  if (Object.hasOwn(node, "x-vmd-list")) {
    if (at !== "/properties/$sections") problem(SCHEMA_PATH, `${at}/x-vmd-list is not on $sections`);
    const keys = node["x-vmd-list"].keys;
    if (!Array.isArray(keys) || keys.length !== 1 || keys[0] !== "@key")
      problem(SCHEMA_PATH, `${at}/x-vmd-list is not keyed by @key alone`);
    if (Object.hasOwn(node, "unevaluatedItems")) problem(SCHEMA_PATH, `${at} has unevaluatedItems beside x-vmd-list`);
  }
  for (const [name, child] of Object.entries(node)) {
    if (name !== "x-vmd-list" && name !== "x-vmd-ref")
      checkVmdKeywords(child, `${at}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  }
  if (Object.hasOwn(node, "x-vmd-list")) {
    for (const [key, item] of Object.entries(node["x-vmd-list"].items ?? {}))
      checkVmdKeywords(item, `${at}/x-vmd-list/items/${key}`);
  }
}

/** Records the errors of a validator's output, at their place in the record. */
function report(path, at, output) {
  if (output.valid) return;
  for (const error of output.errors ?? []) {
    problem(path, `${at}${error.instanceLocation.replace(/^#/, "")} fails ${error.absoluteKeywordLocation.replace(BASE, "")}`);
  }
}

/** Prints the problems and exits with 1, or prints the number of records validated. */
function finish() {
  if (problems.length > 0) {
    console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${root}:`);
    for (const line of problems) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`${validated} decision records valid against ${SCHEMA_PATH}, with @hyperjump/json-schema 1.18.0.`);
  process.exit(0);
}

/** Prints the issues that keep the store from opening or listing, and exits with 1. */
function fatal(issues) {
  for (const issue of issues) console.error(`${root}: ${issue.severity} ${issue.code}: ${issue.message}`);
  process.exit(1);
}
