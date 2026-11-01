#!/usr/bin/env python3
"""Huginn · Muninn: free RTSP/WebRTC gateway and bounded ONVIF controls.
No Blue Iris, paid service, vendor account or third-party Python dependencies.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import re
import socket
import threading
import time
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlsplit
from urllib.request import (HTTPDigestAuthHandler, HTTPPasswordMgrWithDefaultRealm,
                            HTTPRedirectHandler, Request, build_opener)
from urllib.error import HTTPError

VERSION = '1.1.2'
ACTIONS = {'left':(-.35,0,0), 'right':(.35,0,0), 'up':(0,.35,0),
           'down':(0,-.35,0), 'zoom_in':(0,0,.35), 'zoom_out':(0,0,-.35)}
PTZ_NS = 'http://www.onvif.org/ver20/ptz/wsdl'
SOAP_NS = 'http://www.w3.org/2003/05/soap-envelope'

class BridgeError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def validate_url(value, local_only=False):
    parsed=urlsplit(value)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Dirección de servicio inválida.')
    if local_only and (parsed.hostname not in ('localhost','127.0.0.1','::1') or parsed.path not in ('','/')):
        raise ValueError('La API de go2rtc debe estar en localhost, en el mismo equipo que el puente.')
    return value.rstrip('/')

class Go2RTC:
    def __init__(self, url):
        self.url=validate_url(url, local_only=True)
        self.opener=build_opener(NoRedirect())
    def request(self, path, payload=None, content_type=None, timeout=15):
        headers={'Cache-Control':'no-cache'}
        if content_type: headers['Content-Type']=content_type
        return self.opener.open(Request(self.url+path, data=payload, headers=headers,
                                       method='POST' if payload is not None else 'GET'), timeout=timeout)
    def streams(self):
        with self.request('/api/streams') as response:
            data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024: raise BridgeError('Respuesta de catálogo demasiado grande.')
        result=json.loads(data)
        if not isinstance(result,dict): raise BridgeError('Catálogo de go2rtc incompatible.')
        return set(result)
    def exchange(self, stream, sdp):
        with self.request('/api/webrtc?'+urlencode({'src':stream}),sdp,'application/sdp') as response:
            answer=response.read(65537)
        if len(answer)>65536 or not answer.startswith(b'v=0'): raise BridgeError('Respuesta SDP incompatible.')
        return answer
    def media(self, stream, video=True):
        path='/api/stream.mjpeg' if video else '/api/frame.jpeg'
        response=self.request(path+'?'+urlencode({'src':stream}),timeout=20)
        mime=response.headers.get('Content-Type','').lower()
        if not (mime.startswith('multipart/') if video else mime.startswith('image/jpeg')):
            response.close();raise BridgeError('Esta fuente no entrega JPEG. Usa WebRTC o configura FFmpeg localmente.')
        return response

class ONVIF:
    def __init__(self, config):
        self.url=validate_url(config['ptz_url'])
        self.profile=str(config['profile_token'])
        if not self.profile or len(self.profile)>256: raise ValueError('Perfil ONVIF inválido.')
        self.user=os.environ.get(config.get('username_env','CAMERA_ONVIF_USER'),'')
        self.password=os.environ.get(config.get('password_env','CAMERA_ONVIF_PASSWORD'),'')
        if not self.user or not self.password: raise ValueError('Faltan las variables de credenciales ONVIF.')
        manager=HTTPPasswordMgrWithDefaultRealm();manager.add_password(None,self.url,self.user,self.password)
        self.opener=build_opener(NoRedirect(),HTTPDigestAuthHandler(manager))
        self.lock=threading.Lock();self.verified_at=None;self.verified=False
    def envelope(self, body):
        nonce=os.urandom(20)
        created=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        # WS-Security UsernameToken PasswordDigest is prescribed by ONVIF.
        digest=base64.b64encode(hashlib.sha1(nonce+created.encode()+self.password.encode(),usedforsecurity=False).digest()).decode()
        nonce64=base64.b64encode(nonce).decode()
        header=f'''<s:Header><wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>{escape(self.user)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{nonce64}</wsse:Nonce><wsu:Created>{created}</wsu:Created></wsse:UsernameToken></wsse:Security></s:Header>'''
        return (f'<s:Envelope xmlns:s="{SOAP_NS}" xmlns:tptz="{PTZ_NS}" xmlns:tt="http://www.onvif.org/ver10/schema">'+header+'<s:Body>'+body+'</s:Body></s:Envelope>').encode()
    def call(self, action, values):
        body=f'<tptz:{action}><tptz:ProfileToken>{escape(self.profile)}</tptz:ProfileToken>{values}</tptz:{action}>'
        headers={'Content-Type':f'application/soap+xml; charset=utf-8; action="{PTZ_NS}/{action}"', 'SOAPAction':f'"{PTZ_NS}/{action}"'}
        with self.opener.open(Request(self.url,data=self.envelope(body),headers=headers,method='POST'),timeout=8) as response:
            data=response.read(1024*1024+1)
        if len(data)>1024*1024 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise BridgeError('Respuesta ONVIF no permitida.')
        try: root=ET.fromstring(data)
        except ET.ParseError as exc: raise BridgeError('Respuesta ONVIF inválida.') from exc
        if root.find(f'.//{{{SOAP_NS}}}Fault') is not None: raise BridgeError('La cámara rechazó el comando ONVIF.')
        expected=f'.//{{{PTZ_NS}}}{action}Response'
        if root.find(expected) is None: raise BridgeError('La cámara no confirmó el comando ONVIF.')
        return root
    def available(self):
        if self.verified_at is not None and time.monotonic()-self.verified_at<30: return self.verified
        with self.lock:
            try: self.call('GetStatus','');self.verified=True
            except (OSError,ValueError,BridgeError): self.verified=False
            self.verified_at=time.monotonic()
        return self.verified
    def move(self, action):
        if action not in ACTIONS and action!='home': raise ValueError('Acción PTZ inválida.')
        if not self.lock.acquire(blocking=False): raise BridgeError('Hay otro movimiento en curso.')
        try:
            if action=='home':
                self.call('GotoHomePosition','')
            else:
                x,y,z=ACTIONS[action]
                velocity=f'<tptz:Velocity><tt:PanTilt x="{x}" y="{y}"/><tt:Zoom x="{z}"/></tptz:Velocity><tptz:Timeout>PT0.25S</tptz:Timeout>'
                try:
                    self.call('ContinuousMove',velocity)
                    time.sleep(.25)
                finally:
                    # Device timeout bounds movement even if this Stop request
                    # cannot reach the camera after a network interruption.
                    self.call('Stop','<tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom>')
        finally: self.lock.release()

class BridgeServer(ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=True
    def __init__(self,address,config,token,client):
        if len(token)<32: raise ValueError('La clave del puente necesita al menos 32 caracteres.')
        self.token,self.client=token,client
        self.origins=set(config.get('allowed_origins',[]))
        if not self.origins or '*' in self.origins: raise ValueError('Configura orígenes CORS concretos.')
        for origin in self.origins:
            u=urlsplit(origin)
            if not u.hostname or u.path or u.query or u.fragment or u.username or u.password or (u.scheme!='https' and not(u.scheme=='http' and u.hostname in ('localhost','127.0.0.1'))): raise ValueError('Origen CORS inválido.')
        self.cameras=config.get('cameras',{})
        if not isinstance(self.cameras,dict) or not 0<len(self.cameras)<=64: raise ValueError('Configura de 1 a 64 cámaras.')
        self.controllers={}
        for ident,c in self.cameras.items():
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',ident) or not isinstance(c,dict) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',c.get('stream','')) or c.get('transport','webrtc') not in ('webrtc','mjpeg'): raise ValueError('Configuración de cámara inválida.')
            if c.get('onvif'): self.controllers[ident]=ONVIF(c['onvif'])
        self.stream_slots=threading.BoundedSemaphore(4)
        self.catalog_lock=threading.Lock();self.catalog_time=None;self.catalog_cache=[]
        super().__init__(address,Handler)
    def catalog(self):
        with self.catalog_lock:
            if self.catalog_time is not None and time.monotonic()-self.catalog_time<3: return self.catalog_cache
            sources=self.client.streams();result=[]
            for ident,c in self.cameras.items():
                if c['stream'] not in sources: continue
                controller=self.controllers.get(ident)
                result.append({'id':ident,'name':str(c.get('name',ident))[:80],
                               'transport':c.get('transport','webrtc'),'ptzConfigured':controller is not None,'ptz':controller.verified if controller else False})
            self.catalog_cache,self.catalog_time=result,time.monotonic()
            return result

class Handler(BaseHTTPRequestHandler):
    server_version='HuginnMuninn/'+VERSION
    protocol_version='HTTP/1.1'
    def setup(self):
        super().setup();self.connection.settimeout(25)
    def log_message(self,*args): pass
    def cors(self):
        origin=self.headers.get('Origin')
        if origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
            self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type')
            if self.headers.get('Access-Control-Request-Private-Network')=='true': self.send_header('Access-Control-Allow-Private-Network','true')
    def respond(self,code,data,content_type='application/json; charset=utf-8'):
        raw=json.dumps(data,ensure_ascii=False).encode() if not isinstance(data,bytes) else data
        self.send_response(code);self.cors();self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(raw)
    def authorized(self):
        origin=self.headers.get('Origin')
        if origin is not None and origin not in self.server.origins:
            self.respond(403,{'error':'Origen no autorizado.'});return False
        if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+self.server.token).encode()):
            self.respond(401,{'error':'Clave de acceso inválida.'});return False
        return True
    def do_OPTIONS(self):
        if self.headers.get('Origin') not in self.server.origins:
            self.respond(403,{'error':'Origen no autorizado.'});return
        self.send_response(204);self.cors();self.send_header('Content-Length','0');self.send_header('Access-Control-Max-Age','600');self.end_headers()
    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')
    def read_body(self,limit,mime):
        try: size=int(self.headers.get('Content-Length','0'))
        except ValueError: raise ValueError('Longitud inválida.')
        if not 0<size<=limit or self.headers.get('Content-Type','').split(';')[0]!=mime: raise ValueError('Cuerpo de petición inválido.')
        return self.rfile.read(size)
    def dispatch(self,method):
        if not self.authorized(): self.close_connection=True;return
        try:
            if self.path=='/v1/cameras' and method=='GET':
                self.respond(200,{'version':VERSION,'backend':'go2rtc','cameras':self.server.catalog()});return
            match=re.fullmatch(r'/v1/cameras/([A-Za-z0-9_-]{1,64})/(webrtc|mjpeg|snapshot|ptz|capabilities)',self.path)
            if not match or match[1] not in self.server.cameras:
                self.respond(404,{'error':'Cámara o ruta no autorizada.'});self.close_connection=True;return
            ident,action=match.groups();camera=self.server.cameras[ident]
            if not any(c['id']==ident for c in self.server.catalog()):
                self.respond(404,{'error':'La fuente no está configurada en go2rtc.'});return
            if method=='GET' and action=='capabilities':
                controller=self.server.controllers.get(ident)
                self.respond(200,{'ptz':controller.available() if controller else False})
            elif method=='POST' and action=='webrtc':
                body=self.read_body(65536,'application/sdp')
                if not body.startswith(b'v=0'): raise ValueError('Oferta SDP inválida.')
                answer=self.server.client.exchange(camera['stream'],body)
                self.respond(201,answer,'application/sdp')
            elif method=='POST' and action=='ptz':
                controller=self.server.controllers.get(ident)
                if not controller or not controller.available():
                    self.respond(403,{'error':'No se ha confirmado ONVIF PTZ para esta cámara.'});return
                payload=json.loads(self.read_body(1024,'application/json'))
                if not isinstance(payload,dict) or set(payload)!={'action'} or payload['action'] not in (*ACTIONS,'home'): raise ValueError('Acción PTZ inválida.')
                controller.move(payload['action']);self.respond(200,{'ok':True})
            elif method=='GET' and action in ('mjpeg','snapshot'):
                self.send_media(camera['stream'],action=='mjpeg')
            else:
                self.respond(405,{'error':'Método no permitido.'});self.close_connection=True
        except (BrokenPipeError,ConnectionResetError,socket.timeout): self.close_connection=True
        except (ValueError,TypeError):
            if not getattr(self,'stream_started',False): self.respond(400,{'error':'Petición inválida.'})
            self.close_connection=True
        except (BridgeError,HTTPError,OSError):
            if not getattr(self,'stream_started',False): self.respond(502,{'error':'No se pudo completar la operación. Revisa go2rtc, la cámara y su configuración.'})
            self.close_connection=True
    def send_media(self,source,video):
        if not self.server.stream_slots.acquire(blocking=False):
            self.respond(429,{'error':'Máximo de 4 transmisiones MJPEG.'});return
        try:
            with self.server.client.media(source,video) as response:
                self.send_response(200);self.cors();self.send_header('Content-Type',response.headers.get('Content-Type',''))
                self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
                self.send_header('Connection','close');self.end_headers();self.stream_started=True;self.close_connection=True
                started,total=time.monotonic(),0
                while time.monotonic()-started<600:
                    chunk=response.read1(32768)
                    if not chunk: break
                    total+=len(chunk)
                    if not video and total>4*1024*1024: break
                    self.wfile.write(chunk);self.wfile.flush()
        finally: self.server.stream_slots.release()

def main():
    parser=argparse.ArgumentParser(description='Puente gratuito Huginn · Muninn para RTSP y ONVIF')
    parser.add_argument('--config',default='config.json');parser.add_argument('--port',type=int,default=8787)
    args=parser.parse_args()
    try:
        with open(args.config,encoding='utf-8') as file: config=json.load(file)
        client=Go2RTC(config.get('go2rtc_url','http://127.0.0.1:1984'))
        server=BridgeServer(('127.0.0.1',args.port),config,os.environ.get('CAMERA_BRIDGE_TOKEN',''),client)
    except (ValueError,KeyError,OSError): raise SystemExit('Configuración inválida: revisa config.json y CAMERA_BRIDGE_TOKEN (32 caracteres mínimo). Si habilitas ONVIF, configura sus variables de credenciales.')
    print(f'Huginn · Muninn {VERSION}: puente gratuito en 127.0.0.1:{args.port}. Usa HTTPS privado para la PWA.')
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__=='__main__': main()
