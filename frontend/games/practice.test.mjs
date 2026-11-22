import test from "node:test";
import assert from "node:assert/strict";
import * as base from "./rules.js";
import {
  createSession,
  act,
  step,
  targets,
  objectives,
  getRoute,
  levelCount,
  nextMove,
} from "./practice.js";
function at(s, id) {
  const t = targets(s).find((t) => t.id === id);
  assert.ok(t, id);
  Object.assign(s.players[s.active], { x: t.x, z: t.z });
  return act(s, id);
}
test("guidance explains the actual cafe preparation and handoff step", () => {
  const s = createSession("cafe", 3);
  assert.match(nextMove(s), /soup ingredients/i);
  at(s, "soup");
  assert.match(nextMove(s), /stove/i);
  at(s, "stove");
  assert.match(nextMove(s), /stay/i);
  step(s, 2.5);
  assert.match(nextMove(s), /tray/i);
  at(s, "handoff");
  assert.match(nextMove(s), /switch/i);
  act(s, "switch");
  assert.match(nextMove(s), /collect/i);
  at(s, "handoff");
  assert.match(nextMove(s), /serving counter/i);
});
test("rescue guidance names the next carrier and explains the narrow door", () => {
  const s = createSession("rescue", 4);
  s.lastCarrier = 0;
  assert.match(nextMove(s), /teammate 2/i);
  s.carrySofa = true;
  s.rotation = 1;
  assert.match(nextMove(s), /R.*across/i);
  s.rotation = 0;
  assert.match(nextMove(s), /doorway/i);
});
test("track guidance shows the next number, orientation and departure", () => {
  const s = createSession("train", 2);
  assert.match(nextMove(s), /25s/i);
  s.players[0].held = "track";
  s.rails[0] = s.rails[1] = true;
  assert.match(nextMove(s), /3.*vertical/i);
  s.rails.fill(true);
  assert.match(nextMove(s), /station/i);
});
for (const game of ["cafe", "rescue", "train", "workshop"])
  for (let level = 1; level <= 5; level++) {
    test(`${game} level ${level}: complete, reject terminal actions, retry fresh`, () => {
      const s = createSession(game, level);
      if (game === "cafe")
        for (const dish of s.config.orders) {
          assert.equal(at(s, dish), true);
          assert.equal(at(s, dish === "soup" ? "stove" : "board"), true);
          step(s, 2.5);
          if (level >= 3) {
            assert.equal(at(s, "handoff"), true);
            act(s, "switch");
            assert.equal(at(s, "handoff"), true);
          }
          assert.equal(at(s, "serve"), true);
        }
      if (game === "rescue") {
        for (const i of s.config.delivery) {
          if (level >= 4 && s.lastCarrier === s.active) act(s, "switch");
          assert.equal(at(s, "item-" + i), true);
          if (level === 5) {
            const t = targets(s).find((t) => t.id === "spot-" + i);
            Object.assign(s.players[1 - s.active], { x: t.x, z: t.z });
          }
          assert.equal(at(s, "spot-" + i), true);
        }
        Object.assign(s.players[1 - s.active], { x: -5, z: 0 });
        assert.equal(at(s, "sofa"), true);
        assert.equal(at(s, "sofa-spot"), true);
      }
      if (game === "train") {
        getRoute(s).forEach((r, i) => {
          at(s, "supply");
          s.rotation = r.rotation;
          assert.equal(at(s, "rail-" + i), true);
        });
        assert.equal(s.status, "playing");
        step(s, 85);
      }
      if (game === "workshop") {
        for (let i = 0; i < 3; i++) {
          for (let n = 0; n < s.config.gears[i]; n++)
            assert.equal(at(s, "gear-" + i), true);
          assert.equal(at(s, "cable-" + i), true);
          assert.equal(at(s, "socket-" + s.config.sockets.indexOf(i)), true);
        }
        assert.equal(at(s, "power-right"), false);
        at(s, "power-left");
        act(s, "switch");
        assert.equal(at(s, "power-right"), true);
      }
      assert.equal(s.status, "won");
      const frozen = structuredClone(s);
      assert.equal(act(s, "switch"), false);
      step(s, 999);
      assert.deepEqual(s, frozen);
      const retry = createSession(game, level);
      assert.equal(retry.score, 0);
      assert.equal(retry.status, "playing");
      assert.equal(retry.elapsed, 0);
    });
    test(`${game} level ${level}: timeout or missing track loses without a reward`, () => {
      const s = createSession(game, level);
      step(s, s.limit + 1);
      assert.equal(s.status, "lost");
      assert.equal(s.score, 0);
      assert.equal(act(s, "switch"), false);
    });
  }
