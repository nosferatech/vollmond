/**
 * Gives the reason of a `storage-failed` message about the file at `path`: the message less the `cannot read <path>: ` that the
 * storage contract (`StorageReader`) starts it with, for a caller whose own message names the file already. A message in
 * another form, or one that names another path, is given whole, so that nothing it says is lost.
 */
export function storageFailureReason(message: string, path: string): string {
  const named = `cannot read ${path}: `;
  return message.startsWith(named) ? message.slice(named.length) : message;
}
