/**
 * Computes a short SHA-256 fingerprint for sync comparisons.
 *
 * @param content Source content to hash.
 * @returns The first 16 hex characters of the SHA-256 digest.
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
