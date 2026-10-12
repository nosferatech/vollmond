import { isAnchorName } from "../anchor/slug.js";
import { parseJsonUnit } from "../format/json.js";
import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { childPath } from "../record/exact-path.js";
import { readDateTime } from "../schema/logical-types.js";
import { checkStoragePath } from "../storage/path.js";
import { decodeSource } from "../text/source-text.js";
import type { Value, ValueObject } from "../value/value.js";

/** The store's alias file, relative to its root. */
export const ALIASES_PATH = ".vmd/aliases.jsonl";

/**
 * The largest alias file, in bytes: 16 MiB, the bound of a record. A larger file is `alias-file-invalid` whatever it holds,
 * and a store refuses it by its size before reading it.
 */
export const MAX_ALIAS_FILE_BYTES = 16 * 1024 * 1024;

/** An old store path of a record, and the path it moved to. */
export interface RecordAlias {
  readonly kind: "record";
  readonly from: string;
  readonly to: string;
  readonly at: string;
}

/** An old anchor of a record, and the anchor it was renamed to. */
export interface AnchorAlias {
  readonly kind: "anchor";
  readonly record: string;
  readonly from: string;
  readonly to: string;
  readonly at: string;
}

/** An entry of the alias file. */
export type Alias = RecordAlias | AnchorAlias;

/** The entries of an alias file, with lookups by old name. Where several entries have one old name, the last one counts. */
export interface AliasTable {
  /** Every entry, in the file's order. */
  readonly entries: readonly Alias[];
  /** Gives the path a record moved to from `path`, or undefined when no record alias has that `from`. */
  recordMove(path: string): string | undefined;
  /** Gives the paths that {@link recordMove} gives `path` for, in the order of their first entries; empty for none. */
  recordMovesTo(path: string): readonly string[];
  /**
   * Gives the anchor aliases of a record recorded under any of `records`, its store paths, from each old name to the new one:
   * for an old name, the `to` of the last anchor alias in the file whose `record` is one of them; an empty map for none. It
   * takes time in the number of those aliases, so a caller that looks up many names of one record keeps the map.
   */
  anchorRenamesOf(records: readonly string[]): ReadonlyMap<string, string>;
}

/** The members of each kind of entry. */
const MEMBERS = {
  record: ["kind", "from", "to", "at"],
  anchor: ["kind", "record", "from", "to", "at"],
} as const;

/** The table of a store without an alias file. */
export const NO_ALIASES: AliasTable = aliasTableOf([]);

/**
 * Reads an alias file: JSON Lines, each line a JSON object, either `{"kind": "record", "from", "to", "at"}` with store paths, or
 * `{"kind": "anchor", "record", "from", "to", "at"}` with a store path and two anchor names, `at` an RFC 3339 date-time string,
 * and no other member. A byte order mark at the start is skipped. A line ends at LF, a CR before it included; the last line may
 * end without one. Fails with one `alias-file-invalid`, which has no node: for a file larger than {@link MAX_ALIAS_FILE_BYTES},
 * without parsing it, and otherwise naming the first line that breaks these rules: a file that is not UTF-8, an empty line, a
 * line that is not JSON or holds a duplicate member, or an entry of another shape.
 */
export function readAliases(content: Uint8Array): Outcome<AliasTable> {
  if (content.length > MAX_ALIAS_FILE_BYTES) return fail([aliasFileTooLarge()]);
  const decoded = decodeSource(ALIASES_PATH, content);
  if (!decoded.ok) return fail([invalid("it is not UTF-8")]);
  const source = decoded.value;
  const text = source.text;
  const entries: Alias[] = [];
  let line = 0;
  // A byte order mark is not part of the first line, as in every file vmd reads.
  for (let start = source.hasBom ? 1 : 0; start < text.length; line += 1) {
    const newline = text.indexOf("\n", start);
    const next = newline < 0 ? text.length : newline + 1;
    // A CR before the LF is JSON white space, which the line's parse reads past.
    const end = newline < 0 ? text.length : newline;
    const where = `line ${line + 1}`;
    if (end <= start) return fail([invalid(`${where} is empty`)]);
    const unit = parseJsonUnit({
      path: ALIASES_PATH,
      source,
      start,
      end,
      at: "",
      nodes: { add: (parent, key) => childPath(parent, key) },
      notObjectCode: "root-not-object",
    });
    if (unit.value === null || unit.issues.length > 0) {
      const problem = unit.issues[0]?.message ?? "it is not a JSON object";
      return fail([invalid(`${where} is not a JSON object: ${problem}`)]);
    }
    const entry = aliasOf(unit.value);
    if (typeof entry === "string") return fail([invalid(`${where} ${entry}`)]);
    entries.push(entry);
    start = next;
  }
  return succeed(aliasTableOf(entries));
}

