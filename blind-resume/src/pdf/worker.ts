import workerSource from "virtual:pdfjs-worker-source";

const POLICY_NAME = "blind-resume-worker";

interface ScriptUrlPolicy {
  createScriptURL(input: string): unknown;
}

interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createScriptURL: (input: string) => string }): ScriptUrlPolicy;
}

const issuedUrls = new Set<string>();
let policy: ScriptUrlPolicy | null = null;

function trustedTypesFactory(): TrustedTypesFactory | undefined {
  return (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
}

function toScriptUrl(url: string): string {
  const factory = trustedTypesFactory();
  if (!factory) return url;
  policy ??= factory.createPolicy(POLICY_NAME, {
    createScriptURL(input: string): string {
      if (issuedUrls.has(input)) return input;
      throw new TypeError("このアプリが作成していない Worker の URL は使えません。");
    },
  });
  return policy.createScriptURL(url) as string;
}

export function createPdfWorker(): Worker {
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  issuedUrls.add(url);
  let worker: Worker;
  try {
    worker = new Worker(toScriptUrl(url), { name: "pdfjs" });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    issuedUrls.delete(url);
  }
  const revoke = (): void => URL.revokeObjectURL(url);
  worker.addEventListener("message", revoke, { once: true });
  worker.addEventListener("error", revoke, { once: true });
  return worker;
}
