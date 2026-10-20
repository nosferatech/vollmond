// `vmd refs ADDR [--to | --from] [--context N] [-n N] [--cursor C]`: the references into a node, or made in it, grouped by
// the record that makes them, a page at a time, then their issues.

import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";
import { checkStoreFiles } from "./check-store.testkit.js";

const FILES: Record<string, string> = {
  ".vmd/config.yaml": "vmd: 1\n",
  "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText.\n\n### Deep <a id="deep"></a>\n\n- <a id="step"></a>First step.\n',
  "b.md": "# B\n\n[1](a.md#intro) [2](a.md#deep)\n\n## Later\n\n[3](a.md) [4](a.md#missing) [5](a.md#step)\n",
  "c.md": "# C\n\n[6](a.md#intro)\n",
  "d.md": "# D\n\n[7](gone.md) [8](img.png) [9](b.md#later)\n",
  "img.png": "x",
};

function env(root: string): Partial<CliEnvironment> {
  return { cwd: root, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

async function vmd(root: string, ...args: string[]) {
  const result = await runCli(args, env(root));
  return { ...result, stdout: String(result.stdout) };
}

const ROOT = writeFiles(temporaryDirectory(), FILES);

describe("refs --to, the default", () => {
  test("lists the references into a section and below it, grouped by citing record, with their status", async () => {
    const result = await vmd(ROOT, "refs", "a.md#intro");
    expect(result.stdout).toBe(
      "a.md#intro  4 references\n" +
        "b.md\n" +
        "  #$body:3:5         ok  a.md#intro\n" +
        "  #$body:3:21        ok  a.md#deep\n" +
        "  #later/$body:7:33  ok  a.md#step\n" +
        "c.md\n" +
        "  #$body:3:5  ok  a.md#intro\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect((await vmd(ROOT, "refs", "--to", "a.md#intro")).stdout).toBe(result.stdout);
  });

  test("lists every reference that names a record, dangling ones included, then their issues, exit 4", async () => {
    const result = await vmd(ROOT, "refs", "a.md");
    expect(result.stdout).toMatch(/^a\.md {2}6 references\n/);
    expect(result.stdout).toMatch(/ {2}#later\/\$body:7:15 +dangling {2}a\.md#missing\n/);
    expect(result.stdout).toMatch(/\nb\.md:7:15 error ref-dangling: "a\.md#missing": /);
    expect(result.exitCode).toBe(4);
  });

  test("lists the references to a block anchor, an asset and a path where nothing is", async () => {
    expect((await vmd(ROOT, "refs", "a.md#step")).stdout).toMatch(/^a\.md#step {2}1 reference\nb\.md\n/);
    expect((await vmd(ROOT, "refs", "img.png")).stdout).toMatch(
      /^img\.png {2}1 reference\nd\.md\n {2}#\$body:3:\d+ +ok {2}img\.png\n$/,
    );
    const gone = await vmd(ROOT, "refs", "gone.md");
    expect(gone.stdout).toMatch(/^gone\.md {2}1 reference\nd\.md\n {2}#\$body:3:5 +dangling {2}gone\.md\n/);
  });

  test("says so when nothing refers to the node", async () => {
    expect(await vmd(ROOT, "refs", "c.md")).toEqual({ stdout: "c.md  0 references\n", stderr: "", exitCode: 0 });
  });

  test("fails as resolving does for an address that names nothing", async () => {
    const result = await vmd(ROOT, "refs", "a.md#nothing");
    expect(result.stderr).toMatch(/error address-not-found: /);
    expect(result.exitCode).toBe(1);
  });
});

describe("refs --from", () => {
  test("lists the references made in a node and below it, with the address each resolves to", async () => {
    const result = await vmd(ROOT, "refs", "--from", "b.md#later");
    expect(result.stdout).toMatch(
      /^b\.md#later {2}3 references\nb\.md\n {2}#later\/\$body:7:5 +ok +a\.md +-> a\.md\n {2}#later\/\$body:7:15 +dangling +a\.md#missing\n {2}#later\/\$body:7:33 +ok +a\.md#step +-> a\.md#step\n/,
    );
  });

  test("refuses --to with --from", async () => {
    const result = await vmd(ROOT, "refs", "--to", "--from", "b.md");
    expect(result.stderr).toMatch(/^error usage-invalid: --to and --from cannot be given together/);
    expect(result.exitCode).toBe(2);
  });
});

describe("refs' paging, context and output", () => {
  test("prints at most -n references, then the cursor that continues after them", async () => {
    const first = await vmd(ROOT, "refs", "a.md", "-n", "4");
    expect(first.stdout.split("\n").filter((line) => line.startsWith("  #"))).toHaveLength(4);
    const cursor = /… 2 more \(--cursor (\S+)\)\n/.exec(first.stdout)?.[1] as string;
    expect(cursor).toBeDefined();
    const next = await vmd(ROOT, "refs", "a.md", "-n", "4", "--cursor", cursor.replace(/^'|'$/g, ""));
    expect(next.stdout).toMatch(/^a\.md {2}6 references\nb\.md\n {2}#later\/\$body:7:33 +ok {2}a\.md#step\nc\.md\n/);
    expect(next.stdout).not.toContain("more (--cursor");
  });

  test("refuses a cursor it did not give", async () => {
    const result = await vmd(ROOT, "refs", "a.md", "--cursor", "nonsense");
    expect(result.stderr).toMatch(/^error usage-invalid: /);
    expect(result.exitCode).toBe(2);
  });

  test("prints N lines of the citing file around each reference with --context N", async () => {
    const result = await vmd(ROOT, "refs", "a.md#step", "--context", "1");
    expect(result.stdout).toBe(
      "a.md#step  1 reference\nb.md\n  #later/$body:7:33  ok  a.md#step\n      6  \n      7  [3](a.md) [4](a.md#missing) [5](a.md#step)\n",
    );
  });

  test("gives the references and the cursor under --json, with every issue", async () => {
    const result = await vmd(ROOT, "--json", "refs", "a.md", "-n", "2");
    const outcome = JSON.parse(result.stdout);
    expect(outcome.value.items).toHaveLength(2);
    expect(outcome.value.items[0]).toMatchObject({ raw: "a.md#intro", status: "ok", from: { path: "b.md", at: "/$body" } });
    expect(outcome.value.items[0].destination).toEqual([expect.any(Number), expect.any(Number)]);
    expect(outcome.value.remaining).toEqual({ count: 4, exact: true });
    expect(typeof outcome.value.cursor).toBe("string");
  });

  test("gives the references' issues the severities the configuration gives them", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    expect((await vmd(root, "refs", "b.md#later")).stdout).toMatch(/warning ref-derived-anchor: /);
    writeFiles(root, { ".vmd/config.yaml": "vmd: 1\nissues:\n  ref-derived-anchor: off\n" });
    expect((await vmd(root, "refs", "b.md#later")).stdout).not.toContain("ref-derived-anchor");
  });
});

describe("refs in the strict read mode", () => {
  test("leaves out the references of a record it refuses and reports it as an error; lists those into it", async () => {
    const root = writeFiles(temporaryDirectory(), checkStoreFiles());
    const plain = await vmd(root, "refs", "a.md");
    expect(plain.stdout).toMatch(/^a\.md {2}3 references\n/);
    const strict = await vmd(root, "--strict", "refs", "a.md");
    expect(strict.stdout).toMatch(/^a\.md {2}2 references\n/);
    expect(strict.stdout).toMatch(/\ntasks\/t\.json:1:2 error schema-violation: /);
    expect(strict.exitCode).toBe(4);
    const from = await vmd(root, "--strict", "refs", "--from", "tasks/t.json");
    expect(from.stderr).toMatch(/error schema-violation: /);
    expect(from.exitCode).toBe(1);
    // The references into the refused record are listed, none here; the record is still reported as one the listing left out.
    const into = await vmd(root, "--strict", "refs", "--to", "tasks/t.json");
    expect(into.stdout).toMatch(/^tasks\/t\.json {2}0 references\ntasks\/t\.json:1:2 error schema-violation: /);
  });
});
