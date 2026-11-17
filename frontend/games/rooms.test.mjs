import test from 'node:test';
import assert from 'node:assert/strict';
import {rooms,nearbyRoom,canEnterRoom} from './rooms.js';
import {games} from './rules.js';
test('five rooms map to every playable game exactly once',()=>{
 assert.deepEqual(rooms.map(r=>r.id).sort(),games.map(g=>g.id).sort());
 for(const r of rooms){assert.ok(Math.abs(Math.hypot(r.x,r.z)-10.5)<.001);for(const other of rooms){if(other!==r)assert.ok(Math.hypot(r.x-other.x,r.z-other.z)>6.4);}}
});
test('entry requires an open room and a nearby player',()=>{
 for(const r of rooms){const p={x:r.x*.9,z:r.z*.9};assert.equal(nearbyRoom(p)?.id,r.id);assert.equal(canEnterRoom(r.id,p,false),true);assert.equal(canEnterRoom(r.id,{x:0,z:0},false),false);}
 const r=rooms.find(r=>r.id==='workshop');assert.equal(canEnterRoom(r.id,r,true),false);assert.equal(canEnterRoom('unknown',r,false),false);
});
