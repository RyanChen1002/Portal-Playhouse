/* Local visual spike only. Replace this sample state with the shared PortalClient
   and agreed room adapter during integration. No network requests or persistence. */
'use strict';
const palette = ['#aecb98','#e5b186','#b9add6','#9dc9cc','#dd9e9c','#d4c585','#9eb8d8','#bfc994','#d2acb9','#b5c8c0'];
const faces = ['•ᴗ•','•‿•','˘ᴗ˘','•ω•','◕ᴗ◕'];
const avatars = Array.from({length:20}, (_,i) => ({id:`avatar-${String(i+1).padStart(2,'0')}`,color:palette[i%10],face:faces[Math.floor(i/4)]}));
const profile = {id:'demo-player',displayName:'Explorer',avatarId:'avatar-01',winsTotal:0};
let toastTimer;
window.addEventListener('playhouse-profile',event=>{Object.assign(profile,event.detail);renderProfile();document.querySelector('#display-name').value=profile.displayName;});

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
function navigate(){
  const id=window.location.hash.slice(1);
  const view=['lobby','profile','history'].includes(id)?id:'lobby';
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
  profile.displayName=name;profile.avatarId=avatarId;
  $('#display-name').value=name;renderProfile();
  notice('Character updated for this preview. Reloading resets it.');
});
window.addEventListener('hashchange',navigate);
buildAvatarPicker();renderProfile();navigate();
