import {character,animateCharacter,names,colors} from './characters.js';
import * as THREE from './vendor/three.module.js';
import {rooms as gameRooms,adjacentRoomLinks,nearbyRoom,canEnterRoom,roomDirectoryEntries,lobbyEnterAction} from './games/rooms.js';
import {bindDialogEscape} from './games/menu.js';

const host = document.querySelector('#world');
host.replaceChildren();
host.setAttribute('aria-label', '3D playhouse. WASD or arrow keys move. Enter at a doorway starts its game. Click a room sign or press H nearby for details.');
const hint = document.createElement('div'); hint.className = 'world-hint'; hint.textContent = 'WASD / arrows · Move · Enter at a doorway to play'; host.append(hint);


let selected = 0, active = false, worldView = true;
let currentRoom='lobby', zoom=.88, detailsOpen=false, selectedDetailsRoom=null;
let buildTransform=null;
const detailsDialog=document.createElement('dialog');
detailsDialog.className='room-details-dialog';
detailsDialog.setAttribute('aria-labelledby','room-details-title');
document.body.append(detailsDialog);
bindDialogEscape(detailsDialog,closeRoomDetails);
detailsDialog.addEventListener('click',event=>{
 if(event.target===detailsDialog||event.target.closest('[data-close-details]'))closeRoomDetails();
 const enter=event.target.closest('[data-enter-room]');
 if(enter&&selectedDetailsRoom){const id=selectedDetailsRoom;closeRoomDetails();clearKeys();window.dispatchEvent(new CustomEvent('playhouse-enter-game',{detail:{id}}));}
});
function closeRoomDetails(){
 if(detailsDialog.open)detailsDialog.close();
 detailsOpen=false;
 selectedDetailsRoom=null;
 clearKeys();
 host.focus();
}
function renderRoomDetails(roomId){
 selectedDetailsRoom=roomId;
 detailsDialog.replaceChildren();
 const entry=roomDirectoryEntries(onlineSnapshot?.board||[],!!window.playhouseLive?.online).find(item=>item.id===roomId);
 if(!entry)throw new Error(`Unknown room details requested: ${roomId}`);
 const room=gameRooms.find(item=>item.id===roomId);
 if(!room)throw new Error(`Unknown game room requested: ${roomId}`);
 const header=document.createElement('header');
 const intro=document.createElement('div');
 const eyebrow=document.createElement('p');eyebrow.className='room-details-eyebrow';eyebrow.textContent=`ROOM 0${room.number} · ${entry.status.toUpperCase()}`;
 const title=document.createElement('h2');title.id='room-details-title';title.textContent=entry.name;
 const copy=document.createElement('p');copy.textContent=entry.description;
 intro.append(eyebrow,title,copy);
 const close=document.createElement('button');close.type='button';close.className='room-details-close';close.dataset.closeDetails='';close.textContent='Close · Esc';close.setAttribute('aria-label',`Close ${entry.name} details`);
 header.append(intro,close);detailsDialog.append(header);
 const card=document.createElement('article');card.className='commons-room-card room-details-card';
 if(entry.players.length){const players=document.createElement('p');players.className='commons-room-players';players.textContent='Here now · '+entry.players.join(' · ');card.append(players);}
 const steps=document.createElement('ol');for(const step of entry.steps){const item=document.createElement('li');item.textContent=step;steps.append(item);}
 const controls=document.createElement('p');controls.className='commons-room-controls';controls.textContent=entry.controls;
 const enter=document.createElement('button');enter.type='button';enter.className='room-enter-button';enter.dataset.enterRoom='';enter.textContent='Enter '+entry.name;
 card.append(steps,controls,enter);detailsDialog.append(card);
 const footer=document.createElement('footer');footer.textContent='Enter near the doorway to start · Click a room sign or press H nearby for these details.';
 detailsDialog.append(footer);
}
function openRoomDetails(roomId){
 clearKeys();renderRoomDetails(roomId);detailsOpen=true;detailsDialog.showModal();
 detailsDialog.querySelector('[data-enter-room]').focus();
}
const cameraTarget=new THREE.Vector3(0,0,2);
const keys = new Set();
const obstacles = [];
let scene, camera, renderer, hero, portalTarget;
const walkers = [], portals = [];
const livePeers=new Map();let onlineSnapshot=null;
function clearPeers(){for(const peer of livePeers.values()){scene.remove(peer.mesh);peer.mesh.traverse(o=>o.geometry?.dispose());}livePeers.clear();}
window.addEventListener('playhouse-online-state',event=>{
 const {snapshot,state,reset}=event.detail;onlineSnapshot=snapshot;
 walkers.forEach(p=>p.mesh.visible=false);if(reset||state!=='connected')keys.clear();
 if(reset&&snapshot.self.roomId==='lobby'&&snapshot.self.position){hero.position.set(snapshot.self.position.x,0,snapshot.self.position.z);hero.rotation.y=snapshot.self.rotation;}
 const others=snapshot.self.roomId==='lobby'?snapshot.room.players.filter(p=>p.id!==snapshot.self.playerId&&p.position):[];
 for(const [id,peer]of livePeers)if(!others.some(p=>p.id===id)){scene.remove(peer.mesh);peer.mesh.traverse(o=>o.geometry?.dispose());livePeers.delete(id);}
 for(const p of others){let peer=livePeers.get(p.id);if(!peer){const mesh=character(Number(p.avatarId.slice(-2))-1);mesh.position.set(p.position.x,0,p.position.z);scene.add(mesh);peer={mesh};livePeers.set(p.id,peer);}peer.target=p.position;peer.rotation=p.rotation;}
 document.querySelector('.demo-tag').textContent='Online dev · '+state;
 document.querySelector('.world-top .pill:last-child').textContent=state+' · '+snapshot.room.players.length+' players in this space';
});
window.addEventListener('playhouse-offline',()=>{onlineSnapshot=null;clearPeers();walkers.forEach(p=>p.mesh.visible=true);document.querySelector('.demo-tag').textContent='Local practice · Not saved online';});
window.addEventListener('playhouse-practice-away',()=>{keys.clear();clearPeers();document.querySelector('.demo-tag').textContent='Local practice · Online world disconnected';});
window.addEventListener('playhouse-profile',event=>{setAvatar(Number(event.detail.avatarId.slice(-2))-1);});
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const materials = new Map();
function material(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return materials.get(color);}
function box(parent,x,y,z,w,h,d,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function sphere(parent,x,y,z,r,color,sx=1,sy=1,sz=1){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;}
function cone(parent,x,y,z,r,h,color){const mesh=new THREE.Mesh(new THREE.ConeGeometry(r,h,5),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;}
function solid(x,z,w,d){const r=buildTransform;if(r){const c=Math.cos(r.rotation),a=Math.sin(r.rotation);obstacles.push({x:r.cx+x*c+z*a,z:r.cz-x*a+z*c,w:w/2+.38,d:d/2+.38,rotation:r.rotation});}else obstacles.push({x,z,w:w/2+.38,d:d/2+.38,rotation:0});}
// Contemporary furniture: rounded upholstery, pale oak, ceramic and slim metal frames.
function softBox(parent,x,y,z,w,h,d,color,r=.08){
 const radius=Math.min(r,w/3,h/3,d/3),shape=new THREE.Shape();
 const left=-w/2+radius,right=w/2-radius,bottom=-h/2+radius,top=h/2-radius;
 shape.moveTo(left-radius,bottom);shape.lineTo(left-radius,top);shape.quadraticCurveTo(left-radius,top+radius,left,top+radius);shape.lineTo(right,top+radius);shape.quadraticCurveTo(right+radius,top+radius,right+radius,top);shape.lineTo(right+radius,bottom);shape.quadraticCurveTo(right+radius,bottom-radius,right,bottom-radius);shape.lineTo(left,bottom-radius);shape.quadraticCurveTo(left-radius,bottom-radius,left-radius,bottom);
 const geometry=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.01,d-2*radius),bevelEnabled:true,bevelThickness:radius,bevelSize:radius*.35,bevelSegments:3,steps:1,curveSegments:6});geometry.center();
 const mesh=new THREE.Mesh(geometry,material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function cylinder(parent,x,y,z,r,h,color){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,32),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function plant(x,z){
 cylinder(scene,x,.34,z,.32,.65,0xf1eee6);cylinder(scene,x,.67,z,.28,.035,0x766551);
 for(let i=0;i<7;i++){const angle=i*2.4,tx=x+Math.cos(angle)*.3,tz=z+Math.sin(angle)*.3;const leaf=sphere(scene,tx,.95+(i%3)*.23,tz,.25,i%2?0x4b8265:0x74a17c,.48,1.6,.85);leaf.rotation.z=Math.cos(angle)*.7;leaf.rotation.x=Math.sin(angle)*.5;}
 solid(x,z,.85,.85);
}
function sofa(x,z,color){
 // Recessed base, separate padded seats and backrests, piping and throw pillows.
 for(const dx of [-1.1,1.1])for(const dz of [-.36,.36])cylinder(scene,x+dx,.18,z+dz,.045,.3,0x343f43);
 softBox(scene,x,.43,z,2.75,.38,1.22,0x455b58,.1);
 for(const dx of [-.65,0,.65]){
  softBox(scene,x+dx,.7,z+.08,.64,.24,.9,color,.1);
  const back=softBox(scene,x+dx,1.05,z-.43,.66,.65,.28,color,.12);back.rotation.x=-.12;
  box(scene,x+dx,.815,z+.48,.55,.012,.015,0xdee3db);
 }
 for(const side of [-1,1])softBox(scene,x+side*1.22,.78,z,.28,.56,1.25,color,.1);
 const pillow=softBox(scene,x-.76,.99,z-.12,.43,.43,.18,0xf0e8d9,.09);pillow.rotation.z=.16;
 const accent=softBox(scene,x+.72,.98,z-.14,.43,.4,.18,0xc58e73,.09);accent.rotation.z=-.15;
 solid(x,z,2.8,1.3);
}
function desk(x,z){
 softBox(scene,x,1.15,z,2.5,.12,1.15,0xd7c5a7,.05);
 for(const dx of [-1.04,1.04]){box(scene,x+dx,.6,z,.065,1.1,.78,0x3d484d);box(scene,x+dx,.075,z,.5,.07,.9,0x3d484d);}
 // Thin monitor, illuminated screen, stand, keyboard, mouse and ceramic mug.
 softBox(scene,x,1.78,z-.23,1.2,.73,.075,0x303d49,.035);
 softBox(scene,x,1.79,z-.18,1.1,.62,.015,0x9bbfc5,.02);
 box(scene,x,1.42,z-.23,.06,.35,.06,0x3d484d);softBox(scene,x,1.24,z-.15,.45,.035,.25,0x3d484d,.01);
 for(let row=0;row<3;row++)for(let key=0;key<8;key++)box(scene,x-.32+key*.085,1.233,z+.2+row*.06,.066,.025,.04,0xe9ece9);
 softBox(scene,x+.58,1.24,z+.3,.13,.06,.21,0xe8e9e4,.025);
 cylinder(scene,x-.9,1.3,z+.24,.085,.22,0xf5f0e8);cylinder(scene,x-.9,1.415,z+.24,.065,.01,0x6c5142);
 solid(x,z,2.5,1.15);
}
function officeChair(x,z,color=0x657e88){
 cylinder(scene,x,.3,z,.045,.5,0x505b60);
 for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const foot=box(scene,x+Math.sin(a)*.18,.1,z+Math.cos(a)*.18,.04,.05,.4,0x505b60);foot.rotation.y=a;sphere(scene,x+Math.sin(a)*.36,.08,z+Math.cos(a)*.36,.07,0x3c444a);}
 softBox(scene,x,.59,z,.68,.15,.66,color,.08);const back=softBox(scene,x,1,z+.27,.65,.7,.1,color,.09);back.rotation.x=.1;
 for(const side of [-1,1]){box(scene,x+side*.37,.73,z,.04,.3,.05,0x424e53);softBox(scene,x+side*.37,.87,z,.09,.07,.4,0x424e53,.02);}
 solid(x,z,.85,.9);
}
function coffeeTable(x,z){
 for(const dx of [-.55,.55])for(const dz of [-.3,.3])box(scene,x+dx,.3,z+dz,.05,.55,.05,0x414b50);
 softBox(scene,x,.6,z,1.6,.1,1,0xe8e6df,.12);
 softBox(scene,x-.25,.69,z,.48,.08,.35,0xb8c8bb,.02);box(scene,x-.25,.736,z,.39,.006,.27,0xf4efdf);
 cylinder(scene,x+.43,.79,z+.1,.12,.3,0xc89a80);sphere(scene,x+.43,1.05,z+.1,.12,0x719678,.6,1.7,.7);
 solid(x,z,1.6,1);
}

