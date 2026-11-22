import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = resolve(root, "frontend/dist");

test("static build includes the real browser client and every referenced local asset, but no private or test files", () => {
  execFileSync(process.execPath, ["tools/build-frontend.cjs"], { cwd: root });
  const files = readdirSync(out, { recursive: true }).map(String);
  assert.ok(files.includes("portal-client.js"));
  assert.ok(
    files.includes("vendor/THREE-LICENSE.txt") ||
      files.includes("vendor\\THREE-LICENSE.txt"),
  );
  assert.ok(
    !files.some((f) =>
      /\.test\.|\.md$|\.env|vercel\.json|package|checklist/.test(f),
    ),
  );
  const bundle = readFileSync(resolve(out, "portal-client.js"), "utf8");
  assert.match(bundle, /createPortalClient/);
  assert.doesNotMatch(bundle, /createMockPortalClient/);
  const html = readFileSync(resolve(out, "index.html"), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) {
    assert.ok(
      existsSync(resolve(out, ref.replace(/^\//, ""))),
      `Missing HTML asset ${ref}`,
    );
  }
  for (const file of files.filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(resolve(out, file), "utf8");
    for (const [, ref] of source.matchAll(
      /(?:from\s*|import\s*\()\s*['"]([./][^'"]+\.js)['"]/g,
    )) {
      const target = ref.startsWith("/")
        ? resolve(out, ref.slice(1))
        : resolve(out, dirname(file), ref);
      assert.ok(existsSync(target), `Missing import ${ref} in ${file}`);
    }
  }
});
