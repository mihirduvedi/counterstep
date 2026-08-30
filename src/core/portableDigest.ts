/**
 * Browser-safe SHA-256 for trace intake. Keeping this in a separate module
 * prevents the client receipt pipeline from importing Node's crypto package.
 */
export async function sha256HexPortable(bytes: Uint8Array): Promise<string> {
  const snapshot = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    snapshot.buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
