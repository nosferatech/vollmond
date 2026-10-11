import { appendFile, chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { OperationAdapter, OperationOutcome, OperationRegistry } from "./operation.js";
import { operations as defaultOperations } from "./operations/index.js";
import { type CaseResult, type RunOptions, type RunResult, runSuite } from "./runner.js";
import { caseFile, compareCase, makeSuite, storeCase, storeFiles } from "./testing/temp-suite.js";

const REAL_SUITE = fileURLToPath(new URL("../../../../conformance/", import.meta.url));

/** Runs the suite at `suite` with its `declaration.json` and the default operations unless `options` gives others. */
function run(suite: string, options: Partial<RunOptions> = {}): Promise<RunResult> {
  return runSuite({
    suiteDirectory: suite,
    declarationFile: join(suite, "declaration.json"),
    operations: defaultOperations,
    ...options,
  });
}

/** Returns a run's results, failing the test when the run did not start. */
async function results(suite: string, options: Partial<RunOptions> = {}): Promise<readonly CaseResult[]> {
  const result = await run(suite, options);
  if (result.exitCode === 2) {
    throw new Error(result.message);
  }
  return result.report.results;
}

/** A fake `parse` that gives each record's text as its title, so that a test sees which bytes it received. */
const fakeParse: OperationAdapter = {
  run: async (input, { store }) => {
    const bytes = store?.files.get(String(input.record));
    return bytes === undefined
      ? { ok: false, issues: [{ code: "address-not-found", severity: "error", path: String(input.record), at: null }] }
      : { ok: true, result: { title: new TextDecoder().decode(bytes).replace(/^# |\n$/g, "") }, issues: [] };
  },
};

/** A registry holding `compare` and a fake `parse` whose outcome a test chooses. */
function withParse(outcome: (input: Record<string, unknown>) => Promise<OperationOutcome>): OperationRegistry {
  return new Map([...defaultOperations, ["parse", { run: outcome }]]);
}

describe("runSuite: starting", () => {
  const cases = { "cases/selftest/c.cases.json": caseFile([compareCase("one", 1, 1, true)]) };

  test("starts on a valid suite, declaration and selection", async () => {
    expect((await run(await makeSuite(cases))).exitCode).toBe(0);
  });

  test.each([
    ["suite.json is missing", { "suite.json": null }, {}, "suite.json cannot be read"],
    ["suite.json has an unknown member", { "suite.json": '{"version": "1", "case_format": 1, "x": 1}' }, {}, "unknown member x"],
    ["the case format is unknown", { "suite.json": '{"version": "1", "case_format": 2}' }, {}, "case_format 2"],
    ["the declaration is missing", { "declaration.json": null }, {}, "the declaration cannot be read"],
    [
      "the declaration has an unknown member",
      { "declaration.json": '{"name": "a", "version": "1", "profiles": [], "x": 1}' },
      {},
      "unknown member x",
    ],
    ["the selection is invalid", {}, { selection: { profiles: ["reading"] } }, "unknown profile reading"],
    ["cases/ is missing", { "cases/selftest/c.cases.json": null }, {}, "cannot be listed"],
  ])("exits with 2 when %s", async (_name, files, options, message) => {
    const result = await run(await makeSuite({ ...cases, ...files }), options);
    expect(result.exitCode).toBe(2);
    expect(result.exitCode === 2 && result.message).toContain(message);
  });

  test("exits with 2 on an input member that the operation does not take, also in a case outside the selection or skipped", async () => {
    const suite = await makeSuite({
      ...cases,
      ...storeFiles("cases/store"),
      "cases/meta.cases.json": caseFile([
        storeCase("with-as", "meta", { input: { store: "store", record: "a.md", as: "singular" }, pending: "#1" }),
      ]),
    });
    const result = await run(suite, { selection: { ids: ["selftest/"] } });
    expect(result).toEqual({
      exitCode: 2,
      message: "these cases give input members that their operations do not take: meta/with-as: as",
    });
  });
});

describe("runSuite: the report", () => {
  test("reports the suite, the implementation, the commit, and results in the byte order of their ids", async () => {
    const suite = await makeSuite({
      "cases/b.cases.json": caseFile([compareCase("z", 1, 1, true), compareCase("a", 1, 2, false)]),
      "cases/a.cases.json": caseFile([
        compareCase("é", 1, 1, true),
        compareCase("\u{1f600}", 1, 1, true),
        compareCase("y", 1, 1, true),
      ]),
    });
    // The ids are invalid as local ids, so the first two cases of a.cases.json are errors, by index; that orders them too.
    const result = await run(suite, { commit: "abc" });
    expect(result).toEqual({
      exitCode: 1,
      report: {
        suite: { version: "0.6.0-dev", case_format: 1, commit: "abc" },
        implementation: { name: "test", version: "0.0.0", profiles: ["read"] },
        selection: null,
        results: [
          { id: "a/#0", verdict: "error", detail: expect.stringContaining("id must be") },
          { id: "a/#1", verdict: "error", detail: expect.stringContaining("id must be") },
          { id: "a/y", verdict: "pass" },
          { id: "b/a", verdict: "pass" },
          { id: "b/z", verdict: "pass" },
        ],
        unused_skips: [],
      },
    });
  });

  test("orders ids by UTF-8 bytes, not by UTF-16 code units", async () => {
    const suite = await makeSuite({
      "cases/\u{1f600}.cases.json": caseFile([compareCase("a", 1, 1, true)]),
      "cases/～.cases.json": caseFile([compareCase("a", 1, 1, true)]),
    });
    // U+FF5E sorts after the surrogates of U+1F600 in UTF-16, and before its four-byte UTF-8 form.
    expect((await results(suite)).map((result) => result.id)).toEqual(["～/a", "\u{1f600}/a"]);
  });

  test("leaves out the commit when it is not known", async () => {
    const result = await run(await makeSuite({ "cases/a.cases.json": caseFile([compareCase("a", 1, 1, true)]) }));
    expect(result.exitCode === 0 && result.report.suite).toEqual({ version: "0.6.0-dev", case_format: 1 });
  });
});

describe("runSuite: skipping", () => {
  const declaration = (skip: object[], profiles = ["read"]) => JSON.stringify({ name: "test", version: "0", profiles, skip });

  test("skips pending cases first, then undeclared profiles, then skip entries, the first matching entry giving the reason", async () => {
    // An entry counts as used when its selector matches a case, also one that an earlier entry, a profile or pending skips.
    const suite = await makeSuite({
      ...storeFiles("cases/store"),
      "cases/t.cases.json": caseFile([
        storeCase("pending", "parse", { pending: "#53 question 2", profiles: ["validate"] }),
        storeCase("profile", "parse", { profiles: ["read", "validate", "query"] }),
        storeCase("by-id", "parse"),
        storeCase("by-operation", "parse"),
      ]),
      "declaration.json": declaration([
        { id: "t/by-id", reason: "first" },
        { operation: "parse", reason: "second" },
        { id: "t/", reason: "third" },
        { id: "t/pending", reason: "only pending" },
        { id: "gone/", reason: "stale" },
      ]),
    });
    const result = await run(suite);
    expect(result.exitCode === 0 && result.report).toMatchObject({
      results: [
        { id: "t/by-id", verdict: "skip", reason: "first" },
        { id: "t/by-operation", verdict: "skip", reason: "second" },
        { id: "t/pending", verdict: "skip", reason: "pending: #53 question 2" },
        { id: "t/profile", verdict: "skip", reason: "profile validate not declared" },
      ],
      unused_skips: [{ id: "gone/", reason: "stale" }],
    });
  });

  test("reports a case whose operation the runner does not implement as an error, unless an entry skips it", async () => {
    const suite = await makeSuite({ ...storeFiles("cases/store"), "cases/t.cases.json": caseFile([storeCase("one", "parse")]) });
    expect(await results(suite)).toEqual([
      { id: "t/one", verdict: "error", detail: "the runner does not implement the operation parse" },
    ]);
    await writeFile(join(suite, "declaration.json"), declaration([{ operation: "parse", reason: "later" }]));
    expect(await results(suite)).toEqual([{ id: "t/one", verdict: "skip", reason: "later" }]);
  });

  test("reports a malformed case as an error even when it is pending or an entry would skip it", async () => {
    const suite = await makeSuite({
      "cases/t.cases.json": caseFile([{ ...storeCase("one", "parse", { pending: "#1" }), note: "x" }]),
      "declaration.json": declaration([{ operation: "parse", reason: "later" }]),
    });
    expect(await results(suite)).toEqual([{ id: "t/one", verdict: "error", detail: "the case has the unknown member note" }]);
  });
});

describe("runSuite: unreadable case files", () => {
  test.skipIf(process.getuid?.() === 0)(
    "reports a case file that cannot be read as an error, and runs the other files",
    async () => {
      const suite = await makeSuite({
        "cases/locked.cases.json": caseFile([compareCase("a", 1, 1, true)]),
        "cases/open.cases.json": caseFile([compareCase("a", 1, 1, true)]),
      });
      await chmod(join(suite, "cases/locked.cases.json"), 0o000);
      expect(await results(suite)).toEqual([
        { id: "locked/", verdict: "error", detail: expect.stringContaining("the case file cannot be read") },
        { id: "open/a", verdict: "pass" },
      ]);
    },
  );
});

describe("runSuite: selection", () => {
  const files = {
    ...storeFiles("cases/store"),
    "cases/selftest/c.cases.json": caseFile([compareCase("one", 1, 1, true)]),
    "cases/t.cases.json": caseFile([
      storeCase("read", "parse", { spec: ["5.3"] }),
      storeCase("query", "parse", { profiles: ["read", "query"], spec: ["10.4"] }),
      { ...storeCase("broken", "parse"), note: "x" },
      { ...storeCase("no-lists", "parse", { profiles: "read", spec: "5.3" }) },
    ]),
    "declaration.json": JSON.stringify({
      name: "a",
      version: "0",
      profiles: ["read", "query"],
      skip: [{ id: "unused/", reason: "x" }],
    }),
  };

  test("keeps the selected cases, the self-test and the malformed cases a criterion cannot rule out, and states the selection", async () => {
    const operations = withParse(async () => ({ ok: true, result: { title: "A" }, issues: [] }));
    const result = await run(await makeSuite(files), { selection: { profiles: ["query"] }, operations });
    expect(result.exitCode === 1 && result.report).toEqual(
      expect.objectContaining({
        selection: { profiles: ["query"], sections: null, ids: null },
        results: [
          { id: "selftest/c/one", verdict: "pass" },
          { id: "t/no-lists", verdict: "error", detail: expect.stringContaining("spec must be") },
          { id: "t/query", verdict: "pass" },
        ],
      }),
    );
    expect(result.exitCode === 1 && Object.hasOwn(result.report, "unused_skips")).toBe(false);
  });

  test("always selects the selftest/ topic, also a malformed case in it, and no compare case outside it", async () => {
    const suite = await makeSuite({
      "cases/selftest/c.cases.json": caseFile([{ ...compareCase("broken", 1, 1, true), profiles: ["read"], note: "x" }]),
      "cases/other.cases.json": caseFile([compareCase("compare", 1, 1, true)]),
    });
    expect(await results(suite, { selection: { ids: ["nothing/"] } })).toEqual([
      { id: "selftest/c/broken", verdict: "error", detail: "the case has the unknown member note" },
    ]);
  });

  test("selects by sections and by ids", async () => {
    const suite = await makeSuite(files);
    const operations = withParse(async () => ({ ok: true, result: { title: "A" }, issues: [] }));
    expect((await results(suite, { selection: { sections: ["5"] }, operations })).map((result) => result.id)).toEqual([
      "selftest/c/one",
      "t/broken",
      "t/no-lists",
      "t/read",
    ]);
    expect((await results(suite, { selection: { ids: ["t/query"] }, operations })).map((result) => result.id)).toEqual([
      "selftest/c/one",
      "t/query",
    ]);
  });
});

describe("runSuite: verdicts", () => {
  const suiteWith = (...cases: object[]) => makeSuite({ ...storeFiles("cases/store"), "cases/t.cases.json": caseFile(cases) });
  const issue = { code: "syntax-error", severity: "error", path: "a.md", at: "" } as const;

  test("passes an outcome that matches, and fails one that does not", async () => {
    const suite = await suiteWith(
      storeCase("result", "parse", { input: { store: "store", record: "result" } }),
      storeCase("other-result", "parse", {
        input: { store: "store", record: "other-result" },
        expect: { result: { title: "B" } },
      }),
      storeCase("fails", "parse", { input: { store: "store", record: "fails" }, expect: { fails: true, issues: [issue] } }),
      storeCase("warning", "parse", {
        input: { store: "store", record: "warning" },
        expect: { result: { title: "A" }, issues: [{ ...issue, severity: "warning" }] },
      }),
    );
    const outcomes: Record<string, OperationOutcome> = {
      result: { ok: true, result: { title: "A" }, issues: [] },
      "other-result": { ok: true, result: { title: "A" }, issues: [] },
      fails: { ok: false, issues: [issue] },
      warning: { ok: true, result: { title: "A" }, issues: [issue] },
    };
    const verdicts = await results(suite, {
      operations: withParse(async (input) => outcomes[String(input.record)] ?? { ok: false, issues: [] }),
    });
    expect(verdicts).toEqual([
      { id: "t/fails", verdict: "pass" },
      { id: "t/other-result", verdict: "fail", detail: 'expected the result {"title":"B"}, got {"title":"A"}' },
      { id: "t/result", verdict: "pass" },
      { id: "t/warning", verdict: "fail", detail: expect.stringContaining("expected the issues") },
    ]);
  });

  test("fails a success where the case expects failure, and a failure where it expects success", async () => {
    const suite = await suiteWith(
      storeCase("expects-failure", "parse", { expect: { fails: true, issues: [] } }),
      storeCase("expects-success", "parse"),
    );
    const verdicts = await results(suite, { operations: withParse(async () => ({ ok: true, issues: [] })) });
    expect(verdicts).toEqual([
      { id: "t/expects-failure", verdict: "fail", detail: "the operation succeeded, and the case expects it to fail" },
      { id: "t/expects-success", verdict: "fail", detail: "the operation gave no result" },
    ]);
    const failing = await results(suite, { operations: withParse(async () => ({ ok: false, issues: [issue] })) });
    expect(failing).toEqual([
      { id: "t/expects-failure", verdict: "fail", detail: expect.stringContaining("expected the issues") },
      { id: "t/expects-success", verdict: "fail", detail: expect.stringContaining("the operation failed with the issues") },
    ]);
  });

  test("fails a crash, also where the case expects failure, and an operation that does not settle in time", async () => {
    const suite = await suiteWith(
      storeCase("crash", "parse", { expect: { fails: true, issues: [] } }),
      storeCase("hang", "parse"),
    );
    expect(await results(suite, { operations: withParse(() => Promise.reject(new Error("boom"))) })).toEqual([
      { id: "t/crash", verdict: "fail", detail: "the operation crashed: boom" },
      { id: "t/hang", verdict: "fail", detail: "the operation crashed: boom" },
    ]);
    const hanging = withParse(() => new Promise(() => {}));
    expect(await results(suite, { operations: hanging, timeoutMs: 20 })).toEqual([
      { id: "t/crash", verdict: "fail", detail: "the operation crashed: no outcome after 20 ms" },
      { id: "t/hang", verdict: "fail", detail: "the operation crashed: no outcome after 20 ms" },
    ]);
  });

  test("reports a case whose input the adapter rejects as an error", async () => {
    const suite = await makeSuite({
      "cases/t.cases.json": caseFile([{ ...compareCase("not-arrays", 1, [1], false), input: { a: 1, b: [1], unordered: true } }]),
    });
    expect(await results(suite)).toEqual([
      { id: "t/not-arrays", verdict: "error", detail: "input.a and input.b must be arrays when input.unordered is true" },
    ]);
  });

  test("rejects an unordered flag that is not a boolean, and accepts one that is", async () => {
    const suite = await makeSuite({
      "cases/t.cases.json": caseFile([
        { ...compareCase("yes", 1, 1, true), input: { a: [1], b: [1], unordered: "yes" } },
        { ...compareCase("false", 1, 1, true), input: { a: [1, 2], b: [2, 1], unordered: false }, expect: { result: false } },
      ]),
    });
    expect(await results(suite)).toEqual([
      { id: "t/false", verdict: "pass" },
      { id: "t/yes", verdict: "error", detail: "input.unordered must be a boolean" },
    ]);
  });

  test("reports a validate that throws as an error, and an equalResults that throws as a crash", async () => {
    const suite = await suiteWith(storeCase("one", "parse"));
    const throwing = (adapter: Partial<OperationAdapter>): OperationRegistry =>
      new Map([["parse", { run: async () => ({ ok: true, result: { title: "A" }, issues: [] }), ...adapter }]]);
    const validate = () => {
      throw new Error("no validation");
    };
    const equalResults = () => {
      throw new Error("no comparison");
    };
    expect(await results(suite, { operations: throwing({ validate }) })).toEqual([
      { id: "t/one", verdict: "error", detail: "the input cannot be checked: no validation" },
    ]);
    expect(await results(suite, { operations: throwing({ equalResults }) })).toEqual([
      { id: "t/one", verdict: "fail", detail: "the operation crashed: no comparison" },
    ]);
  });

  test("compares only the four stable members of the issues an operation reports", async () => {
    const suite = await suiteWith(storeCase("one", "parse", { expect: { fails: true, issues: [issue] } }));
    const withMessage = withParse(async () => ({ ok: false, issues: [{ ...issue, message: "bad", line: 1 } as typeof issue] }));
    expect(await results(suite, { operations: withMessage })).toEqual([{ id: "t/one", verdict: "pass" }]);
  });

  test("fails a mismatch whatever the case expects", async () => {
    const suite = await suiteWith(storeCase("one", "parse"), storeCase("two", "parse", { expect: { fails: true, issues: [] } }));
    const mismatching = withParse(async () => ({ mismatch: "read back 1, not 2" }));
    expect(await results(suite, { operations: mismatching })).toEqual([
      { id: "t/one", verdict: "fail", detail: "read back 1, not 2" },
      { id: "t/two", verdict: "fail", detail: "read back 1, not 2" },
    ]);
  });

  test("aborts the signal of an operation that does not settle in time, and not of one that does", async () => {
    const suite = await suiteWith(storeCase("one", "parse"));
    const signals: AbortSignal[] = [];
    const hanging: OperationRegistry = new Map([
      [
        "parse",
        {
          run: (_input, { signal }) => {
            signals.push(signal);
            return new Promise(() => {});
          },
        },
      ],
    ]);
    await results(suite, { operations: hanging, timeoutMs: 20 });
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    const settling: OperationRegistry = new Map([
      [
        "parse",
        {
          run: async (_input, { signal }) => {
            signals.push(signal);
            return { ok: true, result: { title: "A" }, issues: [] };
          },
        },
      ],
    ]);
    await results(suite, { operations: settling });
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
  });

  test("gives each case its own copy of the store's bytes", async () => {
    const suite = await suiteWith(storeCase("one", "parse"), storeCase("two", "parse"));
    const seen: string[] = [];
    const mutating: OperationRegistry = new Map([
      [
        "parse",
        {
          run: async (_input, { store }) => {
            const bytes = store?.files.get("a.md") ?? new Uint8Array();
            seen.push(new TextDecoder().decode(bytes));
            bytes.fill(0x21);
            return { ok: true, result: { title: "A" }, issues: [] };
          },
        },
      ],
    ]);
    await results(suite, { operations: mutating });
    expect(seen).toEqual(["# A\n", "# A\n"]);
  });

  test("gives the operation its store and the configuration the case names", async () => {
    const suite = await makeSuite({
      ...storeFiles("cases/store"),
      "cases/store/.vmd/lenient.yaml": "uniqueness: lenient\n",
      "cases/t.cases.json": caseFile([
        storeCase("config", "parse", { input: { store: "store", record: "a.md", config: "lenient.yaml" } }),
      ]),
    });
    let seen: string | undefined;
    const spy: OperationRegistry = new Map([
      [
        "parse",
        {
          run: async (input, context) => {
            seen = new TextDecoder().decode(context.store?.config);
            return fakeParse.run(input, context);
          },
        },
      ],
    ]);
    expect(await results(suite, { operations: spy })).toEqual([{ id: "t/config", verdict: "pass" }]);
    expect(seen).toBe("uniqueness: lenient\n");
  });

  test("uses the operation's own comparison of results when it has one", async () => {
    const suite = await suiteWith(storeCase("unordered", "parse", { expect: { result: [1, 2] } }));
    const unordered: OperationRegistry = new Map([
      ...defaultOperations,
      [
        "parse",
        {
          run: async () => ({ ok: true, result: [2, 1], issues: [] }),
          equalResults: (expected, actual, input, { comparison }) =>
            input.record === "a.md" &&
            Array.isArray(expected) &&
            Array.isArray(actual) &&
            comparison.equalUnordered(expected, actual),
        },
      ],
    ]);
    expect(await results(suite, { operations: unordered })).toEqual([{ id: "t/unordered", verdict: "pass" }]);
  });
});

describe("runSuite: input versions", () => {
  /** Copies the real `markdown/line-endings` cases, store and manifest into a new suite, and returns the suite's path. */
  async function copyLineEndings(): Promise<string> {
    const suite = await makeSuite({});
    await mkdir(join(suite, "cases/markdown"), { recursive: true });
    for (const name of ["line-endings.cases.json", "line-endings.versions.json", "line-endings"]) {
      await cp(join(REAL_SUITE, "cases/markdown", name), join(suite, "cases/markdown", name), { recursive: true });
    }
    await mkdir(join(suite, "cases/other"), { recursive: true });
    await cp(join(REAL_SUITE, "cases/markdown/line-endings"), join(suite, "cases/other/store"), { recursive: true });
    const copied = JSON.parse(await readFile(join(suite, "cases/markdown/line-endings.cases.json"), "utf8")) as {
      defaults: object;
    };
    const other = { ...copied, defaults: { ...copied.defaults, input: { store: "store" } } };
    await writeFile(join(suite, "cases/other/o.cases.json"), JSON.stringify(other));
    return suite;
  }

  test("runs the cases on a store whose files match its manifest", async () => {
    const verdicts = await results(await copyLineEndings(), { operations: new Map([["parse", fakeParse]]) });
    expect(verdicts.filter((result) => result.verdict === "error")).toEqual([]);
    expect(verdicts.length).toBeGreaterThan(1);
  });

  test("reports every case on an edited store as an error, and runs the cases on other stores", async () => {
    const suite = await copyLineEndings();
    await appendFile(join(suite, "cases/markdown/line-endings/crlf.md"), "\r\n");
    const verdicts = await results(suite, { operations: new Map([["parse", fakeParse]]) });
    const onEdited = verdicts.filter((result) => result.id.startsWith("markdown/"));
    expect(onEdited.length).toBeGreaterThan(1);
    for (const result of onEdited) {
      expect(result).toEqual({
        id: result.id,
        verdict: "error",
        detail: expect.stringMatching(/^line-endings: crlf\.md: version [0-9a-f]{40} expected/),
      });
    }
    expect(verdicts.filter((result) => result.id.startsWith("other/") && result.verdict === "error")).toEqual([]);
  });

  test("reports the cases on a store whose manifest lists a file that is gone", async () => {
    const suite = await copyLineEndings();
    await rm(join(suite, "cases/markdown/line-endings/crlf.md"));
    const verdicts = await results(suite, { operations: new Map([["parse", fakeParse]]) });
    expect(verdicts.find((result) => result.id.startsWith("markdown/"))).toMatchObject({
      verdict: "error",
      detail: expect.stringContaining("crlf.md is missing"),
    });
  });
});
