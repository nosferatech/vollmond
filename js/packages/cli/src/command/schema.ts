// `vmd schema [COLLECTION] [--all]`: the store's collections, or what one collection's schema says, in one screen.

import {
  type Collection,
  collectionOfRecord,
  type FieldSummary,
  fail,
  type ListSummary,
  makeIssue,
  type Outcome,
  type SchemaSummary,
  type Store,
  succeed,
  type Value,
} from "@vollmond/core";
import { type ColumnRow, formatColumns, oneLine } from "../output/lines.js";
import { formatCount } from "../output/sizes.js";
import { counted } from "./check.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem } from "./options.js";

/** The lines a collection's summary is cut at without `--all`, its first line included. */
const SCREEN_LINES = 40;

/** How many paths a page of the listing that counts records holds. */
const LIST_PAGE = 1000;

/** A collection as the listing gives it. */
export interface CollectionListing {
  readonly name: string;
  readonly match: readonly string[];
  /** Its schema file in the schema directory; absent for a collection without one. */
  readonly schema?: string;
  /** How many records it holds: those it alone claims. */
  readonly records: number;
}

/** What `vmd schema` without a name gives. */
export interface CollectionsListing {
  readonly collections: readonly CollectionListing[];
  /** How many records no collection claims. */
  readonly unclaimed: number;
  /** How many records several collections claim, which are read as records of none (`collection-conflict`). */
  readonly conflicted: number;
}

/** What `vmd schema COLLECTION` gives: the schema's summary, with the collection's schema file and record count. */
export interface CollectionSchemaListing extends SchemaSummary {
  readonly schema?: string;
  readonly records: number;
}

/**
 * Without a name, lists the configuration's collections, one line each with its globs, its schema file and how many records
 * it holds, then how many records are in none; no schema is loaded, so a schema that cannot be used does not fail the
 * listing, which `check` reports. With a name, loads that collection's schema and prints what it says in one screen, cut at 40
 * lines unless `--all`: each field with its type, whether it is required, its logical type, its values and their order, its
 * typed reference and whether it is a summary field; the keyed lists with their keys and required items; and the required
 * sections. Fails with the schema's issue when it cannot be used, and with `address-not-found` for a name the configuration
 * does not have. `--json` gives the same as data, never cut.
 */
export const SCHEMA_COMMAND: Command = {
  name: "schema",
  usage: "[COLLECTION] [--all]",
  summary: "list the collections, or one collection's fields, types, values and required sections",
  options: { all: { type: "boolean" } },
  help: "  --all  print the whole summary; it is cut at 40 lines otherwise\n",
  readsStore: true,
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 0, 1, "a collection");
    if (problem !== null) return usagePlan(problem);
    const name = positionals[0];
    const all = options.all === true;
    if (all && name === undefined) return usagePlan("--all prints a collection's whole summary: name the collection");
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const counts = await recordCounts(store);
        if (!counts.ok) return outcomeOutput(counts, () => "");
        if (name === undefined) {
          const listing: CollectionsListing = {
            collections: store.configuration.collections.map((collection) => ({
              name: collection.name,
              match: collection.match,
              ...(collection.schema === undefined ? {} : { schema: collection.schema }),
              records: counts.value.byCollection.get(collection) ?? 0,
            })),
            unclaimed: counts.value.unclaimed,
            conflicted: counts.value.conflicted,
          };
          return outcomeOutput(succeed(listing, counts.issues), formatListing);
        }
        const collection = store.configuration.collections.find((candidate) => candidate.name === name);
        if (collection === undefined) return outcomeOutput(unknownCollection(store, name), () => "");
        const records = counts.value.byCollection.get(collection) ?? 0;
        const loaded = await store.schema(collection);
        if (loaded !== null && !loaded.ok) return outcomeOutput(loaded, () => "");
        const head = `${oneLine(name)}  ${oneLine(collection.schema ?? "(no schema)")}  ${counted(records, "record")}\n`;
        if (loaded === null) return outcomeOutput(succeed({ collection: name, records }, counts.issues), () => head);
        const summary: CollectionSchemaListing = {
          ...loaded.value.summary(),
          ...(collection.schema === undefined ? {} : { schema: collection.schema }),
          records,
        };
        return outcomeOutput(succeed(summary, counts.issues), (value) => head + cut(formatSummary(value), all));
      },
    };
  },
};

/** The records of each collection, and those in none, counted over the store's listing. */
interface RecordCounts {
  readonly byCollection: ReadonlyMap<Collection, number>;
  readonly unclaimed: number;
  readonly conflicted: number;
}

