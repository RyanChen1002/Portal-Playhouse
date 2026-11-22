"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { files, clientBundle } = require("./frontend-assets.cjs");
const frontend = path.resolve(__dirname, "..", "frontend");
const output = path.join(frontend, "dist");

// Generate first: a bundling error must not destroy the previous working output.
const bundle = clientBundle();
for (const file of files) fs.accessSync(path.join(frontend, file));
if (fs.existsSync(output)) {
  if (
    fs.lstatSync(output).isSymbolicLink() ||
    fs.realpathSync(output) !== output
  ) {
    throw new Error("Refusing to clean a redirected output directory.");
  }
  fs.rmSync(output, { recursive: true });
}
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(frontend, file), destination);
}
fs.writeFileSync(path.join(output, "portal-client.js"), bundle);
console.log(`Built ${files.length + 1} public files in frontend/dist.`);
