// `vmd get ADDR [--value|--body] [--max-chars N] [--meta F,..|all]`: one node, in its source or as a value, with its computed
// fields.

import {
  COMPUTED_FIELD_NAMES,
  type ComputedFieldName,
  type ComputedFields,
  type GetResult,
  type NodeForm,
  succeed,
} from "@vollmond/core";
import { formatColumns, terminalText } from "../output/lines.js";
import { shellWord } from "../output/paging.js";
import { formatCount, formatTokens } from "../output/sizes.js";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, type OptionReading, rangeJson, readWholeNumber, storeIssueDetails } from "./options.js";

/** The number of characters `get` prints of a node when `--max-chars` does not say. */
export const DEFAULT_MAX_CHARS = 20_000;

/** The computed fields `all` stands for: every one but `@nodes`, which is requested by name. */
const ALL_FIELDS: readonly ComputedFieldName[] = COMPUTED_FIELD_NAMES.filter((name) => name !== "@nodes");

/** The computed fields that are not computed yet, which the text output says it leaves out. */
const NOT_YET_COMPUTED: ReadonlySet<ComputedFieldName> = new Set(["@refs", "@collection"]);

// Deviations from the specification, recorded in issue #18: `--fields` and `--no-value` are not offered yet, and under
// `--json` the node is given as its value unless `--body` is given, as the specification's example of `--meta all --json`
// shows; `--max-chars` cuts the text output only.
/**
 * Prints the node a singular address names, a record's root without a fragment. Without `--json` it prints the node's source
 * by default, `--value` its value view as JSON, and `--body` a section's `$body` (a block anchor's text); with `--json` the
 * value is the node's value view, or its `$body` with `--body`. `--meta` requests computed fields by name, with or without
 * their `@`, or `all` of them but `@nodes`: the text output prints one line per field before the node, and the JSON output's
 * value is then `{"value": …, "meta": {…}}`. The text output stops after `--max-chars` characters (20,000 by default), and the
 * line that says so tells how much remains and suggests `vmd outline`. On a terminal, the node's text is escaped as
 * {@link terminalText} does; to a pipe or a file it is written raw.
 */
