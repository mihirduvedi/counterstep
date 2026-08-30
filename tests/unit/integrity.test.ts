import { describe, it, expect } from "vitest";
import {
  sha256Hex,
  sha256HexFromString,
} from "../../src/core/integrity.js";

describe("sha256 integrity", () => {
  it("produces a 64-char hex string", () => {
    const digest = sha256HexFromString("hello world");
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is identical for identical bytes", () => {
    const a = sha256HexFromString("Agent Receipt");
    const b = sha256HexFromString("Agent Receipt");
    expect(a).toBe(b);
  });

  it("changes when bytes change", () => {
    const a = sha256HexFromString("hello");
    const b = sha256HexFromString("hello ");
    expect(a).not.toBe(b);
  });

  it("matches well-known SHA-256 for empty string", () => {
    // SHA-256("") = e3b0c44298fc1c149afb...
    const digest = sha256HexFromString("");
    expect(digest).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("Uint8Array overload matches string overload for same UTF-8 bytes", () => {
    const str = "Agent Receipt 🤖";
    const bytes = new TextEncoder().encode(str);
    const fromStr = sha256HexFromString(str);
    const fromBytes = sha256Hex(bytes);
    expect(fromBytes).toBe(fromStr);
  });

  it("is computed before parsing — raw bytes hash is independent of JSON structure", () => {
    // Same semantic JSON, different whitespace = different hash
    const compact = JSON.stringify({ foo: 1 });
    const pretty = JSON.stringify({ foo: 1 }, null, 2);
    expect(sha256HexFromString(compact)).not.toBe(sha256HexFromString(pretty));
  });
});
