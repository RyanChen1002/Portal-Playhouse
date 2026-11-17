// Local-only rules. This module has no network, database, or DOM access.
export const games = [
 {id:'portal',name:'Portal Partners',tag:'Think together',time:180,color:'#8cae87',description:'Hold a plate, extend a bridge, collect both crystals, and escape together.',steps:['Leave one teammate on the gold pressure plate.','Switch characters and cross the center bridge. Use the far lever to keep it open.','Collect both crystals. Bring both teammates to the glowing exit.']},
 {id:'cafe',name:'Playhouse Cafe',tag:'Make something good',time:180,color:'#dba382',description:'Prepare four fresh orders in a tiny sunlit cafe.',steps:['Read the current order. Take a salad basket or soup ingredients.','Use the chopping board for salad or the stove for soup. Stay nearby while preparing.','Carry the finished dish to the serving counter. Complete four correct orders.']},
 {id:'rescue',name:'Room Rescue',tag:'A fresh start',time:240,color:'#b6a0c7',description:'Restore the lounge, one careful delivery at a time.',steps:['Pick up each small item and carry it to the matching numbered outline.','Bring both teammates close to the sofa before lifting it. They move together while carrying.','Use R to turn the sofa lengthwise through the center doorway, then place it on its outline.']},
 {id:'train',name:'Tiny Train Team',tag:'Keep things rolling',time:120,color:'#d4b85e',description:'Build the route before the little train catches up.',steps:['You have 25 seconds before the train starts. Fetch rails from the supply rack.','Follow the six numbered route markers. Use R to match the direction shown on each marker.','Build ahead of the train. It advances every 10 seconds and must reach the station.']},
 {id:'workshop',name:'Power-Up Workshop',tag:'Bring it to life',time:180,color:'#79b9b3',description:'Repair the machine and power the portal together.',steps:['Use each gear to rotate its number. Match the shared target: 1, 2, 3.','Pick up cables A, B, C and fit them into sockets with the same letter.','Leave one teammate at the left power station; switch and activate the right station.']}
];
export const route=[{x:-6,z:0,rotation:0},{x:-3,z:0,rotation:0},{x:0,z:0,rotation:0},{x:3,z:0,rotation:0},{x:6,z:0,rotation:0},{x:9,z:0,rotation:0}];
export function createSession(id){
 const def=games.find(g=>g.id===id);if(!def)throw Error('Unknown game');
 return {id,status:'playing',active:0,players:[{x:-3,z:6,held:null},{x:id==='rescue'?-5:0,z:6,held:null}],elapsed:0,limit:def.time,score:0,mistakes:0,message:'Walk up to a marked object and press E.',rotation:0,latched:false,crystals:[false,false],items:[false,false,false,false],carrySofa:false,sofaDone:false,gears:[0,0,0],sockets:[false,false,false],rails:Array(6).fill(false),trainStep:0,job:null};
}
const target=(id,x,z,label)=>({id,x,z,label});
export function targets(s){
 switch(s.id){
 case 'portal':return [target('plate',-5,3,'Hold bridge plate'),target('lever',2,-4,'Latch bridge'),...s.crystals.flatMap((done,i)=>done?[]:[target('crystal-'+(i?'b':'a'),i?6:-6,-5,'Collect crystal '+(i+1))]),target('exit',0,-7,'Exit together')];
 case 'cafe':return [target('salad',-7,-5,'Take salad ingredients'),target('soup',-3,-5,'Take soup ingredients'),target('board',2,-5,'Prepare salad'),target('stove',7,-5,'Cook soup'),target('serve',6,4,'Serve '+(s.score%2?'soup':'salad')),target('bin',-7,4,'Clear held item')];
 case 'rescue':return [...s.items.flatMap((done,i)=>done?[]:[target('item-'+i,-7,i*3-5,'Pick up item '+(i+1)),target('spot-'+i,7,i*3-5,'Place item '+(i+1))]),...s.sofaDone?[]:[target('sofa',-5,0,'Lift sofa together'),target('sofa-spot',5,0,'Place sofa')]];
 case 'train':return [target('supply',-7,6,'Take track piece'),...route.flatMap((r,i)=>s.rails[i]?[]:[target('rail-'+i,r.x,r.z,'Place track '+(i+1)+' — horizontal')])];
 case 'workshop':return [...[0,1,2].flatMap(i=>[target('gear-'+i,-6+i*6,-5,'Gear '+(i+1)+' target '+(i+1)),...s.sockets[i]?[]:[target('cable-'+i,-6+i*6,1,'Take cable '+String.fromCharCode(65+i)),target('socket-'+i,-6+i*6,-2,'Connect '+String.fromCharCode(65+i))]]),target('power-left',-4,5,'Hold left power'),target('power-right',4,5,'Activate portal')];
 default:return [];
 }
}
export const near=(p,t,r=1.9)=>Math.hypot(p.x-t.x,p.z-t.z)<=r;
export function bridgeOpen(s){return s.latched||s.players.some(p=>near(p,{x:-5,z:3},1.3));}
export function move(s,dx,dz,dt){
 if(s.status!=='playing'||!Number.isFinite(dt)||dt<=0)return;
 const len=Math.hypot(dx,dz);if(!len)return;const p=s.players[s.active],speed=s.carrySofa?2.4:4;
 const advance=(axis,d)=>{const candidate={...p,[axis]:p[axis]+d};if(Math.abs(candidate.x)>9.6||Math.abs(candidate.z)>7.7)return;
  if(s.id==='portal'&&Math.abs(candidate.z)<1.25&&(!bridgeOpen(s)||Math.abs(candidate.x)>1.2))return;
  if(s.id==='cafe'){
   const furniture=[...[-7,-3,2,7].map(x=>({x,z:-5,w:1.7,d:1.1})),{x:6,z:4,w:1.8,d:.9},{x:-7,z:4,w:.8,d:.8}];
   if(furniture.some(o=>Math.abs(candidate.x-o.x)<o.w&&Math.abs(candidate.z-o.z)<o.d))return;
  }
  if(s.id==='rescue') {const halfX=s.carrySofa?(s.rotation%2?.7:2):.35,halfZ=s.carrySofa?(s.rotation%2?2:.7):.35;if(Math.abs(candidate.x)<halfX+.25&&Math.abs(candidate.z)+halfZ>1.45)return;if(Math.abs(candidate.x)+halfX>10||Math.abs(candidate.z)+halfZ>8)return;}
  p[axis]=candidate[axis];
 };
 // Small substeps prevent a long frame crossing a wall or missing a bridge.
 const distance=speed*Math.min(dt,.25);const steps=Math.ceil(distance/.12);for(let i=0;i<steps;i++){advance('x',dx/len*distance/steps);advance('z',dz/len*distance/steps);}
 if(s.carrySofa){const other=s.players[1-s.active];other.x=p.x+(s.rotation%2?0:-1.3);other.z=p.z+(s.rotation%2?-1.3:0);}
}
function reject(s,message){s.message=message;return false;}
function win(s){s.status='won';s.message='Together, you did it. This result is not saved online.';}
export function act(s,id){
 if(s.status!=='playing')return false;
 if(id==='cancel'){s.status='cancelled';s.job=null;return true;}
 if(id==='switch'){if(s.carrySofa)return reject(s,'Place the sofa before switching teammates.');s.active=1-s.active;s.message='Controlling teammate '+(s.active+1);return true;}
 if(id==='rotate'){
  if(s.id==='rescue'&&s.carrySofa){const p=s.players[s.active];if(Math.abs(p.x)<2.3||Math.abs(p.z)>5.7)return reject(s,'Move away from the wall before turning the sofa.');}
  s.rotation=(s.rotation+1)%4;s.message='Orientation: '+(s.rotation%2?'vertical':'horizontal');return true;
 }
 const t=targets(s).find(t=>t.id===id),p=s.players[s.active];if(!t||!near(p,t))return reject(s,'Walk closer to the marked object.');
 if(s.id==='portal'){
  if(id==='plate')s.message='Stay on the plate and switch teammates with Q.';
  if(id==='lever'){s.latched=true;s.message='Bridge locked open. Collect both crystals.';}
  if(id.startsWith('crystal')){s.crystals[id.endsWith('a')?0:1]=true;s.score=s.crystals.filter(Boolean).length;s.message='Crystal collected.';}
  if(id==='exit'){if(s.crystals.every(Boolean)&&s.players.every(p=>near(p,t,2.3)))win(s);else return reject(s,'Both crystals and both teammates must be here.');}
 }
 if(s.id==='cafe'){
  if(id==='bin'){p.held=null;s.job=null;s.message='Hands empty.';}
  if(id==='salad'||id==='soup'){if(p.held)return reject(s,'Your hands are full. Serve or use the clear station.');p.held='raw-'+id;s.message='Carry ingredients to the '+(id==='salad'?'board.':'stove.');}
  if(id==='board'||id==='stove'){const dish=id==='board'?'salad':'soup';if(p.held!=='raw-'+dish)return reject(s,'This station needs raw '+dish+' ingredients.');if(s.job)return reject(s,'Finish the current preparation first.');s.job={player:s.active,dish,remaining:2.5,target:t};s.message='Preparing '+dish+' — stay near the station.';}
  if(id==='serve'){const dish=s.score%2?'soup':'salad';if(p.held!=='ready-'+dish){s.mistakes++;return reject(s,'Order needs prepared '+dish+'. Nothing served.');}p.held=null;s.score++;s.message='Order served!';if(s.score===4)win(s);}
 }
 if(s.id==='rescue'){
  if(id.startsWith('item-')){if(s.players.some(p=>p.held===id))return reject(s,'Your teammate is already carrying this item.');if(p.held||s.carrySofa)return reject(s,'Place what you are carrying first.');p.held=id;s.message='Carry it to the matching numbered outline.';}
  if(id.startsWith('spot-')){const n=Number(id.slice(-1));if(p.held!=='item-'+n)return reject(s,'This outline belongs to item '+(n+1)+'.');s.items[n]=true;p.held=null;s.score++;s.message='Item placed.';}
  if(id==='sofa'){if(s.players.some(p=>p.held)||!s.players.every(p=>near(p,t,2.7)))return reject(s,'Both teammates need empty hands and must stand near the sofa.');s.carrySofa=true;s.rotation=1;s.message='Moving together. R turns the sofa; fit it through the doorway.';}
  if(id==='sofa-spot'){if(!s.carrySofa)return reject(s,'Bring the sofa here together.');s.carrySofa=false;s.sofaDone=true;s.score++;s.message='Sofa placed.';}
  if(s.sofaDone&&s.items.every(Boolean))win(s);
 }
 if(s.id==='train'){
  if(id==='supply'){if(p.held)return reject(s,'Place your track first.');p.held='track';s.message='Match the track to a numbered route marker. R rotates.';}
  if(id.startsWith('rail-')){const i=Number(id.slice(-1));if(p.held!=='track')return reject(s,'Fetch a track piece from the supply rack.');if(s.rotation%2!==route[i].rotation){s.mistakes++;return reject(s,'Turn the track with R to match the horizontal route.');}s.rails[i]=true;p.held=null;s.score=s.rails.filter(Boolean).length;s.message='Track fitted. Keep building ahead of the train.';}
 }
 if(s.id==='workshop'){
  const n=Number(id.slice(-1));
  if(id.startsWith('gear')){s.gears[n]=(s.gears[n]+1)%4;s.message='Gear '+(n+1)+' is now '+s.gears[n]+'.';}
  if(id.startsWith('cable')){if(s.players.some(p=>p.held===id))return reject(s,'Your teammate has that cable.');if(p.held)return reject(s,'Connect the cable you are carrying first.');p.held='cable-'+n;s.message='Connect cable '+String.fromCharCode(65+n)+' to its matching socket.';}
  if(id.startsWith('socket')){if(p.held!=='cable-'+n){s.mistakes++;return reject(s,'Match the cable letter to this socket.');}s.sockets[n]=true;p.held=null;s.message='Cable fitted.';}
  s.score=s.gears.filter((v,i)=>v===i+1).length+s.sockets.filter(Boolean).length;
  if(id==='power-left')s.message='Stay here and switch to the other teammate.';
  if(id==='power-right'){if(s.score===6&&near(s.players[1-s.active],{x:-4,z:5},1.9))win(s);else return reject(s,'Match all three gears and cables, then hold both power stations.');}
 }
 return true;
}
export function step(s,dt){
 if(s.status!=='playing'||!Number.isFinite(dt)||dt<=0)return;
 s.elapsed+=dt;
 if(s.job){const j=s.job;if(!near(s.players[j.player],j.target,2.4)){s.job=null;s.message='Preparation cancelled. Stay by the station.';}else {j.remaining-=dt;if(j.remaining<=0){s.players[j.player].held='ready-'+j.dish;s.job=null;s.message='Dish ready. Take it to the serving counter.';}}}
 if(s.id==='train'){const reached=Math.min(route.length,Math.max(0,Math.floor((s.elapsed-25)/10)));for(let i=s.trainStep;i<reached;i++){if(!s.rails[i]){s.status='lost';s.message='The train reached missing track '+(i+1)+'. Try building farther ahead.';return;}s.trainStep=i+1;}if(s.trainStep===route.length){win(s);return;}}
 if(s.elapsed>=s.limit){s.elapsed=s.limit;s.status='lost';s.job=null;s.message='Time is up. Try again with a new plan.';}
}
export function objectives(s){
 switch(s.id){case 'portal':return [['Bridge latched',s.latched],['Two crystals collected',s.crystals.every(Boolean)],['Both teammates at exit',s.status==='won']];case 'cafe':return Array.from({length:4},(_,i)=>['Order '+(i+1)+': '+(i%2?'soup':'salad'),s.score>i]);case 'rescue':return [...s.items.map((v,i)=>['Place item '+(i+1),v]),['Place sofa together',s.sofaDone]];case 'train':return [['Six tracks fitted',s.rails.every(Boolean)],['Train reaches station',s.status==='won']];case 'workshop':return [['Gears match 1 / 2 / 3',s.gears.every((v,i)=>v===i+1)],['Cables A / B / C connected',s.sockets.every(Boolean)],['Portal powered together',s.status==='won']];default:return [];}
}
