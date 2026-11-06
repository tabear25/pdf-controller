import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 4173;
const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const headers = vercel.headers.flatMap((rule) => rule.headers);
const types = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = normalize(join(dist, path));
  const ok = req.method === "GET" && file.startsWith(dist) && existsSync(file) && statSync(file).isFile();
  console.log(`${req.method} ${url.pathname} ${ok ? 200 : 404}`);
  if (!ok) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  for (const h of headers) res.setHeader(h.key, h.value);
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  res.end(readFileSync(file));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${dist} at http://127.0.0.1:${port}/`);
});
