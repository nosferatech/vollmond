// `vmd refs ADDR [--to | --from] [--context N] [-n N] [--cursor C]`: the references into a node, the default, or made in it.

import {
  applySeverities,
  compareUtf8,
  type Outcome,
  type Reference,
  type ReferenceListing,
  type ReferenceTarget,
  type Store,
  succeed,
} from "@vollmond/core";
import { DEFAULT_ISSUE_LIMIT } from "../output/issues.js";
import { type ColumnRow, formatColumns, oneLine, oneLineWithTabs } from "../output/lines.js";
import { formatPageRemainder, MAX_LIMIT, readLimit } from "../output/paging.js";
import { formatCount } from "../output/sizes.js";
import { checkIssueDetails, counted } from "./check.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, rangeJson, readWholeNumber, storeIssueDetails } from "./options.js";

/** The number of references `refs` prints when `-n` is not given, as for `grep`. */
export const DEFAULT_REFS_LIMIT = 50;

/** A page of references, as `--json` gives it. */
export interface ReferencePage {
  /** The references on the page, each as the library gives it, with its ranges as `[start, end]`. */
  readonly items: readonly unknown[];
  /** The cursor that continues after the page, or null when nothing remains. */
  readonly cursor: string | null;
  readonly remaining: { readonly count: number; readonly exact: true };
  /** The records the listing could not read, and those of each collection whose schema cannot be used. */
  readonly unreadable: ReferenceListing["unreadable"];
}

/**
 * Writes the line that counts the records the listing could not read, naming each collection whose schema cannot be used
 * with its records' count; the empty string for none.
 */
function formatUnreadable(unreadable: ReferenceListing["unreadable"]): string {
  if (unreadable.count === 0) return "";
  const schemas = unreadable.schemas.map(
    (schema) => `${formatCount(schema.count)} of the collection ${schema.collection}, whose schema cannot be used`,
  );
  return `${counted(unreadable.count, "record")} could not be read${schemas.length === 0 ? "" : `: ${schemas.join("; ")}`}\n`;
}

/**
 * Lists the references into the node ADDR names and below it (`--to`, the default), or those made in it and below it
 * (`--from`), grouped by the record that makes them, in the order of their paths and then of the references in each record.
 * A first line gives ADDR and how many references there are; under each citing record's path, each reference gets a line
 * with the canonical address of the node that holds it, its line and column, its status and its target as written, and with
 * `--from` the address it resolves to. `--context N` adds N lines of the citing file before and after each. At most `-n` of
 * them (50 by default) are printed, then, when more remain, how many and the cursor that continues.
 *
 * `--to` with a path alone, or with `#` alone, lists every reference whose URI names that path, a record's, an asset's, a
 * directory's or one where nothing is, whatever its status, but not those to the files below a directory; with a fragment,
 * resolved as a link to it is, through aliases, those with a target at the node or below it (readings R24 and R27 of the I2
 * design, for the project owner to confirm). The records the listing could not read are counted on a line of their own, so
 * that none vanishes silently, naming each collection whose schema cannot be used. The issues of every listed reference
 * follow the listing, on every page, with the severities the configuration gives them, capped at 20, so exit code 4 when one
 * is an error. In the strict read mode, a record the mode refuses is left out and reported, and `--from` it fails, as `get`
 * does. A cursor resumes after the citing record and the ordinal it names, and is not bound to its query, as `grep`'s is not
 * (reading R26).
 */
export const REFS_COMMAND: Command = {
  name: "refs",
  usage: "ADDR [--to | --from] [--context N] [-n N] [--cursor C]",
  summary: "list the references into a node, or made in it, with their status",
  options: {
    to: { type: "boolean" },
    from: { type: "boolean" },
    context: { type: "string" },
    limit: { type: "string", short: "n" },
    cursor: { type: "string" },
  },
  help:
    "  --to         the references into ADDR's node and below it; the default. A path alone: every reference naming it\n" +
    "  --from       the references made in ADDR's node and below it, with the address each resolves to\n" +
    "  --context N  print N lines of the citing file before and after each reference\n" +
    "  -n N         list at most N references, 50 by default; --cursor C continues after them\n",
  readsStore: true,
  readsIndex: true,
  issueOutput: "listing",
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 1, 1, "an address");
    if (problem !== null) return usagePlan(problem);
    if (options.to === true && options.from === true) return usagePlan("--to and --from cannot be given together");
    const limit = readLimit(options.limit as string | undefined, DEFAULT_REFS_LIMIT);
    if (!limit.ok) return usagePlan(limit.message);
    const context = readWholeNumber(options.context, "--context", { minimum: 0, maximum: MAX_LIMIT }, 0);
    if (!context.ok) return usagePlan(context.message);
    const after = options.cursor === undefined ? null : readCursor(options.cursor as string);
    if (after === undefined) return usagePlan(`--cursor ${JSON.stringify(options.cursor)} is not a cursor that refs gave`);
    const address = positionals[0] as string;
    const outgoing = options.from === true;
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const reading = { raw: true } as const;
        const listed = await store.referenceListing(outgoing ? { from: address, reading } : { to: address, reading });
        if (!listed.ok) return outcomeOutput(listed, () => "", storeIssueDetails(store));
        const all = listed.value.references;
        const unreadable = listed.value.unreadable;
        const start = after === null ? 0 : startAfter(all, after);
        const shown = all.slice(start, start + limit.limit);
        const rest = all.length - start - shown.length;
        const last = shown.at(-1);
        const cursor = rest > 0 && last !== undefined ? writeCursor(last, all) : null;
        // The issues of every reference listed, not only the page's, so that the exit code is the whole result's, as for
        // `check -n`; they are printed capped, the references being resolved already.
        const issues = applySeverities([...all.flatMap((reference) => reference.issues), ...listed.issues], store.configuration);
        const page: ReferencePage = {
          items: shown.map(referenceJson),
          cursor,
          remaining: { count: rest, exact: true },
          unreadable,
        };
        const lines = await referenceLines(store, shown, outgoing, context.value);
        const text = () =>
          `${oneLine(address)}  ${counted(all.length, "reference")}\n${lines}${formatUnreadable(unreadable)}` +
          (cursor === null ? "" : formatPageRemainder({ remaining: rest, cursor }));
        const outcome: Outcome<ReferencePage> = succeed(page, issues);
        return outcomeOutput(outcome, text, await checkIssueDetails(store, issues, DEFAULT_ISSUE_LIMIT));
      },
    };
  },
};

