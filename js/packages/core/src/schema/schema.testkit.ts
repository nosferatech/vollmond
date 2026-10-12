// Helpers for the tests of the schema modules: a collection's schema loaded from files in memory, and records to validate.

import { expect } from "vitest";
import type { Collection } from "../config/configuration.js";
import { parseRecord } from "../format/parse-record.js";
import type { Issue } from "../issue/issue.js";
import { makeIssue } from "../issue/issue.js";
import { fail, succeed } from "../issue/outcome.js";
import type { ParsedRecord } from "../record/record.js";
import { type CollectionSchema, loadCollectionSchema } from "./collection-schema.js";

/** A collection named `things` whose schema is `root`. */
export function collectionOf(root: string): Collection {
  return { name: "things", match: ["*.json"], exclude: [], schema: root, queryTarget: "records" };
}

/** The configuration bytes the tests' schemas are loaded with. */
export const CONFIGURATION = new TextEncoder().encode("vmd: 1\n");

/** Loads the schema `root` from schema files given as text, by their paths in the schema directory. */
export async function load(files: Readonly<Record<string, string>>, root = "s.json", declared = 1) {
  const encoder = new TextEncoder();
  const loaded = await loadCollectionSchema(collectionOf(root), {
    configuration: CONFIGURATION,
    configurationName: ".vmd/config.yaml",
    declared,
    read: async (path) =>
      Object.hasOwn(files, path)
        ? succeed(encoder.encode(files[path] as string))
        : fail([makeIssue({ code: "address-not-found", path: null, at: null, message: `${path} does not exist` })]),
  });
  if (loaded === null) throw new Error("the collection has a schema");
  return loaded;
}

/** Loads a schema that must be usable, from one file `s.json` holding `schema` as JSON, or as JSON text, beside `files`. */
export async function usable(schema: unknown, files: Readonly<Record<string, string>> = {}): Promise<CollectionSchema> {
  const loaded = await load({ "s.json": typeof schema === "string" ? schema : JSON.stringify(schema), ...files });
  if (!loaded.ok) expect.fail(`expected a usable schema, got ${JSON.stringify(loaded.issues)}`);
  return loaded.value;
}

/** Loads a schema that must be unusable, and gives its one issue. */
export async function unusable(files: Readonly<Record<string, string>>, root = "s.json", declared = 1): Promise<Issue> {
  const loaded = await load(files, root, declared);
  if (loaded.ok) expect.fail("expected the schema to be unusable");
  expect(loaded.issues).toHaveLength(1);
  return loaded.issues[0] as Issue;
}

/** Parses a JSON record that must parse. */
export function record(text: string, path = "r.json"): ParsedRecord {
  const parsed = parseRecord(path, new TextEncoder().encode(text));
  if (!parsed.ok) expect.fail(`expected the record to parse, got ${JSON.stringify(parsed.issues)}`);
  return parsed.value;
}

/** The `at` of each issue a schema reports for a JSON record. */
export function violationsAt(schema: CollectionSchema, text: string): (string | null)[] {
  const issues = schema.validate(record(text));
  for (const issue of issues) expect(issue.code).toBe("schema-violation");
  return issues.map((issue) => issue.at);
}
