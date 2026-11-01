import {VERSION,MAX_CAMERAS,TYPES,normalizeCamera,parseConfig,serializeConfig,escapeHTML as e,safeURL,bridgePath,cameraId} from './core.mjs';
import {readState,writeState} from './storage.mjs';
import {CameraPlayer} from './player.mjs';

const $=s=>document.querySelector(s);
const icons={camera:'<rect x="3" y="5" width="14" height="14" rx="3"/><path d="m17 9 4-2v10l-4-2"/><circle cx="10" cy="12" r="3"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',link:'<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4M16 8l2-2a4 4 0 0 1 6 6l-4 4" transform="translate(1 0) scale(.9)"/>',settings:'<path d="m10 3 4 0 1 3 3 2 3 0v4l-2 2-1 3-3 1-1 3h-4l-1-3-3-1-1-3-2-2V8h3l3-2z"/><circle cx="12" cy="12" r="3"/>',shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',square:'<rect x="3" y="3" width="18" height="18" rx="2"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',x:'<path d="m6 6 12 12M18 6 6 18"/>',play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',snapshot:'<path d="M4 6h4l2-3h4l2 3h4v14H4z"/><circle cx="12" cy="12" r="4"/>',record:'<circle cx="12" cy="12" r="7"/>',edit:'<path d="m4 16 12-12 4 4L8 20H4zm10-10 4 4"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',star:'<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',volume:'<path d="m3 9 5 0 5-4v14l-5-4H3zM17 8c3 3 3 5 0 8m3-11c5 5 5 9 0 14"/>',mute:'<path d="m3 9 5 0 5-4v14l-5-4H3zM17 9l5 6m0-6-5 6"/>',events:'<path d="M5 3h14v18H5zM8 7h8M8 12h8M8 17h5"/>',monitor:'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-4 0h8"/>',refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',zoom:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.camera}</svg>`;
function hydrate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
hydrate();document.querySelectorAll('[data-version]').forEach(el=>el.textContent=VERSION);
let state=readState();const tokens=new Map(),players=new Map(),recorders=new Map(),activity=new Map();let sample=null,group='Todas',pendingToken=null,installEvent=null,waitingWorker=null,currentView='cameras';
const backgroundPaused=new Set();let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500);}
function persist(next=state){try{writeState(next);state=next;return true;}catch{toast('No se pudo guardar. El almacenamiento del navegador está lleno o bloqueado.');return false;}}
const allCameras=()=>sample?[...state.cameras,sample]:state.cameras;
const findCamera=id=>allCameras().find(c=>c.id===id);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const filename=(name,ext)=>`Huginn-Muninn-${name.replace(/[^a-zA-Z0-9_-]/g,'-')}-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`;
function button(action,label,ico,id,extra=''){return `<button class="icon-button" data-camera-action="${action}" data-id="${e(id)}" aria-label="${e(label)}" title="${e(label)}" ${extra}>${icon(ico)}</button>`;}
function cardHTML(c){return `<article class="camera-card" id="card-${e(c.id)}" data-camera-id="${e(c.id)}"><div class="card-heading"><div class="card-title"><h3>${e(c.name)}</h3><span class="camera-location">${e(c.group)} · ${c.type==='demo'?'Vista simulada':e(TYPES[c.type])}</span></div>${c.type!=='demo'?button('favorite',c.favorite?'Quitar favorita':'Marcar favorita','star',c.id,c.favorite?'data-favorite="true"':''):''}${c.type!=='demo'?button('edit','Editar cámara','edit',c.id):''}${button('delete',c.type==='demo'?'Cerrar ejemplo':'Eliminar cámara','x',c.id)}</div><div class="media-stage"><video muted autoplay playsinline aria-label="${e(c.name)}"></video><span class="media-badge"><i></i><span>Sin conectar</span></span><span class="rec-label" hidden>● GRABANDO CLIP</span><div class="stage-placeholder">${icon(c.type==='demo'?'camera':'lock')}<p>Lista para conectar</p><button class="button secondary" data-camera-action="start" data-id="${e(c.id)}">${icon('play')}Conectar</button></div></div><div class="card-controls">${button('toggle','Reproducir o pausar','play',c.id)}${button('snapshot','Guardar captura','snapshot',c.id,'data-live disabled')}${button('record','Grabar clip local (máximo 2 min)','record',c.id,'data-record data-live disabled')}${button('mute','Activar o silenciar audio','mute',c.id,'data-audio disabled')}${button('events','Actividad de conexión','events',c.id)}<span class="control-spacer"></span><small data-resolution>—</small>${button('zoom','Zoom digital','zoom',c.id,'data-live disabled')}${button('fullscreen','Pantalla completa','expand',c.id)}</div><div class="ptz-controls" hidden><span>PTZ · TOCA PARA MOVER</span>${[['left','←','Girar izquierda'],['up','↑','Inclinar arriba'],['home','⌂','Posición inicial'],['down','↓','Inclinar abajo'],['right','→','Girar derecha'],['zoom_in','+','Acercar'],['zoom_out','−','Alejar']].map(([action,text,label])=>`<button data-ptz="${action}" data-id="${e(c.id)}" aria-label="${label}">${text}</button>`).join('')}</div><div class="events-panel" hidden></div></article>`;}

