import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('branch and Actions publishing open the same complete PWA instead of the README',async()=>{
  const root=new URL('../',import.meta.url);
  await promisify(execFile)(process.execPath,['scripts/build.mjs'],{cwd:root});
  const text=path=>readFile(new URL(path,root),'utf8');
  assert.equal(await text('_site/index.html'),await text('index.html'));
  assert.match(await text('index.html'),/url=\.\/dist\//);
  assert.equal(await text('_site/dist/index.html'),await text('dist/index.html'));
  const manifest=JSON.parse(await text('_site/dist/manifest.webmanifest'));
  for(const asset of ['app.mjs','core.mjs','storage.mjs','player.mjs','app.css','sw.js','vendor/hls.min.js',...manifest.icons.map(i=>i.src)])
    await access(new URL('_site/dist/'+asset,root));
  await assert.rejects(access(new URL('_site/bridge/camera_bridge.py',root)),{code:'ENOENT'});
});