/** Reads an entry, or says what is wrong with it. */
function aliasOf(object: ValueObject): Alias | string {
  const kind = object.kind;
  if (kind !== "record" && kind !== "anchor") return 'has no kind "record" or "anchor"';
  const members = MEMBERS[kind];
  const extra = Object.keys(object).find((name) => !(members as readonly string[]).includes(name));
  if (extra !== undefined) return `has a member ${JSON.stringify(extra)}, which a ${kind} alias does not have`;
  const missing = members.find((name) => typeof object[name] !== "string");
  if (missing !== undefined) return `has no string ${missing}`;
  const text = (name: string) => object[name] as string;
  if (readDateTime(text("at")) === null) return `has an at that is not a date-time (RFC 3339): ${JSON.stringify(text("at"))}`;
  const paths = kind === "record" ? ["from", "to"] : ["record"];
  for (const name of paths) {
    const problem = checkStoragePath(text(name));
    if (problem !== null) return `has a ${name} that is not a store path: ${problem.message}`;
  }
  if (kind === "record") return { kind, from: text("from"), to: text("to"), at: text("at") };
  for (const name of ["from", "to"]) {
    if (!isAnchorName(text(name))) return `has a ${name} that is not an anchor name: ${JSON.stringify(object[name] as Value)}`;
  }
  return { kind, record: text("record"), from: text("from"), to: text("to"), at: text("at") };
}

const NO_RENAMES: ReadonlyMap<string, string> = new Map();
const NO_PATHS: readonly string[] = Object.freeze([]);

/** Builds the lookups of a table, the last entry of each old name winning. */
function aliasTableOf(entries: readonly Alias[]): AliasTable {
  const moves = new Map<string, string>();
  /** The last anchor alias of each record and old name: its new name, and its line, which says which of a record's paths wins. */
  const renames = new Map<string, Map<string, { readonly to: string; readonly line: number }>>();
  entries.forEach((entry, line) => {
    if (entry.kind === "record") {
      moves.set(entry.from, entry.to);
      return;
    }
    let names = renames.get(entry.record);
    if (names === undefined) {
      names = new Map();
      renames.set(entry.record, names);
    }
    names.set(entry.from, { to: entry.to, line });
  });
  const movesTo = new Map<string, string[]>();
  for (const [from, to] of moves) {
    const froms = movesTo.get(to);
    if (froms === undefined) movesTo.set(to, [from]);
    else froms.push(from);
  }
  const anchorRenamesOf = (records: readonly string[]): ReadonlyMap<string, string> => {
    const last = new Map<string, { readonly to: string; readonly line: number }>();
    for (const record of records) {
      for (const [from, rename] of renames.get(record) ?? []) {
        const known = last.get(from);
        if (known === undefined || rename.line > known.line) last.set(from, rename);
      }
    }
    if (last.size === 0) return NO_RENAMES;
    return new Map([...last].map(([from, rename]) => [from, rename.to]));
  };
  return Object.freeze({
    entries: Object.freeze([...entries]),
    recordMove: (path: string) => moves.get(path),
    recordMovesTo: (path: string) => movesTo.get(path) ?? NO_PATHS,
    anchorRenamesOf,
  });
}

/** The `alias-file-invalid` of an alias file larger than {@link MAX_ALIAS_FILE_BYTES}, naming the bound and the remedy. */
export function aliasFileTooLarge(): Issue {
  return makeIssue({
    code: "alias-file-invalid",
    path: null,
    at: null,
    message: `${ALIASES_PATH} is larger than ${MAX_ALIAS_FILE_BYTES} bytes, the largest alias file: remove the aliases that no open branch still needs with \`vmd alias prune\``,
  });
}

/** The `alias-file-invalid` of a file, naming what is wrong. */
function invalid(problem: string): Issue {
  return makeIssue({
    code: "alias-file-invalid",
    path: null,
    at: null,
    message: `${ALIASES_PATH} is not valid JSON Lines of alias entries: ${problem}`,
  });
}