function renderCameras(){
  const active=new Set([...players].filter(([,p])=>p.wanted).map(([id])=>id));
  players.forEach(p=>p.stop());players.clear();recorders.forEach(r=>{if(r.state!=='inactive')r.stop();});
  const cameras=allCameras();$('#camera-grid').innerHTML=cameras.map(cardHTML).join('');
  for(const c of cameras){
    const card=$(`#card-${c.id}`),video=card.querySelector('video');
    const player=new CameraPlayer(c,video,(status,message)=>updateCard(c.id,status,message),origin=>tokens.get(origin));players.set(c.id,player);
    const fav=card.querySelector('[data-favorite="true"]');fav?.classList.add('favorite');
  }
  $('#nav-count').textContent=state.cameras.length;$('#total-count').textContent=state.cameras.length;
  $('#empty-state').hidden=cameras.length>0;$('#camera-subtitle').textContent=cameras.length?`${state.cameras.length} cámara${state.cameras.length===1?'':'s'}${sample?' · 1 ejemplo':''}`:'Tu próxima conexión empieza aquí';
  const groups=['Todas',...new Set(state.cameras.map(c=>c.group))];if(!groups.includes(group))group='Todas';
  $('#group-filters').innerHTML=groups.map(g=>`<button class="${g===group?'active':''}" data-group="${e(g)}">${e(g)}</button>`).join('');$('#group-filters').hidden=groups.length<3;
  applyLayout();applyFilter();
  if(currentView==='cameras')for(const c of cameras){if((active.has(c.id)||state.settings.autoConnect||c.type==='demo')&&!$(`#card-${c.id}`).hidden)autoStart(c.id);}
  updateStats();
}
function maxStreams(){return matchMedia('(max-width:650px)').matches?2:4;}
function autoStart(id){const c=findCamera(id);if(!c||c.type==='bridge'&&!tokens.has(c.url))return;const p=players.get(id);if([...players.values()].filter(p=>p.wanted).length<maxStreams())p.start();}
async function startCamera(id){
  const c=findCamera(id),p=players.get(id);if(!c||!p)return;
  if(c.type==='bridge'&&!tokens.has(c.url)){pendingToken=id;$('#token-description').textContent=`Conecta «${c.name}» a ${new URL(c.url).hostname}.`;$('#session-token').value='';$('#token-dialog').showModal();return;}
  const other=[...players].filter(([key,p])=>key!==id&&p.wanted);
  if(other.length>=maxStreams()){const [first,player]=other[0];player.stop('Pausada para dar paso a otra cámara.');stopRecording(first);}
  await p.start();
}
function applyFilter(){let visible=0;const term=$('#camera-search').value.trim().toLocaleLowerCase();for(const c of allCameras()){
  const card=$(`#card-${c.id}`);const show=(group==='Todas'||c.group===group)&&`${c.name} ${c.group}`.toLocaleLowerCase().includes(term);card.hidden=!show;if(show)visible++;else {players.get(c.id)?.stop('Oculta por el filtro.');stopRecording(c.id);}
}$('#no-results').hidden=visible>0||allCameras().length===0;}
function applyLayout(){const focus=state.settings.layout==='focus';$('#camera-grid').classList.toggle('focus',focus);$('#layout-grid').classList.toggle('selected',!focus);$('#layout-focus').classList.toggle('selected',focus);$('#layout-grid').setAttribute('aria-pressed',String(!focus));$('#layout-focus').setAttribute('aria-pressed',String(focus));}
function updateStats(){$('#live-count').textContent=[...players].filter(([id,p])=>p.state==='live'&&findCamera(id)?.type!=='demo').length;}
function updateCard(id,status,message=''){
  const card=$(`#card-${id}`);if(!card)return;
  const log=activity.get(id)||[]; if(log[0]?.status!==status){log.unshift({status,message,time:Date.now()});activity.set(id,log.slice(0,20));}
  const p=players.get(id),live=['live','sample'].includes(status),label={live:findCamera(id)?.type==='mp4'?'REPRODUCIENDO':'EN DIRECTO',sample:'EJEMPLO',connecting:'CONECTANDO',retry:'RECONECTANDO',error:'SIN CONEXIÓN',locked:'ACCESO REQUERIDO',idle:'SIN CONECTAR',paused:'PAUSADA',blocked:'PULSA REPRODUCIR'}[status]||status;
  const badge=card.querySelector('.media-badge');badge.className=`media-badge ${status==='live'?'live':status==='sample'?'sample':''}`;badge.querySelector('span').textContent=label;
  const overlay=card.querySelector('.stage-placeholder');overlay.hidden=live;overlay.querySelector('p').textContent=message||'Lista para conectar';
  const connect=overlay.querySelector('button');connect.hidden=['connecting','retry'].includes(status);connect.innerHTML=`${icon('play')}${status==='error'?'Reintentar':'Conectar'}`;
  card.querySelectorAll('[data-live]').forEach(b=>b.disabled=!live);card.querySelector('[data-audio]').disabled=!live||['mjpeg','demo'].includes(findCamera(id)?.type);
  if(!window.MediaRecorder||!('captureStream' in HTMLMediaElement.prototype)&&!('mozCaptureStream' in HTMLMediaElement.prototype)&&!p?.mediaStream)card.querySelector('[data-record]').disabled=true;
  card.querySelector('[data-camera-action="toggle"]').innerHTML=icon(p?.wanted?'pause':'play');card.querySelector('.ptz-controls').hidden=!(live&&p?.ptz);
  const video=card.querySelector('video');card.querySelector('[data-resolution]').textContent=live&&video.videoWidth?`${video.videoWidth} × ${video.videoHeight}`:'—';
  if(!live)stopRecording(id);updateStats();
}
function openCamera(c){$('#camera-form').reset();$('#camera-id').value=c?.id||'';$('#camera-dialog-title').textContent=c?'Editar cámara':'Añadir cámara';$('#camera-name').value=c?.name||'';$('#camera-group').value=c?.group||'General';$('#camera-type').value=c?.type||'bridge';$('#camera-url').value=c?.url||'';$('#camera-stream').value=c?.stream||'';$('#camera-token').value='';$('#camera-error').hidden=true;$('#discovered-cameras').hidden=true;updateType();$('#camera-dialog').showModal();}
function updateType(){const bi=$('#camera-type').value==='bridge';$('#bridge-fields').hidden=!bi;$('#direct-help').hidden=bi;$('#camera-url-label').textContent=bi?'Dirección HTTPS del puente gratuito':'Dirección HTTPS del video';$('#camera-url').placeholder=bi?'https://equipo.tu-red.ts.net':'https://servidor/video.m3u8';$('#camera-stream').required=bi;}
$('#camera-type').addEventListener('change',updateType);
document.querySelectorAll('[data-action="add"]').forEach(b=>b.addEventListener('click',()=>openCamera()));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
$('#camera-form').addEventListener('submit',event=>{
  event.preventDefault();try{
    const id=$('#camera-id').value||cameraId(),old=state.cameras.find(c=>c.id===id);
    if(!old&&state.cameras.length>=MAX_CAMERAS)throw new Error('El máximo es de 12 cámaras guardadas.');
    const camera=normalizeCamera({id,name:$('#camera-name').value,group:$('#camera-group').value,type:$('#camera-type').value,url:$('#camera-url').value,stream:$('#camera-stream').value,favorite:old?.favorite});
    const cameras=old?state.cameras.map(c=>c.id===id?camera:c):[...state.cameras,camera];
    if(!persist({...state,cameras}))return;
    const token=$('#camera-token').value.trim();if(camera.type==='bridge'&&token)tokens.set(camera.url,token);$('#camera-token').value='';$('#camera-dialog').close();renderCameras();toast(old?'Cámara actualizada.':'Cámara guardada.');
  }catch(error){$('#camera-error').textContent=error.message;$('#camera-error').hidden=false;}
});
$('#token-form').addEventListener('submit',event=>{event.preventDefault();const camera=findCamera(pendingToken);if(!camera)return;tokens.set(camera.url,$('#session-token').value.trim());$('#session-token').value='';$('#token-dialog').close();startCamera(camera.id);});
$('#token-dialog').addEventListener('close',()=>$('#session-token').value='');$('#camera-dialog').addEventListener('close',()=>$('#camera-token').value='');
$('#discover-cameras').addEventListener('click',async()=>{
  const button=$('#discover-cameras');button.disabled=true;
  try{const origin=safeURL($('#camera-url').value,{bridge:true}),token=$('#camera-token').value.trim()||tokens.get(origin);if(!token)throw new Error('Introduce la clave del puente para consultar las cámaras.');
    const response=await fetch(`${origin}/v1/cameras`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:'no-store',credentials:'omit',redirect:'error'});if(!response.ok)throw new Error(response.status===401?'La clave no es válida.':'No se pudo consultar el puente gratuito. Revisa HTTPS, la VPN y el puente.');
    const data=await response.json();if(!data.cameras?.length)throw new Error('No hay cámaras autorizadas. Revisa config.json del puente.');
    const select=$('#discovered-cameras');select.innerHTML='<option value="">Selecciona una cámara</option>'+data.cameras.map(c=>`<option value="${e(c.id)}">${e(c.name||c.id)}${c.online===false?' · sin señal':''}</option>`).join('');select.hidden=false;
    select.onchange=()=>{const c=data.cameras.find(c=>c.id===select.value);if(c){$('#camera-stream').value=c.id;if(!$('#camera-name').value)$('#camera-name').value=c.name||c.id;}};
    $('#camera-error').hidden=true;
  }catch(error){$('#camera-error').textContent=error.message;$('#camera-error').hidden=false;}finally{button.disabled=false;}
});
async function confirmRemoval(c){return new Promise(resolve=>{
  $('#confirm-description').textContent=`Se eliminará «${c.name}» de este dispositivo. La cámara seguirá funcionando en su red.`;$('#confirm-dialog').showModal();
  $('#confirm-ok').onclick=()=>{$('#confirm-dialog').close('yes');};$('#confirm-cancel').onclick=()=>$('#confirm-dialog').close('no');$('#confirm-dialog').addEventListener('close',()=>resolve($('#confirm-dialog').returnValue==='yes'),{once:true});
});}
$('#camera-grid').addEventListener('click',async event=>{
  const ptz=event.target.closest('[data-ptz]');if(ptz){await sendPTZ(ptz);return;}
  const button=event.target.closest('[data-camera-action]');if(!button)return;
  const id=button.dataset.id,c=findCamera(id),p=players.get(id);if(!c||!p)return;
  try{switch(button.dataset.cameraAction){
    case 'start':await startCamera(id);break;
    case 'toggle':if(p.wanted){p.stop();stopRecording(id);}else await startCamera(id);break;
    case 'edit':openCamera(c);break;
    case 'delete':if(c.type==='demo'){sample=null;renderCameras();}else if(await confirmRemoval(c)){if(persist({...state,cameras:state.cameras.filter(x=>x.id!==id)}))renderCameras();}break;
    case 'favorite':if(persist({...state,cameras:state.cameras.map(x=>x.id===id?{...x,favorite:!x.favorite}:x)})){button.classList.toggle('favorite',!c.favorite);button.setAttribute('aria-label',c.favorite?'Marcar favorita':'Quitar favorita');}break;
    case 'snapshot':download(await p.snapshot(),filename(c.name,'jpg'));toast('Captura descargada.');break;
    case 'record':recorders.has(id)?stopRecording(id):startRecording(c,p);break;
    case 'mute':p.video.muted=!p.video.muted;button.innerHTML=icon(p.video.muted?'mute':'volume');break;
    case 'zoom':p.video.classList.toggle('zoomed');button.setAttribute('aria-pressed',String(p.video.classList.contains('zoomed')));break;
    case 'fullscreen':{const card=$(`#card-${id}`);if(document.fullscreenElement)await document.exitFullscreen();else if(card.requestFullscreen)await card.requestFullscreen();else if(p.video.webkitEnterFullscreen)p.video.webkitEnterFullscreen();else toast('Utiliza la vista ampliada en este navegador.');break;}
    case 'events':await showEvents(c);break;
  }}catch(error){toast(error.message||'La acción no está disponible en este navegador.');}
});
async function sendPTZ(button){const c=findCamera(button.dataset.id);if(!c||!players.get(c.id)?.ptz)return;const controls=button.closest('.ptz-controls');controls.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const response=await fetch(bridgePath(c,'ptz'),{method:'POST',headers:{Authorization:`Bearer ${tokens.get(c.url)}`,'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.ptz}),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('No se pudo ejecutar el movimiento ONVIF. Comprueba la configuración PTZ.');}
  catch(error){toast(error.message);}finally{controls.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
async function showEvents(c){
 const panel=$(`#card-${c.id} .events-panel`);if(!panel.hidden){panel.hidden=true;return;}panel.hidden=false;
 const labels={live:'Video conectado',sample:'Vista de ejemplo',connecting:'Conectando',retry:'Reconectando',error:'Error de conexión',locked:'Clave requerida',paused:'Conexión pausada',idle:'Sin conectar',blocked:'Reproducción pendiente'};
 const items=activity.get(c.id)||[];
 panel.innerHTML='<h4>Actividad de conexión · esta sesión</h4>'+(items.length?items.map(a=>`<div class="event-row"><span>${e(labels[a.status]||a.status)}${a.message?` · ${e(a.message)}`:''}</span><time>${e(new Date(a.time).toLocaleTimeString('es'))}</time></div>`).join(''):'<p>Todavía no hay actividad.</p>')+'<p>Este registro muestra conexiones; no son alertas de movimiento.</p>';
}
function startRecording(c,p){
  if(!window.MediaRecorder)throw new Error('Este navegador no permite grabar clips locales.');
  let stream=p.mediaStream;
  if(!stream){const capture=p.video.captureStream||p.video.mozCaptureStream;if(!capture)throw new Error('La grabación no está disponible para esta fuente.');stream=capture.call(p.video);}
  if(!stream.getVideoTracks().length)throw new Error('Todavía no hay video para grabar.');
  const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
  if(!mime)throw new Error('El navegador no ofrece un formato de grabación compatible.');
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2000000}),chunks=[];let bytes=0;
  const timer=setTimeout(()=>stopRecording(c.id),120000);recorders.set(c.id,recorder);
  recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;if(bytes>64*1024*1024)stopRecording(c.id);}};
  recorder.onerror=()=>{toast('Se interrumpió la grabación local.');stopRecording(c.id);};
  recorder.onstop=()=>{clearTimeout(timer);recorders.delete(c.id);const card=$(`#card-${c.id}`);if(card){card.querySelector('.rec-label').hidden=true;card.querySelector('[data-record]').classList.remove('favorite');}if(chunks.length){download(new Blob(chunks,{type:mime}),filename(c.name,mime.includes('mp4')?'mp4':'webm'));toast('Clip local descargado.');}};
  recorder.start(1000);$(`#card-${c.id} .rec-label`).hidden=false;$(`#card-${c.id} [data-record]`).classList.add('favorite');toast('Grabando clip local. Pulsa otra vez para guardar; máximo 2 minutos.');
}
function stopRecording(id){const r=recorders.get(id);if(r&&r.state!=='inactive')r.stop();}
$('#show-demo').addEventListener('click',()=>{sample={id:'example',name:'Entrada · ejemplo',group:'Vista simulada',type:'demo'};renderCameras();});
$('#camera-search').addEventListener('input',applyFilter);
$('#group-filters').addEventListener('click',event=>{const b=event.target.closest('[data-group]');if(!b)return;group=b.dataset.group;$('#group-filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));applyFilter();});
for(const layout of ['grid','focus'])$('#layout-'+layout).addEventListener('click',()=>{if(persist({...state,settings:{...state.settings,layout}}))applyLayout();});
function navigate(){const view=location.hash.slice(1);currentView=['cameras','setup','settings'].includes(view)?view:'cameras';document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${currentView}`);document.querySelectorAll('.nav-link').forEach(el=>el.classList.toggle('active',el.hash===`#${currentView}`));$('#breadcrumb').textContent={cameras:'Vista general',setup:'Conexión',settings:'Ajustes'}[currentView];
  if(currentView!=='cameras')players.forEach((p,id)=>{if(p.wanted){backgroundPaused.add(id);p.stop('Vista de cámaras en pausa.');stopRecording(id);}});
  else{for(const id of backgroundPaused)autoStart(id);backgroundPaused.clear();}
}
window.addEventListener('hashchange',navigate);
function applySettings(){document.documentElement.dataset.theme=state.settings.theme;$('#setting-theme').checked=state.settings.theme==='light';$('#setting-auto').checked=state.settings.autoConnect;$('#setting-hidden').checked=state.settings.pauseHidden;}
for(const [selector,key] of [['#setting-auto','autoConnect'],['#setting-hidden','pauseHidden'],['#setting-theme','theme']])$(selector).addEventListener('change',event=>{const value=key==='theme'?(event.target.checked?'light':'dark'):event.target.checked;persist({...state,settings:{...state.settings,[key]:value}});applySettings();});
$('#export-config').addEventListener('click',()=>{download(new Blob([serializeConfig(state.cameras)],{type:'application/json'}),'Huginn-Muninn-configuracion.json');toast('Configuración exportada. Contiene direcciones privadas; guárdala en privado.');});
$('#import-config').addEventListener('click',()=>$('#config-file').click());
$('#config-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>100000)throw new Error('El archivo supera el límite de 100 KB.');const imported=parseConfig(await file.text());const merged=[...new Map([...state.cameras,...imported].map(c=>[c.id,c])).values()];if(merged.length>MAX_CAMERAS)throw new Error('La importación superaría el máximo de 12 cámaras.');if(persist({...state,cameras:merged})){renderCameras();toast(`${imported.length} cámaras importadas o actualizadas.`);}}catch(error){toast(error.message);}finally{event.target.value='';}});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;});
window.addEventListener('appinstalled',()=>{installEvent=null;toast('HUGINN instalada.');});
async function install(){if(installEvent){await installEvent.prompt();await installEvent.userChoice;installEvent=null;}else $('#install-dialog').showModal();}
$('#install-button').addEventListener('click',install);$('#install-settings').addEventListener('click',install);
function network(){const online=navigator.onLine;$('#network').innerHTML=`<i></i>${online?'Con red':'Sin internet'}`;$('#network').classList.toggle('offline',!online);}
window.addEventListener('online',()=>{network();if(currentView==='cameras'&&state.settings.autoConnect)allCameras().forEach(c=>autoStart(c.id));});
window.addEventListener('offline',()=>{network();toast('El dispositivo perdió conexión a internet. La red local o VPN puede seguir disponible.');});
document.addEventListener('visibilitychange',()=>{if(!state.settings.pauseHidden)return;if(document.hidden)players.forEach((p,id)=>{if(p.wanted){backgroundPaused.add(id);p.stop('Pausada en segundo plano.');stopRecording(id);}});else if(currentView==='cameras'){for(const id of backgroundPaused)autoStart(id);backgroundPaused.clear();}});
window.addEventListener('pagehide',()=>{players.forEach(p=>p.stop());recorders.forEach(r=>{if(r.state!=='inactive')r.stop();});tokens.clear();});
window.addEventListener('pageshow',event=>{if(event.persisted&&state.settings.autoConnect&&currentView==='cameras')allCameras().forEach(c=>autoStart(c.id));});
const updateClock=()=>$('#clock').textContent=new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});updateClock();setInterval(updateClock,1000);
applySettings();navigate();renderCameras();network();if(state.storageError)toast('No se pudo leer la configuración local. Puedes importar una copia.');
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
  const offer=()=>{if(reg.waiting&&navigator.serviceWorker.controller){waitingWorker=reg.waiting;$('#update-banner').hidden=false;}};offer();reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',offer);});
}).catch(()=>toast('No se pudo habilitar el modo sin conexión. Comprueba que la app use HTTPS.'));
  let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(waitingWorker&&!reloading){reloading=true;location.reload();}});
}
$('#apply-update').addEventListener('click',()=>{if(recorders.size){toast('Guarda los clips activos antes de actualizar.');return;}waitingWorker?.postMessage('ACTIVATE_UPDATE');});
