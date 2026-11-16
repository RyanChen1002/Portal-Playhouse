/* Local visual spike only. Replace this sample state with the shared PortalClient
   and agreed room adapter during integration. No network requests or persistence. */
'use strict';
const palette = ['#aecb98','#e5b186','#b9add6','#9dc9cc','#dd9e9c','#d4c585','#9eb8d8','#bfc994','#d2acb9','#b5c8c0'];
const faces = ['•ᴗ•','•‿•','˘ᴗ˘','•ω•','◕ᴗ◕'];
const avatars = Array.from({length:20}, (_,i) => ({id:`avatar-${String(i+1).padStart(2,'0')}`,color:palette[i%10],face:faces[Math.floor(i/4)]}));
const profile = {id:'demo-player',displayName:'Explorer',avatarId:'avatar-01',winsTotal:0};
const rooms = [
  {id:'fern',name:'Fern room',number:'01',status:'waiting',players:[],score:null,time:null},
  {id:'coral',name:'Coral room',number:'02',status:'playing',players:['Nova','Pip'],score:120,time:'02:14'},
  {id:'iris',name:'Iris room',number:'03',status:'waiting',players:['Remy','Sol'],score:null,time:null}
];
let locationId = 'lobby';
let ready = false;
let toastTimer;
let position = {x:43,y:57};
const $ = (selector) => document.querySelector(selector);
function notice(message){
  clearTimeout(toastTimer);
  $('#notice').textContent=message;
  $('#notice').hidden=false;
  toastTimer=setTimeout(()=>{$('#notice').hidden=true;},6000);
}
function currentAvatar(){return avatars.find(a=>a.id===profile.avatarId);}
function renderProfile(){
  const avatar=currentAvatar();
  document.querySelectorAll('.my-name').forEach(el=>{el.textContent=profile.displayName;});
  document.querySelectorAll('.my-avatar').forEach(el=>{el.textContent=avatar.face;el.style.setProperty('--avatar-color',avatar.color);});
}
function roomLabel(room){return room.status==='playing'?'In progress':room.players.length>=2?'Full':'Open';}
function roomCard(room){
  const card=document.createElement('article');card.className='room-card';
  // Only static sample fields are inserted as markup. User names use textContent below.
  card.innerHTML=`<div class="room-card-top"><span class="room-number">${room.number}</span><span class="room-badge ${room.status==='playing'?'playing':room.players.length>=2?'full':''}">${roomLabel(room)}</span></div><h3>${room.name}</h3><p>Cooperative · First game TBD</p><p class="people"></p><div class="room-meta"><span>${room.players.length} / 2 players · min 2</span><span>Score ${room.score??'—'} · ${room.time??'—'}</span></div><button class="button secondary" type="button" data-room="${room.id}">${locationId===room.id?'Your room':roomLabel(room)==='Open'?'Enter room':'View room'} <span aria-hidden="true">↗</span></button>`;
  card.querySelector('.people').textContent=room.players.length?room.players.join(' + '):'Your team could be the first.';
  return card;
}
function renderRooms(){
  for(const selector of ['#lobby-rooms','#board-rooms']){
    $(selector).replaceChildren(...rooms.map(roomCard));
  }
}
function showRoom(room){
  const own=locationId===room.id;
  const detail=$('#room-detail');detail.hidden=false;
  detail.innerHTML=`<p class="eyebrow">${own?'YOUR ROOM':'ROOM PREVIEW'} · SAMPLE STATE</p><h2>${room.name}</h2><p class="room-people"></p><p>${room.status==='playing'?'This sample round is locked. You can read its board status, but cannot join or spectate inside.':room.players.length>=2&&!own?'This room is full. Your current location has not changed.':'Exactly two players will be required. The first game and its rules are still TBD.'}</p><p class="ready-status"></p><div class="actions"></div>`;
  detail.querySelector('.room-people').textContent=`Players: ${room.players.join(', ')||'None yet'} · Minimum 2 / maximum 2`;
  const actions=detail.querySelector('.actions');
  if(own){
    detail.querySelector('.ready-status').textContent=ready?'You are ready. Waiting for a second player; gameplay is not implemented.':'Choose ready to preview your waiting state. No live players are connected.';
    const readyButton=document.createElement('button');readyButton.className='button primary';readyButton.textContent=ready?'Cancel ready':'Mark ready';readyButton.setAttribute('aria-pressed',String(ready));
    readyButton.onclick=()=>{ready=!ready;showRoom(room);notice(ready?'Ready in this local preview. Waiting for a teammate.':'Ready status cleared.');};
    const leave=document.createElement('button');leave.className='button secondary';leave.textContent='Return to lobby';leave.onclick=leaveRoom;
    const start=document.createElement('button');start.className='button secondary';start.textContent='Game TBD';start.disabled=true;
    actions.append(readyButton,leave,start);
  }else{
    const back=document.createElement('a');back.className='button secondary';back.href='#lobby';back.textContent='Back to lobby view';actions.append(back);
  }
}
function joinRoom(id){
  const room=rooms.find(r=>r.id===id);if(!room)return;
  if(locationId!==id){
    if(room.status==='playing'){notice('This room is locked. Your current location has not changed.');}
    else if(room.players.length>=2){notice('This room is full. Your current location has not changed.');}
    else{
      const previous=rooms.find(r=>r.id===locationId);
      if(previous)previous.players=previous.players.filter(name=>name!==profile.displayName);
      room.players.push(profile.displayName);locationId=id;ready=false;renderRooms();
      window.dispatchEvent(new CustomEvent('demo-room-change',{detail:{roomId:id}}));
      notice(`Entered ${room.name} in the local preview.`);
    }
  }
  showRoom(room);window.location.hash='lobby';
  if($('#local-player')) $('#local-player').hidden=locationId!=='lobby';
}
function leaveRoom(){
  const room=rooms.find(r=>r.id===locationId);
  if(room)room.players=room.players.filter(name=>name!==profile.displayName);
  locationId='lobby';window.dispatchEvent(new CustomEvent('demo-room-change',{detail:{roomId:'lobby'}}));ready=false;$('#room-detail').hidden=true;if($('#local-player')) $('#local-player').hidden=false;
  renderRooms();window.location.hash='lobby';notice('Back in the commons. Your world slot stays the same.');
}
function navigate(){
  const id=window.location.hash.slice(1);
  const view=['lobby','rooms','profile','history'].includes(id)?id:'lobby';
  document.querySelectorAll('.view').forEach(el=>{el.hidden=el.id!==view;});
  document.querySelectorAll('[data-view]').forEach(el=>{
    if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  $('#breadcrumb').textContent={lobby:'The lobby',rooms:'Room board',profile:'My character',history:'My history'}[view];
  if(view==='profile'){
    $('#display-name').value=profile.displayName;
    $(`input[value="${profile.avatarId}"]`).checked=true;
  }
}
function buildAvatarPicker(){
  for(const avatar of avatars){
    const label=document.createElement('label');label.className='avatar-choice';
    const input=document.createElement('input');input.type='radio';input.name='avatarId';input.value=avatar.id;input.checked=avatar.id===profile.avatarId;input.setAttribute('aria-label',`Avatar ${Number(avatar.id.slice(-2))}`);
    const icon=document.createElement('span');icon.className='avatar';icon.style.setProperty('--avatar-color',avatar.color);icon.textContent=avatar.face;icon.setAttribute('aria-hidden','true');
    label.append(input,icon);$('#avatar-picker').append(label);
  }
}
$('#profile-form').addEventListener('submit',event=>{
  event.preventDefault();
  const raw=$('#display-name').value;
  const name=raw.trim().replace(/\s+/gu,' ');
  // UI-only validation. The shared contracts will own validation on integration.
  let error='';
  if(/[\p{Cc}\p{Cf}]/u.test(raw))error='Please remove invisible or control characters.';
  else if(!name||[...name].length>24)error='Choose a display name with 1–24 characters.';
  else if(['milo','nova','pip','remy','sol'].includes(name.toLowerCase()))error='That sample name is taken. Try another name.';
  const avatarId=new FormData(event.target).get('avatarId');
  if(!avatars.some(a=>a.id===avatarId))error='Choose one of the 20 avatars.';
  $('#name-error').textContent=error;$('#display-name').setAttribute('aria-invalid',String(Boolean(error)));
  if(error){$('#display-name').focus();return;}
  const room=rooms.find(r=>r.id===locationId);
  if(room)room.players=room.players.map(n=>n===profile.displayName?name:n);
  profile.displayName=name;profile.avatarId=avatarId;
  $('#display-name').value=name;renderProfile();renderRooms();if(room)showRoom(room);
  notice('Character updated for this preview. Reloading resets it.');
});
document.addEventListener('click',event=>{const button=event.target.closest('[data-room]');if(button)joinRoom(button.dataset.room);});
$('#world').addEventListener('keydown',event=>{
  if(!$('#local-player')||event.target!==$('#world')||locationId!=='lobby')return;
  const movement={ArrowLeft:[-2,0],a:[-2,0],ArrowRight:[2,0],d:[2,0],ArrowUp:[0,-2],w:[0,-2],ArrowDown:[0,2],s:[0,2]}[event.key.length===1?event.key.toLowerCase():event.key];
  if(!movement)return;event.preventDefault();
  position.x=Math.min(68,Math.max(30,position.x+movement[0]));position.y=Math.min(72,Math.max(43,position.y+movement[1]));
  $('#local-player').style.left=`${position.x}%`;$('#local-player').style.top=`${position.y}%`;
});
window.addEventListener('hashchange',navigate);
buildAvatarPicker();renderProfile();renderRooms();navigate();
