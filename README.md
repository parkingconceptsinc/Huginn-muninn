# Huginn · Muninn — Camera Control PWA

App propia y gratuita para ver y controlar cámaras compatibles desde teléfono y escritorio. Blue Iris es únicamente una referencia de organización visual y funcional. **No necesitas Blue Iris, su licencia, su cuenta ni un servidor Blue Iris.**

## Qué incluye la versión 1.1.1

- PWA instalable en Android, iPhone y escritorio, con tema claro/oscuro.
- Mosaico y vista ampliada; hasta 12 cámaras guardadas y 4 conexiones simultáneas (2 en teléfono).
- Video RTSP mediante un puente gratuito go2rtc → WebRTC. Audio de escucha si la fuente y el navegador admiten el códec.
- Giro, inclinación y zoom físico mediante ONVIF cuando la cámara lo permite y se configura un perfil válido. Los controles se habilitan después de comprobar el servicio PTZ.
- Fuentes directas HTTPS HLS, MJPEG y MP4 con CORS.
- Capturas, zoom digital, pantalla completa y clips locales de hasta 2 minutos cuando el navegador lo permite.
- Reconexión automática limitada, pausa en segundo plano y registro local de conexiones.
- Importación/exportación de configuración, versión visible y actualización de la PWA.

La vista de ejemplo está marcada como **simulada** y no representa una cámara real. Esta versión no implementa grabación continua, análisis de movimiento, alertas de vigilancia en segundo plano, reproducción de tarjetas SD ni audio bidireccional. El registro de actividad muestra conexiones, no detecciones de seguridad.

## Compatibilidad de las cámaras Vue990

La página oficial de Vue990 consultada no documenta una API pública ni confirma RTSP/ONVIF para un modelo concreto. Necesitamos **marca, modelo o manual de la cámara** para confirmar su acceso local. Un QR/ID de Vue990 no es una URL de video.

Si la cámara admite RTSP/ONVIF, se puede preparar su conexión al puente gratuito. Si solo admite la nube privada del fabricante, no se puede garantizar que funcione fuera de Vue990. La PWA no configura por sí sola el Wi-Fi de la cámara ni desbloquea protocolos cerrados.

## Software gratuito y alojamiento

La interfaz está preparada para GitHub Pages en `parkingconceptsinc/Huginn-muninn`. El código publicado no contiene direcciones privadas ni credenciales de cámaras. Cada dispositivo guarda su configuración en su navegador.

Para fuentes RTSP, un PC Windows/Linux/Mac, mini PC, NAS compatible o Raspberry Pi de la misma red ejecuta **go2rtc**, software libre con licencia MIT, y el puente Python incluido. El navegador recibe WebRTC; GitHub solo sirve la interfaz. El equipo puente debe permanecer encendido. No hay licencias ni suscripciones de la app; se usa el equipo y la conexión de internet que ya tengas.

Si la cámara ya entrega video HTTPS compatible, puede usarse directamente sin este puente. Para acceso fuera de la misma red se necesita una ruta privada hasta el puente, por ejemplo WireGuard. Tailscale es una opción más sencilla con plan gratuito para uso personal no comercial; sus condiciones son independientes de la app y no se requieren para usar otra VPN.

## 1. Configurar el video local

