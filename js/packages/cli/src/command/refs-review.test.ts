// `vmd refs`: the records it could not read, the whole result's exit code, aliases, cursors, context lines and the JSON form.

import { describe, expect, test } from "vitest";
import { type CliEnvironment, runCli } from "../cli.js";
import { temporaryDirectory, writeFiles } from "../directories.testkit.js";

const FILES: Record<string, string> = {
  ".vmd/config.yaml": "vmd: 1\n",
  "a.md": '# A\n\n## Intro <a id="intro"></a>\n\nText.\n\n- <a id="step"></a>First step.\n',
  "b.md": "# B\n\n[1](a.md#intro)\n\n## Later\n\n[2](a.md#missing) [3](a.md#step)\n",
  "c.md": "# C\n\n[4](a.md) [7](a.md#step)\n",
  "docs/d.md": "# D\n\n[5](../a.md#intro) [6](./)\n",
};

function env(root: string): Partial<CliEnvironment> {
  return { cwd: root, unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
}

async function vmd(root: string, ...args: string[]) {
  const result = await runCli(args, env(root));
  return { ...result, stdout: String(result.stdout) };
}

/** The raw targets of the reference lines of a text output, in order. */
function raws(text: string): string[] {
  return [...text.matchAll(/^ {2}#\S* +\S+ +(\S+)/gm)].map((match) => match[1] as string);
}

describe("refs and the records it cannot read", () => {
  test("counts the records it left out, so that none vanishes silently, and gives the count in the JSON", async () => {
    const root = writeFiles(temporaryDirectory(), { ...FILES, "broken.json": "{" });
    const result = await vmd(root, "refs", "a.md#intro");
    expect(result.stdout).toContain("\n1 record could not be read\n");
    const json = JSON.parse((await vmd(root, "--json", "refs", "a.md#intro")).stdout);
    expect(json.value.unreadable).toEqual({ count: 1, schemas: [] });
  });

  test("names a collection whose schema cannot be used, with its issue, rather than say 0 references alone", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ...FILES,
      ".vmd/config.yaml": 'vmd: 1\ncollections:\n  notes:\n    match: ["n/*.md"]\n    schema: note.schema.json\n',
      ".vmd/schema/note.schema.json": '{"type": 5}',
      "n/one.md": "# One\n\n[x](../a.md)\n",
      "n/two.md": "# Two\n",
    });
    const result = await vmd(root, "refs", "a.md#step");
    expect(result.stdout).toContain("\n2 records could not be read: 2 of the collection notes, whose schema cannot be used\n");
    expect(result.stdout).toMatch(/\nerror schema-invalid: the schema note\.schema\.json of the collection notes /);
    expect(result.exitCode).toBe(4);
    const json = JSON.parse((await vmd(root, "--json", "refs", "a.md#step")).stdout);
    expect(json.value.unreadable).toEqual({ count: 2, schemas: [{ collection: "notes", count: 2 }] });
  });
});

describe("refs over the whole result", () => {
  test("exits with 4 when any listed reference has an error, on another page too, and prints its issue", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    const first = await vmd(root, "refs", "a.md", "-n", "1");
    expect(first.exitCode).toBe(4);
    expect(first.stdout).toMatch(/\nb\.md:7:5 error ref-dangling: /);
  });

  test("names the citing node of an issue by its semantic path, as check does", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    expect((await vmd(root, "refs", "a.md")).stdout).toContain("  in   #later/$body  (exact #/$sections/0/$body)\n");
  });

  test("gives the citing node's canonical address in the JSON, and a block target's range as [start, end]", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    const json = JSON.parse((await vmd(root, "--json", "refs", "--from", "b.md#later")).stdout);
    expect(json.value.items.map((item: { from: { address: string } }) => item.from.address)).toEqual([
      "#later/$body",
      "#later/$body",
    ]);
    expect(json.value.items[1].targets[0].range).toEqual([expect.any(Number), expect.any(Number)]);
  });
});

