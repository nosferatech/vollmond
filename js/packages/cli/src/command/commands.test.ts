// The read commands over a store on the filesystem, through `runCli`, with and without `--json`.

import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { type CliEnvironment, type CliResult, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";

const GUIDE = `# Guide

Intro text with a 😀 in it.

## Install

Run it.

- <a id="step"></a>First step.
- Second step.

### Linux

Use the package.

## Use

`;

const TWIN = "# Twin\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond\n";

/** Bytes that are not UTF-8: a lone continuation byte, an invalid lead byte, a NUL. */
const NOT_UTF8 = new Uint8Array([0xff, 0xfe, 0x00, 0x80, 0x0a]);

/** A store with records, assets, a broken record, a dotfile and a file that is not UTF-8. */
function fixtureStore(): string {
  return writeFiles(temporaryDirectory(), {
    ".vmd/config.yaml": "vmd: 1\n",
    ".gitignore": "Use\n",
    "broken.json": "{",
    "data.json": '{"status": "open", "range": {"start": 1, "end": 2}}',
    "docs/guide.md": GUIDE,
    "docs/twin.md": TWIN,
    "image.bin": NOT_UTF8,
    "lines.txt": "one\ntwo\r\nthree\rfour\n",
  });
}

const ROOT = fixtureStore();

/** The environment of a run in `cwd`, the store root unless given, with a runtime whose Unicode data agrees. */
function env(cwd = ROOT): Partial<CliEnvironment> {
  return { cwd, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

/** Runs `vmd` in the store and returns its result, with stdout as text. */
async function vmd(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runCli(args, env());
  return { ...result, stdout: textOf(result) };
}

/** Runs `vmd --json` in the store and returns the parsed outcome object and the exit code. */
async function vmdJson(...args: string[]): Promise<{ outcome: JsonOutcome; exitCode: number }> {
  const result = await runCli(["--json", ...args], env());
  expect(result.stderr).toBe("");
  return { outcome: JSON.parse(textOf(result)) as JsonOutcome, exitCode: result.exitCode };
}

interface JsonOutcome {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly issues: readonly { readonly code: string; readonly candidates?: readonly unknown[] }[];
}

/** The run's stdout as text: bytes, as `cat` writes them, are decoded as UTF-8. */
function textOf(result: CliResult): string {
  return typeof result.stdout === "string" ? result.stdout : new TextDecoder().decode(result.stdout);
}

const codes = (outcome: JsonOutcome) => outcome.issues.map((issue) => issue.code);

/** The length of a text in UTF-8 bytes. */
const bytes = (text: string) => Buffer.byteLength(text);

/** The UTF-8 offset in the guide of the first occurrence of `marker`. */
const at = (marker: string) => bytes(GUIDE.slice(0, GUIDE.indexOf(marker)));

/** The size of the guide's sections, which hold the sections below them, in bytes. */
const SIZE = {
  guide: bytes(GUIDE),
  install: at("## Use") - at("## Install"),
  linux: at("## Use") - at("### Linux"),
  use: bytes(GUIDE) - at("## Use"),
};

describe("command options", () => {
  test("are read before the store is looked for, so a bad -n outside a store is usage-invalid", async () => {
    const result = await runCli(["--json", "ls", "-n", "0"], { cwd: temporaryDirectory() });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout as string).issues.map((issue: { code: string }) => issue.code)).toEqual(["usage-invalid"]);
  });

  test.each([
    ["ls", "a", "b"],
    ["ls", "-n", "0"],
    ["ls", "-n", "1.5"],
    ["cat"],
    ["cat", "a.md", "b.md"],
    ["cat", "a.md", "--lines", "0:2"],
    ["cat", "a.md", "--lines", "3:2"],
    ["cat", "a.md", "--lines", "2"],
    ["cat", "a.md", "--lines", "1:02"],
    ["grep"],
    ["grep", "a", "b", "c"],
    ["grep", "a", "-C", "-1"],
    ["grep", "a", "-C", "x"],
    ["outline"],
    ["outline", "a.md", "--depth", "-1"],
    ["outline", "a.md", "--depth", "01"],
    ["get"],
    ["get", "a.md", "--value", "--body"],
    ["get", "a.md", "--max-chars", "0"],
    ["get", "a.md", "--meta", "nope"],
    ["get", "a.md", "--meta", "@path,"],
  ])("refuse %j with usage-invalid and exit code 2, even outside a store", async (...args) => {
    const result = await runCli(["--json", ...args], { cwd: temporaryDirectory() });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout as string).issues.map((issue: { code: string }) => issue.code)).toEqual(["usage-invalid"]);
  });

  test("let legitimate values through", async () => {
    expect((await vmd("ls", "-n", "1")).exitCode).toBe(0);
    expect((await vmd("cat", "lines.txt", "--lines", "1:1")).exitCode).toBe(0);
    expect((await vmd("grep", "x", "-C", "0")).exitCode).toBe(0);
    expect((await vmd("outline", "docs/guide.md", "--depth", "0")).exitCode).toBe(0);
    expect((await vmd("get", "data.json", "--max-chars", "1", "--meta", "path,@at,all")).exitCode).toBe(0);
  });
});

