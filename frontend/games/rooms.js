import {games} from './rules.js';
// Five inward-facing rooms around a shared courtyard, with entrances on a ring.
export const rooms=games.map((game,i)=>{const angle=(-90+i*72)*Math.PI/180;
 return {...game,x:Math.sin(angle)*10.5,z:Math.cos(angle)*10.5,cx:Math.sin(angle)*15.5,cz:Math.cos(angle)*15.5,rotation:angle+Math.PI,number:i+1};});
export function nearbyRoom(player){return rooms.find(r=>Math.hypot(player.x-r.x,player.z-r.z)<3.2);}
export function canEnterRoom(id,player,lockedExample){return nearbyRoom(player)?.id===id&&!(lockedExample&&id==='workshop');}
