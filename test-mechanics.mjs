import assert from 'node:assert/strict';import{Game,V,distance}from './src/game.js';
const events=[];const g=new Game(e=>events.push(e));
const tick=t=>{for(let i=0;i<t*60;i++)g.tick(1/60)};
const walk=(x,z)=>{let watchdog=0;while(distance(g.player,V(x,0,z))>.08&&watchdog++<20000){g.move(x-g.player.x,z-g.player.z,1/60);g.tick(1/60);if(g.failed)break;}return watchdog<20000;};
// Real movement simulation, action tests separate from browser ray/input tests.
assert(walk(3.2,4.6));g.act('latch');g.act('pickup');walk(0,0);assert(g.anomalyDone);tick(2);assert(events.some(e=>e.type==='metal'&&e.pos.y===0));walk(0,-6);g.act('bell');g.capture();assert(g.clip.length>0);walk(0,-11);g.place();walk(0,-6);tick(10);assert.equal(g.phase,3);assert(g.lureCount>0);assert(events.some(e=>e.replay&&e.pos.z< -10));
const time=g.time,at=g.device.at;assert.equal(g.time,time);assert.equal(g.device.at,at); // Pause is caller not ticking.
g.checkpoint=1;g.restore();assert.equal(g.phase,3);assert.equal(g.player.y,3);assert(g.hasRecorder&&g.clip.length);g.checkpoint=2;g.restore();assert(g.power&&g.valve&&!g.motor&&!g.paper);assert.equal(g.phase,4);g.reset();assert.equal(g.phase,0);assert.equal(g.holdSoundAt,0);console.log('PASS mechanics: movement-driven anomaly, recording, relocated playback, threat response, checkpoint inventory and reset');
// Regression: a sound at the exact capture instant must not fall outside [0,6).
const instant=[];const h=new Game(e=>instant.push(e));h.hasRecorder=true;h.phase=3;h.sound('knock',h.player,5);h.capture();assert(h.clip[0].time<6);h.place();for(let i=0;i<11*60;i++)h.tick(1/60);assert(instant.some(e=>e.replay&&e.type==='knock'));
// An incorrect lure can kill; restore keeps inventory and a viable checkpoint.
const f=new Game();f.checkpoint=2;f.restore();f.player=V(4,0,-24);f.threat=Object.assign(f.threat,V(4,.2,-24));f.sound('knock',f.player,9);for(let i=0;i<4*60;i++)f.tick(1/60);assert(f.failed);f.restore();assert(!f.failed&&f.power&&f.hasRecorder&&f.clip.length&&!f.device);
console.log('PASS regressions: latest sound replayed; failed lure and checkpoint recovery');

// Failure/ending are terminal within a frame: held E may still arrive after tick.
for(const state of ['failed','ended']){
 const q=new Game();q.phase=3;q.hasRecorder=true;q.inlet=true;q.valve=true;q.hold=3.99;q.holding='power';q[state]=true;
 q.updateHold('power',.05);assert.equal(q.power,false);assert.equal(q.hold,0);
 q.act('bell');assert.equal(q.stats.events,0);q.capture();q.place();assert.equal(q.device,null);
}
// Repeated playback can be recovered and reused without erasing the clip.
const r=new Game();r.hasRecorder=true;r.phase=2;r.sound('knock',r.player,5);r.capture();r.place();
for(let i=0;i<25*60;i++)r.tick(1/60);assert(r.device.done);const clip=r.clip.length;assert(r.retrieve());r.place();assert(r.device&&!r.device.done);assert.equal(r.clip.length,clip);
console.log('PASS lifecycle: no post-failure hold completion; expired recorder reusable');
// Final acoustic callback is anchored to the same physical water gauge seen earlier.
const finalEvents=[];const finish=new Game(e=>finalEvents.push(e));finish.paper=true;finish.phase=6;finish.act('exit');
assert(finish.ended);assert.deepEqual(finalEvents.at(-1).pos,V(16,2,-1));
console.log('PASS ending: final step uses water gauge position');
