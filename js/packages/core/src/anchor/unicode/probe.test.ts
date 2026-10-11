import { describe, expect, test } from "vitest";
import { PROBE_FACTS, probeUnicodeRuntime, STANDARD_RUNTIME, type UnicodeRuntime, unicodeRuntimeProbe } from "./probe.js";
import { isLetterMarkDigitOrConnector, lowerCaseOf, UNICODE_VERSION } from "./unicode.js";

/** The part of Node's `process` this file reads. Core sees no Node types, and the global is absent outside Node. */
const runtimeUnicode = (globalThis as { process?: { versions?: { unicode?: string } } }).process?.versions?.unicode;

/** Whether a version such as "17.0" is at least the tables' version, compared by major and minor. */
function atLeastTables(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  const [tablesMajor = 0, tablesMinor = 0] = UNICODE_VERSION.split(".").map(Number);
  return major > tablesMajor || (major === tablesMajor && minor >= tablesMinor);
}

/** A runtime that answers as the standard one does, except where `changes` says otherwise. */
function fakeRuntime(changes: Partial<UnicodeRuntime>): UnicodeRuntime {
  return { ...STANDARD_RUNTIME, ...changes };
}

describe("the facts", () => {
  test("hold in the tables, so that a typo in a fact cannot pass as the runtime's fault", () => {
    for (const fact of PROBE_FACTS) {
      if (fact.kind === "letter") expect(isLetterMarkDigitOrConnector(fact.codePoint)).toBe(true);
      if (fact.kind === "lower-case") expect(lowerCaseOf(fact.codePoint)).toBe(String.fromCodePoint(fact.lower));
    }
  });

  test("include characters that the tables' Unicode version assigned, which an older runtime does not know", () => {
    // U+16EA0 and U+20C1 are new in Unicode 17.0 (Beria Erfe; the Saudi riyal sign).
    expect(PROBE_FACTS.map((fact) => fact.codePoint)).toEqual(expect.arrayContaining([0x16ea0, 0x20c1]));
  });
});

describe("unicodeRuntimeProbe", () => {
  test("names the tables' version", () => {
    expect(unicodeRuntimeProbe().version).toBe(UNICODE_VERSION);
  });

  test("agrees on a runtime whose Unicode is the tables' or newer, and disagrees on an older one", (context) => {
    if (runtimeUnicode === undefined) context.skip("the runtime does not say its Unicode version");
    const probe = unicodeRuntimeProbe();
    expect(probe.agrees).toBe(atLeastTables(runtimeUnicode as string));
    expect(probe.failures.length === 0).toBe(probe.agrees);
  });

  test("is frozen", () => {
    const probe = unicodeRuntimeProbe();
    expect(Object.isFrozen(probe)).toBe(true);
    expect(Object.isFrozen(probe.failures)).toBe(true);
  });
});

describe("probeUnicodeRuntime on a faked runtime", () => {
  test("agrees where every fact holds", () => {
    expect(probeUnicodeRuntime(STANDARD_RUNTIME).agrees).toBe(runtimeUnicode === undefined || atLeastTables(runtimeUnicode));
  });

  test("fails a runtime that does not know U+16EA0 as a letter, naming the code point", () => {
    const probe = probeUnicodeRuntime(fakeRuntime({ isLetter: (cp) => cp !== 0x16ea0 && STANDARD_RUNTIME.isLetter(cp) }));
    expect(probe.agrees).toBe(false);
    expect(probe.failures).toEqual([expect.stringContaining("U+16EA0")]);
  });

  test("fails a runtime whose lower case of U+16EA0 is itself, as before Unicode 17.0", () => {
    const probe = probeUnicodeRuntime(
      fakeRuntime({ lowerCase: (cp) => (cp === 0x16ea0 ? String.fromCodePoint(cp) : STANDARD_RUNTIME.lowerCase(cp)) }),
    );
    expect(probe.agrees).toBe(false);
    expect(probe.failures).toEqual([expect.stringMatching(/U\+16EA0.*U\+16EBB/)]);
  });

  test("fails a runtime that does not know U+20C1 as assigned", () => {
    const probe = probeUnicodeRuntime(fakeRuntime({ isAssigned: (cp) => cp !== 0x20c1 && STANDARD_RUNTIME.isAssigned(cp) }));
    expect(probe.failures).toEqual([expect.stringContaining("U+20C1")]);
  });

  test("lists every fact that fails, in the order of the facts", () => {
    const probe = probeUnicodeRuntime({
      isLetter: () => false,
      isAssigned: () => false,
      lowerCase: (cp) => String.fromCodePoint(cp),
    });
    expect(probe.failures).toHaveLength(PROBE_FACTS.length);
  });
});
