// Git for the tests: temporary repositories, and git kept from the user's own configuration, in the tests' git and in vmd's.

import { execFileSync } from "node:child_process";
import { afterAll, beforeAll } from "vitest";
import { temporaryDirectory, writeFiles } from "./directories.testkit.js";

/** The variables that keep git from reading the user's and the system's configuration. */
const ISOLATION: Readonly<Record<string, string>> = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/**
 * Sets the variables that keep git from the user's and the system's configuration in this process for the test file, so that
 * the git that vmd runs reads only the repository's own; restores them after.
 */
export function isolateGit(): void {
  const saved = new Map<string, string | undefined>();
  beforeAll(() => {
    for (const [name, value] of Object.entries(ISOLATION)) {
      saved.set(name, process.env[name]);
      process.env[name] = value;
    }
  });
  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/** This process's environment without git's variables, and with git kept from the user's and the system's configuration. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith("GIT_")) delete environment[name];
  return { ...environment, ...ISOLATION };
}

/** Runs git in `directory`, with an identity for commits and no signing, and gives its output. */
export function git(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", directory, "-c", "user.name=vmd", "-c", "user.email=vmd@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", env: gitEnvironment() },
  );
}

/** Creates a repository holding `files`, committed, and returns its root. */
export function repository(files: Readonly<Record<string, string>>): string {
  const root = writeFiles(temporaryDirectory(), files);
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return root;
}
