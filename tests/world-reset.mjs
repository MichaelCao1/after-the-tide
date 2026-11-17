import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorld } from '../src/world.js';

const ctx = new Proxy(
  { createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (o, k) => (k in o ? o[k] : () => {}) }
);
globalThis.document = { querySelectorAll: () => [], createElement: () => ({ width: 512, height: 512, getContext: () => ctx }) };

const scene = new THREE.Scene(), w = createWorld(scene);
const original = w.rolls.map(r => r.quaternion.toArray()), pen = w.penArm.position.toArray();
assert.equal(w.southDoor.position.y, 0, 'South shutter closed initially');

w.addRipple({ x: 3, z: -25 }, 1);
for (let i = 0; i < 100; i++) {
  w.update(0.05, { phase: 7, ended: true, motor: true, power: true, powered: true, valve: true });
}
assert.notDeepEqual(w.rolls.map(r => r.quaternion.toArray()), original);
assert.notDeepEqual(w.penArm.position.toArray(), pen);
assert(w.southDoor.position.y > 2.8, 'South shutter opens when powered & valve closed');
assert(w.water.material.uniforms.uTime.value > 0);

w.reset();
assert.deepEqual(w.rolls.map(r => r.quaternion.toArray()), original);
assert.deepEqual(w.penArm.position.toArray(), pen);
assert.equal(w.southDoor.position.y, 0, 'South shutter resets to closed');
assert.equal(w.water.material.uniforms.uTime.value, 0);
assert(w.water.material.uniforms.uRings.value.every(r => r.z === -100 && r.w === 0));

w.update(0, { phase: 0, motor: false, powered: false, valve: false });
assert.deepEqual(w.rolls.map(r => r.quaternion.toArray()), original);
assert.deepEqual(w.penArm.position.toArray(), pen);
assert.equal(w.southDoor.position.y, 0);
assert.equal(w.lights.emergency.intensity, 0);

// Continue / checkpoint restore frame-0 immediate pose check
w.update(0, { phase: 4, power: true, powered: true, valve: true });
assert.equal(w.southDoor.position.y, 2.88, 'Continue/Restore snaps south shutter open on frame 0');
w.reset();
console.log('PASS authored roller/pen/shutter pose, ripple epoch, Continue snap and emergency state reset');
