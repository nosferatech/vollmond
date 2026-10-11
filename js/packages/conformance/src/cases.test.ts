import { describe, expect, test } from "vitest";
import { type LoadedCase, loadCases, readCaseFile } from "./cases.js";
import { caseFile, compareCase, makeSuite, storeCase, storeFiles } from "./testing/temp-suite.js";

const read = (text: string) => readCaseFile(new TextEncoder().encode(text), "topic/file", "/suite/cases/topic");

/** Returns each case's id with its detail when it is malformed, or `ok`. */
const verdicts = (cases: readonly LoadedCase[]) =>
  cases.map((loaded) => [loaded.ok ? loaded.case.id : loaded.id, loaded.ok ? "ok" : loaded.detail]);

describe("readCaseFile", () => {
  test("applies defaults, merging input one level deep, and forms global ids", () => {
    const { cases, inputsNotTaken } = read(
      caseFile([storeCase("one", "parse", { input: { record: "b.md" }, spec: ["5.4"] })], {
        spec: ["5.3"],
        operation: "meta",
        input: { store: "shared", config: "lenient.yaml" },
      }),
    );
    expect(inputsNotTaken).toEqual([]);
    expect(cases).toEqual([
      {
        ok: true,
        case: {
          id: "topic/file/one",
          directory: "/suite/cases/topic",
          description: "A case over a store.",
          spec: ["5.4"],
          profiles: ["read"],
          operation: "parse",
          input: { store: "shared", config: "lenient.yaml", record: "b.md" },
          expect: { result: { title: "A" }, fails: false, issues: [] },
        },
      },
    ]);
  });

  test("keeps pending and expected issues", () => {
    const issue = { code: "yaml-alias", severity: "error", path: "a.yaml", at: "/a" };
    const [loaded] = read(
      caseFile([storeCase("one", "parse", { pending: "#1", expect: { fails: true, issues: [issue] } })]),
    ).cases;
    expect(loaded?.ok && loaded.case.pending).toBe("#1");
    expect(loaded?.ok && loaded.case.expect).toEqual({ fails: true, issues: [issue] });
  });

  test("makes a case with an unknown member an error, leaving the other cases alone", () => {
    const cases = [
      { ...compareCase("extra", 1, 1, true), note: "x" },
      { ...compareCase("in-input", 1, 1, true), input: { a: 1, b: 1, c: 1 } },
      { ...compareCase("in-expect", 1, 1, true), expect: { result: true, why: "x" } },
      compareCase("fine", 1, 1, true),
    ];
    expect(verdicts(read(caseFile(cases)).cases)).toEqual([
      ["topic/file/extra", "the case has the unknown member note"],
      ["topic/file/in-input", "input has the unknown member c"],
      ["topic/file/in-expect", "expect has the unknown member why"],
      ["topic/file/fine", "ok"],
    ]);
  });

  test.each([
    [
      "at the top of the file",
      { cases: [compareCase("a", 1, 1, true)], version: 2 },
      "the case file has the unknown member version",
    ],
    [
      "in defaults",
      { defaults: { operation: "compare", store: "x" }, cases: [compareCase("a", 1, 1, true)] },
      "defaults has the unknown member store",
    ],
  ])("makes every case an error for an unknown member %s", (_where, file, detail) => {
    expect(verdicts(read(JSON.stringify({ ...file, cases: [...file.cases, compareCase("b", 1, 1, true)] })).cases)).toEqual([
      ["topic/file/a", detail],
      ["topic/file/b", detail],
    ]);
  });

  test("makes a case with a repeated member name or an unrepresentable number an error, and only that case", () => {
    const text = `{"cases": [
      {"id": "dup", "id": "dup", "description": "", "spec": [], "profiles": [], "operation": "compare", "input": {"a": 1, "b": 1}, "expect": {"result": true}},
      {"id": "big", "description": "", "spec": [], "profiles": [], "operation": "compare", "input": {"a": 9007199254740993, "b": 1}, "expect": {"result": true}},
      {"id": "fine", "description": "", "spec": [], "profiles": [], "operation": "compare", "input": {"a": 9007199254740992, "b": 1e23}, "expect": {"result": false}}
    ]}`;
    expect(verdicts(read(text).cases)).toEqual([
      ["topic/file/dup", 'the member name "id" is repeated'],
      ["topic/file/big", "the integer 9007199254740993 has no exact double"],
      ["topic/file/fine", "ok"],
    ]);
  });

  test("makes every case an error for a problem in defaults", () => {
    const text = `{"defaults": {"input": {"a": 1e400}}, "cases": [${JSON.stringify(compareCase("one", 1, 1, true))}]}`;
    expect(verdicts(read(text).cases)).toEqual([["topic/file/one", "the number 1e400 is too large for a double"]]);
  });

  test("gives one error for a file that cannot be read", () => {
    expect(verdicts(read("{").cases)).toEqual([["topic/file/", expect.stringContaining("the case file cannot be read")]]);
    expect(verdicts(read('{"defaults": {}}').cases)).toEqual([
      ["topic/file/", "the case file must be an object with a list of cases"],
    ]);
  });

  test("names a case without a usable id by its index, and rejects ids used twice", () => {
    const cases = [
      compareCase("Bad_Id", 1, 1, true),
      "not a case",
      compareCase("twice", 1, 1, true),
      compareCase("twice", 1, 2, false),
    ];
    expect(verdicts(read(caseFile(cases as object[])).cases)).toEqual([
      ["topic/file/#0", expect.stringContaining("id must be")],
      ["topic/file/#1", "the case must be an object"],
      ["topic/file/twice", "the id twice is used by another case of the file"],
      ["topic/file/twice", "the id twice is used by another case of the file"],
    ]);
  });

  test("rejects a case that lacks a member once defaults are applied", () => {
    const { expect: _expect, ...noExpect } = compareCase("a", 1, 1, true) as Record<string, unknown>;
    expect(verdicts(read(caseFile([noExpect])).cases)).toEqual([["topic/file/a", "the case lacks expect"]]);
  });

  test("rejects a missing required input and a profile the suite does not define", () => {
    const cases = [
      { ...compareCase("no-b", 1, 1, true), input: { a: 1 } },
      { ...compareCase("profile", 1, 1, true), profiles: ["reading"] },
    ];
    expect(verdicts(read(caseFile(cases)).cases)).toEqual([
      ["topic/file/no-b", "input lacks b, which compare requires"],
      ["topic/file/profile", expect.stringContaining("profiles must be")],
    ]);
  });

  test("checks expect against the operation", () => {
    const cases = [
      { ...compareCase("both", 1, 1, true), expect: { result: true, fails: true } },
      { ...compareCase("neither", 1, 1, true), expect: {} },
      { ...compareCase("fails-false", 1, 1, true), expect: { fails: false } },
      { ...storeCase("check-fails", "check", { input: { store: "s" } }), expect: { fails: true } },
      { ...storeCase("check-result", "check", { input: { store: "s" } }), expect: { result: 1 } },
      { ...storeCase("check-fine", "check", { input: { store: "s" } }), expect: {} },
      { ...compareCase("bytes", 1, 1, true), expect: { result: true, bytes: "x" } },
      {
        ...compareCase("issue", 1, 1, true),
        expect: { result: true, issues: [{ code: "x", severity: "fatal", path: null, at: null }] },
      },
      {
        ...compareCase("issue-member", 1, 1, true),
        expect: { result: true, issues: [{ code: "x", severity: "error", path: null, at: null, line: 1 }] },
      },
      {
        ...compareCase("issue-fine", 1, 1, true),
        expect: { result: true, issues: [{ code: "x", severity: "warning", path: "a.md", at: "" }] },
      },
    ];
    expect(verdicts(read(caseFile(cases)).cases)).toEqual([
      ["topic/file/both", "expect must have exactly one of result and fails for compare"],
      ["topic/file/neither", "expect must have exactly one of result and fails for compare"],
      ["topic/file/fails-false", "expect.fails must be true when it is given"],
      ["topic/file/check-fails", "check cannot be expected to fail"],
      ["topic/file/check-result", "check has no result to expect"],
      ["topic/file/check-fine", "ok"],
      ["topic/file/bytes", expect.stringContaining("expect.bytes is reserved")],
      ["topic/file/issue", "expect.issues[0] must give severity as error or warning"],
      ["topic/file/issue-member", "expect.issues[0] the issue has the unknown member line"],
      ["topic/file/issue-fine", "ok"],
    ]);
  });

  test("collects an input member that the operation does not take, from the case or from defaults", () => {
    const { inputsNotTaken } = read(
      caseFile(
        [
          storeCase("meta-as", "meta", { input: { store: "s", record: "a.md", as: "singular" } }),
          storeCase("resolve", "resolve", { input: { address: "a.md", as: "singular" } }),
          storeCase("parse", "parse"),
        ],
        { input: { store: "s", record: "a.md" } },
      ),
    );
    expect(inputsNotTaken).toEqual(["topic/file/meta-as: as", "topic/file/resolve: record"]);
  });

  test("does not check the inputs of an operation the suite does not define", () => {
    const { cases, inputsNotTaken } = read(
      caseFile([{ ...compareCase("outline", 1, 1, true), operation: "outline", input: { store: "s" } }]),
    );
    expect(inputsNotTaken).toEqual([]);
    expect(verdicts(cases)).toEqual([["topic/file/outline", "ok"]]);
  });
});

describe("loadCases", () => {
  test("finds case files at any depth, but not inside fixture stores", async () => {
    const suite = await makeSuite({
      "cases/a.cases.json": caseFile([compareCase("x", 1, 1, true)]),
      "cases/deep/er/b.cases.json": caseFile([compareCase("y", 1, 1, true)]),
      "cases/deep/c.json": "not a case file",
      ...storeFiles("cases/deep/store"),
      "cases/deep/store/d.cases.json": caseFile([compareCase("z", 1, 1, true)]),
    });
    const { cases } = await loadCases(suite);
    expect(cases.map((loaded) => (loaded.ok ? loaded.case.id : loaded.id)).sort()).toEqual(["a/x", "deep/er/b/y"]);
  });

  test("rejects when cases/ does not exist", async () => {
    await expect(loadCases(await makeSuite({}))).rejects.toThrow();
  });
});