1. Descarga go2rtc desde su [repositorio oficial](https://github.com/AlexxIT/go2rtc/releases). No necesitas crear una cuenta en go2rtc.
2. Copia `bridge/go2rtc.example.yaml` a `bridge/go2rtc.yaml` en el equipo puente.
3. Reemplaza las URLs RTSP de ejemplo por las rutas reales del modelo de cámara y sus credenciales locales. Esas rutas no son universales. Los caracteres especiales del usuario/contraseña se deben codificar en la URL.
4. En `webrtc.candidates`, escribe la IP LAN real del equipo. Para acceso por VPN, añade también su IP de la VPN. No uses el dominio del proxy HTTPS como si fuera el puerto de medios.
5. Arranca el binario go2rtc en esa carpeta. Su API queda limitada a `127.0.0.1:1984` por la configuración incluida.

Para WebRTC usa H.264 cuando sea posible. El audio depende de que exista un códec compatible, como Opus o G.711; una fuente AAC puede necesitar conversión local con FFmpeg. La app no promete compatibilidad universal con H.265 o audio propietario. El puerto de medios 8555 TCP/UDP debe ser accesible desde la LAN o VPN autorizada, manteniendo el acceso público bloqueado por el firewall.

## 2. Ejecutar el puente gratuito

Necesitas Python 3.10+; no instala paquetes externos.

1. Copia `bridge/config.example.json` a `bridge/config.json`.
2. Haz coincidir el `stream` de cada cámara con la clave de `streams` en `go2rtc.yaml`. `entrada` y `patio` son ejemplos.
3. El origen permitido para esta publicación es `https://parkingconceptsinc.github.io`, sin ruta ni barra final. No uses `*`.
4. Crea una clave aleatoria de 32 caracteres o más y guárdala en tu gestor de contraseñas. Esta clave protege tu propio puente; no es una cuenta ni un servicio de pago.
5. En PowerShell, dentro de `bridge/`:

```powershell
$bridgeSecret = Read-Host 'Clave del puente (mínimo 32 caracteres)' -AsSecureString
$env:CAMERA_BRIDGE_TOKEN = [System.Net.NetworkCredential]::new('', $bridgeSecret).Password
py camera_bridge.py --config config.json
```

En Linux/macOS puedes cargar `CAMERA_BRIDGE_TOKEN` mediante el gestor de secretos de tu sistema y ejecutar `python3 camera_bridge.py --config config.json`.

El puente solo escucha en `127.0.0.1:8787`. No expone la administración de go2rtc, la configuración ni URLs RTSP. Solo admite las cámaras autorizadas en su archivo local.

## 3. Acceso HTTPS desde teléfono y escritorio

La PWA en GitHub Pages usa HTTPS. Para conectar al puente necesitas HTTPS con certificado válido y acceso de red desde tu teléfono. No basta con pegar una IP HTTP de la cámara en una página HTTPS.

Puedes usar un proxy HTTPS y WireGuard, ambos gratuitos, con un certificado válido para un nombre que controles. Como alternativa opcional para uso personal, Tailscale Serve puede proporcionar HTTPS dentro de una red privada:

```powershell
tailscale serve --bg 8787
```

Usa el origen HTTPS exacto que devuelva el comando. Mantén la VPN activa en el teléfono y añade la IP de la VPN a los candidatos WebRTC de go2rtc. El tráfico de video WebRTC viaja al puerto 8555 por la LAN/VPN; Serve solo transporta la API HTTPS. No abras la API de go2rtc, el puente o la cámara al internet público.

No hace falta una cuenta de Blue Iris. La VPN concreta puede tener su propio mecanismo de acceso; WireGuard autogestionado no exige una cuenta de proveedor.

## 4. Conectar una cámara en la PWA

1. Pulsa **Añadir cámara** → **Puente gratuito · RTSP / ONVIF**.
2. Introduce nombre, ubicación, origen HTTPS del puente y su clave.
3. Pulsa **Buscar cámaras del puente** y selecciona un ID, o escríbelo si ya lo conoces.
4. Guarda y conecta. El catálogo identifica fuentes configuradas; la app solo muestra «En directo» cuando recibe video.

Las claves se guardan únicamente en memoria durante esta sesión. Los nombres y direcciones sí se guardan en el dispositivo. No se sincronizan automáticamente entre teléfono y computadora: exporta/importa el JSON para transferir la configuración. El archivo no incluye claves.

## 5. Control físico ONVIF opcional

El video funciona sin habilitar PTZ. Para una cámara con ONVIF PTZ:

1. Obtén del dispositivo o su documentación la URL del servicio PTZ y el token del perfil de medios real. No asumas que los valores de ejemplo sirven para tu modelo.
2. Añade una propiedad `onvif` dentro de la cámara correspondiente en `bridge/config.json`, siguiendo `bridge/onvif.example.json`.
3. Carga sus credenciales en el entorno del puente. En PowerShell:

```powershell
$env:CAMERA_ONVIF_USER = Read-Host 'Usuario local ONVIF'
$cameraSecret = Read-Host 'Contraseña local ONVIF' -AsSecureString
$env:CAMERA_ONVIF_PASSWORD = [System.Net.NetworkCredential]::new('', $cameraSecret).Password
```

4. Reinicia el puente y conecta la cámara. La app comprueba el servicio `GetStatus` de ONVIF antes de habilitar los controles.

Las pulsaciones usan movimientos limitados a 0,25 s y una orden Stop adicional. Posición inicial, giro y zoom dependen de las funciones que implemente el modelo. Algunos dispositivos requieren un perfil, espacios de velocidad o autenticación específicos y necesitarán adaptar la configuración. El reloj de la cámara debe ser correcto para la autenticación WS-Security.

## Instalación de la PWA

- Android: Chrome → menú → Instalar app / Añadir a pantalla de inicio.
- iPhone/iPad: Safari → Compartir → Añadir a pantalla de inicio.
- Windows/macOS: Chrome o Edge → icono de instalación en la barra de direcciones.

La versión de escritorio es la misma aplicación en ventana independiente. No exige instalar Blue Iris. La interfaz abre sin internet tras su primera carga; el video necesita acceso a la red de la cámara. Los clips se descargan localmente y se detienen al pausar o salir de la aplicación.

## GitHub Pages y separación DEV / PROD

`main` es producción; `dev` ejecuta pruebas sin publicar producción. El almacenamiento se separa por origen y ruta de la aplicación, para aislar publicaciones DEV y PROD. No mezcles credenciales ni cámaras entre entornos. Para desarrollo, autoriza un origen localhost concreto en un puente DEV independiente.

En **Settings → Pages → Build and deployment**, selecciona **GitHub Actions** si el repositorio aún no tiene Pages activo. El flujo incluido valida y construye la PWA antes de publicar. El puente Python se ejecuta en tu equipo; GitHub Actions no aloja servicios de video permanentes.

```bash
npm test
npm run build
```

Node 20+ y Python 3.10+ bastan; no requiere `npm install`. HLS.js 1.6.19 y los iconos ya están incluidos. El sitio listo para publicar se genera en `_site/`. Las rutas relativas permiten alojarlo bajo `/Huginn-muninn/`.

Los archivos reales `bridge/config.json`, `bridge/go2rtc.yaml`, variables de entorno y capturas privadas están excluidos del repositorio. La caché de la PWA solo guarda una lista explícita de archivos de interfaz y nunca peticiones autenticadas, frames, video o datos del puente.

## Cambios de 1.1.1

- Caché de interfaz por versión completa: la actualización se activa desde el aviso sin mezclar módulos de versiones diferentes.
- Reproducción bloqueada por el navegador: espera la pulsación del usuario sin iniciar reconexiones innecesarias.
- El estado de reproducción requiere video reproduciéndose; al terminar un MP4 deja de aparecer activo.
- Configuración local aislada por dirección y ruta para separar DEV y PROD.

## Validación y límites actuales

Las pruebas automatizadas verifican validación de URL/configuración, protección de claves, parser MJPEG, límites de importación, autenticación del puente, CORS, restricciones de rutas, intercambio SDP con un servidor simulado y solicitudes ONVIF con timeout y Stop. También se revisó la interfaz en escritorio y a 390 píxeles de ancho.

No se ha probado con la cámara física del usuario. Quedan pendientes el modelo Vue990, la URL RTSP real, el perfil ONVIF si procede y la prueba de video/PTZ desde sus dispositivos. El intercambio simulado de SDP no sustituye una prueba WebRTC con cámara real.

## Documentación primaria

- [go2rtc y su código libre](https://github.com/AlexxIT/go2rtc)
- [API de go2rtc](https://github.com/AlexxIT/go2rtc/blob/master/website/api/openapi.yaml)
- [Especificación ONVIF PTZ](https://github.com/onvif/specs/blob/development/doc/PTZ.xml)
- [Vue990 oficial](https://www.vue990.com/app-download/index.html)
- [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Condiciones del plan personal Tailscale](https://tailscale.com/pricing)
- [HLS.js y licencia Apache-2.0](https://github.com/video-dev/hls.js)
