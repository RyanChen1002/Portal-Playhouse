import {games} from './rules.js';
// Five inward-facing rooms around a shared courtyard, with entrances on a ring.
export const rooms=games.map((game,i)=>{const angle=(-90+i*72)*Math.PI/180;
 return {...game,x:Math.sin(angle)*10.5,z:Math.cos(angle)*10.5,cx:Math.sin(angle)*15.5,cz:Math.cos(angle)*15.5,rotation:angle+Math.PI,number:i+1};});
export function adjacentRoomLinks(){
 const point=(room,x,z)=>{const c=Math.cos(room.rotation),a=Math.sin(room.rotation);return {x:room.cx+x*c+z*a,z:room.cz-x*a+z*c};};
 return rooms.map((room,index)=>{
  const next=rooms[(index+1)%rooms.length],dx=next.cx-room.cx,dz=next.cz-room.cz,c=Math.cos(room.rotation),a=Math.sin(room.rotation);
  const fromSide=Math.sign(dx*c-dz*a),nextDx=room.cx-next.cx,nextDz=room.cz-next.cz,nextC=Math.cos(next.rotation),nextA=Math.sin(next.rotation);
  const toSide=Math.sign(nextDx*nextC-nextDz*nextA);
  return {from:room.id,to:next.id,fromSide,toSide,start:point(room,fromSide*4.65,2),end:point(next,toSide*4.65,2)};
 });
}
export function nearbyRoom(player){return rooms.find(r=>Math.hypot(player.x-r.x,player.z-r.z)<3.2);}
export function canEnterRoom(id,player){return nearbyRoom(player)?.id===id;}
const onlinePortalSteps=[
 'One teammate holds the gold pressure plate so the bridge stays open.',
 'The other crosses, pulls the lever, and latches the bridge open.',
 'Both collect a crystal, then meet at the exit together.'
];
const onlineWorkshopSteps=[
 'Rotate the gears to match the displayed targets.',
 'Carry each cable to its matching socket.',
 'Stand at left power while your teammate activates right power.'
];
export function supportsOnlineRoom(id, board = []) {
 return id === 'portal' || (id === 'workshop' && board.some(room => room.id === id));
}
export function roomDirectoryEntries(board=[],online=false){
 return rooms.map(room=>{
  const summary=online?board.find(entry=>entry.id===room.id):null;
  const livePortal=online&&room.id==='portal';
  const liveWorkshop=room.id==='workshop'&&!!summary;
  const live=online&&supportsOnlineRoom(room.id,board);
  return {
   id:room.id,
   name:room.name,
   description:room.description,
   steps:livePortal?onlinePortalSteps:liveWorkshop?onlineWorkshopSteps:room.steps,
   controls:live?'WASD / arrows · Move   E · Interact   Enter · Ready   Esc · Menu':'WASD / arrows · Move   E · Interact   Q · Switch   R · Rotate   Esc · Menu',
   status:!live?'Local practice':summary?`${summary.status==='playing'?'Playing':'Waiting'} · ${summary.players?.length||0}/2`:'Online · status unavailable',
   players:live?summary?.players?.map(player=>player.displayName).filter(Boolean)||[]:[]
  };
 });
}
export function lobbyEnterAction(roomId){
 return roomId?'enter-room':null;
}