export const GET_COMMAND: Command = {
  name: "get",
  usage: "ADDR [--value|--body] [--max-chars N] [--meta F,..|all]",
  summary: "print one node: its source, its value or its body, with computed fields",
  options: {
    value: { type: "boolean" },
    body: { type: "boolean" },
    "max-chars": { type: "string" },
    meta: { type: "string" },
  },
  readsStore: true,
  help:
    "  --value        the node's value view, as JSON\n" +
    "  --body         a section's $body, or a block anchor's text\n" +
    "  --max-chars N  stop after N characters, 20,000 by default\n" +
    `  --meta F,..    computed fields, with or without their @, or all of them but @nodes:\n                 ${COMPUTED_FIELD_NAMES.join(", ")}\n`,
  prepare: ({ positionals, options, globals, stdoutIsTerminal }) => {
    const problem = argumentCountProblem(positionals, 1, 1, "an address");
    if (problem !== null) return usagePlan(problem);
    if (options.value === true && options.body === true) return usagePlan("--value and --body cannot be given together");
    const maxChars = readWholeNumber(
      options["max-chars"],
      "--max-chars",
      { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      DEFAULT_MAX_CHARS,
    );
    if (!maxChars.ok) return usagePlan(maxChars.message);
    const meta = readFieldNames(options.meta as string | undefined);
    if (!meta.ok) return usagePlan(meta.message);
    const address = positionals[0] as string;
    const form: NodeForm = options.body === true ? "body" : options.value === true || globals.json ? "value" : "source";
    return {
      kind: "run",
      run: async (opened) => {
        const { store } = opened as OpenedStore;
        const result = await store.get(address, {
          form,
          reading: { raw: true },
          ...(meta.value === undefined ? {} : { meta: meta.value }),
        });
        const details = storeIssueDetails(store);
        if (!result.ok) return outcomeOutput(result, () => "", details);
        const printed = printedResult(result.value);
        const text = () =>
          formatResult(result.value, {
            form,
            maxChars: maxChars.value,
            address,
            meta: meta.value,
            terminal: stdoutIsTerminal,
          });
        return outcomeOutput(succeed(printed, result.issues), text, details);
      },
    };
  },
};

/** Reads `--meta`: names separated by commas, each with or without its `@`, or `all`; absent when not given. */
function readFieldNames(value: string | undefined): OptionReading<readonly ComputedFieldName[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const names: ComputedFieldName[] = [];
  for (const item of value.split(",")) {
    if (item === "all") {
      names.push(...ALL_FIELDS);
      continue;
    }
    const name = item.startsWith("@") ? item : `@${item}`;
    if (!(COMPUTED_FIELD_NAMES as readonly string[]).includes(name)) {
      return {
        ok: false,
        message: `--meta takes computed fields separated by commas, or all; ${JSON.stringify(item)} is not one (${COMPUTED_FIELD_NAMES.join(", ")})`,
      };
    }
    names.push(name as ComputedFieldName);
  }
  return { ok: true, value: [...new Set(names)] };
}

/** What `--json` prints as the value: the node alone, or the node with its computed fields, their ranges as `[start, end]`. */
function printedResult(result: GetResult): unknown {
  return result.meta === undefined ? result.value : { value: result.value, meta: jsonFields(result.meta) };
}

/** Writes the ranges of computed fields as `[start, end]`, in `@nodes` too. */
function jsonFields(fields: ComputedFields): Record<string, unknown> {
  const written: Record<string, unknown> = { ...fields };
  const source = fields["@source"];
  if (source !== undefined) {
    written["@source"] = {
      ...source,
      range: rangeJson(source.range),
      ...(source.memberRange === undefined ? {} : { memberRange: rangeJson(source.memberRange) }),
    };
  }
  const range = fields["@range"];
  if (range !== undefined) written["@range"] = rangeJson(range);
  const nodes = fields["@nodes"];
  if (nodes !== undefined) {
    written["@nodes"] = Object.fromEntries(Object.entries(nodes).map(([at, inner]) => [at, jsonFields(inner)]));
  }
  return written;
}

/** Writes a node for the terminal: its computed fields, one per line, then the node, cut after `maxChars` characters. */
function formatResult(
  result: GetResult,
  options: {
    readonly form: NodeForm;
    readonly maxChars: number;
    readonly address: string;
    readonly meta: readonly ComputedFieldName[] | undefined;
    /** Whether stdout is a terminal, where the node's text is escaped. */
    readonly terminal: boolean;
  },
): string {
  let text = "";
  if (options.meta !== undefined && result.meta !== undefined) {
    const fields = jsonFields(result.meta);
    const rows = options.meta.flatMap((name) => {
      if (NOT_YET_COMPUTED.has(name)) return [{ cells: [name, "(not computed yet)"] }];
      const value = fields[name];
      if (value === undefined) return [];
      // An empty string is written as JSON, so that the line shows that the field is there.
      return [{ cells: [name, typeof value === "string" && value !== "" ? value : JSON.stringify(value)] }];
    });
    text += `${formatColumns(rows)}\n`;
  }
  const content = options.form === "value" ? JSON.stringify(result.value, null, 2) : (result.value as string);
  const { shown, rest } = cutAfter(content, options.maxChars);
  // Deviation from the specification, recorded in issue #18, until the project owner decides the rule: on a terminal the
  // node's text has its controls, line separators and bidirectional controls escaped, line feeds and tabs kept, so that a
  // record cannot act on the terminal; to a pipe or a file it is written raw, as `cat` always writes.
  const written = options.terminal ? terminalText(shown) : shown;
  text += written.endsWith("\n") || written === "" ? written : `${written}\n`;
  if (rest !== "") {
    const restBytes = new TextEncoder().encode(rest).length;
    text +=
      `… cut after ${formatCount(options.maxChars)} characters, ${formatCount([...rest].length)} more (${formatTokens(restBytes)}); ` +
      `vmd outline ${shellWord(options.address)} lists its sections, and --max-chars N prints more\n`;
  }
  return text;
}

/** Splits a text after its first `count` characters, counted as code points, so that no character is cut in two. */
function cutAfter(text: string, count: number): { readonly shown: string; readonly rest: string } {
  let index = 0;
  for (let seen = 0; seen < count && index < text.length; seen++) {
    index += (text.codePointAt(index) as number) > 0xffff ? 2 : 1;
  }
  return { shown: text.slice(0, index), rest: text.slice(index) };
}
