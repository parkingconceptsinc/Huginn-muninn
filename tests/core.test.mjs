import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {safeURL,normalizeCamera,parseConfig,serializeConfig,escapeHTML,bridgePath} from '../dist/core.mjs';
import {readState,writeState,storageKey} from '../dist/storage.mjs';
import {JPEGParser} from '../dist/player.mjs';
const camera={id:'entry',name:'Entrada',group:'Casa',type:'bridge',url:'https://pc.example.ts.net',stream:'entrada'};
test('URL validation rejects mixed content, URL credentials and non-network schemes',()=>{
  for(const input of ['http://192.168.1.2','rtsp://camera/stream','javascript:alert(1)','data:image/jpeg;base64,xx','https://admin:password@camera.example','https://camera.example/#private','https://camera.example/?token=secret'])assert.throws(()=>safeURL(input));
  assert.equal(safeURL('http://127.0.0.1:8787',{bridge:true}),'http://127.0.0.1:8787');
});
test('bridge origin rejects paths, query strings and malformed camera IDs',()=>{
  assert.throws(()=>normalizeCamera({...camera,url:'https://pc.example.ts.net/admin'}));
  assert.throws(()=>normalizeCamera({...camera,stream:'../admin'}));
  assert.throws(()=>normalizeCamera({...camera,id:'<img>'}));
});
test('normalization and exports do not preserve secrets or extra fields',()=>{
  const text=serializeConfig([{...camera,token:'SUPERSECRET',password:'PASSWORD',runtime:{session:'HIDDEN'}}]);
  for(const secret of ['SUPERSECRET','PASSWORD','HIDDEN'])assert.ok(!text.includes(secret));
  assert.equal(parseConfig(text)[0].name,'Entrada');
});
test('malformed imports, duplicates and oversized configurations fail atomically',()=>{
  for(const text of ['no-json',JSON.stringify({schema:2,cameras:[]}),JSON.stringify({schema:1,cameras:[camera,camera]}),JSON.stringify({schema:1,cameras:Array.from({length:13},(_,i)=>({...camera,id:'c'+i}))})])assert.throws(()=>parseConfig(text));
});
test('storage projects valid fields and recovers from corrupted state',()=>{
  let saved;const storage={setItem:(_,v)=>saved=v,getItem:()=>saved};
  writeState({cameras:[{...camera,token:'NEVER-PERSIST'}],settings:{layout:'focus'}},storage);
  assert.ok(!saved.includes('NEVER-PERSIST'));assert.equal(readState(storage).settings.layout,'focus');
  saved='{broken';assert.equal(readState(storage).storageError,true);
});
test('DEV and PROD configuration use separate application scopes',()=>{
  const prod=storageKey({href:'https://example.github.io/Huginn-muninn/#settings'});
  assert.equal(prod,storageKey({href:'https://example.github.io/Huginn-muninn/'}));
  assert.notEqual(prod,storageKey({href:'https://example.github.io/Huginn-muninn-dev/'}));
  assert.notEqual(prod,storageKey({href:'http://localhost:4173/'}));
});
test('HTML display strings are escaped',()=>assert.equal(escapeHTML('<img src="x" onerror="x">'), '&lt;img src=&quot;x&quot; onerror=&quot;x&quot;&gt;'));
test('bridge paths cannot request arbitrary proxy operations',()=>{
  assert.equal(bridgePath(camera,'ptz'),'https://pc.example.ts.net/v1/cameras/entrada/ptz');
  assert.throws(()=>bridgePath(camera,'config'));
});
test('MJPEG parser handles every two-way network split',()=>{
  const data=new Uint8Array([45,45,10,255,216,1,2,3,255,217,13,10,255,216,4,5,255,217]);
  for(let split=1;split<data.length;split++){
    const parser=new JPEGParser();const frames=[...parser.push(data.slice(0,split)),...parser.push(data.slice(split))];
    assert.equal(frames.length,2,'split='+split);assert.deepEqual([...frames[0]],[255,216,1,2,3,255,217]);
  }
});
test('MJPEG parser supports one-byte chunks and limits unclosed frames',()=>{
  const parser=new JPEGParser();const chunks=[255,216,1,2,3,255,217];const frames=chunks.flatMap(value=>parser.push(new Uint8Array([value])));
  assert.equal(frames.length,1);const bounded=new JPEGParser(8);bounded.push(new Uint8Array([255,216,1,2]));assert.throws(()=>bounded.push(new Uint8Array(6)));
});
test('offline cache uses an explicit shell allowlist and excludes authorized requests',async()=>{
  const text=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
  assert.match(text,/request.headers.has\('authorization'\)/);assert.match(text,/!SHELL.has\(url.href\)/);assert.match(text,/url.search/);
});
