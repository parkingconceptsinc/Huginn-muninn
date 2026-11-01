import {RETRY_DELAYS,bridgePath,connectionMessage} from './core.mjs';

// The parser accepts multipart streams split at arbitrary network boundaries.
// It extracts JPEG SOI/EOI markers and bounds retained data to avoid growth.
export class JPEGParser {
  constructor(limit = 4 * 1024 * 1024) { this.buffer = new Uint8Array(); this.limit = limit; }
  push(chunk) {
    if (this.buffer.length + chunk.length > this.limit) throw new Error('La imagen recibida supera el límite de 4 MB.');
    const data = new Uint8Array(this.buffer.length + chunk.length);
    data.set(this.buffer); data.set(chunk,this.buffer.length);
    const frames = [];
    let start = -1, consumed = 0;
    for (let i=0;i<data.length-1;i++) {
      if (start < 0 && data[i] === 0xff && data[i+1] === 0xd8) { start=i; i++; }
      else if (start >= 0 && data[i] === 0xff && data[i+1] === 0xd9) {
        frames.push(data.slice(start,i+2)); consumed=i+2; start=-1; i++;
      }
    }
    this.buffer = start >= 0 ? data.slice(start) : data.slice(Math.max(consumed,data.length-1));
    return frames;
  }
}

