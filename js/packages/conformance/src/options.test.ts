import { describe, expect, test } from "vitest";
import { checkDeclaration, skipMatches } from "./declaration.js";
import { readJson } from "./json.js";
import { checkSelection, isSelected, sectionSelects } from "./selection.js";
import { checkSuiteVersion } from "./suite.js";

const read = (text: string) => readJson(new TextEncoder().encode(text));

describe("checkSuiteVersion", () => {
  test("accepts the suite's version and case format 1", () => {
    expect(checkSuiteVersion(read('{"version": "0.6.0-dev", "case_format": 1}'))).toEqual({
      ok: true,
      value: { version: "0.6.0-dev", case_format: 1 },
    });
  });

  test.each([
    ["an unknown member", '{"version": "0.6.0", "case_format": 1, "extra": true}', "unknown member extra"],
    ["an unknown case format", '{"version": "0.6.0", "case_format": 2}', "case_format 2"],
    ["a missing member", '{"version": "0.6.0"}', "must give"],
    ["a repeated member", '{"version": "0.6.0", "case_format": 1, "case_format": 1}', "repeated"],
    ["text that is not JSON", "{", "cannot be read"],
  ])("rejects %s", (_name, text, detail) => {
    const checked = checkSuiteVersion(read(text));
    expect(checked.ok ? "" : checked.detail).toContain(detail);
  });
});

describe("checkDeclaration", () => {
  const valid = {
    name: "x",
    version: "1",
    profiles: ["read", "query"],
    skip: [
      { id: "a/", reason: "r" },
      { operation: "parse", reason: "s" },
    ],
  };

  test("accepts a declaration, with or without a skip list", () => {
    expect(checkDeclaration(read(JSON.stringify(valid)))).toEqual({ ok: true, value: valid });
    expect(checkDeclaration(read('{"name": "x", "version": "1", "profiles": []}'))).toEqual({
      ok: true,
      value: { name: "x", version: "1", profiles: [], skip: [] },
    });
  });

  test.each([
    ["an unknown member", { ...valid, extra: 1 }, "unknown member extra"],
    ["an unknown profile", { ...valid, profiles: ["reading"] }, "profiles"],
    ["a skip entry with two selectors", { ...valid, skip: [{ id: "a", operation: "parse", reason: "r" }] }, "exactly one"],
    ["a skip entry without a selector", { ...valid, skip: [{ reason: "r" }] }, "exactly one"],
    ["a skip entry without a reason", { ...valid, skip: [{ id: "a" }] }, "exactly one"],
    ["a skip entry with an unknown member", { ...valid, skip: [{ id: "a", reason: "r", note: "n" }] }, "unknown member note"],
    ["a skip entry whose selector is no string", { ...valid, skip: [{ id: 1, reason: "r" }] }, "as a string"],
  ])("rejects %s", (_name, declaration, detail) => {
    const checked = checkDeclaration(read(JSON.stringify(declaration)));
    expect(checked.ok ? "" : checked.detail).toContain(detail);
  });

  test("matches a skip entry by operation, by global id, and by a prefix ending in /", () => {
    expect(skipMatches({ operation: "parse", reason: "r" }, "a/b", "parse")).toBe(true);
    expect(skipMatches({ operation: "parse", reason: "r" }, "a/b", "meta")).toBe(false);
    expect(skipMatches({ id: "a/b", reason: "r" }, "a/b", "parse")).toBe(true);
    expect(skipMatches({ id: "a/b", reason: "r" }, "a/bc", "parse")).toBe(false);
    expect(skipMatches({ id: "a/", reason: "r" }, "a/b/c", "parse")).toBe(true);
    expect(skipMatches({ id: "a", reason: "r" }, "a/b", "parse")).toBe(false);
  });
});

describe("checkSelection", () => {
  test("gives null for a full run, and the criteria otherwise", () => {
    expect(checkSelection({})).toEqual({ ok: true, value: null });
    expect(checkSelection({ ids: ["a/"] })).toEqual({ ok: true, value: { profiles: null, sections: null, ids: ["a/"] } });
  });

  test.each([
    ["an unknown profile", { profiles: ["reading"] }, "unknown profile reading"],
    ["an empty criterion", { sections: [] }, "non-empty"],
    ["an empty entry", { ids: [""] }, "non-empty"],
  ])("rejects %s", (_name, criteria, detail) => {
    const checked = checkSelection(criteria);
    expect(checked.ok ? "" : checked.detail).toContain(detail);
  });
});

describe("isSelected", () => {
  const selected = (criteria: Parameters<typeof checkSelection>[0], candidate: Parameters<typeof isSelected>[1]) => {
    const checked = checkSelection(criteria);
    return checked.ok && isSelected(checked.value, candidate);
  };
  const candidate = { id: "addresses/paths/x", profiles: ["read", "validate"], spec: ["7.3", "RFC 6901 4"] };

  test("selects by any listed profile the case needs", () => {
    expect(selected({ profiles: ["validate"] }, candidate)).toBe(true);
    expect(selected({ profiles: ["query", "read"] }, candidate)).toBe(true);
    expect(selected({ profiles: ["query"] }, candidate)).toBe(false);
  });

  test("selects by a section or a section above the one cited", () => {
    expect(selected({ sections: ["7"] }, candidate)).toBe(true);
    expect(selected({ sections: ["7.3"] }, candidate)).toBe(true);
    expect(selected({ sections: ["7.3.1"] }, candidate)).toBe(false);
    expect(selected({ sections: ["RFC 6901 4"] }, candidate)).toBe(true);
    expect(selected({ sections: ["4"] }, candidate)).toBe(false);
  });

  test("selects by id or prefix", () => {
    expect(selected({ ids: ["addresses/"] }, candidate)).toBe(true);
    expect(selected({ ids: ["addresses/paths/x"] }, candidate)).toBe(true);
    expect(selected({ ids: ["addresses"] }, candidate)).toBe(false);
  });

  test("requires every criterion given", () => {
    expect(selected({ profiles: ["read"], ids: ["markdown/"] }, candidate)).toBe(false);
    expect(selected({ profiles: ["read"], ids: ["addresses/"] }, candidate)).toBe(true);
  });

  test("takes a criterion on a list a malformed case cannot give as met", () => {
    expect(selected({ profiles: ["query"], sections: ["10"] }, { id: "x/#0" })).toBe(true);
    expect(selected({ ids: ["y/"] }, { id: "x/#0" })).toBe(false);
  });
});

describe("sectionSelects", () => {
  test.each([
    ["7", "7", true],
    ["7", "7.3.1", true],
    ["7.3", "7.31", false],
    ["7", "71", false],
    ["A", "A", true],
    ["CommonMark 0.31.2 4", "CommonMark 0.31.2 4.3", true],
    ["CommonMark 0.31.2 4", "CommonMark 0.30 4.3", false],
    ["XSD 1.1 Part 2 3.3", "XSD 1.1 Part 2 3.3.3.1", true],
    ["4.3", "CommonMark 0.31.2 4.3", false],
  ])("%s selects %s: %s", (section, citation, result) => {
    expect(sectionSelects(section, citation)).toBe(result);
  });
});
