import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { MAX_CONFIGURATION_BYTES } from "@vollmond/core";

/** What reading a configuration file gave: its bytes, or why there are none. */
export type ConfigurationFileReading =
  | { readonly kind: "read"; readonly content: Uint8Array }
  /** No file has the path, or the filesystem cannot read it: `reason` says which, for the user. */
  | { readonly kind: "unreadable"; readonly reason: string }
  /** The path names something that cannot be a configuration: `reason` says what, after "the configuration". */
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * Reads a configuration file, which must be a regular file. The file is opened without blocking and checked before anything is
 * read, so a FIFO, a socket, a device or a directory is refused at once rather than waited on. At most one byte more than
 * {@link MAX_CONFIGURATION_BYTES} is read, whatever the file holds or grows to, so that `readStoreConfiguration` refuses a
 * larger file without vmd reading all of it.
 */
export async function readConfigurationFile(path: string): Promise<ConfigurationFileReading> {
  // The path is checked first since a socket cannot be opened at all; the open file is checked again, in case it changed.
  try {
    const info = await stat(path);
    if (!info.isFile()) return { kind: "invalid", reason: `is ${describeKind(info)}, not a regular file` };
  } catch (error) {
    return { kind: "unreadable", reason: describeError(error) };
  }
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    return { kind: "unreadable", reason: describeError(error) };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { kind: "invalid", reason: `is ${describeKind(info)}, not a regular file` };
    const buffer = new Uint8Array(MAX_CONFIGURATION_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return { kind: "read", content: buffer.slice(0, length) };
  } catch (error) {
    return { kind: "unreadable", reason: describeError(error) };
  } finally {
    await handle.close();
  }
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
  if (code === "ENOENT") return "it does not exist";
  if (code === "EISDIR") return "it is a directory";
  return typeof code === "string" ? code : String(error);
}
