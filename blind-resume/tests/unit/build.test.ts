import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { classicWorkerSource } from "../../scripts/build-plugin.mjs";
import { buildCsp } from "../../scripts/csp.mjs";

describe("CSP", () => {
  const meta = buildCsp({ scriptHashes: ["abc="], styleHashes: ["def="], delivery: "meta" });
  const header = buildCsp({ scriptHashes: ["abc="], styleHashes: ["def="], delivery: "header" });
  const directive = (csp: string, name: string): string | undefined =>
    csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

  it("スクリプトはハッシュと wasm-unsafe-eval だけを許可する", () => {
    expect(directive(meta, "script-src")).toBe("script-src 'sha256-abc=' 'wasm-unsafe-eval'");
    expect(meta).not.toContain("'unsafe-eval'");
    expect(meta).not.toContain("'unsafe-inline'");
    expect(directive(meta, "script-src")).not.toMatch(/blob:|data:|https?:/);
  });

  it("通信、フォーム送信、base の書き換えを遮断する", () => {
    expect(directive(meta, "connect-src")).toBe("connect-src 'none'");
    expect(directive(meta, "form-action")).toBe("form-action 'none'");
    expect(directive(meta, "base-uri")).toBe("base-uri 'none'");
    expect(directive(meta, "default-src")).toBe("default-src 'none'");
  });

  it("Worker は blob: だけを許可し、Trusted Types を要求する", () => {
    expect(directive(meta, "worker-src")).toBe("worker-src blob:");
    expect(directive(meta, "require-trusted-types-for")).toBe("require-trusted-types-for 'script'");
    expect(directive(meta, "trusted-types")).toBe("trusted-types blind-resume-worker");
  });

  it("frame-ancestors はヘッダーでだけ指定する（meta では効かない）", () => {
    expect(directive(meta, "frame-ancestors")).toBeUndefined();
    expect(directive(header, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });
});

describe("PDF.js の Worker の classic 形式への変換", () => {
  const source = classicWorkerSource();

  it("export と import.meta が残っていない", () => {
    expect(source).not.toMatch(/export\s*\{/);
    expect(source).not.toContain("import.meta");
  });

  it("classic スクリプトとして構文が正しい", () => {
    expect(() => new vm.Script(source)).not.toThrow();
  });

  it("Worker として起動したときに自分で初期化する処理が残っている", () => {
    expect(source).toContain("initializeFromPort");
    expect(source).toContain("WorkerMessageHandler");
  });
});
