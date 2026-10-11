// The exit code counts the store's issues as the command's own. No configuration this vmd reads has an issue of severity
// error and still succeeds, so the reading of the configuration is replaced here by one that does.

import { makeIssue, succeed } from "@vollmond/core";
import { expect, test, vi } from "vitest";
import { runCli } from "./cli.js";
import { type Command, outcomeOutput } from "./command/command.js";
import { temporaryDirectory, writeFiles } from "./directories.testkit.js";

vi.mock("@vollmond/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@vollmond/core")>();
  return {
    ...core,
    readStoreConfiguration: () =>
      succeed(Object.freeze({ vmd: 1, declared: 1 }), [
        core.makeIssue({ code: "config-invalid", path: null, at: null, message: "an error the configuration still reads past" }),
      ]),
  };
});

const give: Command = {
  name: "give",
  usage: "",
  summary: "gives 1",
  options: {},
  readsStore: true,
  run: async () =>
    outcomeOutput(succeed(1, [makeIssue({ code: "heading-html", path: "a.md", at: "/h", message: "m" })]), () => "1\n"),
};

test("a success whose only error is the configuration's exits with 4, with and without --json", async () => {
  const cwd = writeFiles(temporaryDirectory(), { ".vmd/config.yaml": "vmd: 1\n" });
  const env = { cwd, commands: [give], unicodeProbe: () => ({ version: "17.0.0", agrees: true, failures: [] }) };
  const text = await runCli(["give"], env);
  expect(text.exitCode).toBe(4);
  expect(text.stderr).toMatch(/^\.vmd\/config\.yaml error config-invalid: an error the configuration still reads past\n/);
  const json = await runCli(["give", "--json"], env);
  expect(json.exitCode).toBe(4);
  expect(JSON.parse(String(json.stdout)).issues.map((issue: { code: string }) => issue.code)).toEqual([
    "config-invalid",
    "heading-html",
  ]);
});