describe("what refs --to names", () => {
  test("lists the same for a record with an empty fragment as for the record", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    expect(raws((await vmd(root, "refs", "a.md#")).stdout)).toEqual(raws((await vmd(root, "refs", "a.md")).stdout));
  });

  test("resolves a link's URI against the citing record's path, a dangling one included", async () => {
    const root = writeFiles(temporaryDirectory(), { ...FILES, "docs/e.md": "# E\n\n[g](../gone.md)\n" });
    expect(raws((await vmd(root, "refs", "a.md")).stdout)).toContain("../a.md#intro");
    expect(raws((await vmd(root, "refs", "gone.md")).stdout)).toEqual(["../gone.md"]);
  });

  test("lists the links to a directory, one where nothing is included, and not the links below it", async () => {
    const root = writeFiles(temporaryDirectory(), { ...FILES, "e.md": "# E\n\n[g](gone/) [d](docs/d.md)\n" });
    expect(raws((await vmd(root, "refs", "gone")).stdout)).toEqual(["gone/"]);
    expect(raws((await vmd(root, "refs", "docs")).stdout)).toEqual(["./"]);
  });

  test("follows a record alias from an old path, with a fragment, as a link through it does", async () => {
    const alias = `${JSON.stringify({ kind: "record", from: "olda.md", to: "a.md", at: "2026-10-09T08:00:00Z" })}\n`;
    const root = writeFiles(temporaryDirectory(), { ...FILES, ".vmd/aliases.jsonl": alias });
    const result = await vmd(root, "refs", "olda.md#intro");
    expect(result.exitCode).toBe(0);
    expect(raws(result.stdout)).toEqual(raws((await vmd(root, "refs", "a.md#intro")).stdout));
  });

  test("fails with address-ambiguous for an address that matches several nodes, as get does, with the candidates", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": "vmd: 1\n",
      "a.md": "# A\n\n## Twice\n\none\n\n## Twice\n\ntwo\n",
      "b.md": "# B\n\n[x](a.md#twice-1)\n",
    });
    const result = await vmd(root, "refs", "a.md#twice");
    expect(result.stderr).toMatch(/^a\.md error address-ambiguous: /);
    expect(result.stderr).toMatch(/\n {2}candidates {2}#\/\$sections\/0 \(line 3, derived #twice\)\n/);
    expect(result.stderr).toContain("  hint use the address of the candidate you mean");
    expect(result.exitCode).toBe(1);
    // The same failure as get's, word for word.
    expect(result.stderr).toBe((await vmd(root, "get", "a.md#twice")).stderr);
  });

  test("does not take a sibling whose exact path starts with the node's for a node below it", async () => {
    const sections = Array.from({ length: 11 }, (_, index) => `## S${index}\n\nText.\n`).join("\n");
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": "vmd: 1\n",
      "s.md": `# S\n\n${sections}`,
      "r.md": "# R\n\n[ten](s.md#s10)\n",
    });
    expect((await vmd(root, "refs", "s.md#/$sections/1")).stdout).toMatch(/ {2}0 references\n/);
    expect((await vmd(root, "refs", "s.md#/$sections/10")).stdout).toMatch(/ {2}1 reference\n/);
  });
});

describe("refs' cursor and context", () => {
  test("pages through every reference one at a time, in the order of the whole listing", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    const all = raws((await vmd(root, "refs", "a.md")).stdout);
    const paged: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await vmd(root, "refs", "a.md", "-n", "1", ...(cursor === undefined ? [] : ["--cursor", cursor]));
      paged.push(...raws(result.stdout));
      cursor = /--cursor (\S+)\)\n/.exec(result.stdout)?.[1];
      if (cursor === undefined) break;
    }
    expect(paged).toEqual(all);
  });

  test("resumes after the cursor's record when that record no longer has its reference", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    const first = await vmd(root, "refs", "a.md", "-n", "3");
    const cursor = /--cursor (\S+)\)\n/.exec(first.stdout)?.[1] as string;
    writeFiles(root, { "b.md": "# B\n\nNo links now.\n" });
    expect(raws((await vmd(root, "refs", "a.md", "--cursor", cursor)).stdout)).toEqual(["a.md", "a.md#step", "../a.md#intro"]);
  });

  test("prints context lines without a byte order mark, split at lone carriage returns, and escaped", async () => {
    const root = writeFiles(temporaryDirectory(), {
      ".vmd/config.yaml": "vmd: 1\n",
      "a.md": "# A\n",
      "b.md": "\uFEFF# B\r\r[x](a.md) \u001b[31m\r",
    });
    const result = await vmd(root, "refs", "a.md", "--context", "2");
    expect(result.stdout).toContain("      1  # B\n      2  \n      3  [x](a.md) \\u001b[31m\n");
  });

  test("writes a directory target with its slash", async () => {
    const root = writeFiles(temporaryDirectory(), FILES);
    expect((await vmd(root, "refs", "--from", "docs/d.md")).stdout).toMatch(/ +-> docs\/\n/);
  });
});
