import type { JsonObject } from "./json.js";

/** A value read from the suite or from the runner's options, or why it is invalid. */
export type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** A failed check with its reason. */
export function invalid(detail: string): { readonly ok: false; readonly detail: string } {
  return { ok: false, detail };
}

/** Returns why an object has members outside `known`, naming them as members of `where`, or `undefined` when it has none. */
export function unknownMembers(object: JsonObject, known: readonly string[], where: string): string | undefined {
  const unknown = Object.keys(object).filter((name) => !known.includes(name));
  return unknown.length === 0
    ? undefined
    : `${where} has the unknown member${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`;
}

/** Whether a value is an array of strings, none of them empty. */
export function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}