const signs=[];
function roomPoint(r,x,z){const c=Math.cos(r.rotation),a=Math.sin(r.rotation);return {x:r.cx+x*c+z*a,z:r.cz-x*a+z*c};}
function makeBoard(r){
 const point=roomPoint(r,-3.1,5.7),cv=document.createElement('canvas');cv.width=768;cv.height=440;const tx=new THREE.CanvasTexture(cv);tx.colorSpace=THREE.SRGBColorSpace;
 const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,depthTest:true}));sign.position.set(point.x,2.15,point.z);sign.scale.set(4.2,2.4,1);sign.name='room-board:'+r.id;scene.add(sign);signs.push({r,cv,tx,sign,point});
}
function drawBoards(){for(const {r,cv,tx}of signs){
 const ctx=cv.getContext('2d');
 ctx.clearRect(0,0,768,440);ctx.fillStyle='#173b40';ctx.beginPath();ctx.roundRect(5,5,758,430,34);ctx.fill();
 ctx.strokeStyle='#c9a96b';ctx.lineWidth=8;ctx.beginPath();ctx.roundRect(12,12,744,416,28);ctx.stroke();
 ctx.fillStyle='#fffaf0';ctx.font='700 70px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(r.name,384,220,690);
 tx.needsUpdate=true;
}}
function buildRoom(r){
 const root=scene,group=new THREE.Group();group.position.set(r.cx,0,r.cz);group.rotation.y=r.rotation;root.add(group);scene=group;buildTransform=r;
 const tint=new THREE.Color(r.color).getHex();
 softBox(scene,0,-.15,0,9.5,.35,10.5,0xd6d9cb,.1);
 box(scene,0,.04,0,9.2,.06,10.2,tint);
 for(let x=-4.5;x<4.5;x+=.75)for(let z=-5;z<5;z+=1)box(scene,x+.37,.085,z+.5,.72,.025,.97,0xf1e7d1);
 // A colored carpet and pale timber edges tie each interior to its game.
 softBox(scene,0,.12,-.8,6.7,.035,6.6,tint,.01);
 for(const x of [-4.65,4.65])for(const [start,end]of[[-5.2,.8],[3.2,5.2]]){
  const length=end-start,center=(start+end)/2;
  box(scene,x,.45,center,.16,.9,length,0xd1ddd3);solid(x,center,.16,length);
 }
 box(scene,0,.65,-5.2,9.5,1.3,.18,0xd1ddd3);solid(0,-5.2,9.5,.18);
 for(const x of [-3,3]){box(scene,x,.35,5.1,3.3,.7,.18,0xd1ddd3);solid(x,5.1,3.3,.18);}
 // Inward-facing doorway, open enough to walk through.
 for(const x of [-1.1,1.1]){softBox(scene,x,1.25,5,.18,2.5,.3,tint);solid(x,5,.18,.3);}softBox(scene,0,2.5,5,2.4,.18,.3,tint);
 box(scene,0,.14,4.9,1.8,.025,.5,0xeed4a0);
 for(const x of [-3.3,3.3])plant(x,-4.2);
 // Windows, framed artwork, shelves, pendant lighting and seating.
 box(scene,1.8,1.6,-5.05,2.6,1.5,.07,0x7da3a6);box(scene,1.8,1.6,-4.99,2.4,1.3,.04,0xcce5e5);box(scene,1.8,1.6,-4.95,.06,1.35,.06,0x6f9694);
 box(scene,-1.6,1.4,-5.02,1.4,1,.08,0xc5a27b);box(scene,-1.6,1.4,-4.96,1.2,.8,.05,tint);sphere(scene,-1.6,1.4,-4.9,.24,0xffdda0,1,1,.12);
 sofa(2.3,-2.6,tint);coffeeTable(2.2,-.7);
 for(let i=0;i<3;i++){box(scene,-3.8,.3+i*.6,-2.4,.8,.06,1.6,0xc6ad88);for(let n=0;n<5;n++)box(scene,-3.8,.53+i*.6,-3+n*.28,.4,.4,.18,colors[n]);}solid(-3.8,-2.4,.8,1.6);
 if(r.id==='portal'){for(const x of [-1.8,.2]){cylinder(scene,x,.35,-2,.45,.7,0xafd0bd);const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.4),material(0x85c8bc));gem.position.set(x,1,-2);scene.add(gem);solid(x,-2,.9,.9);}for(let z=0;z<1.5;z+=.3)box(scene,-1,.2,z,2,.12,.24,0xc6a278);}
 if(r.id==='cafe'){softBox(scene,-1.5,.6,-2.7,3,1.2,1.2,0x9fbaa5);solid(-1.5,-2.7,3,1.2);for(let i=0;i<3;i++){cylinder(scene,-2.4+i*.8,1.26,-2.7,.23,.08,0xfff5df);sphere(scene,-2.4+i*.8,1.4,-2.7,.16,0xd99e6c);}cylinder(scene,-2,.65,.2,.7,.1,0xd9c5a0);solid(-2,.2,1.4,1.4);officeChair(-2,1.6,tint);}
 if(r.id==='rescue'){for(const [x,z]of[[-2,-2],[-1,-2],[-2,-.9]]){softBox(scene,x,.45,z,.8,.9,.8,0xd0b08b);solid(x,z,.8,.8);}cylinder(scene,-2,.65,1,.6,.1,0xe4cfac);plant(-3,2.7);}
 if(r.id==='train'){for(let x=-2.8;x<1;x+=.3)box(scene,x,.25,-2,.12,.1,1,0xab8d65);for(const z of [-2.35,-1.65])box(scene,-1,.3,z,3.8,.08,.06,0x6b8279);softBox(scene,-1,.65,-2,1.5,.6,.8,0x6eaa95);softBox(scene,-1.5,1.1,-2,.6,.5,.8,0xe0bf6d);solid(-1,-2,3.8,1);}
 if(r.id==='workshop'){desk(-1.5,-2);officeChair(-1.5,-.6,tint);softBox(scene,-2,1.4,2,1.1,.16,.3,0x7bc3b1,.04);softBox(scene,-2,1.4,2,.3,.16,1.1,0x7bc3b1,.04);solid(-2,2,1.8,.5);}
 scene=root;buildTransform=null;makeBoard(r);
}
function buildRoomLinks(){
 for(const link of adjacentRoomLinks()){
  const dx=link.end.x-link.start.x,dz=link.end.z-link.start.z,length=Math.hypot(dx,dz),rotation=Math.atan2(dx,dz);
  const centerX=(link.start.x+link.end.x)/2,centerZ=(link.start.z+link.end.z)/2,path=new THREE.Group();
  path.position.set(centerX,0,centerZ);path.rotation.y=rotation;scene.add(path);
  softBox(path,0,.045,0,3.2,.11,length,0xcbd6cf,.1);
  softBox(path,0,.12,0,2.45,.035,length-.12,0xe6e1d4,.05);
  const glassMaterial=new THREE.MeshBasicMaterial({color:0xa8d4ce,transparent:true,opacity:.46,side:THREE.DoubleSide,depthWrite:false});
  for(const x of [-1.4,1.4]){
   const pane=new THREE.Mesh(new THREE.PlaneGeometry(length-.55,1.45),glassMaterial);
   pane.rotation.y=Math.PI/2;pane.position.set(x,1.34,0);path.add(pane);
   for(const z of [-length/2,0,length/2])box(path,x,1.15,z,.1,2.1,.1,0x6da6a0);
   box(path,x,2.2,0,.1,.1,length,0x6da6a0);
   obstacles.push({x:centerX+x*Math.cos(rotation),z:centerZ-x*Math.sin(rotation),w:.58,d:length/2+.38,rotation});
  }
 }
}
const lobbyAccents=[];
function buildWalkway(r){
 const length=Math.hypot(r.x,r.z),root=scene,path=new THREE.Group();
 path.rotation.y=r.rotation;root.add(path);
 softBox(path,0,.045,-length/2,4.35,.11,length,0xcbd6cf,.12);
 softBox(path,0,.12,-length/2,3.35,.035,length-.18,0xe6e1d4,.05);
 for(let z=-.6;z>-length;z-=1.1){
  for(const x of [-1.12,0,1.12]){
   const shade=(Math.round(Math.abs(z)*10)+Math.round(Math.abs(x)*10))%2?0xd4c9b5:0xe9dfce;
   softBox(path,x,.17,z,.98,.045,.83,shade,.06);
  }
 }
 for(const x of [-1.83,1.83])box(path,x,.17,-length/2,.055,.04,length-.2,0x6da6a0);
 softBox(path,0,.19,-length+.35,3.1,.07,.45,new THREE.Color(r.color).getHex(),.06);
 const x=3.8,z=-length*.57,shade=new THREE.Color(r.color).getHex();
 if(r.id==='portal'){
  cylinder(path,x,.24,z,.78,.42,0x426b70);cylinder(path,x,.49,z,.55,.09,0xb6d5cb);
  for(const dx of [-.25,.25]){const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.42),material(0x84d8cf));gem.position.set(x+dx,.98,z);gem.rotation.z=dx;path.add(gem);lobbyAccents.push(gem);}
 }else if(r.id==='cafe'){
  softBox(path,x,.68,z,1.75,1.1,1.1,0x547b70,.12);softBox(path,x,1.29,z,2.05,.14,1.3,0xe7b56f,.08);
  for(const dx of [-.75,.75])cylinder(path,x+dx,1.65,z,.075,.65,0x5b6670);
  cylinder(path,x-.28,1.38,z+.12,.2,.08,0xfff1d8);cylinder(path,x-.28,1.55,z+.12,.115,.28,0xc98963);
 }else if(r.id==='rescue'){
  for(const [dx,dz,color]of[[-.45,0,0xd9a779],[.42,-.22,0xbca7d2],[.4,.34,0x84a99b]])softBox(path,x+dx,.55,z+dz,.75,.72,.72,color,.1);
  softBox(path,x,.18,z,1.9,.12,1.6,0x596c67,.05);
  sphere(path,x,1.25,z,.3,shade,.8,1.3,.8);
 }else if(r.id==='train'){
  box(path,x,.95,z,.12,1.9,.12,0x526a70);softBox(path,x,.38,z,.7,.14,.65,0x526a70,.08);
  for(let i=0;i<3;i++)sphere(path,x,.9+i*.42,z,.2,[0x81c8a4,0xf0c765,0xe47e73][i],.9,.9,.42);
  cylinder(path,x,2.25,z,.53,.12,0xe7d9bb);
 }else{
  softBox(path,x,1.15,z,1.55,.22,.34,0x417c7d,.05);softBox(path,x,1.15,z,.34,.22,1.55,shade,.05);
  cylinder(path,x,.3,z,.72,.35,0x3d5960);
 }
}
function buildFountain(){
 const basin=cylinder(scene,0,.34,0,1.65,.55,0x436c72);
 cylinder(scene,0,.64,0,1.42,.08,0xa9d2c8);
 const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.7),material(0x72c9c4));crystal.position.set(0,1.5,0);scene.add(crystal);lobbyAccents.push(crystal);
}
function buildWorld(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0xdce7e2);scene.fog=new THREE.Fog(0xdce7e2,65,110);
 scene.add(new THREE.HemisphereLight(0xf6fbf3,0x7d9a95,1.55));const sun=new THREE.DirectionalLight(0xfff0d8,1.9);sun.position.set(-12,28,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30});sun.shadow.normalBias=.035;scene.add(sun);
 cylinder(scene,0,-.32,0,23,.6,0xaeb8c4);
 softBox(scene,0,.015,0,21,.08,20,0xe3e9df,.02);
 softBox(scene,-4,.065,2,6,.02,9,0xd6cfe1,.01);softBox(scene,4,.065,-2,6,.02,9,0xcadfd6,.01);
 for(let x=-9;x<=9;x+=1.5)box(scene,x,.07,0,.018,.012,18,0xd2d8d0);
 for(let z=-9;z<=9;z+=1.5)box(scene,0,.07,z,18,.012,.018,0xd2d8d0);

 for(const r of gameRooms){buildWalkway(r);buildRoom(r);}
 buildRoomLinks();
 buildFountain();
 solid(0,0,3,3);
 for(let i=0;i<5;i++){const a=(-54+i*72)*Math.PI/180,x=Math.sin(a)*6,z=Math.cos(a)*6;const fabric=[0xe8a78b,0xaca0d4,0x8abbaa,0xe6c878,0x91bace][i];softBox(scene,x,.37,z,1.25,.5,1.25,fabric,.13);softBox(scene,x,.78,z-.45,1.2,.55,.25,fabric,.09);for(const dx of [-.43,.43])for(const dz of [-.4,.4])cylinder(scene,x+dx,.12,z+dz,.04,.22,0x514b60);solid(x,z,1.4,1.4);const px=Math.sin(a)*8,pz=Math.cos(a)*8;plant(px,pz);}
 hero=character(selected);hero.position.set(0,0,4);scene.add(hero);
 for(const [i,x,z]of[[3,-3,1],[5,3,-2],[8,5,3]]){const npc=character(i);npc.position.set(x,0,z);scene.add(npc);walkers.push({mesh:npc,x,z});}
 camera=new THREE.PerspectiveCamera(45,1,.1,150);camera.position.set(8,30,34);camera.lookAt(0,0,0);
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-hidden','true');host.prepend(renderer.domElement);
 drawBoards();
 const boardRaycaster=new THREE.Raycaster(),boardPointer=new THREE.Vector2();
 const roomBoardAtPointer=event=>{
  const bounds=renderer.domElement.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return null;
  boardPointer.set((event.clientX-bounds.left)/bounds.width*2-1,-((event.clientY-bounds.top)/bounds.height)*2+1);
  boardRaycaster.setFromCamera(boardPointer,camera);
  const hit=boardRaycaster.intersectObjects(signs.map(item=>item.sign))[0];
  return hit&&signs.find(item=>item.sign===hit.object);
 };
 renderer.domElement.addEventListener('pointermove',event=>{renderer.domElement.style.cursor=roomBoardAtPointer(event)?'pointer':'crosshair';});
 renderer.domElement.addEventListener('click',event=>{const board=roomBoardAtPointer(event);if(board)openRoomDetails(board.r.id);});
 new ResizeObserver(resize).observe(host);resize();
}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
function canMove(x,z){return Math.hypot(x,z)<23&&!obstacles.some(o=>{const dx=x-o.x,dz=z-o.z,c=Math.cos(o.rotation),a=Math.sin(o.rotation);return Math.abs(dx*c-dz*a)<o.w&&Math.abs(dx*a+dz*c)<o.d;});}
function setAvatar(index){selected=index;if(!hero)return;const replacement=character(index);replacement.position.copy(hero.position);replacement.rotation.copy(hero.rotation);scene.remove(hero);hero.traverse(o=>o.geometry?.dispose());hero=replacement;scene.add(hero);}
let last=performance.now();
function frame(now){requestAnimationFrame(frame);if(!renderer)return;const dt=Math.min((now-last)/1000,.04);last=now;const t=now/1000;let moving=false;
 if(active&&worldView&&(!window.playhouseLive?.online||window.playhouseLive.connected)&&!window.playhouseGameOpen&&!detailsOpen&&document.activeElement===host&&!document.hidden){let dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),dz=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));if(dx||dz){const l=Math.hypot(dx,dz);dx/=l;dz/=l;const x=(dx*.953+dz*.303)*dt*4.8,z=(-dx*.303+dz*.953)*dt*4.8;if(canMove(hero.position.x+x,hero.position.z)){hero.position.x+=x;moving=true;}if(canMove(hero.position.x,hero.position.z+z)){hero.position.z+=z;moving=true;}hero.rotation.y=Math.atan2(x,z);}}
 if(moving&&window.playhouseLive?.online)window.playhouseLive.move({x:hero.position.x,y:0,z:hero.position.z},hero.rotation.y);
 for(const peer of livePeers.values()){const movingPeer=Math.hypot(peer.mesh.position.x-peer.target.x,peer.mesh.position.z-peer.target.z)>.02;peer.mesh.position.lerp(new THREE.Vector3(peer.target.x,0,peer.target.z),Math.min(1,dt*12));peer.mesh.rotation.y=peer.rotation;animateCharacter(peer.mesh,t,movingPeer);}
 animateCharacter(hero,t,moving);walkers.forEach((npc,i)=>animateCharacter(npc.mesh,t+i,false));portalTarget=nearbyRoom(hero.position);
 hint.textContent=portalTarget?`Enter / K · ${portalTarget.name} · H or click its sign for details`:'WASD / arrows · Move · Enter at a doorway to play · Click a sign for details';
 if(!reduced.matches)lobbyAccents.forEach((accent,i)=>{accent.rotation.y+=(i%2?1:-1)*dt*.32;});
 const focus=new THREE.Vector3(hero.position.x*.35,0,hero.position.z*.35);cameraTarget.lerp(focus,reduced.matches?1:Math.min(1,dt*4));camera.position.copy(cameraTarget).add(new THREE.Vector3(8*zoom,30*zoom,34*zoom));camera.lookAt(cameraTarget);
 host.dataset.playerX=hero.position.x.toFixed(2);host.dataset.playerZ=hero.position.z.toFixed(2);host.dataset.nearbyGame=portalTarget?.id||'';host.dataset.currentRoom=currentRoom;
 if(worldView&&!window.playhouseGameOpen&&!document.hidden)renderer.render(scene,camera);
}
try{buildWorld();requestAnimationFrame(frame);}catch(error){hint.textContent='3D could not start. Enable WebGL and reload.';console.error(error);}
function clearKeys(){keys.clear();}
window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);host.addEventListener('blur',clearKeys);
// Clicking anywhere on the open floor returns keyboard control to walking.
host.addEventListener('pointerdown',e=>{if(e.target===renderer?.domElement)host.focus();});
host.addEventListener('keydown',event=>{
 const key=event.key.toLowerCase();
 if(event.target!==host)return;
 if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){event.preventDefault();keys.add(key);}
 if(key==='h'&&portalTarget){event.preventDefault();openRoomDetails(portalTarget.id);}
 if((key==='enter'||key==='k')&&!event.repeat){
  const action=lobbyEnterAction(portalTarget?.id);
  if(action==='enter-room'&&portalTarget&&canEnterRoom(portalTarget.id,hero.position)){event.preventDefault();clearKeys();window.dispatchEvent(new CustomEvent('playhouse-enter-game',{detail:{id:portalTarget.id}}));}
 }
});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('hashchange',()=>{worldView=location.hash==='#lobby'||!location.hash;clearKeys();if(worldView)requestAnimationFrame(resize);});
const controls=document.createElement('div');controls.className='camera-controls';for(const [text,delta]of[['Zoom in',-.15],['Zoom out',.15]]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{zoom=THREE.MathUtils.clamp(zoom+delta,.6,1.5);host.focus();};controls.append(b);}host.append(controls);
// Welcome gate uses explicitly fake credentials; never stores entered passwords.
const gate=document.querySelector('#welcome');
const appShell=[document.querySelector('.sidebar'),document.querySelector('main')];
appShell.forEach(el=>el.hidden=true);
const picker=document.querySelector('#welcome-avatars');
const symbols=['🦊','🧭','🧙','🌿','🌷','🧚','🛡','🌙','🦁','🎻'];
for(let i=0;i<20;i++){const button=document.createElement('button');button.type='button';button.className='character-tile';button.setAttribute('aria-pressed',String(i===0));button.innerHTML=`<span aria-hidden="true">${symbols[i%10]}</span><strong>${names[i]}</strong>`;button.onclick=()=>{setAvatar(i);picker.querySelectorAll('button').forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));document.querySelector('#chosen-name').textContent=names[i];};picker.append(button);}
function selectStep(){document.querySelector('#login-step').hidden=true;document.querySelector('#character-step').hidden=false;document.querySelector('#character-title').focus();}
window.addEventListener('playhouse-authenticated',selectStep);
window.addEventListener('playhouse-online-enter',()=>{gate.hidden=true;appShell.forEach(el=>el.hidden=false);active=true;worldView=true;location.hash='lobby';requestAnimationFrame(resize);host.focus();});
document.querySelector('#demo-enter').onclick=selectStep;
document.querySelector('#login-form').onsubmit=event=>{event.preventDefault();const email=document.querySelector('#login-email'),password=document.querySelector('#login-password');if(email.value==='explorer@example.test'&&password.value==='playhouse-demo'){password.value='';document.querySelector('#login-error').textContent='';selectStep();}else{password.value='';document.querySelector('#login-error').textContent='Use the sample credentials shown below, or choose Explore demo.';}};
document.querySelector('#enter-world').onclick=()=>{document.querySelector(`#avatar-picker input[value="avatar-${String(selected+1).padStart(2,'0')}"]`).checked=true;document.querySelector('#profile-form').requestSubmit();gate.hidden=true;appShell.forEach(el=>el.hidden=false);active=true;worldView=true;location.hash='lobby';requestAnimationFrame(resize);host.focus();};
document.querySelector('#sign-out-demo').onclick=()=>{active=false;clearKeys();gate.hidden=false;appShell.forEach(el=>el.hidden=true);document.querySelector('#character-step').hidden=true;document.querySelector('#login-step').hidden=false;document.querySelector('#login-email').focus();};
document.querySelector('#profile-form').addEventListener('submit',()=>{if(document.querySelector('#display-name').getAttribute('aria-invalid')!=='true')setAvatar(Number(new FormData(document.querySelector('#profile-form')).get('avatarId').slice(-2))-1);});
// Update the existing picker descriptions to match the 3D roster.
document.querySelectorAll('#avatar-picker input').forEach((input,i)=>{input.setAttribute('aria-label',names[i]);input.parentElement.title=names[i];input.nextElementSibling.textContent=symbols[i%10];});
// Portraits are rendered from the same models used in the walkable world.
if(renderer){
 const portraits=[],portraitScene=new THREE.Scene();portraitScene.background=new THREE.Color(0xe5eadc);
 portraitScene.add(new THREE.HemisphereLight(0xfff6e1,0x8a9e8c,2.8));
 const light=new THREE.DirectionalLight(0xffead0,3);light.position.set(-3,5,5);portraitScene.add(light);
 const portraitCamera=new THREE.PerspectiveCamera(33,1,.1,20);portraitCamera.position.set(1.5,2.1,5);portraitCamera.lookAt(0,1.25,0);
 renderer.setSize(160,160,false);
 for(let i=0;i<20;i++){
  const model=character(i);portraitScene.add(model);renderer.render(portraitScene,portraitCamera);
  const url=renderer.domElement.toDataURL('image/png');portraits.push(url);
  const image=document.createElement('img');image.src=url;image.alt='';image.width=100;image.height=100;
  picker.children[i].querySelector('span').replaceChildren(image);
  const icon=document.querySelectorAll('#avatar-picker input')[i].nextElementSibling;icon.replaceChildren(image.cloneNode());
  portraitScene.remove(model);model.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();});
 }
 function portrait(){document.querySelectorAll('.my-avatar').forEach(el=>{const image=document.createElement('img');image.src=portraits[selected];image.alt=names[selected];el.replaceChildren(image);});}
 document.querySelector('#profile-form').addEventListener('submit',()=>{if(document.querySelector('#display-name').getAttribute('aria-invalid')!=='true')portrait();});
 portrait();resize();
}

window.addEventListener('hashchange',()=>{if(active&&location.hash==='#lobby')requestAnimationFrame(()=>host.focus());});
