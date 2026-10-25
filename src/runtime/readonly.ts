export type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

/** Freeze owned plain runtime data once, rather than clone it on every view read. */
export function freezeData<T>(value: T): DeepReadonly<T> {
  const seen = new WeakSet<object>();
  function visit(item: unknown) {
    if (!item || typeof item !== 'object' || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) visit(child);
    Object.freeze(item);
  }
  visit(value); return value as DeepReadonly<T>;
}
