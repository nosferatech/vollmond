import {
  type ConfigurationSource,
  createMemoryStorage,
  fail,
  makeIssue,
  type Outcome,
  openStore,
  type Store,
  succeed,
} from "@vollmond/core";
import type { FixtureStore } from "../operation.js";

/** The configuration a fixture store holds, and the directory of its schemas, both in `.vmd/`. */
const CONFIGURATION_PATH = ".vmd/config.yaml";
const SCHEMA_DIRECTORY = ".vmd/schema";

/**
 * Opens a case's store through core's `openStore`, over a memory backend that holds every file of the store: with the
 * configuration file the case names in place of `.vmd/config.yaml`, as `--config` does, and with the schemas in
 * `.vmd/schema/`, the directory beside either. Fails as `openStore` does, with `config-invalid` for a store given without one.
 */
export async function openCaseStore(fixture: FixtureStore | undefined): Promise<Outcome<Store>> {
  const files = fixture?.files ?? new Map<string, Uint8Array>();
  const content = fixture?.config ?? files.get(CONFIGURATION_PATH);
  if (content === undefined) {
    return fail([makeIssue({ code: "config-invalid", path: null, at: null, message: `the store has no ${CONFIGURATION_PATH}` })]);
  }
  const configuration: ConfigurationSource = {
    content,
    name: CONFIGURATION_PATH,
    readSchema: async (path) => {
      const schema = files.get(`${SCHEMA_DIRECTORY}/${path}`);
      return schema === undefined
        ? fail([
            makeIssue({ code: "address-not-found", path: null, at: null, message: `${SCHEMA_DIRECTORY}/${path} does not exist` }),
          ])
        : succeed(schema);
    },
  };
  return openStore(createMemoryStorage({ files: Object.fromEntries(files) }), { configuration });
}
