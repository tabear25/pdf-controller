type AnyFn = (...args: unknown[]) => unknown;

function define(target: object, name: string, value: unknown): void {
  if (!(name in target)) Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

define(Promise, "try", (fn: AnyFn, ...args: unknown[]) => new Promise((resolve) => resolve(fn(...args))));

for (const proto of [Map.prototype, WeakMap.prototype] as object[]) {
  define(proto, "getOrInsert", function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  define(proto, "getOrInsertComputed", function (this: Map<unknown, unknown>, key: unknown, compute: AnyFn) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  });
}

define(Math, "sumPrecise", (values: Iterable<number>) => {
  let sum = 0;
  for (const v of values) sum += v;
  return sum;
});

define(Uint8Array.prototype, "toHex", function (this: Uint8Array) {
  return Buffer.from(this).toString("hex");
});
define(Uint8Array.prototype, "toBase64", function (this: Uint8Array) {
  return Buffer.from(this).toString("base64");
});
define(Uint8Array, "fromBase64", (text: string) => new Uint8Array(Buffer.from(text, "base64")));
define(Uint8Array, "fromHex", (text: string) => new Uint8Array(Buffer.from(text, "hex")));
