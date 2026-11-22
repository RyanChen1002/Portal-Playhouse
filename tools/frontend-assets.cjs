"use strict";

// One public asset list for local preview and deployment. Never copy the repo root.
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "world.js",
  "world.css",
  "characters.js",
  "live.js",
  "auth.js",
  "live-state.js",
  "games/rooms.js",
  "games/ui.js",
  "games/menu.js",
  "games/practice.js",
  "games/scene.js",
  "games/environment.js",
  "games/rules.js",
  "games/games.css",
  "vendor/three.module.js",
  "vendor/three.core.js",
  "vendor/THREE-LICENSE.txt",
];

function clientBundle() {
  return require("esbuild").buildSync({
    entryPoints: [
      require("node:path").join(
        __dirname,
        "..",
        "shared",
        "client",
        "index.ts",
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    legalComments: "inline",
  }).outputFiles[0].contents;
}

module.exports = { files, clientBundle };
