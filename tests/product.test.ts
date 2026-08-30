import { describe, expect, it } from "vitest";

import {
  PRODUCT_NAME,
  RECEIPT_SCHEMA_VERSION,
  qualifyVerdict,
} from "../src/core/product";

describe("product foundation", () => {
  it("keeps a versioned receipt contract", () => {
    expect(PRODUCT_NAME).toBe("Agent Receipt");
    expect(RECEIPT_SCHEMA_VERSION).toBe("agent-receipt.receipt.v1");
  });

  it("qualifies every verdict against supplied evidence", () => {
    expect(qualifyVerdict("within_declared_authority")).toBe(
      "Within declared authority. Based on the supplied trace and authority envelope.",
    );
  });
});
