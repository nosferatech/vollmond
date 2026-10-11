import type { Outcome } from "@vollmond/core";

/** The exit codes of `vmd`. */
export const ExitCode = Object.freeze({
  /** The command did what was asked, with warnings at most. */
  ok: 0,
  /** The command failed, or a bug stopped it. */
  error: 1,
  /** The command line is not one `vmd` accepts. */
  usage: 2,
  /** A write found the store changed since it was read: re-read and retry. */
  conflict: 3,
  /** The command did what was asked, and found at least one issue of severity `error`. */
  validationFailed: 4,
});

/**
 * Gives the exit code of a command's outcome. A failure is {@link ExitCode.conflict} when one of its issues is a `conflict`, and
 * {@link ExitCode.error} otherwise. A success is {@link ExitCode.validationFailed} when one of its issues is an error, and
 * {@link ExitCode.ok} when they are warnings or there are none.
 */
export function exitCodeOf(outcome: Outcome<unknown>): number {
  if (!outcome.ok) return outcome.issues.some((issue) => issue.code === "conflict") ? ExitCode.conflict : ExitCode.error;
  return outcome.issues.some((issue) => issue.severity === "error") ? ExitCode.validationFailed : ExitCode.ok;
}