export class CameraPlayer {
  constructor(camera, video, onState, getToken) {
    this.camera=camera;this.video=video;this.onState=onState;this.getToken=getToken;
    this.wanted=false;this.epoch=0;this.retry=0;this.state='idle';this.ptz=false;
  }
  setState(state,message='') { this.state=state;this.onState(state,message); }
  async start() {
    if (this.wanted && this.state === 'blocked') { await this.play(); return; }
    if (this.wanted && ['connecting','live','sample'].includes(this.state)) return;
    this.wanted=true;this.retry=0;await this.connect();
  }
  async connect() {
    this.cleanup();const epoch=++this.epoch;
    this.controller=new AbortController();const signal=this.controller.signal;
    this.setState('connecting','Estableciendo conexión…');
    this.timeout=setTimeout(()=>this.fail(new Error('Sin imágenes durante 20 segundos. Revisa el servidor, la cámara y la VPN.'),epoch),20000);
    const playing=()=>{
      if (epoch !== this.epoch || !this.wanted || !this.video.videoWidth || this.video.paused) return;
      clearTimeout(this.timeout);
      this.setState(this.camera.type==='demo'?'sample':'live');
      clearTimeout(this.stableTimer);
      this.stableTimer=setTimeout(()=>{this.retry=0;},30000);
    };
    this.video.addEventListener('playing',playing,{signal});
    this.video.addEventListener('loadeddata',playing,{signal});
    this.video.addEventListener('ended',()=>this.stop(this.camera.type==='mp4'?'Video finalizado.':'La transmisión terminó.'),{signal});
    this.video.addEventListener('error',()=>this.fail(new Error('El navegador no puede reproducir esta fuente. Comprueba el formato y CORS.'),epoch),{signal});
    this.video.addEventListener('waiting',()=>{
      clearTimeout(this.timeout);
      this.timeout=setTimeout(()=>this.fail(new Error('Se interrumpió la recepción de video.'),epoch),20000);
    },{signal});
    this.video.muted=true;
    this.lastFrame=performance.now();
    const frame=()=>{if(epoch!==this.epoch||signal.aborted)return;this.lastFrame=performance.now();this.frameCallback=this.video.requestVideoFrameCallback(frame);};
    if(this.video.requestVideoFrameCallback)this.frameCallback=this.video.requestVideoFrameCallback(frame);
    this.watchdog=setInterval(()=>{
      if (!this.wanted || epoch!==this.epoch || this.state!=='live') return;
      if (this.camera.type==='bridge' && (this.transport==='mjpeg'||this.video.requestVideoFrameCallback) && performance.now()-this.lastFrame>20000) this.fail(new Error('El puente dejó de enviar imágenes.'),epoch);
    },5000);
    try {
      if (this.camera.type==='bridge') await this.bridge(epoch,signal);
      else if (this.camera.type==='demo') this.demo(epoch);
      else if (this.camera.type==='mjpeg') this.directMJPEG(epoch,signal);
      else if (this.camera.type==='hls' && !this.video.canPlayType('application/vnd.apple.mpegurl')) {
        if (!window.Hls?.isSupported()) throw new Error('Este navegador no admite HLS. Prueba Chrome, Edge o Safari actualizado.');
        this.hls=new window.Hls({lowLatencyMode:true,maxBufferLength:10,backBufferLength:5,manifestLoadingMaxRetry:1,levelLoadingMaxRetry:1,fragLoadingMaxRetry:1});
        this.hls.on(window.Hls.Events.ERROR,(_,data)=>{if(data.fatal)this.fail(new Error('No se pudo cargar HLS. Revisa la fuente, el códec y CORS.'),epoch);});
        this.hls.loadSource(this.camera.url);this.hls.attachMedia(this.video);
        await this.play();
      } else { this.video.crossOrigin='anonymous';this.video.src=this.camera.url;await this.play(); }
    } catch(error) { if (!signal.aborted)this.fail(error,epoch); }
  }
  async play() {
    try { await this.video.play(); }
    catch(error) {
      if(error.name==='NotAllowedError') {
        clearTimeout(this.timeout);
        this.setState('blocked','Pulsa reproducir para iniciar el video.');
      } else if(error.name!=='AbortError') throw error;
    }
  }
  async bridge(epoch,signal) {
    const token=this.getToken(this.camera.url);
    if (!token) {this.wanted=false;this.cleanup();this.setState('locked','Introduce la clave de acceso del puente.');return;}
    const headers={Authorization:`Bearer ${token}`};
    const catalog=await fetch(`${this.camera.url}/v1/cameras`,{headers,signal,cache:'no-store',credentials:'omit',redirect:'error'});
    if (!catalog.ok) throw new Error(catalog.status===401?'Clave del puente incorrecta. Edita el acceso para cambiarla.':'El puente no responde. Comprueba la dirección HTTPS, CORS y la VPN.');
    const items=await catalog.json();
    const capability=items.cameras?.find(c=>c.id===this.camera.stream);
    if (!capability) throw new Error('Este ID no está configurado en el puente gratuito.');
    this.ptz=capability.ptz===true;
    if(capability.ptzConfigured)this.refreshPTZ(epoch,signal,headers);
    this.transport=capability.transport||'webrtc';
    if(this.transport==='webrtc'){await this.webRTC(epoch,signal,headers);return;}
    this.onState('connecting','Recibiendo video del puente gratuito…');
    const response=await fetch(bridgePath(this.camera,'mjpeg'),{headers,signal,cache:'no-store',credentials:'omit',redirect:'error'});
    if (!response.ok || !response.body) throw new Error('No se pudo abrir MJPEG. Comprueba la cámara y que la fuente del puente tenga video JPEG.');
    if (!response.headers.get('content-type')?.toLowerCase().includes('multipart/')) throw new Error('El puente devolvió una respuesta de video incompatible.');
    this.canvas=document.createElement('canvas');this.canvas.width=1280;this.canvas.height=720;
    this.ctx=this.canvas.getContext('2d');
    if (!this.canvas.captureStream) throw new Error('Actualiza el navegador para reproducir el video.');
    this.mediaStream=this.canvas.captureStream(15);this.video.srcObject=this.mediaStream;
    const parser=new JPEGParser();const reader=response.body.getReader();this.reader=reader;let first=true;
    while (!signal.aborted && epoch===this.epoch) {
      const {done,value}=await reader.read();
      if(done)throw new Error('El puente cerró la transmisión.');
      const frames=parser.push(value);
      if (!frames.length)continue;
      // Discard older frames in the same chunk rather than building latency.
      const bitmap=await createImageBitmap(new Blob([frames.at(-1)],{type:'image/jpeg'}));
      if (signal.aborted || epoch!==this.epoch) {bitmap.close();return;}
      if(this.canvas.width!==bitmap.width||this.canvas.height!==bitmap.height){this.canvas.width=bitmap.width;this.canvas.height=bitmap.height;}
      this.ctx.drawImage(bitmap,0,0);bitmap.close();this.lastFrame=performance.now();
      if(first){first=false;await this.play();}
    }
  }
  async refreshPTZ(epoch,signal,headers) {
    try{
      const response=await fetch(bridgePath(this.camera,'capabilities'),{headers,signal,cache:'no-store',credentials:'omit',redirect:'error'});
      if(response.ok){const capabilities=await response.json();if(epoch===this.epoch&&!signal.aborted){this.ptz=capabilities.ptz===true;this.onState(this.state);}}
    }catch{/* Video continues when optional PTZ discovery fails. */}
  }
  async webRTC(epoch,signal,headers) {
    if(!window.RTCPeerConnection)throw new Error('Este navegador no admite WebRTC. Actualiza Chrome, Edge o Safari.');
    const peer=new RTCPeerConnection({iceServers:[]});this.peer=peer;
    peer.addTransceiver('video',{direction:'recvonly'});peer.addTransceiver('audio',{direction:'recvonly'});
    this.mediaStream=new MediaStream();this.video.srcObject=this.mediaStream;
    peer.addEventListener('track',event=>{
      if(epoch!==this.epoch||signal.aborted)return;
      this.mediaStream.addTrack(event.track);this.play();
    });
    peer.addEventListener('connectionstatechange',()=>{
      if(epoch!==this.epoch||signal.aborted)return;
      clearTimeout(this.peerTimer);
      if(peer.connectionState==='failed')this.fail(new Error('No se pudo establecer el canal de video. Comprueba la VPN y las direcciones ICE del puente.'),epoch);
      else if(peer.connectionState==='disconnected')this.peerTimer=setTimeout(()=>this.fail(new Error('Se interrumpió el canal de video.'),epoch),5000);
    });
    await peer.setLocalDescription(await peer.createOffer());
    if(signal.aborted)return;
    await new Promise(resolve=>{
      let timer;
      const done=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);signal.removeEventListener('abort',done);resolve();};
      const changed=()=>{if(peer.iceGatheringState==='complete')done();};
      timer=setTimeout(done,6000);peer.addEventListener('icegatheringstatechange',changed);signal.addEventListener('abort',done,{once:true});changed();
    });
    if(signal.aborted||epoch!==this.epoch)return;
    const response=await fetch(bridgePath(this.camera,'webrtc'),{method:'POST',headers:{...headers,'Content-Type':'application/sdp'},body:peer.localDescription.sdp,signal,cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response.ok)throw new Error('El puente no pudo abrir esta fuente RTSP. Comprueba su dirección y el códec H.264.');
    const sdp=await response.text();if(!sdp.startsWith('v=0'))throw new Error('El puente devolvió una respuesta WebRTC inválida.');
    if(signal.aborted||epoch!==this.epoch)return;
    await peer.setRemoteDescription({type:'answer',sdp});
  }
  directMJPEG(epoch,signal) {
    this.image=document.createElement('img');this.image.alt=this.camera.name;this.image.crossOrigin='anonymous';
    this.image.addEventListener('load',()=>{if(epoch===this.epoch){clearTimeout(this.timeout);this.setState('live');}},{signal});
    this.image.addEventListener('error',()=>this.fail(new Error('No se pudo abrir MJPEG. Revisa el enlace HTTPS y CORS.'),epoch),{signal});
    this.video.hidden=true;this.video.parentElement.append(this.image);this.image.src=this.camera.url;
  }
  demo(epoch) {
    this.canvas=document.createElement('canvas');this.canvas.width=1280;this.canvas.height=720;
    const ctx=this.canvas.getContext('2d');
    const draw=()=>{
      if(epoch!==this.epoch)return;
      const w=1280,h=720;ctx.fillStyle='#152632';ctx.fillRect(0,0,w,h);
      const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#203d4c');grad.addColorStop(1,'#101c2a');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
      ctx.fillStyle='#243746';ctx.fillRect(0,310,w,410);
      ctx.fillStyle='#405664';ctx.beginPath();ctx.moveTo(395,720);ctx.lineTo(580,360);ctx.lineTo(730,360);ctx.lineTo(985,720);ctx.fill();
      ctx.fillStyle='#344c5b';ctx.fillRect(120,170,480,270);ctx.fillStyle='#203443';ctx.beginPath();ctx.moveTo(90,180);ctx.lineTo(360,70);ctx.lineTo(640,180);ctx.fill();
      ctx.fillStyle='#142939';ctx.fillRect(190,235,120,95);ctx.fillRect(380,235,120,95);ctx.fillRect(520,330,60,110);
      ctx.strokeStyle='#617b8a';ctx.lineWidth=4;ctx.strokeRect(188,233,124,99);ctx.strokeRect(378,233,124,99);
      for(let i=0;i<7;i++){const x=780+i*55;ctx.fillStyle='#172f34';ctx.beginPath();ctx.arc(x,280-(i%2)*25,55+(i%2)*10,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263539';ctx.fillRect(x-5,310,10,125);}
      ctx.fillStyle='#111c26aa';ctx.fillRect(0,0,w,55);ctx.fillStyle='#c5d2dc';ctx.font='18px monospace';ctx.fillText('VISTA SIMULADA · SIN CÁMARA REAL',25,35);ctx.textAlign='right';ctx.fillText(new Date().toLocaleTimeString('es'),w-25,35);ctx.textAlign='left';
      ctx.strokeStyle='#7fa4b94d';ctx.lineWidth=1;ctx.strokeRect(28,80,w-56,h-110);
      const x=650+Math.sin(Date.now()/3500)*130;ctx.fillStyle='#7c98a4';ctx.beginPath();ctx.arc(x,490,13,0,Math.PI*2);ctx.fill();ctx.fillRect(x-10,505,20,35);
      this.demoTimer=setTimeout(draw,100);
    };draw();this.mediaStream=this.canvas.captureStream(10);this.video.srcObject=this.mediaStream;this.play();
  }
  fail(error,epoch) {
    if(epoch!==this.epoch||!this.wanted)return;
    this.cleanup();this.epoch++;
    if(this.retry<RETRY_DELAYS.length && navigator.onLine){
      const delay=RETRY_DELAYS[this.retry++];this.setState('retry',`${connectionMessage(error)} Reintento ${this.retry}/5 en ${delay/1000} s.`);
      this.retryTimer=setTimeout(()=>{if(this.wanted)this.connect();},delay);
    }else{this.wanted=false;this.setState('error',connectionMessage(error));}
  }
  stop(message='Conexión pausada.') {this.wanted=false;this.epoch++;this.cleanup();this.setState('paused',message);}
  cleanup() {
    clearTimeout(this.timeout);clearTimeout(this.retryTimer);clearTimeout(this.demoTimer);clearTimeout(this.stableTimer);clearInterval(this.watchdog);clearTimeout(this.peerTimer);
    if(this.frameCallback&&this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.frameCallback);
    this.controller?.abort();this.peer?.close();this.peer=null;this.reader?.cancel().catch(()=>{});this.reader=null;
    this.hls?.destroy();this.hls=null;
    this.mediaStream?.getTracks().forEach(t=>t.stop());this.mediaStream=null;
    this.video.pause();this.video.srcObject=null;this.video.removeAttribute('src');this.video.load();this.video.hidden=false;
    if(this.image){this.image.removeAttribute('src');this.image.remove();this.image=null;}
    this.canvas=null;this.ptz=false;
  }
  async snapshot() {
    if(!['live','sample'].includes(this.state))throw new Error('Conecta la cámara antes de capturar.');
    const source=this.image||this.video;
    const width=source.videoWidth||source.naturalWidth,height=source.videoHeight||source.naturalHeight;
    if(!width||!height)throw new Error('Todavía no hay una imagen disponible.');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(source,0,0,width,height);
    return new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se pudo capturar la imagen.')),'image/jpeg',.92);}catch{reject(new Error('El servidor debe permitir CORS para guardar capturas.'));}});
  }
}
