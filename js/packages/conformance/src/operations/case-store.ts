import {
  createMemoryStorage,
  fail,
  makeIssue,
  type Outcome,
  openStore,
  type Store,
  storeConfigurationSource,
} from "@vollmond/core";
import type { FixtureStore } from "../operation.js";

/** The configuration a fixture store holds in `.vmd/`. */
const CONFIGURATION_PATH = ".vmd/config.yaml";

/**
 * Opens a case's store through core's `openStore`, over a memory backend that holds every file of the store: with the
 * configuration file the case names in place of `.vmd/config.yaml`, as `--config` does, and with the schemas in
 * `.vmd/schema/`, the directory beside either, read through the backend as core reads a store's own schemas. Fails as
 * `openStore` does, with `config-invalid` for a store given without a configuration.
 */
export async function openCaseStore(fixture: FixtureStore | undefined): Promise<Outcome<Store>> {
  const files = fixture?.files ?? new Map<string, Uint8Array>();
  const content = fixture?.config ?? files.get(CONFIGURATION_PATH);
  if (content === undefined) {
    return fail([makeIssue({ code: "config-invalid", path: null, at: null, message: `the store has no ${CONFIGURATION_PATH}` })]);
  }
  const backend = createMemoryStorage({ files: Object.fromEntries(files) });
  return openStore(backend, { configuration: storeConfigurationSource(backend, content) });
}
