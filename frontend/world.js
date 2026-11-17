import {character,animateCharacter,names,colors} from './characters.js';
import * as THREE from './vendor/three.module.js';
import {rooms as gameRooms,nearbyRoom,canEnterRoom} from './games/rooms.js';

const host = document.querySelector('#world');
host.replaceChildren();
host.setAttribute('aria-label', '3D playhouse. WASD or arrow keys to walk. K enters a nearby game. Tab leaves the world.');
const hint = document.createElement('div'); hint.className = 'world-hint'; hint.textContent = 'Click the world, then WASD to explore'; host.append(hint);


let selected = 0, active = false, worldView = true;
let currentRoom='lobby', zoom=1, lockedExample=false, activeGameId=null, dismissedRoom=null;
let buildTransform=null;
let updateRoomBoards=()=>{};
const nearbyBoard=document.createElement('section');nearbyBoard.className='nearby-game-board';nearbyBoard.hidden=true;nearbyBoard.setAttribute('aria-label','Nearby game rules');host.append(nearbyBoard);
let boardKey='';
function dismissBoard(){dismissedRoom=portalTarget?.id;nearbyBoard.hidden=true;host.focus();}
nearbyBoard.addEventListener('click',e=>{if(e.target.closest('[data-dismiss-board]'))dismissBoard();});
const cameraTarget=new THREE.Vector3(0,0,2);
const keys = new Set();
const obstacles = [];
let scene, camera, renderer, hero, portalTarget;
const walkers = [], portals = [];
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
 const point=roomPoint(r,-2.5,5.3),cv=document.createElement('canvas');cv.width=768;cv.height=440;const tx=new THREE.CanvasTexture(cv);tx.colorSpace=THREE.SRGBColorSpace;
 const sign=new THREE.Sprite(new THREE.SpriteMaterial({map:tx,depthTest:true}));sign.position.set(point.x,2.2,point.z);sign.scale.set(3.8,2.18,1);scene.add(sign);signs.push({r,cv,tx,sign,point});
 cylinder(scene,point.x,.6,point.z,.045,1.2,0x657b70);solid(point.x,point.z,.15,.15);
}
function drawBoards(){for(const {r,cv,tx}of signs){const ctx=cv.getContext('2d'),locked=lockedExample&&r.id==='workshop',playing=activeGameId===r.id;ctx.fillStyle='#fffdf4';ctx.fillRect(0,0,768,440);ctx.fillStyle=locked?'#a26558':playing?'#a5833e':'#3a7864';ctx.fillRect(0,0,768,62);ctx.fillStyle='#fff';ctx.font='bold 29px sans-serif';ctx.fillText(locked?'LOCKED · DEMO':playing?'PLAYING · PRACTICE':'OPEN · K TO PLAY',28,42);ctx.fillStyle='#294d43';ctx.font='bold 35px sans-serif';ctx.fillText(r.name,28,114,710);ctx.font='24px sans-serif';let y=160;for(const text of [r.description,...r.steps]){let line='';for(const word of text.split(' ')){if(ctx.measureText(line+word).width>705){ctx.fillText(line,28,y);line='';y+=29;}line+=word+' ';}ctx.fillText(line,28,y);y+=33;}tx.needsUpdate=true;}}
updateRoomBoards=drawBoards;
function buildRoom(r){
 const root=scene,group=new THREE.Group();group.position.set(r.cx,0,r.cz);group.rotation.y=r.rotation;root.add(group);scene=group;buildTransform=r;
 const tint=new THREE.Color(r.color).getHex();
 softBox(scene,0,-.15,0,9.5,.35,10.5,0xd6d9cb,.1);
 box(scene,0,.04,0,9.2,.06,10.2,tint);
 for(let x=-4.5;x<4.5;x+=.75)for(let z=-5;z<5;z+=1)box(scene,x+.37,.085,z+.5,.72,.025,.97,0xf1e7d1);
 // A colored carpet and pale timber edges tie each interior to its game.
 softBox(scene,0,.12,-.8,6.7,.035,6.6,tint,.01);
 for(const x of [-4.65,4.65]){box(scene,x,.45,0,.16,.9,10.4,0xd1ddd3);solid(x,0,.16,10.4);}
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
 if(r.id==='workshop'){desk(-1.5,-2);officeChair(-1.5,-.6,tint);const ring=new THREE.Mesh(new THREE.TorusGeometry(.8,.12,12,40),material(0x7bc3b1));ring.position.set(-2,1.4,2);scene.add(ring);solid(-2,2,1.8,.5);}
 scene=root;buildTransform=null;makeBoard(r);
}
function buildWorld(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0xe1e9df);scene.fog=new THREE.Fog(0xe1e9df,65,110);
 scene.add(new THREE.HemisphereLight(0xfff7e8,0x92ab98,2));const sun=new THREE.DirectionalLight(0xffedd2,2.4);sun.position.set(-12,28,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30});sun.shadow.normalBias=.035;scene.add(sun);
 cylinder(scene,0,-.32,0,23,.6,0xb9cbb5);cylinder(scene,0,.015,0,10.5,.08,0xeadfc8);
 const trim=new THREE.Mesh(new THREE.RingGeometry(8.8,9.2,96),material(0xc4b28f));trim.rotation.x=-Math.PI/2;trim.position.y=.07;scene.add(trim);
 for(const r of gameRooms){const path=new THREE.Group();path.rotation.y=r.rotation;scene.add(path);box(path,0,.07,-8.5,2.4,.04,6,0xf3ead9);buildRoom(r);}
 // Compact courtyard: seats and planting stay between the five radial paths.
 cylinder(scene,0,.3,0,1.5,.6,0xe4ddcd);cylinder(scene,0,.62,0,1.35,.04,0x6c8464);solid(0,0,3,3);
 for(let i=0;i<10;i++){const a=i*2.4;const leaf=sphere(scene,Math.sin(a)*.8,1+(i%3)*.2,Math.cos(a)*.8,.35,i%2?0x659b78:0x8ab58b,.6,1.7,.8);leaf.rotation.z=Math.sin(a)*.5;}
 for(let i=0;i<5;i++){const a=(-54+i*72)*Math.PI/180,x=Math.sin(a)*6,z=Math.cos(a)*6;cylinder(scene,x,.35,z,.7,.65,[0xd6ac91,0xb7b6d2,0xa3c5b6,0xe0ca91,0xa4c2cd][i]);solid(x,z,1.4,1.4);const px=Math.sin(a)*8,pz=Math.cos(a)*8;plant(px,pz);}
 hero=character(selected);hero.position.set(0,0,4);scene.add(hero);
 for(const [i,x,z]of[[3,-3,1],[5,3,-2],[8,5,3]]){const npc=character(i);npc.position.set(x,0,z);scene.add(npc);walkers.push({mesh:npc,x,z});}
 camera=new THREE.PerspectiveCamera(45,1,.1,150);camera.position.set(8,30,34);camera.lookAt(0,0,0);
 renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.domElement.setAttribute('aria-hidden','true');host.prepend(renderer.domElement);
 drawBoards();new ResizeObserver(resize).observe(host);resize();
}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
function canMove(x,z){return Math.hypot(x,z)<23&&!obstacles.some(o=>{const dx=x-o.x,dz=z-o.z,c=Math.cos(o.rotation),a=Math.sin(o.rotation);return Math.abs(dx*c-dz*a)<o.w&&Math.abs(dx*a+dz*c)<o.d;});}
function setAvatar(index){selected=index;if(!hero)return;const replacement=character(index);replacement.position.copy(hero.position);replacement.rotation.copy(hero.rotation);scene.remove(hero);hero.traverse(o=>o.geometry?.dispose());hero=replacement;scene.add(hero);}
let last=performance.now();
function frame(now){requestAnimationFrame(frame);if(!renderer)return;const dt=Math.min((now-last)/1000,.04);last=now;const t=now/1000;let moving=false;
 if(active&&worldView&&!window.playhouseGameOpen&&document.activeElement===host&&!document.hidden){let dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),dz=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));if(dx||dz){const l=Math.hypot(dx,dz);dx/=l;dz/=l;const x=(dx*.953+dz*.303)*dt*4.8,z=(-dx*.303+dz*.953)*dt*4.8;if(canMove(hero.position.x+x,hero.position.z)){hero.position.x+=x;moving=true;}if(canMove(hero.position.x,hero.position.z+z)){hero.position.z+=z;moving=true;}hero.rotation.y=Math.atan2(x,z);}}
 animateCharacter(hero,t,moving);walkers.forEach((npc,i)=>animateCharacter(npc.mesh,t+i,false));portalTarget=nearbyRoom(hero.position);
 if(dismissedRoom&&dismissedRoom!==portalTarget?.id)dismissedRoom=null;
 const locked=lockedExample&&portalTarget?.id==='workshop',nextKey=(portalTarget?.id||'')+locked;
 if(nextKey!==boardKey){boardKey=nextKey;if(portalTarget){const r=portalTarget;nearbyBoard.innerHTML='<button class="board-dismiss" data-dismiss-board aria-label="Close rules">×</button><span class="room-state">'+(locked?'LOCKED · DEMO':'OPEN · PRACTICE')+'</span><h2>'+r.name+'</h2><p>'+r.description+'</p><ol>'+r.steps.map(t=>'<li>'+t+'</li>').join('')+'</ol><p class="board-controls">WASD: walk · E: interact · Q: switch · R: rotate</p><strong>'+(locked?'Turn off the locked-room example to play':'K to play · '+Math.round(r.time/60)+' minutes')+'</strong><small>Esc closes rules · H shows them again</small>';}}
 nearbyBoard.hidden=!portalTarget||dismissedRoom===portalTarget.id||window.playhouseGameOpen;
 hint.textContent=portalTarget?(locked?'Locked example · switch it off to play':'K · '+portalTarget.name+' · H rules · Esc dismiss'):'WASD / arrows · Walk to any room · K to play';
 const focus=new THREE.Vector3(hero.position.x*.35,0,hero.position.z*.35);cameraTarget.lerp(focus,reduced.matches?1:Math.min(1,dt*4));camera.position.copy(cameraTarget).add(new THREE.Vector3(8*zoom,30*zoom,34*zoom));camera.lookAt(cameraTarget);
 if(portalTarget){const sign=signs.find(s=>s.r.id===portalTarget.id),point=new THREE.Vector3(sign.point.x,3.2,sign.point.z).project(camera);nearbyBoard.style.left=Math.max(8,Math.min(host.clientWidth-312,(point.x+1)*host.clientWidth/2-150))+'px';nearbyBoard.style.top=Math.max(55,Math.min(host.clientHeight-nearbyBoard.offsetHeight-55,(1-point.y)*host.clientHeight/2))+'px';}
 host.dataset.playerX=hero.position.x.toFixed(2);host.dataset.playerZ=hero.position.z.toFixed(2);host.dataset.nearbyGame=portalTarget?.id||'';host.dataset.currentRoom=currentRoom;
 if(worldView&&!window.playhouseGameOpen&&!document.hidden)renderer.render(scene,camera);
}
try{buildWorld();requestAnimationFrame(frame);}catch(error){hint.textContent='3D could not start. Enable WebGL and reload.';console.error(error);}
function clearKeys(){keys.clear();}
window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);host.addEventListener('blur',clearKeys);
// Clicking anywhere on the open floor returns keyboard control to walking.
host.addEventListener('pointerdown',e=>{if(e.target===renderer?.domElement)host.focus();});
host.addEventListener('keydown',event=>{const key=event.key.toLowerCase();if(key==='escape'&&!nearbyBoard.hidden){event.preventDefault();dismissBoard();return;}if(event.target!==host)return;if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){event.preventDefault();keys.add(key);}if(key==='h'&&portalTarget){dismissedRoom=null;event.preventDefault();}if(key==='k'&&portalTarget&&!event.repeat){event.preventDefault();if(canEnterRoom(portalTarget.id,hero.position,lockedExample)){clearKeys();window.dispatchEvent(new CustomEvent('playhouse-enter-game',{detail:{id:portalTarget.id}}));}}});
window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('hashchange',()=>{worldView=location.hash==='#lobby'||!location.hash;clearKeys();if(worldView)requestAnimationFrame(resize);});
window.addEventListener('playhouse-game-status',e=>{activeGameId=e.detail?.id||null;drawBoards();});
const controls=document.createElement('div');controls.className='camera-controls';for(const [text,delta]of[['Zoom in',-.15],['Zoom out',.15]]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{zoom=THREE.MathUtils.clamp(zoom+delta,.6,1.5);host.focus();};controls.append(b);}host.append(controls);
const toggle=document.createElement('label');toggle.className='room-demo-toggle';toggle.innerHTML='<input type="checkbox" id="locked-room-demo"> Show one locked-room example';host.append(toggle);toggle.querySelector('input').onchange=e=>{lockedExample=e.target.checked;drawBoards();host.focus();};
// Welcome gate uses explicitly fake credentials; never stores entered passwords.
const gate=document.querySelector('#welcome');
const appShell=[document.querySelector('.sidebar'),document.querySelector('main')];
appShell.forEach(el=>el.hidden=true);
const picker=document.querySelector('#welcome-avatars');
const symbols=['🦊','🧭','🧙','🌿','🌷','🧚','🛡','🌙','🦁','🎻'];
for(let i=0;i<20;i++){const button=document.createElement('button');button.type='button';button.className='character-tile';button.setAttribute('aria-pressed',String(i===0));button.innerHTML=`<span aria-hidden="true">${symbols[i%10]}</span><strong>${names[i]}</strong>`;button.onclick=()=>{setAvatar(i);picker.querySelectorAll('button').forEach((b,j)=>b.setAttribute('aria-pressed',String(j===i)));document.querySelector('#chosen-name').textContent=names[i];};picker.append(button);}
function selectStep(){document.querySelector('#login-step').hidden=true;document.querySelector('#character-step').hidden=false;document.querySelector('#character-title').focus();}
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
