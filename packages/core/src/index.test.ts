import { expect, test } from "vitest";
import { CORE_PACKAGE_NAME } from "./index.js";

test("core exports its package name", () => {
  expect(CORE_PACKAGE_NAME).toBe("@vollmond/core");
});
