import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CameraPlayer} from '../dist/player.mjs';

class Video extends EventTarget {
  videoWidth=1280;
  paused=true;
  allowPlay=true;
  play() {
    this.dispatchEvent(new Event('loadeddata'));
    if(!this.allowPlay)return Promise.reject(new DOMException('Gesture required','NotAllowedError'));
    this.paused=false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause(){this.paused=true;}
  load(){}
  removeAttribute(){}
}
const camera={id:'test',name:'Test',type:'mp4',url:'https://camera.example/video.mp4'};

test('autoplay waits for a user gesture without reconnecting or reporting live video',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const video=new Video(),states=[];
  video.allowPlay=false;
  const player=new CameraPlayer(camera,video,state=>states.push(state),()=>null);
  t.after(()=>player.stop());
  await player.start();
  assert.equal(player.state,'blocked');
  assert.ok(!states.includes('live'));
  t.mock.timers.tick(25000);
  assert.equal(player.state,'blocked');
  video.allowPlay=true;
  await player.start();
  assert.equal(player.state,'live');
});

test('a finished video stops its connection and no longer appears live',async t=>{
  const video=new Video();
  const player=new CameraPlayer(camera,video,()=>{},()=>null);
  t.after(()=>player.stop());
  await player.start();
  assert.equal(player.state,'live');
  video.dispatchEvent(new Event('ended'));
  assert.equal(player.state,'paused');
  assert.equal(player.wanted,false);
});