test("crossed workshop cables cannot be duplicated or put in the wrong socket", () => {
  const s = createSession("workshop", 5);
  at(s, "cable-0");
  assert.equal(at(s, "socket-0"), false);
  act(s, "switch");
  assert.equal(at(s, "cable-0"), false);
  act(s, "switch");
  assert.equal(at(s, "socket-2"), true);
  assert.ok(!targets(s).some((t) => t.id === "cable-0"));
});
test("cafe preparation cancels on walking away and handoff cannot accept raw food", () => {
  const s = createSession("cafe", 3);
  at(s, "soup");
  assert.equal(at(s, "handoff"), false);
  at(s, "stove");
  s.players[0].z = 5;
  step(s, 3);
  assert.equal(s.job, null);
  assert.equal(s.players[0].held, "raw-soup");
});
test("later rescue levels can return a wrong pickup so both hands cannot deadlock the delivery order", () => {
  const s = createSession("rescue", 4);
  at(s, "item-0");
  act(s, "switch");
  at(s, "item-1");
  assert.equal(at(s, "item-1"), true);
  assert.equal(s.players[1].held, null);
  assert.equal(at(s, "item-2"), true);
  assert.equal(at(s, "spot-2"), true);
});
test("Portal Partners state and commands remain identical to the original rules", () => {
  const s = createSession("portal"),
    b = base.createSession("portal");
  assert.deepEqual(s, b);
  act(s, "switch");
  base.act(b, "switch");
  step(s, 1);
  base.step(b, 1);
  assert.deepEqual(s, b);
  assert.equal(levelCount("portal"), 1);
  assert.throws(() => createSession("portal", 2));
});
test("four existing games have five independent levels and reject invalid levels", () => {
  for (const id of ["cafe", "rescue", "train", "workshop"]) {
    assert.equal(levelCount(id), 5);
    for (let n = 1; n <= 5; n++) {
      const s = createSession(id, n);
      assert.equal(s.level, n);
      assert.equal(s.status, "playing");
      assert.ok(objectives(s).length);
    }
    assert.throws(() => createSession(id, 6));
    assert.throws(() => createSession(id, 0));
  }
});
test("later cafe levels need all their actual orders, not just four", () => {
  const s = createSession("cafe", 2);
  for (let i = 0; i < s.config.orders.length; i++) {
    const dish = s.config.orders[i];
    at(s, dish);
    at(s, dish === "salad" ? "board" : "stove");
    step(s, 2.5);
    assert.equal(at(s, "serve"), true);
    assert.equal(
      s.status,
      i === s.config.orders.length - 1 ? "won" : "playing",
    );
  }
});
test("cafe relay requires the other teammate to collect a prepared order", () => {
  const s = createSession("cafe", 3);
  const dish = s.config.orders[0];
  at(s, dish);
  at(s, dish === "salad" ? "board" : "stove");
  step(s, 2.5);
  assert.equal(at(s, "serve"), false);
  assert.equal(at(s, "handoff"), true);
  assert.equal(at(s, "handoff"), false);
  act(s, "switch");
  assert.equal(at(s, "handoff"), true);
  assert.equal(at(s, "serve"), true);
});
test("rescue delivery order is enforced without consuming a misplaced item", () => {
  const s = createSession("rescue", 2);
  at(s, "item-0");
  assert.equal(at(s, "spot-0"), false);
  assert.equal(s.players[s.active].held, "item-0");
});
test("train layouts have usable routes and reject incorrect track orientation", () => {
  const s = createSession("train", 3),
    route = getRoute(s);
  assert.ok(route.some((r) => r.z !== 0));
  for (let i = 0; i < route.length; i++) {
    at(s, "supply");
    s.rotation = 1 - route[i].rotation;
    assert.equal(at(s, "rail-" + i), false);
    s.rotation = route[i].rotation;
    assert.equal(at(s, "rail-" + i), true);
  }
  step(s, 85);
  assert.equal(s.status, "won");
});
test("workshop level five uses its own gear targets and both power stations", () => {
  const s = createSession("workshop", 5);
  for (let i = 0; i < 3; i++) {
    for (let n = 0; n < s.config.gears[i]; n++) at(s, "gear-" + i);
    at(s, "cable-" + i);
    assert.equal(at(s, "socket-" + [2, 1, 0][i]), true);
  }
  assert.equal(at(s, "power-right"), false);
  at(s, "power-left");
  act(s, "switch");
  assert.equal(at(s, "power-right"), true);
  assert.equal(s.status, "won");
});
