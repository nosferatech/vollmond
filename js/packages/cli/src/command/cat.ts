// `vmd cat PATH [--lines A:B]`: a file's bytes, as they are.

import { type ContentRange, type FileContent, succeed } from "@vollmond/core";
import { type Command, type OpenedStore, outcomeOutput, usagePlan } from "./command.js";
import { argumentCountProblem, type OptionReading, rangeJson } from "./options.js";

/**
 * Prints a file of the store, by its store path, as the bytes the backend returns, whatever their encoding. `--lines A:B`
 * prints lines A to B, B excluded, counted from 1, with lines ending at LF, CRLF or a lone CR; a range past the end is cut
 * there. Under `--json` the value is the file's content, in base64, with its path, size, version, modification time and the
 * byte range read.
 */
export const CAT_COMMAND: Command = {
  name: "cat",
  usage: "PATH [--lines A:B]",
  summary: "print a file's content, or some of its lines",
  options: { lines: { type: "string" } },
  help: "  --lines A:B  lines A to B, B left out, counted from 1: 1:4 prints lines 1, 2 and 3\n",
  readsStore: true,
  prepare: ({ positionals, options }) => {
    const problem = argumentCountProblem(positionals, 1, 1, "the path of a file");
    if (problem !== null) return usagePlan(problem);
    const path = positionals[0] as string;
    const range = readLineRange(options.lines as string | undefined);
    if (!range.ok) return usagePlan(range.message);
    return {
      kind: "run",
      run: async (opened) => {
        const { storage } = opened as OpenedStore;
        const read = await storage.read(path, range.value === undefined ? {} : { range: range.value });
        // The JSON output writes ranges as [start, end], as everywhere else.
        const outcome = read.ok ? succeed(jsonContent(read.value), read.issues) : read;
        return outcomeOutput(outcome, (content) => content.content);
      },
    };
  },
};

/** A file's content as `--json` writes it: the backend's, with the range as `[start, end]`. */
function jsonContent(content: FileContent): Omit<FileContent, "range"> & { readonly range: readonly [number, number] } {
  return { ...content, range: rangeJson(content.range) };
}

/** Reads `--lines A:B`: two whole numbers, the first from 1 and the second not below it; absent when not given. */
function readLineRange(value: string | undefined): OptionReading<ContentRange | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const match = /^([1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value);
  if (match !== null) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isSafeInteger(end) && end >= start) return { ok: true, value: { unit: "lines", start, end } };
  }
  return {
    ok: false,
    message: `--lines takes A:B, lines A to B with B left out, A from 1 and B not below A, not ${JSON.stringify(value)}`,
  };
}
