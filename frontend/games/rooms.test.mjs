import test from 'node:test';
import assert from 'node:assert/strict';
import * as roomDirectory from './rooms.js';
import {rooms,nearbyRoom,canEnterRoom} from './rooms.js';
import {games} from './rules.js';
import {roomFurnitureSpec} from './environment.js';
test('five rooms map to every playable game exactly once',()=>{
 assert.deepEqual(rooms.map(r=>r.id).sort(),games.map(g=>g.id).sort());
 for(const r of rooms){assert.ok(Math.abs(Math.hypot(r.x,r.z)-10.5)<.001);for(const other of rooms){if(other!==r)assert.ok(Math.hypot(r.x-other.x,r.z-other.z)>6.4);}}
});
test('adjacent rooms have side-link endpoints without moving their entrances',()=>{
 const links=roomDirectory.adjacentRoomLinks?.()||[];
 assert.equal(links.length,rooms.length);
 assert.deepEqual(links.map(link=>[link.from,link.to]),rooms.map((room,index)=>[room.id,rooms[(index+1)%rooms.length].id]));
 for(const link of links){
  const first=rooms.find(room=>room.id===link.from);
  const second=rooms.find(room=>room.id===link.to);
  const distance=Math.hypot(link.end.x-link.start.x,link.end.z-link.start.z);
  assert.ok(distance>4&&distance<10);
  assert.ok(Math.abs(Math.hypot(first.x,first.z)-10.5)<.001);
  assert.ok(Math.abs(Math.hypot(second.x,second.z)-10.5)<.001);
 }
});
test('entry requires an open room and a nearby player',()=>{
 for(const r of rooms){const p={x:r.x*.9,z:r.z*.9};assert.equal(nearbyRoom(p)?.id,r.id);assert.equal(canEnterRoom(r.id,p,false),true);assert.equal(canEnterRoom(r.id,{x:0,z:0},false),false);}
 const r=rooms.find(r=>r.id==='workshop');assert.equal(canEnterRoom(r.id,r,true),true);assert.equal(canEnterRoom('unknown',r,false),false);
});

test('room details use truthful live names and practice labels',()=>{
 const entries=roomDirectory.roomDirectoryEntries?.([{id:'portal',status:'waiting',players:[{displayName:'Milo'}]}],true)||[];
 assert.equal(entries.length,5);
 const portal=entries.find(entry=>entry.id==='portal');
 assert.equal(portal.status,'Waiting · 1/2');
 assert.deepEqual(portal.players,['Milo']);
 assert.equal(portal.steps[0],'One teammate holds the gold pressure plate so the bridge stays open.');
 assert.equal(entries.find(entry=>entry.id==='cafe').status,'Local practice');
 const offline=roomDirectory.roomDirectoryEntries?.([],false)||[];
 assert.ok(offline.every(entry=>entry.status==='Local practice'));
});

test('Enter starts a nearby room and does nothing away from a doorway',()=>{
 const enter=roomDirectory.lobbyEnterAction;
 assert.equal(enter?.('portal'),'enter-room');
 assert.equal(enter?.(null),null);
});

test('every game has one visual furniture set without changing room ids',()=>{
 const sets=rooms.map(r=>roomFurnitureSpec(r.id));
 assert.deepEqual(sets.map(s=>s.id).sort(),rooms.map(r=>r.id).sort());
 for(const spec of sets){
  assert.ok(spec.label);
  assert.ok(spec.furniture.length>=2);
 }
 assert.equal(roomFurnitureSpec('unknown'),null);
});
