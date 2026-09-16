import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

// Local preview of Expo's static export, including extensionless route URLs.
const root = resolve("dist");
const port = Number(process.env.ZAKURA_PREVIEW_PORT ?? 4173);
try { await stat(resolve(root, "index.html")); }
catch { throw new Error("Run npm run export:web before starting the preview."); }
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".ttf": "font/ttf", ".woff2": "font/woff2" };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    let target = file;
    if (!extname(target)) target += ".html";
    let status = 200;
    let body;
    try { body = await readFile(target); }
    catch { target = resolve(root, "+not-found.html"); body = await readFile(target); status = 404; }
    response.writeHead(status, { "Content-Type": contentTypes[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch { response.writeHead(400).end("Bad request"); }
}).listen(port, "127.0.0.1", () => process.stdout.write(`Zakura Bot preview: http://127.0.0.1:${port}\n`));
