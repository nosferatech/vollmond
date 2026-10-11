/**
 * A value of the value view: the JSON data model restricted as I-JSON (RFC 7493) restricts it, except that noncharacters are
 * allowed. Numbers are finite doubles, strings are well formed, and member names are unique.
 */
export type Value = null | boolean | number | string | readonly Value[] | ValueObject;

/**
 * An object of the value view. Objects that vmd creates have a null prototype ({@link createValueObject}), so a member named
 * `__proto__` is an ordinary member. Member order carries no meaning; the source order of a parsed record's members is in its
 * `NodeIndex`, since JavaScript lists integer-like names first.
 */
export interface ValueObject {
  readonly [name: string]: Value;
}

/** A value object under construction, for parsers. */
export interface MutableValueObject {
  [name: string]: Value;
}

/** Creates an empty object with a null prototype, so that `object["__proto__"] = v` adds an ordinary member. */
export function createValueObject(): MutableValueObject {
  return Object.create(null) as MutableValueObject;
}

/** Whether `object` has an own member named `name`, whatever its prototype. */
export function hasMember(object: ValueObject, name: string): boolean {
  return Object.hasOwn(object, name);
}

/**
 * Whether `value` is in the data model: null, a boolean, a finite number, a well-formed string, a plain array of values with
 * no holes, or an object whose prototype is `Object.prototype` or null and whose own enumerable string-keyed members are
 * values. Symbol-keyed members, accessors, and instances of other classes (`Date`, `Map`, typed arrays) are not data.
 */
export function isValue(value: unknown): value is Value {
  switch (typeof value) {
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "string":
      return value.isWellFormed();
    case "object":
      if (value === null) return true;
      if (Array.isArray(value)) return isValueArray(value);
      return isValueObject(value);
    default:
      return false;
  }
}

function isValueArray(array: readonly unknown[]): boolean {
  if (Object.getPrototypeOf(array) !== Array.prototype) return false;
  // An index loop, not `every`, which skips holes: a hole reads as `undefined`, which is not a value.
  for (let i = 0; i < array.length; i++) {
    if (!isValue(array[i])) return false;
  }
  return true;
}

function isValueObject(object: object): boolean {
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(object).length > 0) return false;
  for (const name of Object.getOwnPropertyNames(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
    if (!name.isWellFormed() || !isValue(descriptor.value)) return false;
  }
  return true;
}

/**
 * Whether two values are equal as JSON values, the equality that round trips are held to: numbers by value, so `-0` equals
 * `0`; arrays in order; objects by their members, regardless of member order.
 */
export function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i] as Value, b[i] as Value)) return false;
    }
    return true;
  }
  const objectA = a as ValueObject;
  const objectB = b as ValueObject;
  const names = Object.keys(objectA);
  if (names.length !== Object.keys(objectB).length) return false;
  for (const name of names) {
    if (!Object.hasOwn(objectB, name) || !valuesEqual(objectA[name] as Value, objectB[name] as Value)) return false;
  }
  return true;
}
