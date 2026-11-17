import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, act, step, move, targets, route } from './rules.js';
function at(s,id){const t=targets(s).find(t=>t.id===id);assert.ok(t,id);Object.assign(s.players[s.active],{x:t.x,z:t.z+1});return act(s,id);}
test('unknown games rejected; sessions and resets have independent state',()=>{
 assert.throws(()=>createSession('unknown'));const a=createSession('cafe'),b=createSession('cafe');a.players[0].x=9;assert.notEqual(a.players[0].x,b.players[0].x);
});
test('range, cancelled actions and timeouts do not give wins',()=>{
 const s=createSession('cafe');assert.equal(act(s,'serve'),false);act(s,'cancel');step(s,999);assert.equal(s.status,'cancelled');assert.equal(act(s,'ingredient'),false);
 const timeout=createSession('workshop');step(timeout,181);assert.equal(timeout.status,'lost');assert.equal(timeout.score,0);
});
test('portal requires plate, lever, crystals and both players at exit',()=>{
 const s=createSession('portal');s.players[0]={x:0,z:2,held:null};move(s,0,-1,1);assert.ok(s.players[0].z>=1);
 at(s,'plate');act(s,'switch');at(s,'lever');assert.equal(s.latched,true);at(s,'crystal-a');at(s,'crystal-b');at(s,'exit');assert.equal(s.status,'playing');act(s,'switch');at(s,'exit');assert.equal(s.status,'won');
});
test('cafe rejects wrong serving and requires preparation for four orders',()=>{
 const s=createSession('cafe');at(s,'salad');at(s,'serve');assert.equal(s.score,0);assert.equal(s.mistakes,1);
 for(let n=0;n<4;n++){s.players[s.active].held=null;at(s,n%2?'soup':'salad');at(s,n%2?'stove':'board');step(s,3);at(s,'serve');}assert.equal(s.status,'won');assert.equal(s.score,4);
});
test('rescue needs matching placements and two teammates to lift sofa',()=>{
 const s=createSession('rescue');assert.equal(at(s,'sofa'),false);
 for(let n=0;n<4;n++){at(s,'item-'+n);at(s,'spot-'+n);}assert.equal(s.score,4);assert.equal(s.status,'playing');
 s.players[1]={x:-5,z:0,held:null};at(s,'sofa');assert.equal(s.carrySofa,true);at(s,'sofa-spot');assert.equal(s.status,'won');
});
test('carried sofa cannot cross divider away from doorway',()=>{
 const s=createSession('rescue');s.carrySofa=true;s.players[0]={x:-2,z:5};s.players[1]={x:-3,z:5};move(s,1,0,.5);assert.ok(s.players[0].x<0);
});
test('train loses at missing track and only wins when it reaches station',()=>{
 const s=createSession('train');step(s,36);assert.equal(s.status,'lost');
 const good=createSession('train');for(let i=0;i<route.length;i++){at(good,'supply');while(good.rotation!==route[i].rotation)act(good,'rotate');at(good,'rail-'+i);}assert.equal(good.status,'playing');step(good,86);assert.equal(good.status,'won');assert.equal(good.score,6);
});
test('workshop requires gears, sockets and separate final stations',()=>{
 const s=createSession('workshop');at(s,'power-right');assert.equal(s.status,'playing');
 for(let i=0;i<3;i++){for(let n=0;n<i+1;n++)at(s,'gear-'+i);at(s,'cable-'+i);at(s,'socket-'+i);}
 at(s,'power-left');act(s,'switch');at(s,'power-right');assert.equal(s.status,'won');const score=s.score;step(s,30);assert.equal(s.score,score);
});
test('a unique furnishing or cable cannot be carried by both teammates',()=>{
 for(const [game,item] of [['rescue','item-0'],['workshop','cable-0']]){const s=createSession(game);at(s,item);act(s,'switch');assert.equal(at(s,item),false);assert.equal(s.players[1].held,null);}
});
test('rescue starts both teammates on the pickup side and sofa needs turning',()=>{
 const s=createSession('rescue');assert.ok(s.players.every(p=>p.x<-.5));s.players[1]={x:-5,z:0,held:null};at(s,'sofa');assert.equal(s.rotation%2,1);
});
test('cafe counters block walking but stay reachable for interaction',()=>{
 const s=createSession('cafe');s.players[0].x=-7;s.players[0].z=-3.5;for(let i=0;i<10;i++)move(s,0,-1,.1);assert.ok(s.players[0].z>-4.1);assert.equal(act(s,'salad'),true);
});
