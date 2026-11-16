// The picture each document diagram showed last, so a view that is built again (the document was re-read) still
// animates from what the user saw instead of popping to the new drawing (E520). Keyed by file path as well as block
// id and theme: two files can hold the same block id, and one must never morph from the other's picture (#557).

const MAX = 100;

export function createShownMemory<T>() {
  const map = new Map<string, T>();
  const keyOf = (path: string, blockId: string, theme: string) => `${path}\n${blockId}\n${theme}`;
  return {
    keyOf,
    get: (key: string) => map.get(key),
    set(key: string, pic: T) {
      map.delete(key);
      map.set(key, pic);
      if (map.size > MAX) map.delete(map.keys().next().value!);
    },
    get size() {
      return map.size;
    },
  };
}
