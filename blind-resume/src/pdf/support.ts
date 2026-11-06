interface FeatureCheck {
  readonly name: string;
  readonly ok: () => boolean;
}

const FEATURES: readonly FeatureCheck[] = [
  { name: "Promise.try", ok: () => typeof (Promise as { try?: unknown }).try === "function" },
  { name: "Promise.withResolvers", ok: () => typeof Promise.withResolvers === "function" },
  { name: "Map.prototype.getOrInsertComputed", ok: () => typeof (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed === "function" },
  { name: "Math.sumPrecise", ok: () => typeof (Math as { sumPrecise?: unknown }).sumPrecise === "function" },
  { name: "Uint8Array.prototype.toHex", ok: () => typeof (Uint8Array.prototype as { toHex?: unknown }).toHex === "function" },
  { name: "Uint8Array.fromBase64", ok: () => typeof (Uint8Array as { fromBase64?: unknown }).fromBase64 === "function" },
  { name: "Float16Array", ok: () => typeof (globalThis as { Float16Array?: unknown }).Float16Array === "function" },
  { name: "WebAssembly", ok: () => typeof WebAssembly === "object" },
  { name: "Worker", ok: () => typeof Worker === "function" },
];

export function missingBrowserFeatures(): string[] {
  return FEATURES.filter((f) => {
    try {
      return !f.ok();
    } catch {
      return true;
    }
  }).map((f) => f.name);
}
