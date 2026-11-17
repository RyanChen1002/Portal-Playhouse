import * as THREE from './vendor/three.module.js';
const colors = [0xe89e55,0x97b6cc,0xb5a0ce,0x9fbc7a,0xdb9d9e,0x86bcaf,0xb8a585,0xa8b4d5,0xd1b575,0xc39fb1];
const names = ['Ember Fox','Cloud Scout','Violet Mage','Fern Keeper','Rose Ranger','River Sprite','Acorn Knight','Moon Explorer','Sunbeam Cub','Berry Bard','Copper Fox','Frost Scout','Twilight Mage','Moss Keeper','Peach Ranger','Lagoon Sprite','Oak Knight','Star Explorer','Honey Cub','Plum Bard'];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const materials=new Map();
function material(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.85}));return materials.get(color);}
function box(parent,x,y,z,w,h,d,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
function sphere(parent,x,y,z,r,color,sx=1,sy=1,sz=1){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;}
function cone(parent,x,y,z,r,h,color){const mesh=new THREE.Mesh(new THREE.ConeGeometry(r,h,5),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh);return mesh;}
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

export {character,animateCharacter,names,colors};