/** Counts the store's records by the collection that claims each, from the listing alone, without reading a record. */
async function recordCounts(store: Store): Promise<Outcome<RecordCounts>> {
  const byCollection = new Map<Collection, number>();
  let unclaimed = 0;
  let conflicted = 0;
  let cursor: string | null = null;
  do {
    const page = await store.backend.list({ prefix: "", limit: LIST_PAGE, ...(cursor === null ? {} : { cursor }) });
    if (!page.ok) return fail(page.issues);
    const paths = [
      ...page.value.items.map((file) => file.path),
      ...page.issues.flatMap((issue) => (issue.code === "storage-failed" && issue.path !== null ? [issue.path] : [])),
    ];
    for (const path of paths) {
      const found = store.classify(path);
      if (found.kind !== "record") continue;
      const collection = collectionOfRecord(found);
      if (found.collections.length > 1) conflicted += 1;
      else if (collection === undefined) unclaimed += 1;
      else byCollection.set(collection, (byCollection.get(collection) ?? 0) + 1);
    }
    cursor = page.value.cursor;
  } while (cursor !== null);
  return succeed({ byCollection, unclaimed, conflicted });
}

/** The failure for a collection name the configuration does not have, naming those it has. */
function unknownCollection(store: Store, name: string): Outcome<never> {
  const names = store.configuration.collections.map((collection) => collection.name);
  return fail([
    makeIssue({
      code: "address-not-found",
      path: null,
      at: null,
      message: `the configuration has no collection named ${name}`,
      hint: names.length === 0 ? "the configuration has no collections" : `the collections are ${names.join(", ")}`,
    }),
  ]);
}

/** Writes the listing of the collections. */
function formatListing(listing: CollectionsListing): string {
  const rows = listing.collections.map(
    (collection): ColumnRow => ({
      cells: [
        collection.name,
        collection.match.join(", "),
        collection.schema ?? "(no schema)",
        counted(collection.records, "record"),
      ],
    }),
  );
  const unclaimed = listing.unclaimed === 0 ? "" : `${counted(listing.unclaimed, "record")} in no collection\n`;
  const conflicted =
    listing.conflicted === 0 ? "" : `${counted(listing.conflicted, "record")} claimed by several collections, so by none\n`;
  return formatColumns(rows) + unclaimed + conflicted;
}

/** Writes a schema's summary, one line per field and keyed list, under their headings. */
function formatSummary(summary: SchemaSummary): string {
  let text = "";
  const root = [
    ...(summary.closed === true ? ["no members but these"] : []),
    ...(summary.notShown === undefined ? [] : [`not shown: ${summary.notShown.join(", ")}`]),
  ];
  if (root.length > 0) text += `record  ${oneLine(root.join("  "))}\n`;
  if (summary.fields.length > 0) {
    text += `fields\n${formatColumns(summary.fields.map(fieldRow))}`;
  }
  if (summary.lists.length > 0) text += `keyed lists\n${formatColumns(summary.lists.map(listRow))}`;
  if (summary.sections.length > 0) text += `required sections\n  ${oneLine(summary.sections.join(", "))}\n`;
  if (summary.truncated) text += "(cut: the schema goes deeper than eight levels, or past 10,000 fields)\n";
  return text;
}

/** One field's line: its path, types, whether it is required, and what else the schema says of it. */
function fieldRow(field: FieldSummary): ColumnRow {
  const notes: string[] = [];
  if (field.enum !== undefined) {
    const separator = field.ordered === "asc" ? " < " : field.ordered === "desc" ? " > " : ", ";
    notes.push(`enum ${field.enum.map(valueText).join(separator)}`);
  }
  if (field.format !== undefined) notes.push(field.format);
  if (field.ref !== undefined) {
    const many = field.ref.cardinality === "many" ? "refs" : "ref";
    const targets =
      field.ref.targets === null ? "" : ` to ${field.ref.targets.length === 0 ? "nothing" : field.ref.targets.join(", ")}`;
    notes.push(`${many}${targets}${field.ref.anchors === "explicit" ? ", explicit anchors" : ""}`);
  }
  if (field.summary === true) notes.push("summary");
  if (field.closed === true) notes.push("no other members");
  if (field.sameAs !== undefined) {
    const as = field.sameAs === "" ? "the record" : field.sameAs;
    notes.push(`${field.recursive === true ? "recursive, " : ""}members as ${as}`);
  }
  if (field.notShown !== undefined) notes.push(`not shown: ${field.notShown.join(", ")}`);
  return {
    cells: [field.path, field.types.join(" | "), field.required ? "required" : "", notes.join("  ")],
    depth: 1,
  };
}

/** One keyed list's line: its path, its type and key, and its required keys and keys with a schema of their own. */
function listRow(list: ListSummary): ColumnRow {
  const notes: string[] = [];
  if (list.required.length > 0) notes.push(`required ${list.required.join(", ")}`);
  if (list.items.length > 0) notes.push(`items ${list.items.join(", ")}`);
  if (list.additional !== true) notes.push(list.additional === false ? "no other keys" : "other keys by a schema");
  return { cells: [list.path, `${list.type} by ${list.key}`, notes.join("  ")], depth: 1 };
}

/** Writes an enum value: a string as it is, anything else as JSON. */
function valueText(value: Value): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Cuts text to the lines that fit one screen after the first line, saying how many were left out, unless `all`. */
function cut(text: string, all: boolean): string {
  const lines = text.split("\n").slice(0, -1);
  const room = SCREEN_LINES - 1;
  if (all || lines.length <= room) return text;
  return `${lines.slice(0, room).join("\n")}\n… ${formatCount(lines.length - room)} more lines (--all)\n`;
}
