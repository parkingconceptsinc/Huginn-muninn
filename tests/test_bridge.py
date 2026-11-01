import importlib.util
import json
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec=importlib.util.spec_from_file_location('bridge',Path(__file__).resolve().parents[1]/'bridge/camera_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)

class FakeCameraStack(BaseHTTPRequestHandler):
    calls=[]
    def log_message(self,*args): pass
    def result(self,body,mime='application/json',status=200):
        if not isinstance(body,bytes): body=json.dumps(body).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        self.calls.append(('GET',self.path,b''))
        if self.path=='/api/streams':self.result({'entry':{'producers':[{'url':'rtsp://DO_NOT_EXPOSE:SECRET@camera'}]},'yard':{},'private':{}})
        elif self.path.startswith('/api/stream.mjpeg?src=entry'):
            self.result(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff\xd8test\xff\xd9\r\n','multipart/x-mixed-replace; boundary=frame')
        else:self.send_error(404)
    def do_POST(self):
        body=self.rfile.read(int(self.headers['Content-Length']));self.calls.append(('POST',self.path,body))
        if self.path.startswith('/api/webrtc?src=entry'):
            self.result(b'v=0\r\ns=mock\r\n','application/sdp',201)
        elif self.path=='/onvif/ptz':
            action=next((action for action in ['GetStatus','ContinuousMove','Stop','GotoHomePosition'] if ('<tptz:'+action+'>').encode() in body),None)
            if not action:self.send_error(400);return
            self.result(f'<s:Envelope xmlns:s="{bridge.SOAP_NS}"><s:Body><p:{action}Response xmlns:p="{bridge.PTZ_NS}"/></s:Body></s:Envelope>'.encode(),'application/soap+xml')
        else:self.send_error(404)

class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream=ThreadingHTTPServer(('127.0.0.1',0),FakeCameraStack)
        threading.Thread(target=cls.upstream.serve_forever,daemon=True).start()
        cls.source=f'http://127.0.0.1:{cls.upstream.server_port}'
        cls.client=bridge.Go2RTC(cls.source)
        cls.config={'allowed_origins':['https://example.github.io'],'cameras':{
            'entrada':{'stream':'entry','name':'Entrada','transport':'webrtc','onvif':{'ptz_url':cls.source+'/onvif/ptz','profile_token':'profile<1'}},
            'patio':{'stream':'yard','name':'Patio','transport':'webrtc'}}}
        with patch.dict(os.environ,{'CAMERA_ONVIF_USER':'viewer','CAMERA_ONVIF_PASSWORD':'PRIVATE_PASSWORD'}):
            cls.server=bridge.BridgeServer(('127.0.0.1',0),cls.config,'a'*40,cls.client)
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.server.server_port}'
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.upstream.shutdown();cls.upstream.server_close()
    def request(self,path,method='GET',data=None,token='a'*40,origin='https://example.github.io',mime='application/json'):
        headers={'Origin':origin,'Authorization':'Bearer '+token}
        if data is not None:headers['Content-Type']=mime
        if data is not None and not isinstance(data,bytes):data=json.dumps(data).encode()
        req=Request(self.base+path,data=data,headers=headers,method=method)
        try:
            with urlopen(req,timeout=5) as response:return response.status,dict(response.headers),response.read()
        except HTTPError as error:return error.code,dict(error.headers),error.read()
    def test_catalog_exposes_only_allowlisted_ids_without_rtsp_credentials(self):
        code,_,body=self.request('/v1/cameras');self.assertEqual(code,200)
        result=json.loads(body);self.assertEqual({c['id'] for c in result['cameras']},{'entrada','patio'})
        for secret in [b'DO_NOT_EXPOSE',b'SECRET',b'PRIVATE_PASSWORD',b'rtsp://']:self.assertNotIn(secret,body)
        self.assertEqual(result['backend'],'go2rtc')
    def test_auth_and_origin_are_required(self):
        self.assertEqual(self.request('/v1/cameras',token='wrong')[0],401)
        self.assertEqual(self.request('/v1/cameras',origin='https://untrusted.example')[0],403)
    def test_preflight_limits_allowed_origins(self):
        code,headers,_=self.request('/v1/cameras',method='OPTIONS')
        self.assertEqual(code,204);self.assertEqual(headers['Access-Control-Allow-Origin'],'https://example.github.io')
        self.assertEqual(self.request('/v1/cameras',method='OPTIONS',origin='null')[0],403)
    def test_webrtc_sdp_is_proxied_only_to_named_stream(self):
        code,headers,body=self.request('/v1/cameras/entrada/webrtc',method='POST',data=b'v=0\r\ns=offer\r\n',mime='application/sdp')
        self.assertEqual(code,201);self.assertEqual(body,b'v=0\r\ns=mock\r\n');self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(self.request('/v1/cameras/private/webrtc',method='POST',data=b'v=0',mime='application/sdp')[0],404)
        self.assertEqual(self.request('/v1/cameras/entrada/webrtc?src=private',method='POST',data=b'v=0',mime='application/sdp')[0],404)
    def test_malformed_sdp_does_not_reach_upstream(self):
        before=len(FakeCameraStack.calls)
        self.assertEqual(self.request('/v1/cameras/entrada/webrtc',method='POST',data=b'not sdp',mime='application/sdp')[0],400)
        self.assertFalse(any(call[0]=='POST' for call in FakeCameraStack.calls[before:]))
    def test_onvif_capabilities_are_verified_before_controls(self):
        code,_,body=self.request('/v1/cameras/entrada/capabilities')
        self.assertEqual(code,200);self.assertEqual(json.loads(body),{'ptz':True})
        self.assertEqual(json.loads(self.request('/v1/cameras/patio/capabilities')[2]),{'ptz':False})
    def test_onvif_move_uses_device_timeout_and_explicit_stop(self):
        code,_,_=self.request('/v1/cameras/entrada/ptz',method='POST',data={'action':'left'})
        self.assertEqual(code,200)
        soap=[c[2] for c in FakeCameraStack.calls if c[1]=='/onvif/ptz']
        move=next(body for body in reversed(soap) if b'ContinuousMove' in body)
        self.assertIn(b'<tptz:Timeout>PT0.25S</tptz:Timeout>',move);self.assertIn(b'profile&lt;1',move)
        self.assertIn(b'PasswordDigest',move);self.assertNotIn(b'PRIVATE_PASSWORD',move)
        self.assertIn(b'<tptz:Stop>',soap[-1])
    def test_unconfigured_ptz_and_arbitrary_commands_are_rejected(self):
        self.assertEqual(self.request('/v1/cameras/patio/ptz',method='POST',data={'action':'left'})[0],403)
        self.assertEqual(self.request('/v1/cameras/entrada/ptz',method='POST',data={'action':'left','url':'http://private'})[0],400)
        self.assertEqual(self.request('/v1/cameras/entrada/ptz',method='POST',data={'action':'reboot'})[0],400)
        self.assertEqual(self.request('/api/config')[0],404)
    def test_mjpeg_is_streamed_without_cache(self):
        code,headers,body=self.request('/v1/cameras/entrada/mjpeg')
        self.assertEqual(code,200);self.assertEqual(headers['Cache-Control'],'no-store');self.assertIn(b'\xff\xd8',body)
    def test_config_rejects_weak_tokens_wildcard_origins_and_nonlocal_go2rtc(self):
        with self.assertRaises(ValueError):bridge.BridgeServer(('127.0.0.1',0),self.config,'short',self.client)
        with self.assertRaises(ValueError):bridge.BridgeServer(('127.0.0.1',0),{**self.config,'allowed_origins':['*']},'a'*40,self.client)
        with self.assertRaises(ValueError):bridge.Go2RTC('http://untrusted.example')

if __name__=='__main__':unittest.main()
