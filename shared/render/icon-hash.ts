// Which chunk file of an icon set holds an icon. Shared by scripts/build-icons.mjs (writes the chunks) and
// icon-registry.ts (loads them), so the two always agree.

/** FNV-1a 32-bit hash of `key`, modulo `chunks`. */
export function packChunk(key: string, chunks: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % chunks;
}
