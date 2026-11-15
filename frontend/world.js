import * as THREE from './vendor/three.module.js';

const host = document.querySelector('#world');
const legacyPortals = [...host.querySelectorAll('[data-room]')];
host.replaceChildren();
legacyPortals.forEach(button => { button.hidden = true; host.append(button); });
host.setAttribute('aria-label', '3D playhouse. WASD or arrow keys to walk. E enters a nearby portal. Tab leaves the world.');
const hint = document.createElement('div'); hint.className = 'world-hint'; hint.textContent = 'Click the world, then WASD to explore'; host.append(hint);
const colors = [0xe89e55,0x97b6cc,0xb5a0ce,0x9fbc7a,0xdb9d9e,0x86bcaf,0xb8a585,0xa8b4d5,0xd1b575,0xc39fb1];
const names = ['Ember Fox','Cloud Scout','Violet Mage','Fern Keeper','Rose Ranger','River Sprite','Acorn Knight','Moon Explorer','Sunbeam Cub','Berry Bard','Copper Fox','Frost Scout','Twilight Mage','Moss Keeper','Peach Ranger','Lagoon Sprite','Oak Knight','Star Explorer','Honey Cub','Plum Bard'];
let selected = 0, active = false, worldView = true;
let currentRoom='lobby', zoom=1;
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
function solid(x,z,w,d){obstacles.push({x,z,w:w/2+.38,d:d/2+.38});}
function character(index){
 const g=new THREE.Group(),kind=index%10;
 const tint=index<10?colors[kind]:new THREE.Color(colors[kind]).offsetHSL(.055,.03,-.08).getHex();
 const skin=[0xf2cfac,0xc38b68,0xe3b48d,0x986447][index%4];
 const animal=kind===0||kind===8;
 const head=new THREE.Group();head.position.y=1.67;g.add(head);
 const body=sphere(g,0,.99,0,.37,tint,1,1.35,.85);
 sphere(head,0,0,0,.47,animal?tint:skin,1,1.04,.92);
 const eyes=[];
 for(const side of [-1,1]){
  // Cream eye surrounds, dark irises, highlights and brows make faces readable.
  sphere(head,side*.19,.015,.38,.14,0xfff5df,.85,1.15,.36);
  const eye=sphere(head,side*.19,.022,.425,.087,0x303c40,.8,1.15,.45);eyes.push(eye);
  sphere(eye,-.025,.03,.07,.019,0xffffff);
  const brow=sphere(head,side*.19,.2,.37,.115,animal?0x865033:0x574235,1,.2,.35);brow.rotation.z=side*-.12;
  sphere(head,side*.32,-.14,.33,.095,animal?0xf9d7b2:0xe29b8e,1,.5,.3);
 }
 if(animal){
  sphere(head,0,-.18,.39,.21,0xffedcf,1.12,.7,.65);
  sphere(head,0,-.11,.54,.075,0x4d3b36,1,.7,.65);
  for(const side of [-1,1]){
   const ear=cone(head,side*.33,.49,-.01,.19,.55,tint);ear.rotation.z=side*-.2;
   const inner=cone(head,side*.33,.5,.075,.115,.35,0xeeb5a6);inner.rotation.z=side*-.2;
  }
 }else{
  sphere(head,0,-.09,.46,.08,skin,.8,.8,.9);
  for(const side of [-1,1])sphere(head,side*.45,-.04,0,.11,skin,.6,1,.75);
  // Layered hair clumps avoid a single helmet-like cap.
  const hair=[0x5e4134,0x40393b,0xb0784b,0x785342][index%4];
  sphere(head,0,.25,-.12,.45,hair,1,.72,.95);
  for(let j=0;j<5;j++){const tuft=sphere(head,-.32+j*.16,.29-Math.sin(j)*.05,.25,.16,hair,.9,1.15,.65);tuft.rotation.z=-.35;}
 }
 // Smile curve, jacket seam, buttons, scarf and satchel.
 const smileCurve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.09,-.235,.438),new THREE.Vector3(0,-.3,.48),new THREE.Vector3(.09,-.235,.438));
 head.add(new THREE.Mesh(new THREE.TubeGeometry(smileCurve,10,.012,5,false),material(0x835443)));
 box(g,0,1,.315,.025,.55,.025,0xf0d5a0);
 for(const y of [.87,1.08])sphere(g,.08,y,.33,.03,0xd7b77a);
 sphere(g,0,1.32,.03,.35,0xf4cc7e,1,.24,1);
 const scarf=box(g,.14,1.12,.36,.14,.4,.06,0xf4cc7e);scarf.rotation.z=-.18;
 const strap=box(g,0,1.02,.34,.1,.72,.04,0x8b684b);strap.rotation.z=-.55;
 sphere(g,-.36,.8,.1,.2,0x9e7853,.55,1,.8);
 const limbs=[];
 for(const side of [-1,1]){
  const leg=new THREE.Group();leg.position.set(side*.18,.65,0);
  sphere(leg,0,-.19,0,.13,0x536272,.9,1.8,.95);
  sphere(leg,0,-.48,.08,.16,0x5c4439,1,.65,1.5);sphere(leg,0,-.55,.07,.16,0xb29a7e,1,.18,1.5);
  g.add(leg);limbs.push(leg);
  const arm=new THREE.Group();arm.position.set(side*.34,1.25,0);arm.rotation.z=side*.12;
  sphere(arm,side*.04,-.2,0,.13,tint,1,1.85,1);
  sphere(arm,side*.05,-.43,.015,.12,animal?tint:skin,.85,1,.85);
  g.add(arm);limbs.push(arm);
 }
 let tail;
 if(animal){tail=new THREE.Group();tail.position.set(0,.73,-.24);sphere(tail,0,.16,-.33,.25,tint,.9,1.2,1.9);sphere(tail,0,.3,-.65,.19,0xffe8c6,.95,1,1.3);g.add(tail);}
 else if(kind===2){cone(head,0,.7,-.03,.43,.8,tint);sphere(head,0,.36,0,.48,tint,1,.12,1);sphere(head,.02,1.1,-.03,.065,0xf6d58c);}
 else if(kind===5){for(const side of [-1,1]){const wing=sphere(g,side*.41,1.2,-.28,.42,0xc4e0cf,.7,1.2,.13);wing.rotation.z=side*.35;}}
 else if(kind===6){sphere(head,0,.26,-.08,.49,0xaab5ad,1,.65,.95);box(head,0,.56,-.02,.1,.3,.4,0xd3ae69);}
 else if(kind===3||kind===4||kind===9){sphere(head,.32,.25,.15,.11,kind===4?0xe99da5:0xd8c778);for(let j=0;j<5;j++)sphere(head,.32+Math.cos(j*1.26)*.13,.25+Math.sin(j*1.26)*.13,.17,.085,kind===3?0x85a96c:0xe7b5bf,1,1,.4);}
 else{sphere(head,0,.3,0,.48,tint,1,.45,1);sphere(head,0,.3,.37,.29,tint,1,.12,1);}
 g.userData={limbs,body,index,head,eyes,tail,gait:0};return g;
}
function animateCharacter(g,t,moving){
 const data=g.userData,blend=moving?1:0;
 data.gait=THREE.MathUtils.lerp(data.gait,blend,.18);
 g.position.y=reduced.matches?0:Math.abs(Math.sin(t*9))*data.gait*.055;
 data.limbs.forEach((limb,i)=>{limb.rotation.x=Math.sin(t*9+(i<2?0:Math.PI))*.6*(i%2?-1:1)*data.gait;});
 data.body.rotation.z=reduced.matches?0:Math.sin(t*4.5)*.035*data.gait;
 data.head.rotation.z=reduced.matches?0:Math.sin(t*1.1+data.index)*.035*(1-data.gait);
 const blink=!reduced.matches&&((t+data.index*.31)%4.6)<.13;
 data.eyes.forEach(eye=>eye.scale.y=blink?.12:1.15);
 if(data.tail)data.tail.rotation.y=reduced.matches?0:Math.sin(t*3)*.22;
}
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
function label(text,x,z){const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');ctx.fillStyle='#faf5e9';ctx.fillRect(0,0,512,96);ctx.fillStyle='#354940';ctx.font='bold 29px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,59);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));sprite.position.set(x,3.6,z);sprite.scale.set(3.8,.71,1);scene.add(sprite);}
function portal(id,x,z,color,title){const g=new THREE.Group();g.position.set(x,0,z);box(g,-.85,1.3,0,.25,2.6,.5,color);box(g,.85,1.3,0,.25,2.6,.5,color);box(g,0,2.6,0,1.95,.3,.5,color);const glow=new THREE.Mesh(new THREE.PlaneGeometry(1.4,2.25),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.4,transparent:true,opacity:.6,side:THREE.DoubleSide}));glow.position.y=1.3;g.add(glow);scene.add(g);portals.push({id,x,z,glow});label(title,x,z);solid(x-.85,z,.25,.5);solid(x+.85,z,.25,.5);}
function buildWorld(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0xdce5df);scene.fog=new THREE.Fog(0xdce5df,48,80);
 scene.add(new THREE.HemisphereLight(0xf3f7ff,0x9aa399,1.65));const sun=new THREE.DirectionalLight(0xffedd8,2.5);sun.position.set(-10,22,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22});sun.shadow.normalBias=.04;scene.add(sun);
 box(scene,0,-.35,0,30,.7,23,0xc7c2ad);box(scene,0,-.02,0,29.5,.1,22.5,0xeeece5);
 for(let x=-14;x<=14;x+=1.5)for(let z=-10;z<=10;z+=1.5)box(scene,x,.045,z,1.47,.015,1.47,((x+z)*2)%3===0?0xdad5cb:0xe4dfd5);
 // Low walls keep the overhead view readable; entrances stay open.
 box(scene,0,.85,-11,30,1.7,.35,0xc3cec9);solid(0,-11,30,.35);box(scene,-14.7,.85,0,.35,1.7,22,0xc3cec9);solid(-14.7,0,.35,22);
 for(const x of [-5,5]){box(scene,x,.65,-6,.22,1.3,8,0xd2dad5);solid(x,-6,.22,8);}
 for(const x of [-10,0,10]){box(scene,x,.1,-6,8,.06,7, x===0?0xd9b7a8:x<0?0xb5c8ac:0xc4bfd6);}
 portal('fern',-10,-8.8,0x85b49b,'01  FERN · OPEN');portal('coral',0,-8.8,0xd59788,'02  CORAL · LOCKED');portal('iris',10,-8.8,0xa99cc7,'03  IRIS · FULL');
 sofa(-10,-5.5,0x7d9b85);sofa(0,-5.5,0xcd9b87);sofa(10,-5.5,0xa398b8);
 box(scene,-9,.14,4,6,.06,5,0xc8cdb1);sofa(-10,2.3,0xb4beb4);sofa(-10,6.7,0xb4beb4);
 coffeeTable(-9,4.5);
 softBox(scene,8,.14,4,7,.06,5,0xcbd4d4,.05);for(const x of [6,10])desk(x,4);
 for(const [x,z]of[[-13,-9],[-6.5,-9],[6.5,-9],[13,-9],[-13,8],[13,8],[-5,2],[4,7]])plant(x,z);
 // A low ceramic planter anchors the commons without dominating the room.
 cylinder(scene,0,.26,2,1.3,.5,0xe3e3dc);cylinder(scene,0,.52,2,1.16,.04,0x6f7565);solid(0,2,2.7,2.7);
 for(let i=0;i<9;i++){const a=i*2.4;const leaf=sphere(scene,Math.cos(a)*.65,.85+(i%3)*.17,2+Math.sin(a)*.65,.33,i%2?0x54856c:0x86a586,.45,1.6,1);leaf.rotation.z=Math.cos(a)*.55;}
 hero=character(selected);hero.position.set(0,0,7);scene.add(hero);
 for(const [i,x,z]of[[3,-8,0],[5,6,0],[8,9,7]]){const npc=character(i);npc.position.set(x,0,z);scene.add(npc);walkers.push({mesh:npc,x,z});}
 camera=new THREE.PerspectiveCamera(42,1,.1,120);camera.position.set(8,21,25);camera.lookAt(0,0,0);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.setClearColor(0xdce5df);renderer.domElement.setAttribute('aria-hidden','true');host.prepend(renderer.domElement);
 new ResizeObserver(resize).observe(host);resize();
}
function resize(){if(!renderer)return;const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
function canMove(x,z){const roomX={fern:-10,coral:0,iris:10}[currentRoom];if(z < -1.35 && (currentRoom==='lobby'||Math.abs(x-roomX)>4.5))return false;if(currentRoom!=='lobby'&&z>-2.1)return false;return Math.abs(x)<14&&Math.abs(z)<10&&!obstacles.some(o=>Math.abs(x-o.x)<o.w&&Math.abs(z-o.z)<o.d);}
function setAvatar(index){selected=index;if(!hero)return;const replacement=character(index);replacement.position.copy(hero.position);replacement.rotation.copy(hero.rotation);scene.remove(hero);hero.traverse(o=>{if(o.geometry)o.geometry.dispose();});hero=replacement;scene.add(hero);}
let last=performance.now();
function frame(now){requestAnimationFrame(frame);if(!renderer)return;const dt=Math.min((now-last)/1000,.04);last=now;const t=now/1000;let moving=false;
 if(active&&worldView&&document.activeElement===host&&!document.hidden){let dx=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));let dz=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));if(dx||dz){const l=Math.hypot(dx,dz);dx/=l;dz/=l;const x=(dx*.953+dz*.303)*dt*4.8,z=(-dx*.303+dz*.953)*dt*4.8;if(canMove(hero.position.x+x,hero.position.z)){hero.position.x+=x;moving=true;}if(canMove(hero.position.x,hero.position.z+z)){hero.position.z+=z;moving=true;}hero.rotation.y=Math.atan2(x,z);}}
 animateCharacter(hero,t,moving);walkers.forEach((npc,i)=>animateCharacter(npc.mesh,t+i,false));portals.forEach((p,i)=>p.glow.material.emissiveIntensity=reduced.matches?.4:.4+Math.sin(t*2+i)*.18);
 portalTarget=portals.find(p=>Math.hypot(hero.position.x-p.x,hero.position.z+1.2)<2.4);
 hint.textContent=portalTarget?`Press E to enter ${portalTarget.id} room`:'WASD / arrows to walk · E near a portal · Tab to leave';
 const focus=new THREE.Vector3(hero.position.x*.72,0,hero.position.z*.65-1);
 cameraTarget.lerp(focus,reduced.matches?1:Math.min(1,dt*4));camera.position.copy(cameraTarget).add(new THREE.Vector3(7*zoom,18*zoom,22*zoom));camera.lookAt(cameraTarget);
 host.dataset.playerX=hero.position.x.toFixed(2);host.dataset.playerZ=hero.position.z.toFixed(2);host.dataset.currentRoom=currentRoom;
 if(worldView&&!document.hidden)renderer.render(scene,camera);
}
try{buildWorld();requestAnimationFrame(frame);}catch(error){hint.textContent='3D could not start. Enable WebGL / hardware acceleration in your browser, then reload.';console.error(error);}
// Stop all movement when focus changes; never capture text-input keystrokes.
function clearKeys(){keys.clear();}
window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);host.addEventListener('blur',clearKeys);
host.addEventListener('pointerdown',event=>{if(event.target===renderer?.domElement)host.focus();});
host.addEventListener('keydown',event=>{if(event.target!==host)return;const key=event.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){event.preventDefault();keys.add(key);}if(key==='e'&&portalTarget&&!event.repeat){legacyPortals.find(p=>p.dataset.room===portalTarget.id).click();clearKeys();}});
window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
window.addEventListener('hashchange',()=>{worldView=location.hash==='#lobby'||!location.hash;clearKeys();if(worldView)requestAnimationFrame(resize);});
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
// Room boards live in the scene and reuse the same demo room state as the UI.
if(renderer){
 const boardMeshes=[];
 function roomBoard(id,x,z){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=380;
  const texture=new THREE.CanvasTexture(canvas);
  const board=new THREE.Mesh(new THREE.PlaneGeometry(4.4,2.6),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
  board.position.set(x,2.1,z);board.userData.roomId=id;scene.add(board);boardMeshes.push(board);
  box(scene,x,.7,z,.12,1.4,.15,0x6c7966);solid(x,z,.2,.25);
  function draw(){const card=document.querySelector(`#board-rooms [data-room="${id}"]`).closest('article');const ctx=canvas.getContext('2d');ctx.fillStyle='#fbf7eb';ctx.fillRect(0,0,640,380);ctx.fillStyle='#dce6ce';ctx.fillRect(0,0,640,15);ctx.fillStyle='#365744';ctx.font='bold 42px sans-serif';ctx.fillText(card.querySelector('h3').textContent,30,75);ctx.font='24px sans-serif';ctx.fillText(card.querySelector('.room-badge').textContent.toUpperCase(),30,120);ctx.fillStyle='#667362';ctx.font='22px sans-serif';ctx.fillText(card.querySelector('.people').textContent,30,172);ctx.fillText(card.querySelector('.room-meta').textContent,30,218);ctx.fillText('Cooperative game · TBD',30,262);ctx.fillStyle='#3a6950';ctx.fillRect(25,292,590,60);ctx.fillStyle='#fff';ctx.fillText('Click board to view / enter room  →',48,331);texture.needsUpdate=true;}
  new MutationObserver(draw).observe(document.querySelector('#board-rooms'),{childList:true,subtree:true});draw();
 }
 roomBoard('fern',-12,-2.5);roomBoard('coral',-2,-2.5);roomBoard('iris',8,-2.5);
 const raycaster=new THREE.Raycaster();
 host.addEventListener('click',event=>{if(event.target!==renderer.domElement)return;const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);const hit=raycaster.intersectObjects(boardMeshes)[0];if(hit)legacyPortals.find(p=>p.dataset.room===hit.object.userData.roomId).click();});
 // Connected room front walls with central doorways.
 for(const center of [-10,0,10])for(const side of [-1,1]){box(scene,center+side*2.7,.65,-1.8,2.5,1.3,.22,0xd2dad5);solid(center+side*2.7,-1.8,2.5,.22);}
 // Bookshelves, books, wall pictures, tables, cushions and lamps add scale.
 for(const x of [-12,12]){box(scene,x,1.1,-10.5,2.3,2.2,.55,0xa68a68);for(let row=0;row<3;row++){box(scene,x,.35+row*.65,-10.15,2.3,.08,.55,0xdec9a7);for(let j=0;j<8;j++)box(scene,x-.9+j*.25,.6+row*.65,-10.15,.18,.4+(j%2)*.1,.3,colors[j]);}}

 for(const x of [-3,3]){box(scene,x,.9,7,1.4,.12,1,0xa98b6c);for(const dx of [-.55,.55])box(scene,x+dx,.45,7,.1,.9,.65,0x8b755e);solid(x,7,1.4,1);sphere(scene,x,1.12,7,.17,0xf2e6c9);}
 for(const x of [-13,13]){box(scene,x,1.5,0,.08,3,.08,0x797b6a);cylinder(scene,x,3,0,.38,.25,0xf4f0e5);cylinder(scene,x,.08,0,.35,.08,0x424d50);solid(x,0,.5,.5);}
 function nameplate(text,model){const c=document.createElement('canvas');c.width=384;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#263c35e8';ctx.fillRect(0,0,384,80);ctx.fillStyle='#fff';ctx.font='28px sans-serif';ctx.textAlign='center';ctx.fillText(text,192,51);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false}));sprite.scale.set(2.5,.52,1);sprite.position.y=2.8;model.add(sprite);}
 walkers.forEach((npc,i)=>nameplate(['Milo · demo','Nova · demo','Pip · demo'][i],npc.mesh));
 nameplate('You · Explorer',hero);
 resize();
 const details=document.querySelector('#room-detail');host.append(details);
 const close=document.createElement('button');close.type='button';close.className='room-close';close.textContent='Close room details';close.onclick=()=>{details.hidden=true;host.focus();};host.append(close);
 new MutationObserver(()=>{close.hidden=details.hidden;}).observe(details,{attributes:true,attributeFilter:['hidden']});close.hidden=true;
}

// Successful room admissions move the character into the room; rejected ones do not.
window.addEventListener('demo-room-change',event=>{
 const previous=currentRoom;currentRoom=event.detail.roomId;keys.clear();
 if(currentRoom==='lobby'){hero.position.set(({fern:-10,coral:0,iris:10}[previous])??0,0,.2);}
 else {hero.position.set({fern:-10,coral:0,iris:10}[currentRoom],0,-3.5);hero.rotation.y=Math.PI;}
});
if(renderer){
 const controls=document.createElement('div');controls.className='camera-controls';
 for(const [text,delta]of[['Zoom in',-.15],['Zoom out',.15]]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>{zoom=THREE.MathUtils.clamp(zoom+delta,.55,1.5);};controls.append(b);}host.append(controls);
 // Room-specific interiors: tables, seating, rugs, wall art and tall windows.
 for(const [center,tint]of[[-10,0x84a597],[0,0xcda18e],[10,0xa99ac3]]){
  box(scene,center+2.5,.14,-6.5,2.2,.06,3.6,0xe2d8c4);
  box(scene,center+2.5,.85,-6,1.8,.16,1.4,0xbe9c72);solid(center+2.5,-6,1.8,1.4);
  for(const side of [-1,1]){box(scene,center+2.5,.5,-6+side*1.25,.75,.15,.7,tint);box(scene,center+2.5,.9,-6+side*1.55,.75,.9,.12,tint);solid(center+2.5,-6+side*1.25,.75,.8);}
  // Recessed glazing with mullions, at the back wall.
  box(scene,center+2.2,1.65,-10.74,2.8,2,.1,0x628b94);box(scene,center+2.2,1.65,-10.65,2.55,1.75,.08,0xb6dae0);
  box(scene,center+2.2,1.65,-10.55,.08,1.85,.08,0x6e9290);box(scene,center+2.2,1.65,-10.55,2.65,.08,.08,0x6e9290);
  box(scene,center-1.7,1.7,-10.7,1.4,1.2,.1,0xc4a875);box(scene,center-1.7,1.7,-10.6,1.2,1,.08,tint);sphere(scene,center-1.7,1.75,-10.48,.27,0xf1db99,1,1,.1);
 }
 // Additional lounge seating and a reception desk, leaving the center path open.
 box(scene,-4,.65,9.3,3.8,1.3,.9,0x9aaf9e);box(scene,-4,1.35,9.3,4,.15,1.1,0xd7bd96);solid(-4,9.3,4,1.1);
 for(const x of [6,10])officeChair(x,5.5);
}



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


// Interior finish pass: generated textures stay local and need no third-party art.
if(renderer){
 function surfaceTexture(kind){
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);
  if(kind==='oak'){
   for(let i=0;i<110;i++){ctx.strokeStyle=`rgba(90,67,42,${.018+(i%7)*.007})`;ctx.lineWidth=.5+(i%3)*.5;ctx.beginPath();for(let y=0;y<=256;y+=8){const x=i*2.5+Math.sin(y*.035+i)*1.8;if(y===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}
  }else{
   for(let i=0;i<256;i+=3){ctx.fillStyle=i%2?'#e4e4e4':'#f2f2f2';ctx.fillRect(i,0,1,256);ctx.fillRect(0,i,256,1);}
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(kind==='oak'?2:4,kind==='oak'?1:4);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return texture;
 }
 const oak=surfaceTexture('oak'),fabric=surfaceTexture('fabric');
 for(const color of [0xd7c5a7,0xd7bd96,0xbe9c72,0xa98b6c,0xa68a68,0xdec9a7]){const mat=material(color);mat.map=oak;mat.roughness=.63;mat.needsUpdate=true;}
 for(const color of [0xb4beb4,0x7d9b85,0xcd9b87,0xa398b8,0x657e88,0xcbd4d4]){const mat=material(color);mat.map=fabric;mat.roughness=.98;mat.needsUpdate=true;}
 for(const color of [0x3d484d,0x343f43,0x505b60,0x424d50]){const mat=material(color);mat.metalness=.55;mat.roughness=.38;}
 for(const color of [0xf1eee6,0xf4f0e5,0xe8e6df])material(color).roughness=.36;
 // Reception slats and recessed warm light strip.
 for(let x=-5.8;x<=-2.2;x+=.13)box(scene,x,.65,9.79,.055,1.18,.035,0xd7c5a7);
 const strip=new THREE.Mesh(new THREE.BoxGeometry(3.7,.035,.025),new THREE.MeshStandardMaterial({color:0xffdeb0,emissive:0xffc58a,emissiveIntensity:1.1}));strip.position.set(-4,1.23,9.84);scene.add(strip);
 // Acoustic panels make the back wall read as a designed interior.
 for(const center of [-10,0,10])for(let i=0;i<9;i++)box(scene,center-3.7+i*.15,1.2,-10.62,.07,2.1,.065,0xd7c5a7);
 // Slim suspended lighting, kept above the occupied room areas.
 for(const x of [-9,8]){
  for(const dx of [-1.5,1.5])cylinder(scene,x+dx,4.4,4,.012,1.6,0x596360);
  softBox(scene,x,3.65,4,3.6,.12,.22,0x414b50,.03);
  const diffuser=new THREE.Mesh(new THREE.BoxGeometry(3.4,.018,.16),new THREE.MeshStandardMaterial({color:0xffedcc,emissive:0xffd39a,emissiveIntensity:1}));diffuser.position.set(x,3.58,4);scene.add(diffuser);
 }
 // A pair of ottomans and nesting tables completes the lounge.
 for(const [x,z,color]of[[-6.5,3.4,0xc58e73],[-6.5,5.6,0x91a6a1]]){cylinder(scene,x,.34,z,.43,.6,color);cylinder(scene,x,.055,z,.35,.08,0x414b50);solid(x,z,.86,.86);}
 cylinder(scene,-7.5,.52,4.5,.42,.06,0xd7c5a7);cylinder(scene,-7.5,.27,4.5,.035,.5,0x414b50);cylinder(scene,-7.5,.045,4.5,.3,.04,0x414b50);solid(-7.5,4.5,.84,.84);
 // Subtle room-threshold lighting keeps entrances legible.
 for(const center of [-10,0,10]){const line=new THREE.Mesh(new THREE.BoxGeometry(2.4,.018,.06),new THREE.MeshStandardMaterial({color:0xe8d4ae,emissive:0xd9b887,emissiveIntensity:.4}));line.position.set(center,.15,-1.7);scene.add(line);}
 resize();
}
