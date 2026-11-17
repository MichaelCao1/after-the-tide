import {Game,V,distance} from '../src/game.js';
import * as THREE from 'three';
import {createWorld} from '../src/world.js';
const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>k in o?o[k]:()=>{}});
globalThis.document={createElement:()=>({width:512,height:512,getContext:()=>ctx})};
let g;g=new Game(()=>{},s=>console.log(Math.round(g?.time||0),s));
g.colliders=createWorld(new THREE.Scene()).colliders;
function tick(t,id=''){for(let i=0;i<t*60;i++){g.tick(1/60);g.updateHold(id,1/60);if(g.failed)throw Error(`DEAD at ${g.time} ${JSON.stringify(g.player)} threat ${JSON.stringify(g.threat)}`)}}
function walk(x,z,slow=false){let n=0;while(distance(g.player,V(x,0,z))>.08&&n++<20000){g.move(x-g.player.x,z-g.player.z,1/60,slow);tick(1/60)}if(n>=20000)throw Error('blocked '+JSON.stringify(g.player));}
walk(3.2,4.6);g.act('latch');g.act('pickup');walk(0,-6);g.act('bell');g.capture();walk(0,-11);g.place();walk(0,-6);tick(10);walk(0,-11);g.retrieve();walk(0,-17.5);walk(-6.3,-17.5);walk(-6.3,-22);g.act('pipe');g.capture();walk(-6.3,-29);g.place();walk(-6.3,-22);tick(7);walk(-6.3,-29);walk(-4.3,-27);walk(-4.3,-23.5);tick(5.6,'inlet');walk(-4.3,-28.5);walk(5.2,-29.5);tick(7.1,'valve');walk(2.0,-29.5);walk(-6.0,-32.2);tick(4.1,'power');walk(-4.8,-33.8);walk(-4.8,-34.4);walk(2,-34.4);walk(2,-38);walk(4,-40);g.act('terminal-pipe');g.capture();walk(0,-38);g.place();walk(0,-43.1);g.act('machine');walk(4,-42);tick(25);walk(0,-43.1);g.act('machine');console.log({phase:g.phase,paper:g.paper,time:g.time,threat:g.threat});
if(!g.paper){walk(0,-38);g.retrieve();g.capture();g.place();walk(4,-41);tick(8);walk(0,-43.1);g.act('machine');console.log('re-lured',g.paper,g.time,g.threat);}if(g.paper){walk(2,-38);walk(2,-34);walk(-5,-34);walk(-6.3,-30);walk(-6.3,-17.5);walk(0,-17.5);walk(0,3.5);walk(3.2,4.6);g.act('exit');console.log('ENDING',g.ended,g.time,g.stats)}
