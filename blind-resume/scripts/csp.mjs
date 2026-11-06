export const TRUSTED_TYPES_POLICY = "blind-resume-worker";

export function buildCsp({ scriptHashes, styleHashes, delivery }) {
  const directives = [
    ["default-src", "'none'"],
    ["script-src", ...scriptHashes.map((h) => `'sha256-${h}'`), "'wasm-unsafe-eval'"],
    ["style-src", ...styleHashes.map((h) => `'sha256-${h}'`)],
    ["worker-src", "blob:"],
    ["connect-src", "'none'"],
    ["img-src", "'none'"],
    ["font-src", "'none'"],
    ["media-src", "'none'"],
    ["object-src", "'none'"],
    ["frame-src", "'none'"],
    ["manifest-src", "'none'"],
    ["form-action", "'none'"],
    ["base-uri", "'none'"],
    ["require-trusted-types-for", "'script'"],
    ["trusted-types", TRUSTED_TYPES_POLICY],
  ];
  if (delivery === "header") {
    directives.push(["frame-ancestors", "'none'"]);
  }
  return directives.map((d) => (d.length === 1 ? `${d[0]} 'none'` : d.join(" "))).join("; ");
}

export function securityHeaders(cspHeader) {
  return [
    { key: "Content-Security-Policy", value: cspHeader },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), clipboard-read=(), display-capture=()" },
    { key: "Cache-Control", value: "no-cache" },
  ];
}
