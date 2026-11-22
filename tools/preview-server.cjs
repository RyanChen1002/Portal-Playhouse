"use strict";
// Serve only the preview assets, on loopback. Never expose repository files.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { files, clientBundle } = require("./frontend-assets.cjs");
const built = process.argv.includes("--built");
const root = path.join(__dirname, "..", "frontend", ...(built ? ["dist"] : []));
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".txt": "text/plain",
};
const assets = new Map(
  files.map((file) => [
    "/" + file,
    [file, mime[path.extname(file)] + "; charset=utf-8"],
  ]),
);
assets.set("/", assets.get("/index.html"));
if (built)
  assets.set("/portal-client.js", [
    "portal-client.js",
    "text/javascript; charset=utf-8",
  ]);
const server = http.createServer((request, response) => {
  if (
    !built &&
    request.url.split("?")[0] === "/portal-client.js" &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    try {
      const bundle = clientBundle();
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : bundle);
    } catch {
      response.writeHead(503);
      response.end(
        "Shared client unavailable. Run npm ci at the repository root.",
      );
    }
    return;
  }
  const asset = assets.get(request.url.split("?")[0]);
  if (!asset || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  fs.readFile(path.join(root, asset[0]), (error, data) => {
    if (error) {
      response.writeHead(500);
      response.end("Preview asset unavailable");
      return;
    }
    response.writeHead(200, {
      "Content-Type": asset[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Portal Playhouse preview: http://127.0.0.1:4173"),
);