/** Where a page starts: after the reference of this citing record with this ordinal among the record's references. */
interface ReferenceCursor {
  readonly path: string;
  readonly ordinal: number;
}

/** Writes the cursor after `reference`: its citing path and its ordinal among that record's references, in base64url. */
function writeCursor(reference: Reference, all: readonly Reference[]): string {
  const ordinal = all.filter((other) => other.from.path === reference.from.path).indexOf(reference);
  return Buffer.from(JSON.stringify([reference.from.path, ordinal]), "utf8").toString("base64url");
}

/** Reads a cursor that {@link writeCursor} wrote, or gives undefined for anything else. */
function readCursor(text: string): ReferenceCursor | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isSafeInteger(value[1])) {
      return { path: value[0], ordinal: value[1] as number };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Gives the index of the first reference after the cursor: after the cursor's reference when its record still has it, and
 * otherwise after every reference of records whose paths sort before or at the cursor's.
 */
function startAfter(all: readonly Reference[], cursor: ReferenceCursor): number {
  let ordinal = -1;
  for (let index = 0; index < all.length; index++) {
    const path = (all[index] as Reference).from.path;
    if (path === cursor.path) {
      ordinal += 1;
      if (ordinal > cursor.ordinal) return index;
    } else if (compareUtf8(path, cursor.path) > 0) {
      return index;
    }
  }
  return all.length;
}

/** Writes the references of a page, grouped by citing record, each with its context lines when `context` is more than 0. */
async function referenceLines(
  store: Store,
  references: readonly Reference[],
  outgoing: boolean,
  context: number,
): Promise<string> {
  let text = "";
  for (let start = 0; start < references.length; ) {
    const path = (references[start] as Reference).from.path;
    let end = start;
    while (end < references.length && (references[end] as Reference).from.path === path) end += 1;
    const group = references.slice(start, end);
    const rows: ColumnRow[] = [];
    for (const reference of group) {
      const address = reference.from.address;
      const where = reference.position === undefined ? "" : `:${reference.position.line}:${reference.position.col}`;
      const resolved = outgoing && reference.targets.length > 0 ? [`-> ${reference.targets.map(targetText).join(", ")}`] : [];
      rows.push({ cells: [`${address === "" ? "#" : address}${where}`, reference.status, reference.raw, ...resolved], depth: 1 });
    }
    const lines = formatColumns(rows).split("\n");
    const fileLines = context > 0 ? await linesOf(store, path) : [];
    text += `${oneLine(path)}\n`;
    group.forEach((reference, index) => {
      text += `${lines[index]}\n`;
      const line = reference.position?.line;
      if (line === undefined || fileLines.length === 0) return;
      for (let shown = Math.max(1, line - context); shown <= Math.min(fileLines.length, line + context); shown++) {
        text += `      ${shown}  ${oneLineWithTabs(fileLines[shown - 1] as string)}\n`;
      }
    });
    start = end;
  }
  return text;
}

/** Gives the lines of a store file as text, without their line breaks; none when it cannot be read. */
async function linesOf(store: Store, path: string): Promise<readonly string[]> {
  const file = await store.backend.read(path);
  if (!file.ok || "oversized" in file.value) return [];
  // The decoder drops a byte order mark, which no line shows.
  const text = new TextDecoder("utf-8").decode(file.value.content);
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Writes a target: a node's store path and canonical address, or an asset's or a directory's path. */
function targetText(target: ReferenceTarget): string {
  return "kind" in target ? (target.kind === "directory" ? `${target.path}/` : target.path) : `${target.path}${target.address}`;
}

/** A reference as `--json` writes it: its ranges as `[start, end]`. */
function referenceJson(reference: Reference): unknown {
  return {
    ...reference,
    ...(reference.destination === undefined ? {} : { destination: rangeJson(reference.destination) }),
    targets: reference.targets.map((target) =>
      "range" in target && target.range !== undefined ? { ...target, range: rangeJson(target.range) } : target,
    ),
  };
}
