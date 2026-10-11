import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type ConfigurationSource,
  fail,
  MAX_CONFIGURATION_BYTES,
  MAX_SCHEMA_BYTES,
  makeIssue,
  type Outcome,
  succeed,
} from "@vollmond/core";

/** What reading a configuration file gave: its bytes, or why there are none. */
export type ConfigurationFileReading =
  | { readonly kind: "read"; readonly content: Uint8Array }
  /** No file has the path, or the filesystem cannot read it: `reason` says which, for the user. */
  | { readonly kind: "unreadable"; readonly reason: string }
  /** The path names something that cannot be a configuration: `reason` says what, after "the configuration". */
  | { readonly kind: "invalid"; readonly reason: string };

/** What reading a bounded file gave: its bytes, no file, or why it could not be read. */
type BoundedFileReading =
  | { readonly kind: "read"; readonly content: Uint8Array }
  | { readonly kind: "missing" }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Reads a configuration file, which must be a regular file. The file is opened without blocking and checked before anything is
 * read, so a FIFO, a socket, a device or a directory is refused at once rather than waited on. At most one byte more than
 * {@link MAX_CONFIGURATION_BYTES} is read, whatever the file holds or grows to, so that `readStoreConfiguration` refuses a
 * larger file without vmd reading all of it.
 */
export async function readConfigurationFile(path: string): Promise<ConfigurationFileReading> {
  const reading = await readBoundedFile(path, MAX_CONFIGURATION_BYTES);
  return reading.kind === "missing" ? { kind: "unreadable", reason: "it does not exist" } : reading;
}

/**
 * Gives the configuration source of a configuration file that has been read: its bytes, and the `schema/` directory beside
 * the file, from which each schema is read as {@link readConfigurationFile} reads the configuration, at most one byte more
 * than `MAX_SCHEMA_BYTES`. A schema that does not exist fails with `address-not-found`; one that cannot be read, or is not a
 * regular file, with `storage-failed`.
 */
export function configurationFileSource(file: string, name: string, content: Uint8Array): ConfigurationSource {
  const directory = join(dirname(file), "schema");
  return {
    content,
    name,
    readSchema: async (path): Promise<Outcome<Uint8Array>> => {
      const shown = `schema/${path}`;
      const reading = await readBoundedFile(join(directory, ...path.split("/")), MAX_SCHEMA_BYTES);
      if (reading.kind === "read") return succeed(reading.content);
      if (reading.kind === "missing") {
        return fail([makeIssue({ code: "address-not-found", path: null, at: null, message: `${shown} does not exist` })]);
      }
      const message = reading.kind === "invalid" ? `${shown} ${reading.reason}` : `cannot read ${shown}: ${reading.reason}`;
      return fail([makeIssue({ code: "storage-failed", path: null, at: null, message })]);
    },
  };
}

/**
 * Reads a regular file, opened without blocking and checked before anything is read, and at most `maxBytes` and one byte more
 * of it, so that a caller can tell a larger file without reading all of it.
 */
async function readBoundedFile(path: string, maxBytes: number): Promise<BoundedFileReading> {
  // The path is checked first since a socket cannot be opened at all; the open file is checked again, in case it changed.
  try {
    const info = await stat(path);
    if (!info.isFile()) return { kind: "invalid", reason: `is ${describeKind(info)}, not a regular file` };
  } catch (error) {
    return failedReading(error);
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return failedReading(error);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { kind: "invalid", reason: `is ${describeKind(info)}, not a regular file` };
    const buffer = new Uint8Array(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return { kind: "read", content: buffer.slice(0, length) };
  } catch (error) {
    return failedReading(error);
  } finally {
    await handle.close();
  }
}

/** The reading of a file that the filesystem could not read: missing for a path that names nothing. */
function failedReading(error: unknown): BoundedFileReading {
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === "ENOTDIR") return { kind: "missing" };
  return { kind: "unreadable", reason: describeError(error) };
}

/** Says what kind of file `info` describes, as "a directory" or "a FIFO". */
function describeKind(info: {
  isDirectory(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isCharacterDevice(): boolean;
  isBlockDevice(): boolean;
}): string {
  if (info.isDirectory()) return "a directory";
  if (info.isFIFO()) return "a FIFO";
  if (info.isSocket()) return "a socket";
  if (info.isCharacterDevice() || info.isBlockDevice()) return "a device";
  return "a special file";
}

/** Says why a file could not be read, for the user. */
function describeError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === "EISDIR") return "it is a directory";
  return typeof code === "string" ? code : String(error);
}
