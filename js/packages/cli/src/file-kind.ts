// What kind of file a path names, in words, for the messages of the readers that refuse anything but a regular file.

/** The type tests of a file's status, as `stat` and `lstat` give them. */
export interface FileKindInfo {
  isDirectory(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isCharacterDevice(): boolean;
  isBlockDevice(): boolean;
}

/** Says what kind of file `info` describes, as "a directory" or "a FIFO"; "a special file" when no test says. */
export function describeKind(info: FileKindInfo): string {
  if (info.isDirectory()) return "a directory";
  if (info.isFIFO()) return "a FIFO";
  if (info.isSocket()) return "a socket";
  if (info.isCharacterDevice() || info.isBlockDevice()) return "a device";
  return "a special file";
}
