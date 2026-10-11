import type { OperationAdapter } from "../operation.js";
import { openCaseStore } from "./case-store.js";
import { compared } from "./parse.js";

/**
 * The `check` operation: every issue core's `Store.check` reports for the case's store, or for the records `records` names.
 * A check never fails in the suite, since its issues are its whole outcome: a configuration that cannot be read, and so a store
 * that cannot be opened, gives its issues as the check's, and so does a store that cannot be listed.
 */
export const checkOperation: OperationAdapter = {
  validate: (input) => {
    const { records } = input;
    if (records === undefined) return undefined;
    return Array.isArray(records) && records.every((path) => typeof path === "string")
      ? undefined
      : "input.records must be a list of store paths";
  },
  run: async (input, { store }) => {
    const opened = await openCaseStore(store);
    if (!opened.ok) return { ok: true, issues: opened.issues.map(compared) };
    const records = input.records as string[] | undefined;
    const checked = await opened.value.check(records === undefined ? {} : { records });
    return { ok: true, issues: [...opened.issues, ...checked.issues].map(compared) };
  },
};