describe("paths", () => {
  test("are store paths, relative to the store root, not to the working directory", async () => {
    const inDocs = env(join(ROOT, "docs"));
    const found = await runCli(["get", "docs/guide.md#use"], inDocs);
    expect(found.exitCode).toBe(0);
    expect(found.stdout).toBe("## Use\n\n");
    const relative = await runCli(["--json", "cat", "guide.md"], inDocs);
    expect(relative.exitCode).toBe(1);
    expect(JSON.parse(relative.stdout as string).issues[0].code).toBe("address-not-found");
  });
});

describe("ls", () => {
  test("lists records and assets with sizes, leaving out .vmd/ and dotfiles, and counts the unreadable on the page", async () => {
    const result = await vmd("ls");
    expect(result).toEqual({
      stdout:
        "broken.json    1 B    ~0 tok   unreadable\n" +
        "data.json      51 B   ~13 tok\n" +
        `docs/guide.md  ${SIZE.guide} B  ~36 tok\n` +
        "docs/twin.md   42 B   ~11 tok\n" +
        "image.bin      5 B    ~1 tok   asset\n" +
        "lines.txt      20 B   ~5 tok   asset\n" +
        "1 record on this page could not be read\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("pages with -n and a cursor, with the exact number that remains, and counts the unreadable on each page only", async () => {
    const first = await vmd("ls", "-n", "2");
    expect(first.stdout).toBe(
      "broken.json  1 B   ~0 tok   unreadable\ndata.json    51 B  ~13 tok\n" +
        "1 record on this page could not be read\n… 4 more (--cursor data.json)\n",
    );
    const second = await vmd("ls", "-n", "2", "--cursor", "data.json");
    expect(second.stdout).toMatch(/^docs\/guide\.md .*\ndocs\/twin\.md .*\n… 2 more \(--cursor docs\/twin\.md\)\n$/);
    const last = await vmd("ls", "--cursor", "docs/twin.md");
    expect(last.stdout).toBe("image.bin  5 B   ~1 tok  asset\nlines.txt  20 B  ~5 tok  asset\n");
  });

  test("matches a glob against whole store paths", async () => {
    expect((await vmd("ls", "docs/*.md")).stdout).toMatch(/^docs\/guide\.md .*\ndocs\/twin\.md .*\n$/);
    expect((await vmd("ls", "*.md")).stdout).toBe("");
  });

  test("gives the page, its counts and the cursor under --json", async () => {
    const { outcome, exitCode } = await vmdJson("ls", "-n", "1");
    expect(exitCode).toBe(0);
    expect(outcome).toEqual({
      ok: true,
      value: {
        items: [
          {
            path: "broken.json",
            size: 1,
            version: expect.stringMatching(/^[0-9a-f]{40}$/),
            modified: expect.any(String),
            kind: "record",
            readable: false,
          },
        ],
        cursor: "broken.json",
        remaining: { count: 5, exact: true },
        unreadable: { count: 1, scope: "page" },
      },
      issues: [],
    });
  });

  test("fails with query-invalid for a malformed glob", async () => {
    const { outcome, exitCode } = await vmdJson("ls", "docs/");
    expect(exitCode).toBe(1);
    expect(codes(outcome)).toEqual(["query-invalid"]);
  });
});

describe("cat", () => {
  test("prints a file's bytes as they are, also when they are not UTF-8", async () => {
    const result = await runCli(["cat", "image.bin"], env());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual(NOT_UTF8);
    expect((await vmd("cat", "docs/twin.md")).stdout).toBe(TWIN);
  });

  test("prints lines A to B, B left out, with lines ending at LF, CRLF or a lone CR", async () => {
    expect((await vmd("cat", "lines.txt", "--lines", "2:4")).stdout).toBe("two\r\nthree\r");
    expect((await vmd("cat", "lines.txt", "--lines", "4:9")).stdout).toBe("four\n");
    expect((await vmd("cat", "lines.txt", "--lines", "2:2")).stdout).toBe("");
  });

  test("gives the content in base64 and the range as [start, end] under --json", async () => {
    const { outcome } = await vmdJson("cat", "image.bin");
    expect(outcome.value).toEqual({
      path: "image.bin",
      size: 5,
      version: expect.stringMatching(/^[0-9a-f]{40}$/),
      modified: expect.any(String),
      content: { base64: Buffer.from(NOT_UTF8).toString("base64") },
      range: [0, 5],
    });
    const lines = await vmdJson("cat", "lines.txt", "--lines", "2:3");
    expect((lines.outcome.value as { range: unknown }).range).toEqual([4, 9]);
  });

  test("fails with address-not-found for a missing file or a directory", async () => {
    for (const path of ["missing.md", "docs"]) {
      const { outcome, exitCode } = await vmdJson("cat", path);
      expect(exitCode).toBe(1);
      expect(codes(outcome)).toEqual(["address-not-found"]);
    }
    const text = await vmd("cat", "missing.md");
    expect(text.stdout).toBe("");
    expect(text.stderr).toBe("missing.md error address-not-found: missing.md does not exist\n");
  });
});

describe("grep", () => {
  test("prints each matching line as path:line:text, without searching .vmd/ or dotfiles", async () => {
    expect(await vmd("grep", "^Use")).toEqual({
      stdout: "docs/guide.md:14:Use the package.\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("prints context lines once, as path-line-text, with -- between groups that do not touch", async () => {
    const result = await vmd("grep", "step", "docs/guide.md", "-C", "1");
    expect(result.stdout).toBe(
      "docs/guide.md-8-\n" +
        'docs/guide.md:9:- <a id="step"></a>First step.\n' +
        "docs/guide.md:10:- Second step.\n" +
        "docs/guide.md-11-\n",
    );
    const apart = await vmd("grep", "^(first|second)$", "-C", "1");
    expect(apart.stdout).toBe(
      "docs/twin.md-4-\ndocs/twin.md:5:first\ndocs/twin.md-6-\n--\n" + "docs/twin.md-8-\ndocs/twin.md:9:second\n",
    );
  });

  test("takes the pattern literally with -F, and ignores case with -i", async () => {
    expect((await vmd("grep", "t.o", "lines.txt")).stdout).toBe("lines.txt:2:two\n");
    expect((await vmd("grep", "-F", "t.o", "lines.txt")).stdout).toBe("");
    expect((await vmd("grep", "-i", "^USE", "docs/*.md")).stdout).toBe("docs/guide.md:14:Use the package.\n");
  });

  test("pages with -n and a cursor, with an estimate of what remains while files are unread", async () => {
    const first = await vmd("grep", "t", "-n", "2");
    expect(first.stdout).toBe(
      'data.json:1:{"status": "open", "range": {"start": 1, "end": 2}}\n' +
        "docs/guide.md:3:Intro text with a 😀 in it.\n" +
        "… ~12 more (--cursor 3:docs/guide.md)\n",
    );
    const next = await vmd("grep", "t", "-n", "2", "--cursor", "3:docs/guide.md");
    expect(next.stdout).toMatch(/^docs\/guide\.md:5:## Install\ndocs\/guide\.md:7:Run it\.\n… ~\d+ more /);
    const json = await vmdJson("grep", "t", "-n", "2");
    expect((json.outcome.value as { remaining: unknown }).remaining).toEqual({ count: expect.any(Number), exact: false });
  });

  test("fails for a pattern outside the portable subset", async () => {
    const { outcome, exitCode } = await vmdJson("grep", "(?i)use");
    expect(exitCode).toBe(1);
    expect(outcome.ok).toBe(false);
  });

  test("gives the matches under --json", async () => {
    const { outcome } = await vmdJson("grep", "-i", "second", "-C", "1");
    expect(outcome.value).toEqual({
      items: [
        { path: "docs/guide.md", line: 10, text: "- Second step.", before: ['- <a id="step"></a>First step.'], after: [""] },
        { path: "docs/twin.md", line: 9, text: "second", before: [""], after: [] },
      ],
      cursor: null,
      remaining: { count: 0, exact: true },
    });
  });
});

describe("outline", () => {
  test("prints the node's size, then each section below it by its address, title and size, indented by depth", async () => {
    expect(await vmd("outline", "docs/guide.md")).toEqual({
      stdout:
        "docs/guide.md  ~36 tok\n" +
        "  #install          Install  ~24 tok\n" +
        "    #install/linux  Linux    ~7 tok\n" +
        "  #use              Use      ~2 tok\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("goes down at most --depth levels, from the node it is given", async () => {
    expect((await vmd("outline", "docs/guide.md", "--depth", "1")).stdout).toBe(
      "docs/guide.md  ~36 tok\n  #install  Install  ~24 tok\n  #use      Use      ~2 tok\n",
    );
    expect((await vmd("outline", "docs/guide.md#install")).stdout).toBe(
      "docs/guide.md#install  ~24 tok\n  #install/linux  Linux  ~7 tok\n",
    );
  });

  test("gives the outline under --json", async () => {
    const { outcome } = await vmdJson("outline", "docs/twin.md");
    expect(outcome.value).toEqual({
      path: "docs/twin.md",
      node: { at: "", address: "", title: "Twin", depth: 0, size: TWIN.length },
      sections: [
        // Both sections have the key notes, so the first is named by its exact path, the second by its derived anchor.
        { at: "/$sections/0", address: "#/$sections/0", key: "notes", title: "Notes", depth: 1, size: 17 },
        { at: "/$sections/1", address: "#notes-1", key: "notes", title: "Notes", depth: 1, size: 17 },
      ],
    });
  });

  test("fails for an ambiguous address, listing the candidates", async () => {
    const result = await vmd("outline", "docs/twin.md#notes");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("  candidates  #/$sections/0 (line 3, derived #notes)\n");
  });
});

describe("get", () => {
  test("prints a section's source by default, from its heading to the next heading of its level", async () => {
    expect(await vmd("get", "docs/guide.md#install")).toEqual({
      stdout: GUIDE.slice(GUIDE.indexOf("## Install"), GUIDE.indexOf("## Use")),
      stderr: "",
      exitCode: 0,
    });
  });

  test("prints the value view as JSON with --value, and a section's $body with --body", async () => {
    expect((await vmd("get", "data.json", "--value")).stdout).toBe(
      '{\n  "status": "open",\n  "range": {\n    "start": 1,\n    "end": 2\n  }\n}\n',
    );
    expect((await vmd("get", "docs/guide.md#linux", "--body")).stdout).toBe("Use the package.\n");
    expect((await vmd("get", "docs/guide.md#step")).stdout).toBe('- <a id="step"></a>First step.\n');
  });

  test("gives the value view under --json, or the $body with --body", async () => {
    expect((await vmdJson("get", "data.json#status")).outcome).toEqual({ ok: true, value: "open", issues: [] });
    expect((await vmdJson("get", "docs/guide.md#linux", "--body")).outcome.value).toBe("Use the package.");
    expect((await vmdJson("get", "docs/guide.md#linux")).outcome.value).toEqual({
      $title: "Linux",
      $body: "Use the package.",
    });
  });

  test("prints the requested computed fields before the node, and says which are not computed yet", async () => {
    const result = await vmd("get", "docs/guide.md#use", "--meta", "@address,depth,@key,@refs,@source");
    expect(result.stdout).toBe(
      "@address  #use\n@depth    1\n@key      use\n@refs     (not computed yet)\n" +
        `@source   {"range":[${at("## Use")},${SIZE.guide}],"line":16,"col":1}\n` +
        "## Use\n\n",
    );
  });

  test("gives the value and the computed fields side by side under --json, with ranges as [start, end]", async () => {
    const { outcome } = await vmdJson("get", "data.json#range", "--meta", "@source,@at");
    expect(outcome.value).toEqual({
      // The value view's own members named start and end are left as they are.
      value: { start: 1, end: 2 },
      meta: { "@source": { range: [28, 50], line: 1, col: 29, memberRange: [19, 50] }, "@at": "/range" },
    });
    const block = await vmdJson("get", "docs/guide.md#step", "--meta", "@range,@nodes");
    const body = "Run it.\n\n";
    expect((block.outcome.value as { meta: unknown }).meta).toEqual({
      "@range": [bytes(body), bytes(`${body}- <a id="step"></a>First step.`)],
    });
    const nodes = await vmdJson("get", "docs/guide.md#install", "--meta", "@source,@nodes");
    const meta = (nodes.outcome.value as { meta: { "@nodes": Record<string, { "@source": { range: unknown } }> } }).meta;
    expect(meta["@nodes"]["/$sections/0/$sections/0"]?.["@source"].range).toEqual([at("### Linux"), at("## Use")]);
  });

  test("stops at --max-chars characters, whole characters, says what remains and suggests outline", async () => {
    // A character above U+FFFF counts as one: the 28th character is the emoji, which the cut keeps whole.
    const shown = "# Guide\n\nIntro text with a 😀";
    const rest = GUIDE.slice(shown.length);
    const result = await vmd("get", "docs/guide.md", "--max-chars", "28");
    expect(result.stdout).toBe(
      `${shown}\n… cut after 28 characters, ${[...rest].length} more (~${Math.round(bytes(rest) / 4)} tok); ` +
        "vmd outline docs/guide.md lists its sections, and --max-chars N prints more\n",
    );
    // What remains is counted in characters too: here it holds the emoji, two UTF-16 code units.
    const before = GUIDE.slice(20);
    expect((await vmd("get", "docs/guide.md", "--max-chars", "20")).stdout).toContain(
      `… cut after 20 characters, ${[...before].length} more (`,
    );
    expect([...before].length).toBe(before.length - 1);
    expect((await vmd("get", "docs/twin.md#/$sections/0", "--max-chars", "5")).stdout).toMatch(
      /^## No\n… cut after 5 characters, 12 more \(~3 tok\); vmd outline 'docs\/twin\.md#\/\$sections\/0' lists/,
    );
    expect((await vmd("get", "docs/guide.md")).stdout).toBe(GUIDE);
  });

  test("fails for an ambiguous address, listing each candidate with its line and derived anchor", async () => {
    const result = await vmd("get", "docs/twin.md#notes");
    expect(result).toEqual({
      stdout: "",
      stderr:
        'docs/twin.md error address-ambiguous: docs/twin.md#notes: its step 1, "notes", matches 2 nodes\n' +
        "  candidates  #/$sections/0 (line 3, derived #notes)\n" +
        "              #/$sections/1 (line 7, derived #notes-1)\n" +
        "  hint use the address of the candidate you mean, or give it an explicit anchor\n",
      exitCode: 1,
    });
    const { outcome } = await vmdJson("get", "docs/twin.md#notes");
    expect(outcome.issues[0]?.candidates).toEqual([
      { path: "docs/twin.md", at: "/$sections/0", address: "#/$sections/0" },
      { path: "docs/twin.md", at: "/$sections/1", address: "#notes-1" },
    ]);
  });

  test("fails with the structural errors of an unreadable record, and with address-not-found for a missing one", async () => {
    const broken = await vmdJson("get", "broken.json");
    expect(broken.exitCode).toBe(1);
    expect(codes(broken.outcome)).toEqual(["syntax-error"]);
    expect(codes((await vmdJson("get", "missing.md#x")).outcome)).toEqual(["address-not-found"]);
    expect(codes((await vmdJson("get", "image.bin")).outcome)).toEqual(["address-not-found"]);
    expect(codes((await vmdJson("get", "data.json#status", "--body")).outcome)).toEqual(["address-not-found"]);
  });

  test("reads an address with characters outside a fragment's raw, as the command line does, in get and outline", async () => {
    const root = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n", "s.json": '{"a b": 1}' });
    const result = await runCli(["get", "s.json#a b"], env(root));
    expect(result).toEqual({ stdout: "1\n", stderr: "", exitCode: 0 });
    const outline = await runCli(["outline", "s.json#a b"], env(root));
    expect(outline).toEqual({ stdout: "s.json#a%20b  ~0 tok\n", stderr: "", exitCode: 0 });
  });

  test("gives every computed field but @nodes for --meta all, and @nodes when it is named too", async () => {
    const all = await vmdJson("get", "docs/guide.md#install", "--meta", "all");
    const fields = Object.keys((all.outcome.value as { meta: object }).meta);
    expect(fields).toEqual(["@path", "@at", "@address", "@key", "@anchors", "@version", "@source", "@issues", "@depth"]);
    const withNodes = await vmdJson("get", "docs/guide.md#install", "--meta", "all,@nodes");
    expect(Object.keys((withNodes.outcome.value as { meta: object }).meta)).toEqual([...fields, "@nodes"]);
  });
});
