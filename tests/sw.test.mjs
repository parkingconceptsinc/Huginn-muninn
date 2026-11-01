import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('installed shell stays on one release and never caches camera requests',async()=>{
  const events=new Map();let fetched=0;
  const installed={release:'installed'};
  const context={URL,Set,self:{location:{href:'https://example.github.io/Huginn-muninn/sw.js'},addEventListener:(name,handler)=>events.set(name,handler)},
    caches:{open:async()=>({match:async()=>installed})},fetch:async()=>{fetched++;return {release:'new'};}};
  runInNewContext(await readFile(new URL('../dist/sw.js',import.meta.url),'utf8'),context);
  let result;
  events.get('fetch')({request:new Request('https://example.github.io/Huginn-muninn/app.mjs'),respondWith:value=>result=value});
  assert.equal(await result,installed);
  assert.equal(fetched,0);
  for(const request of [
    new Request('https://bridge.example/v1/cameras'),
    new Request('https://example.github.io/Huginn-muninn/app.mjs',{headers:{Authorization:'Bearer secret'}}),
    new Request('https://example.github.io/Huginn-muninn/api/frame.jpeg'),
    new Request('https://example.github.io/Huginn-muninn/app.mjs?token=secret')
  ])events.get('fetch')({request,respondWith:()=>assert.fail('Private or non-shell request intercepted')});
});
