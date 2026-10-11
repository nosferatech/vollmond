import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { oneLine } from "./lines.js";
import {
  DEFAULT_LIMITS,
  formatPageRemainder,
  formatUnreadableRecords,
  MAX_LIMIT,
  PAGE_OPTIONS,
  readLimit,
  shellWord,
} from "./paging.js";

test("the default limits are 100 for ls, 50 for grep and 20 for query", () => {
  expect(DEFAULT_LIMITS).toEqual({ ls: 100, grep: 50, query: 20 });
});

test("a paged listing takes -n and --cursor", () => {
  expect(PAGE_OPTIONS).toEqual({ limit: { type: "string", short: "n" }, cursor: { type: "string" } });
});

describe("readLimit", () => {
  test("gives the default when -n is absent", () => {
    expect(readLimit(undefined, 100)).toEqual({ ok: true, limit: 100 });
  });

  test.each([
    ["1", 1],
    ["20", 20],
    [String(MAX_LIMIT), MAX_LIMIT],
  ])("reads %s", (text, limit) => {
    expect(readLimit(text, 100)).toEqual({ ok: true, limit });
  });

  test.each(["", " 5", "5 ", "0", "-1", "+5", "1.5", "1e2", "0x10", "05", "five", String(MAX_LIMIT + 1)])(
    "refuses %j, though Number reads some such strings",
    (text) => {
      const reading = readLimit(text, 100);
      expect(reading.ok).toBe(false);
      expect(reading.ok ? "" : reading.message).toContain("-n");
    },
  );
});

describe("shellWord", () => {
  test("keeps a path as it is", () => {
    expect(shellWord("tickets/0171-x.md")).toBe("tickets/0171-x.md");
  });

  test("quotes what a shell would read otherwise", () => {
    expect(shellWord("a b")).toBe("'a b'");
    expect(shellWord("$body")).toBe("'$body'");
    expect(shellWord("")).toBe("''");
  });

  test("quotes a single quote", () => {
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
  });
});

describe("formatPageRemainder", () => {
  test("says how many remain and gives the cursor", () => {
    expect(formatPageRemainder({ remaining: 1234, cursor: "tickets/0171-x.md" })).toBe(
      "… 1,234 more (--cursor tickets/0171-x.md)\n",
    );
  });

  test("says more remain when the listing does not count them", () => {
    expect(formatPageRemainder({ remaining: null, cursor: "c" })).toBe("… more (--cursor c)\n");
  });

  test("quotes a cursor that a shell would split, so the line can be pasted", () => {
    expect(formatPageRemainder({ remaining: 3, cursor: "a b" })).toBe("… 3 more (--cursor 'a b')\n");
  });

  test("marks an estimate", () => {
    expect(formatPageRemainder({ remaining: 1200, estimated: true, cursor: "c" })).toBe("… ~1,200 more (--cursor c)\n");
    expect(formatPageRemainder({ remaining: 12, estimated: false, cursor: "c" })).toBe("… 12 more (--cursor c)\n");
  });

  test("keeps a cursor's escape sequences, right-to-left override and line breaks from the terminal", () => {
    const line = formatPageRemainder({ remaining: 1, cursor: "a\u001b]8;;x\u0007b\u202ec\nd" });
    expect(line).toBe("… 1 more (--cursor $'a\\x1b]8;;x\\x07b\\u202ec\\x0ad')\n");
    expect(line.slice(0, -1)).toBe(oneLine(line.slice(0, -1)));
  });
});

describe("shellWord in ANSI-C quotes", () => {
  test("escapes a backslash and a single quote beside a control", () => {
    expect(shellWord("it's\\\n")).toBe("$'it\\'s\\\\\\x0a'");
  });

  test("writes DEL as a byte and C1 controls and separators as characters", () => {
    expect(shellWord("\u007f\u0085\u2028")).toBe("$'\\x7f\\u0085\\u2028'");
  });

  /** The shells that read `\u` in ANSI-C quotes: zsh, and bash from 4.2. */
  const shells = ["zsh", "bash"].filter((shell) => {
    try {
      const version = execFileSync(shell, ["-c", "echo $ZSH_VERSION$BASH_VERSION"], { encoding: "utf8" }).trim();
      return shell === "zsh" || /^(4\.[2-9]|[5-9])/.test(version);
    } catch {
      return false;
    }
  });

  test.each(shells)("pastes back into %s as the same text", (shell) => {
    const text = "a b'c\\d\u001b[31m\u0007\u007f\u0085\u202e\u2066\u2028\n\r\tz 概要 😀";
    const printed = execFileSync(shell, ["-c", `printf %s ${shellWord(text)}`], { encoding: "utf8" });
    expect(printed).toBe(text);
  });
});

describe("formatUnreadableRecords", () => {
  test("says nothing for none", () => {
    expect(formatUnreadableRecords(0, "page")).toBe("");
  });

  test("says the count is of the printed page", () => {
    expect(formatUnreadableRecords(1, "page")).toBe("1 record on this page could not be read\n");
    expect(formatUnreadableRecords(1200, "page")).toBe("1,200 records on this page could not be read\n");
  });

  test("says nothing of a page for a count over the store", () => {
    expect(formatUnreadableRecords(2, "store")).toBe("2 records could not be read\n");
  });
});
