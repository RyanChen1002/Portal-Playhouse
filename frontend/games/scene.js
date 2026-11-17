import * as T from '../vendor/three.module.js';
import {character,animateCharacter} from '../characters.js';
import {targets,bridgeOpen,route,games} from './rules.js';

export function createStage(host,s,avatar=0){
 const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const scene=new T.Scene();scene.background=new T.Color('#e5e9df');scene.fog=new T.Fog('#e5e9df',45,80);
 const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.2;host.append(renderer.domElement);
 const camera=new T.PerspectiveCamera(42,1,.1,100);camera.position.set(0,22,23);camera.lookAt(0,0,0);
 const hemi=new T.HemisphereLight('#fff8e7','#8d9e93',2.4);scene.add(hemi);
 const sun=new T.DirectionalLight('#fff2d7',3);sun.position.set(-9,18,7);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-16,right:16,top:16,bottom:-16});sun.shadow.bias=-.0003;scene.add(sun);
 const mats=new Map(),textures=[];function mat(color){if(!mats.has(color))mats.set(color,new T.MeshStandardMaterial({color,roughness:.7}));return mats.get(color);}
 function box(parent,x,y,z,w,h,d,c,round=false){let geo;if(round){const sh=new T.Shape(),r=Math.min(.15,w/3,h/3);sh.moveTo(-w/2+r,-h/2);sh.lineTo(w/2-r,-h/2);sh.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);sh.lineTo(w/2,h/2-r);sh.quadraticCurveTo(w/2,h/2,w/2-r,h/2);sh.lineTo(-w/2+r,h/2);sh.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);sh.lineTo(-w/2,-h/2+r);sh.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);geo=new T.ExtrudeGeometry(sh,{depth:Math.max(.02,d-.16),bevelEnabled:true,bevelThickness:.08,bevelSize:.04,bevelSegments:2,steps:1});geo.center();}else geo=new T.BoxGeometry(w,h,d);const m=new T.Mesh(geo,mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function ball(parent,x,y,z,r,c,sx=1,sy=1,sz=1){const m=new T.Mesh(new T.SphereGeometry(r,16,12),mat(c));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;}
 function cyl(parent,x,y,z,r,h,c){const m=new T.Mesh(new T.CylinderGeometry(r,r,h,24),mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function label(text,x,y,z,color='#294b40',scale=3){const cv=document.createElement('canvas');cv.width=512;cv.height=112;const ctx=cv.getContext('2d');ctx.fillStyle='#fffdf1';ctx.beginPath();ctx.roundRect(2,2,508,108,24);ctx.fill();ctx.fillStyle=color;ctx.font='600 38px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,56,480);const tx=new T.CanvasTexture(cv);tx.colorSpace=T.SRGBColorSpace;textures.push(tx);const sprite=new T.Sprite(new T.SpriteMaterial({map:tx,depthTest:false}));sprite.position.set(x,y,z);sprite.scale.set(scale,scale*.22,1);scene.add(sprite);return sprite;}
 function ring(x,z,c,r=.8){const m=new T.Mesh(new T.RingGeometry(r-.07,r,48),new T.MeshBasicMaterial({color:c,side:T.DoubleSide}));m.rotation.x=-Math.PI/2;m.position.set(x,.035,z);scene.add(m);return m;}
 function plant(x,z){cyl(scene,x,.3,z,.35,.6,'#eee8dc');for(let i=0;i<6;i++){const a=i*2.4;ball(scene,x+Math.cos(a)*.22,.9+(i%2)*.25,z+Math.sin(a)*.22,.3,i%2?'#6f9978':'#3e6c59',.5,1.7,.8);}}
 function sofa(parent,x,z,c='#9bac9b'){const g=new T.Group();g.position.set(x,0,z);parent.add(g);box(g,0,.6,0,3.4,.6,1.3,c,true);box(g,0,1.15,-.5,3.4,.8,.3,c,true);for(const side of [-1,1]){box(g,side*1.65,.92,0,.3,.65,1.4,c,true);box(g,side*1.25,.2,.4,.13,.35,.13,'#796049');box(g,side*.8,.99,-.1,1.1,.22,.9,'#d4d8bf',true);}return g;}
 function track(x,z,parent=scene){const g=new T.Group();g.position.set(x,.07,z);parent.add(g);for(let i=0;i<5;i++)box(g,-1.2+i*.6,.04,0,.16,.13,1.25,'#917958');for(const side of [-1,1])box(g,0,.15,side*.44,2.9,.12,.08,'#818e8b');return g;}
 function food(parent,kind){const g=new T.Group();parent.add(g);cyl(g,0,0,0,.35,.1,'#faf5e4');if(kind.includes('soup')){cyl(g,0,.12,0,.28,.2,'#c78453');cyl(g,0,.24,0,.24,.02,'#e3b84d');}else for(let i=0;i<6;i++)ball(g,Math.cos(i)*.2,.15,Math.sin(i)*.2,.13,i%2?'#86a463':'#d47b59');return g;}
 const accent=games.find(g=>g.id===s.id).color;
 box(scene,0,-.32,0,21,.6,17,'#d9d1bc',true);
 for(let x=-10;x<10;x+=2)for(let z=-8;z<8;z+=2)box(scene,x+1,.002,z+1,1.98,.02,1.98,(x+z)%4?'#eee9dd':'#e7e2d6');
 box(scene,0,.65,-8.1,21,1.3,.25,'#cad4c6');box(scene,-10.3,.35,0,.25,.7,16,'#cad4c6');box(scene,10.3,.35,0,.25,.7,16,'#cad4c6');
 for(const x of [-9,9])plant(x,-7);
 const actors=s.players.map((p,i)=>{const a=character(i?((avatar+3)%20):avatar);scene.add(a);a.scale.setScalar(.82);return a;});
 const selectors=s.players.map((p,i)=>ring(p.x,p.z,i?'#ba9166':'#3d7c67',.55));
 const badges=s.players.map((p,i)=>label('Teammate '+(i+1),p.x,2.35,p.z,'#365c48',2.2));
 const carried=[null,null];let bridge,sofaMesh,train,portalGlow;const crystals=[],itemMeshes=[],railMeshes=[],gearMeshes=[],gearLabels=[],socketLights=[],steam=[];
 if(s.id==='portal'){
  box(scene,0,.04,0,20,.1,2.2,'#526c6b');bridge=new T.Group();scene.add(bridge);for(let z=-1;z<=1;z+=.4)box(bridge,0,.12,z,2.3,.2,.35,'#bda780');ring(-5,3,'#cda84c',1.2);cyl(scene,-5,.09,3,1,.12,'#d1b35f');
  box(scene,2,.6,-4,.7,1.2,.7,'#a3b6a7',true);const lever=box(scene,2,1.4,-4,.1,.7,.1,'#535f56');lever.rotation.z=.4;ball(scene,2.13,1.75,-4,.16,'#c99d52');
  for(const x of [-6,6]){const c=new T.Mesh(new T.OctahedronGeometry(.55),new T.MeshStandardMaterial({color:'#a1d1c1',metalness:.35,roughness:.15,emissive:'#3c8877',emissiveIntensity:.3}));c.position.set(x,1,-5);scene.add(c);crystals.push(c);}
  box(scene,-1.3,1.5,-7,.3,3,.5,accent,true);box(scene,1.3,1.5,-7,.3,3,.5,accent,true);box(scene,0,3,-7,2.9,.3,.5,accent,true);ring(0,-7,'#79aa8a',1.6);
 }
 if(s.id==='cafe'){
  for(const x of [-7,-3,2,7]){box(scene,x,.6,-5,2.7,1.2,1.4,'#c1cdb5',true);box(scene,x,1.24,-5,2.8,.12,1.5,'#faf5e7');}
  for(const x of [-7,-3]){box(scene,x,1.45,-5,1.5,.4,.8,'#b49970',true);food(scene,x===-7?'salad':'soup').position.set(x,1.7,-5);}
  box(scene,2,1.34,-5,1.3,.08,.8,'#b69b72');box(scene,2.4,1.46,-5,.5,.1,.1,'#a2b5b4');cyl(scene,7,1.45,-5,.5,.35,'#5c726a');cyl(scene,7,1.64,-5,.42,.02,'#e2b354');
  for(let i=0;i<5;i++)steam.push(ball(scene,7,1.9+i*.2,-5,.1,'#f2efe3'));
  box(scene,6,.6,4,3,1.2,1.1,'#cda27c',true);box(scene,6,1.25,4,3.1,.12,1.2,'#fff5e4');cyl(scene,-7,.5,4,.5,1,'#899d90');
 }
 if(s.id==='rescue'){
  box(scene,0,.8,-4.8,.3,1.6,6.7,'#9faea3');box(scene,0,.8,4.8,.3,1.6,6.7,'#9faea3');
  for(let i=0;i<4;i++){const g=new T.Group();scene.add(g);g.position.set(-7,0,i*3-5);if(i===0){cyl(g,0,.35,0,.35,.7,'#bd947c');ball(g,0,1,0,.45,'#699775',.7,1.3,.7);}if(i===1){box(g,0,.4,0,1,.8,.8,'#bca486',true);box(g,0,.87,0,1.1,.12,.9,'#e5d7b9');}if(i===2){cyl(g,0,.08,0,.35,.12,'#586e64');cyl(g,0,.65,0,.04,1.2,'#586e64');cyl(g,0,1.3,0,.4,.4,'#ebd7a0');}if(i===3){box(g,0,.4,0,.9,.8,.5,'#b99b70',true);for(let n=0;n<4;n++)box(g,-.3+n*.2,.6,.28,.12,.5,.2,['#a0b5aa','#d4aa87','#a9a3bf','#d3c18d'][n]);}itemMeshes.push(g);ring(7,i*3-5,accent);}
  sofaMesh=sofa(scene,-5,0);sofaMesh.rotation.y=Math.PI/2;ring(5,0,accent,1.7);
 }
 if(s.id==='train'){
  for(const r of route){ring(r.x,r.z,'#b59a62',.65);const tr=track(r.x,r.z);tr.visible=false;railMeshes.push(tr);}
  box(scene,-7,.6,6,3,1.2,1.5,'#b89a71',true);track(0,0,scene).position.set(-7,1.3,6);
  train=new T.Group();scene.add(train);box(train,0,.65,0,1.6,.7,1,'#659c8c',true);cyl(train,.7,.9,0,.4,.8,'#6e9c84');box(train,-.4,1.3,0,.9,.8,1,'#c8ab68',true);box(train,-.4,1.8,0,1.1,.15,1.2,'#536e62',true);for(const side of [-1,1])for(const x of [-.55,.55]){const wh=cyl(train,x,.3,side*.55,.28,.12,'#485d56');wh.rotation.x=Math.PI/2;}
  box(scene,9,.2,-2,2,.4,2,'#b0b99d');box(scene,9,1,-3,.2,2,.2,'#718a76');label('STATION',9,2.2,-3,'#365c48',2.1);
 }
 if(s.id==='workshop'){
  box(scene,0,.55,-5,17,1.1,1.3,'#b1c4b7',true);
  for(let i=0;i<3;i++){const x=-6+i*6,g=new T.Group();g.position.set(x,1.4,-5);scene.add(g);cyl(g,0,0,0,.6,.2,'#c6a76a');for(let j=0;j<10;j++){const a=j*Math.PI/5,m=box(g,Math.cos(a)*.65,0,Math.sin(a)*.65,.22,.25,.25,'#c6a76a');m.rotation.y=-a;}gearMeshes.push(g);gearLabels.push(label('0 → '+(i+1),x,2.5,-5,'#365c48',2));
   box(scene,x,.45,-2,1.2,.9,1,'#8daaa2',true);socketLights.push(ball(scene,x,.95,-2,.24,'#d6b987'));cyl(scene,x,.15,1,.4,.3,['#b97b62','#8c9bb8','#a9b77a'][i]);}
  for(const x of [-4,4]){cyl(scene,x,.1,5,.85,.2,'#c5b58d');ring(x,5,'#79a58b',1);}
  const torus=new T.Mesh(new T.TorusGeometry(1.5,.2,12,48),mat('#809e90'));torus.position.set(0,2,2);scene.add(torus);portalGlow=new T.Mesh(new T.CircleGeometry(1.3,48),new T.MeshBasicMaterial({color:'#91d7bd',transparent:true,opacity:.1,side:T.DoubleSide}));portalGlow.position.set(0,2,2);scene.add(portalGlow);
 }
 // Persistent, legible world markers; interaction stays proximity-based.
 const markers=targets(s).map(t=>({id:t.id,sprite:label(s.id==='cafe'&&t.id==='serve'?'Serve current order':t.label,t.x,.22,t.z+1.35,'#345548',s.id==='workshop'?4.2:4.5)}));
 let lastLabel='';function updateGearLabels(){const key=s.gears.join(',');if(key===lastLabel)return;lastLabel=key;gearLabels.forEach((old,i)=>{scene.remove(old);old.material.map.dispose();old.material.dispose();gearLabels[i]=label(s.gears[i]+' → '+(i+1),-6+i*6,2.5,-5,s.gears[i]===i+1?'#287c51':'#845b38',2);});}
 function heldModel(held){const g=new T.Group();if(held.includes('salad')||held.includes('soup'))food(g,held);else if(held==='track')track(0,0,g).scale.setScalar(.35);else if(held.startsWith('cable')){const m=new T.Mesh(new T.TorusGeometry(.25,.045,8,20),mat(['#b97b62','#8c9bb8','#a9b77a'][Number(held.slice(-1))]));g.add(m);}else box(g,0,0,0,.55,.55,.55,accent,true);return g;}
 const observer=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}});observer.observe(host);
 return {render(dt,time){
  if(reduceMotion)time=0;
  actors.forEach((a,i)=>{const p=s.players[i],moved=Math.hypot(a.position.x-p.x,a.position.z-p.z)>.01;const dx=p.x-a.position.x,dz=p.z-a.position.z;if(moved)a.rotation.y=Math.atan2(dx,dz);a.position.x=p.x;a.position.z=p.z;animateCharacter(a,time,moved);selectors[i].position.set(p.x,.04,p.z);selectors[i].visible=s.active===i;badges[i].position.set(p.x,2.35,p.z);
   if(carried[i]?.userData.held!==p.held){if(carried[i]){a.remove(carried[i]);carried[i].traverse(o=>o.geometry?.dispose());carried[i]=null;}if(p.held){const item=heldModel(p.held);item.userData.held=p.held;item.position.set(0,1,.65);a.add(item);carried[i]=item;}}
   if(p.held||s.carrySofa){a.userData.limbs[1].rotation.x=-1;a.userData.limbs[3].rotation.x=-1;}
  });
  if(bridge){bridge.scale.z=T.MathUtils.lerp(bridge.scale.z,bridgeOpen(s)?1:.02,Math.min(1,dt*6));crystals.forEach((c,i)=>{c.visible=!s.crystals[i];c.rotation.y=time*.5;c.position.y=1+Math.sin(time*2)*.08;});}
  if(sofaMesh){if(s.carrySofa){const p=s.players[s.active];sofaMesh.position.set(p.x,.35,p.z);sofaMesh.rotation.y=s.rotation*Math.PI/2;}else if(s.sofaDone){sofaMesh.position.set(5,0,0);sofaMesh.rotation.y=0;}itemMeshes.forEach((m,i)=>{m.visible=!s.players.some(p=>p.held==='item-'+i);m.position.x=s.items[i]?7:-7;});}
  if(train){railMeshes.forEach((m,i)=>m.visible=s.rails[i]);train.position.set(Math.min(9,-9+Math.max(0,s.elapsed-25)*.3),0,0);train.children.forEach((m,i)=>{if(i>3)m.rotation.z=-time*3;});}
  if(gearMeshes.length){gearMeshes.forEach((g,i)=>g.rotation.y=T.MathUtils.lerp(g.rotation.y,s.gears[i]*Math.PI/2,Math.min(1,dt*6)));updateGearLabels();socketLights.forEach((m,i)=>m.material=mat(s.sockets[i]?'#83c99b':'#d6b987'));portalGlow.material.opacity=s.status==='won'?.85:.1;}
  steam.forEach((p,i)=>{p.visible=Boolean(s.job?.dish==='soup');p.position.y=1.9+(time+i*.3)%1.3;p.scale.setScalar(.6+((time+i*.3)%1.3));});
  const available=new Set(targets(s).map(t=>t.id));markers.forEach(m=>m.sprite.visible=available.has(m.id));renderer.render(scene,camera);
 },dispose(){observer.disconnect();scene.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of [].concat(o.material)){m.map?.dispose();m.dispose();}}});textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();}};
}
