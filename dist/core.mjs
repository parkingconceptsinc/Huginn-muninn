export const VERSION = '1.1.3';
export const MAX_CAMERAS = 12;
export const TYPES = {bridge:'Puente gratuito · RTSP / ONVIF',hls:'HLS · enlace HTTPS',mjpeg:'MJPEG · enlace HTTPS',mp4:'Video MP4 · enlace HTTPS'};
export const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
export function cameraId() {
  return 'cam-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
}

export function safeURL(value, {bridge = false} = {}) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Escribe una dirección completa, empezando por https://.'); }
  if (url.protocol === 'rtsp:') throw new Error('RTSP se configura en el equipo puente. Aquí introduce su dirección HTTPS, no la URL RTSP de la cámara.');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Utiliza HTTPS con un certificado válido. HTTP solo se admite en localhost para desarrollo.');
  if (url.username || url.password) throw new Error('Las credenciales de la cámara se configuran en el puente, no en la dirección.');
  if (url.hash) throw new Error('La dirección no debe incluir un fragmento (#).');
  for (const key of url.searchParams.keys()) {
    if (/^(token|access_token|password|passwd|secret|api_key|apikey|authorization|key|signature|sig)$/i.test(key)) throw new Error('Los enlaces con credenciales deben configurarse en el puente privado.');
  }
  if (bridge && (url.search || !['','/'].includes(url.pathname))) throw new Error('Escribe solo el origen del puente: https://equipo.tu-red.ts.net, sin rutas.');
  return bridge ? url.origin : url.href;
}

export function normalizeCamera(input, id = input?.id) {
  if (!input || typeof input !== 'object') throw new Error('Configuración de cámara inválida.');
  const name = String(input.name || '').trim();
  const group = String(input.group || 'General').trim();
  const type = String(input.type || '');
  if (!name || name.length > 60) throw new Error('El nombre debe tener entre 1 y 60 caracteres.');
  if (!group || group.length > 40) throw new Error('La ubicación debe tener entre 1 y 40 caracteres.');
  if (!Object.hasOwn(TYPES, type)) throw new Error('Selecciona un tipo de conexión compatible.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(id || ''))) throw new Error('Identificador de cámara inválido.');
  const url = safeURL(input.url, {bridge:type === 'bridge'});
  const stream = type === 'bridge' ? String(input.stream || '').trim() : '';
  if (type === 'bridge' && !/^[a-zA-Z0-9_-]{1,64}$/.test(stream)) throw new Error('El ID del puente solo admite letras, números, guiones y guiones bajos (máximo 64).');
  return {id:String(id),name,group,type,url,stream,favorite:input.favorite === true};
}

export function parseConfig(text) {
  if (typeof text !== 'string' || text.length > 100000) throw new Error('El archivo de configuración es demasiado grande.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('El archivo no contiene JSON válido.'); }
  if (!parsed || parsed.schema !== 1 || !Array.isArray(parsed.cameras) || parsed.cameras.length > MAX_CAMERAS) throw new Error('Formato incompatible o más de 12 cámaras.');
  const cameras = parsed.cameras.map(c => normalizeCamera(c));
  if (new Set(cameras.map(c => c.id)).size !== cameras.length) throw new Error('Hay identificadores de cámara repetidos.');
  return cameras;
}

export function serializeConfig(cameras) {
  return JSON.stringify({schema:1,version:VERSION,cameras:cameras.map(c => normalizeCamera(c))},null,2);
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function bridgePath(camera, action) {
  if (!['webrtc','mjpeg','ptz','snapshot','capabilities'].includes(action)) throw new Error('Acción desconocida.');
  return `${camera.url}/v1/cameras/${encodeURIComponent(camera.stream)}/${action}`;
}

export function connectionMessage(error) {
  if (error?.name === 'AbortError') return 'Se canceló la conexión.';
  return error?.message || 'No se pudo conectar. Comprueba la cámara, la red y el acceso al puente.';
}
