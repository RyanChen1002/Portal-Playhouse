import test from "node:test";
import assert from "node:assert/strict";
import { menuTransition } from "./menu.js";

test("Escape opens the menu, then resumes without cancelling a round", () => {
  assert.equal(menuTransition("playing", "escape", true), "menu");
  assert.equal(menuTransition("menu", "escape", true), "playing");
});
test("leaving an active game needs an explicit second confirmation", () => {
  assert.equal(menuTransition("playing", "leave", true), "confirm");
  assert.equal(menuTransition("confirm", "escape", true), "playing");
  assert.equal(menuTransition("confirm", "confirm-leave", true), "closed");
  assert.equal(menuTransition("playing", "confirm-leave", true), "playing");
});
test("help closes with Escape and a finished round can leave directly", () => {
  assert.equal(menuTransition("menu", "help", true), "help");
  assert.equal(menuTransition("help", "escape", true), "playing");
  assert.equal(menuTransition("result", "leave", false), "closed");
});
