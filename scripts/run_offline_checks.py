#!/usr/bin/env python3
"""
Offline deterministic verification runner for After the Tide (退潮之后).
Executes:
1. Synthetic zero-exit error-marker guard probe.
2. All 9 localization/simulation/world/save/occlusion suites in JavaScriptCore (jsc).
3. Full event-driven bundle integration suite against the built dist/assets/index-*.js
   covering all 18 fixed world targets + dynamic placed recorder (19/19 total), hold-E note repeat guard,
   2.60m retrieval, target competition, rapid turning, Shift sprint + CapsLock quiet walk + override,
   blur/pointerlockchange cleanup, south doorway shutter + jamb alignment, and storage-denial checkpoint recovery.

NOTE: This is an offline JS/DOM/event/raycast/geometry verification suite, NOT a real desktop
browser WebGL GPU visual/frame-rate pass.
"""
import glob
import os
import re
import subprocess
import tempfile

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
SEED_PATH = os.path.join(PROJECT_DIR, "scripts", "vendor-three-iife.js")

with open(SEED_PATH, "r", encoding="utf-8") as f:
    VENDOR_IIFE = f.read()

COMMON_PRELUDE = r"""
const console = {
  log: (...a) => print(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  warn: (...a) => print('WARN:', a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  error: (...a) => { print('ERR:', a.join(' ')); throw new Error(a.join(' ')); }
};
function assert(cond, msg = 'Assertion failed') { if (!cond) throw new Error(msg); }
assert.equal = (a, b, m) => { if (a !== b) throw new Error((m || 'Not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };
assert.deepEqual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'Not deepEqual') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };
assert.notDeepEqual = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) throw new Error((m || 'Unexpectedly deepEqual') + ': ' + JSON.stringify(a)); };

globalThis.MutationObserver = class { observe() {} };
const __ctx2d = new Proxy({
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  save() {}, restore() {}, setLineDash() {}, clearRect() {}, fillRect() {}, strokeRect() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, fill() {}, stroke() {}, fillText() {}
}, { get: (o, k) => k in o ? o[k] : () => {} });
globalThis.document = {
  querySelectorAll: () => [],
  createElement: () => ({ width: 256, height: 256, getContext: () => __ctx2d })
};
"""

def strip_src_module(rel_path: str) -> str:
    full = os.path.join(PROJECT_DIR, rel_path)
    with open(full, "r", encoding="utf-8") as f:
        code = f.read()
    out = []
    for ln in code.splitlines():
        if ln.strip().startswith("import "):
            continue
        ln = re.sub(r"^(\s*)export\s+(const|let|function|class)\s+", r"\1\2 ", ln)
        out.append(ln)
    return "\n".join(out)

def transform_test_file(rel_path: str) -> str:
    full = os.path.join(PROJECT_DIR, rel_path)
    with open(full, "r", encoding="utf-8") as f:
        code = f.read()
    out = []
    for ln in code.splitlines():
        s = ln.strip()
        if s.startswith("import "):
            continue
        ln = ln.replace("await new Promise(r=>setTimeout(r,100));", "")
        ln = ln.replace(
            "globalThis.document={createElement:",
            "globalThis.document={querySelectorAll:()=>[],createElement:"
        )
        out.append(ln)
    return "\n".join(out)

def run_jsc(js_code: str, label: str):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
        tf.write(js_code)
        tmp_path = tf.name
    try:
        res = subprocess.run([JSC, tmp_path], capture_output=True, text=True, timeout=45)
        has_err_marker = any(m in res.stdout or m in res.stderr for m in ('ASYNC_ERR:', 'E2E_ERR:', 'ERR:', 'Exception:', 'SyntaxError:', 'ReferenceError:', 'TypeError:'))
        if res.returncode != 0 or has_err_marker:
            print(f"FAIL [{label}]:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
            raise SystemExit(res.returncode or 1)
        print(f"=== PASS [{label}] ===")
        for line in res.stdout.strip().splitlines():
            print("  " + line)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def run_legacy_suites():
    fs_shim = "const fs = { existsSync: () => false, readdirSync: () => [], readFileSync: () => '{}' };\n"

    shared_modules = "\n".join([
        VENDOR_IIFE,
        "const THREE = __THREE_BUNDLE__;",
        "const { mergeGeometries } = __THREE_BUNDLE__;",
        fs_shim,
        strip_src_module("src/i18n.js"),
        strip_src_module("src/game.js"),
        strip_src_module("src/save.js"),
        strip_src_module("src/interaction.js"),
        strip_src_module("src/world.js"),
        "const visible = hasClearInteractionPath;",
    ])

    test_files = [
        "tests/localization.mjs",
        "test-mechanics.mjs",
        "tests/interaction-occlusion.mjs",
        "tests/world-reset.mjs",
        "tests/save-checkpoints.mjs",
        "tests/pressure-detents.mjs",
        "tests/observed-sound-rule.mjs",
        "tests/full-route.mjs",
        "tests/negative-routes.mjs",
    ]
    for tf in test_files:
        body = transform_test_file(tf)
        js = COMMON_PRELUDE + "\n" + shared_modules + "\n(async () => {\n" + body + "\n})().catch(e => { print('ASYNC_ERR:', e, e?.stack); quit(1); });\n"
        run_jsc(js, tf)

def run_bundle_e2e_suite():
    dist_js_list = glob.glob(os.path.join(PROJECT_DIR, "dist/assets/index-*.js"))
    assert len(dist_js_list) == 1, f"Expected 1 dist JS bundle, found {dist_js_list}"
    with open(dist_js_list[0], "r", encoding="utf-8") as f:
        bundle_code = f.read()

    dom_and_webgl_harness = r"""
const console = {
  log: (...a) => print(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  warn: (...a) => print('WARN:', a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
  error: (...a) => { print('ERR:', a.join(' ')); throw new Error(a.join(' ')); }
};
function assert(cond, msg = 'Assertion failed') { if (!cond) throw new Error(msg); }
assert.equal = (a, b, m) => { if (a !== b) throw new Error((m || 'Not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); };

// Minimal W3C DOM + Event + WebGL2 stub so the actual built dist bundle runs unmodified
let __now = 1000;
globalThis.performance = { now: () => __now };
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.MutationObserver = class { observe() {} };
globalThis.URLSearchParams = class { constructor() {} has() { return true; } };
globalThis.location = { search: '?qa=1' };

let __storageThrow = false;
const __store = new Map([['tide-language', 'zh-CN']]);
globalThis.localStorage = {
  getItem: k => __store.has(k) ? __store.get(k) : null,
  setItem: (k, v) => { if (__storageThrow) throw new Error('QuotaExceededError'); __store.set(k, String(v)); },
  removeItem: k => { if (__storageThrow) throw new Error('SecurityError'); __store.delete(k); },
  clear: () => __store.clear()
};

const __winListeners = new Map();
const __docListeners = new Map();
globalThis.addEventListener = (type, fn) => {
  if (!__winListeners.has(type)) __winListeners.set(type, []);
  __winListeners.get(type).push(fn);
};
function dispatchWin(type, ev = {}) {
  for (const fn of (__winListeners.get(type) || [])) fn(ev);
}
function dispatchDoc(type, ev = {}) {
  for (const fn of (__docListeners.get(type) || [])) fn(ev);
}

let __rafCb = null;
globalThis.requestAnimationFrame = cb => { __rafCb = cb; return 1; };

const __ctx2d = new Proxy({
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  save() {}, restore() {}, setLineDash() {}, clearRect() {}, fillRect() {}, strokeRect() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, fill() {}, stroke() {}, fillText() {}
}, { get: (o, k) => k in o ? o[k] : () => {} });

// Minimal WebGL2 context stub sufficient for Three.js WebGLRenderer initialization & scene.render()
function makeWebGL2Stub(canvas) {
  const gl = {
    VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C, VENDOR: 0x1F00, RENDERER: 0x1F01,
    MAX_TEXTURE_SIZE: 0x0D33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, MAX_RENDERBUFFER_SIZE: 0x84E8,
    MAX_VERTEX_ATTRIBS: 0x8869, MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_VARYING_VECTORS: 0x8DFC,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_SAMPLES: 0x8D57, MAX_COLOR_ATTACHMENTS: 0x8CDF,
    MAX_UNIFORM_BUFFER_BINDINGS: 0x8A2F,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    canvas,
    getExtension: name => {
      if (name === 'WEBGL_lose_context') return { loseContext() {} };
      if (name === 'EXT_color_buffer_float' || name === 'EXT_color_buffer_half_float') return {};
      return null;
    },
    getParameter: p => {
      if (p === 0x1F02) return 'WebGL 2.0 (Offline JSC Stub)';
      if (p === 0x8B8C) return 'WebGL GLSL ES 3.00';
      if (p === 0x1F01) return 'Offline JSC Verification Stub';
      if (p === 0x0D33 || p === 0x851C || p === 0x84E8) return 4096;
      if (p === 0x8869 || p === 0x8872 || p === 0x8B4C || p === 0x8CDF) return 16;
      if (p === 0x8B4D || p === 0x8A2F) return 32;
      if (p === 0x8DFB || p === 0x8DFD) return 1024;
      if (p === 0x8DFC) return 30;
      if (p === 0x8D57) return 4;
      return 1;
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    getContextAttributes: () => ({ alpha: false, antialias: true, depth: true, stencil: true }),
    isContextLost: () => false,
    createTexture: () => ({}), deleteTexture() {}, bindTexture() {}, texImage2D() {}, texSubImage2D() {}, texStorage2D() {}, texStorage3D() {},
    texParameteri() {}, texParameterf() {}, generateMipmap() {}, activeTexture() {}, pixelStorei() {},
    createFramebuffer: () => ({}), deleteFramebuffer() {}, bindFramebuffer() {}, framebufferTexture2D() {}, framebufferRenderbuffer() {},
    checkFramebufferStatus: () => 0x8CD5, drawBuffers() {}, readBuffer() {}, blitFramebuffer() {}, invalidateFramebuffer() {},
    createRenderbuffer: () => ({}), deleteRenderbuffer() {}, bindRenderbuffer() {}, renderbufferStorage() {}, renderbufferStorageMultisample() {},
    createBuffer: () => ({}), deleteBuffer() {}, bindBuffer() {}, bufferData() {}, bufferSubData() {}, bindBufferBase() {},
    createVertexArray: () => ({}), deleteVertexArray() {}, bindVertexArray() {},
    enableVertexAttribArray() {}, disableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribIPointer() {}, vertexAttribDivisor() {},
    createProgram: () => ({}), deleteProgram() {}, attachShader() {}, linkProgram() {}, useProgram() {},
    getProgramParameter: () => 0, getProgramInfoLog: () => '',
    createShader: () => ({}), deleteShader() {}, shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, getShaderInfoLog: () => '',
    getUniformLocation: () => ({}), getAttribLocation: () => 0, getUniformBlockIndex: () => 0, uniformBlockBinding() {},
    getActiveUniform: () => ({ name: 'u0', size: 1, type: 0x1406 }),
    getActiveAttrib: () => ({ name: 'a0', size: 1, type: 0x1406 }),
    uniform1i() {}, uniform1f() {}, uniform2f() {}, uniform3f() {}, uniform4f() {},
    uniform1iv() {}, uniform1fv() {}, uniform2fv() {}, uniform3fv() {}, uniform4fv() {},
    uniformMatrix3fv() {}, uniformMatrix4fv() {},
    viewport() {}, scissor() {}, clearColor() {}, clearDepth() {}, clearStencil() {}, clear() {},
    enable() {}, disable() {}, depthFunc() {}, depthMask() {}, colorMask() {}, cullFace() {}, frontFace() {},
    blendEquation() {}, blendFunc() {}, blendEquationSeparate() {}, blendFuncSeparate() {},
    polygonOffset() {}, lineWidth() {}, stencilFunc() {}, stencilOp() {}, stencilMask() {},
    drawArrays() {}, drawElements() {}, drawArraysInstanced() {}, drawElementsInstanced() {},
    getError: () => 0
  };
  Object.assign(gl, {
    POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6,
    BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406
  });
  return new Proxy(gl, { get: (o, k) => k in o ? o[k] : (typeof k === 'string' && k === k.toUpperCase() ? 0 : () => {}) });
}

const __elements = new Map();
function makeEl(id, tag = 'div') {
  const el = {
    id, tagName: tag.toUpperCase(),
    hidden: false, disabled: false, checked: true, value: '1', type: tag === 'input' ? 'range' : '',
    textContent: '', innerHTML: '', className: '',
    width: 1280, height: 720,
    style: { display: '', width: '', opacity: '1', boxShadow: '' },
    children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { this.children.push(c); return c; },
    append(c) { this.children.push(c); },
    replaceChildren(...cs) { this.children = cs; },
    focus() {},
    onclick: null,
    oninput: null,
    _listeners: new Map(),
    addEventListener(t, fn) {
      if (!this._listeners.has(t)) this._listeners.set(t, []);
      this._listeners.get(t).push(fn);
    },
    click() {
      if (typeof this.onclick === 'function') this.onclick();
      for (const fn of (this._listeners.get('click') || [])) fn({});
    },
    requestPointerLock() {
      if (globalThis.__denyPointerLock) return Promise.reject(new Error('NotAllowedError'));
      document.pointerLockElement = this;
      dispatchDoc('pointerlockchange', {});
      return Promise.resolve();
    },
    getContext(kind) {
      if (kind === '2d') return __ctx2d;
      return makeWebGL2Stub(this);
    }
  };
  el.firstElementChild = { style: { width: '0%' } };
  __elements.set(id, el);
  return el;
}

['game','vignette','hud','topHud','location','objective','dangerAlert','reticleWrap','crosshair',
 'promptWrap','prompt','promptSub','hold','holdFill','holdTicks','caption','recorderHud','recTitle',
 'moveBadge','tapeTrack','tapeFill','tapeBlips','recStatus','notice','menu','menuText','continue',
 'start','checkpoint','restart','saveStatus','settingsPanel','quality','volume','sensitivity',
 'brightness','captions','reduce','documentPanel','documentTitle','documentText','closeDocument','sizeWarning'
].forEach(id => {
  const el = makeEl(id, id === 'game' ? 'canvas' : 'div');
  if (['captions', 'reduce'].includes(id)) { el.type = 'checkbox'; el.checked = true; }
  if (['continue', 'checkpoint', 'restart', 'documentPanel', 'dangerAlert'].includes(id)) el.hidden = true;
});

globalThis.document = {
  hidden: false,
  pointerLockElement: null,
  hasFocus: () => true,
  exitPointerLock() { this.pointerLockElement = null; dispatchDoc('pointerlockchange', {}); },
  querySelectorAll: () => [],
  getElementById: id => __elements.get(id) || makeEl(id),
  createElement: tag => {
    if (tag === 'canvas') return { width: 256, height: 256, style: {}, addEventListener() {}, getContext: () => __ctx2d };
    return makeEl('dyn_' + Math.random(), tag);
  },
  addEventListener: (t, fn) => {
    if (!__docListeners.has(t)) __docListeners.set(t, []);
    __docListeners.get(t).push(fn);
  },
  body: { append() {}, appendChild() {} }
};
globalThis.window = globalThis;
"""

    driver_checks = r"""
(async () => {
  const $ = id => document.getElementById(id);
  let capsOn = false;

  function stepFrames(n, dtMs = 1000 / 60) {
    for (let i = 0; i < n; i++) {
      __now += dtMs;
      __rafCb(__now);
    }
  }
  function keyDown(code, repeat = false) {
    dispatchWin('keydown', {
      code, repeat,
      preventDefault() {},
      getModifierState: k => k === 'CapsLock' ? capsOn : false
    });
  }
  function keyUp(code) {
    dispatchWin('keyup', {
      code,
      preventDefault() {},
      getModifierState: k => k === 'CapsLock' ? capsOn : false
    });
  }
  function tapKey(code) { keyDown(code, false); stepFrames(1); keyUp(code); stepFrames(1); }

  async function flushResume() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    stepFrames(2);
  }

  function lookAtPoint(tx, ty, tz) {
    const d = window.__tideDiagnostics();
    const ex = d.position.x, ey = d.position.y + 1.63, ez = d.position.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const horiz = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.atan2(-dy, horiz);
    let dyaw = targetYaw - d.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const dpitch = targetPitch - d.pitch;
    dispatchWin('mousemove', {
      movementX: -dyaw / 0.002,
      movementY: dpitch / 0.002
    });
    stepFrames(1);
  }

  function walkTo(tx, tz, maxFrames = 1200) {
    let guard = 0;
    while (guard++ < maxFrames) {
      const d = window.__tideDiagnostics();
      if (d.failed) throw new Error('Died during walkTo(' + tx + ',' + tz + ') reason=' + d.deathReason);
      const dist = Math.hypot(tx - d.position.x, tz - d.position.z);
      if (dist < 0.14) break;
      lookAtPoint(tx, d.position.y + 1.63, tz);
      keyDown('KeyW');
      stepFrames(1);
    }
    keyUp('KeyW');
    stepFrames(1);
    const fin = window.__tideDiagnostics();
    assert(Math.hypot(tx - fin.position.x, tz - fin.position.z) < 0.25,
      `walkTo(${tx},${tz}) blocked at (${fin.position.x.toFixed(2)},${fin.position.z.toFixed(2)})`);
  }

  const exercisedTargets = new Set();

  // Boot & Start New Game (first verify no-pointer-lock Arrow-key fallback + strict mousemove gate!)
  stepFrames(3);
  assert.equal(window.__tideDiagnostics().paused, true, 'Should start paused on title');
  globalThis.__denyPointerLock = true;
  $('start').click();
  await flushResume();
  assert.equal(window.__tideDiagnostics().paused, false, 'Game unpauses even when pointer lock is denied');
  assert.equal(document.pointerLockElement, null, 'Pointer lock absent when denied');
  const yawBeforeUnlockedMove = window.__tideDiagnostics().yaw;
  dispatchWin('mousemove', { movementX: 250, movementY: -120 });
  stepFrames(1);
  assert.equal(window.__tideDiagnostics().yaw, yawBeforeUnlockedMove, 'Unlocked mousemove MUST be ignored!');
  keyDown('ArrowLeft'); stepFrames(6); keyUp('ArrowLeft');
  assert(window.__tideDiagnostics().yaw > yawBeforeUnlockedMove + 0.08, 'ArrowLeft fallback rotates yaw without pointer lock');
  // Now enable standard pointer lock via canvas click (just like ordinary player clicking canvas)
  globalThis.__denyPointerLock = false;
  $('game').click();
  await flushResume();
  assert.equal(document.pointerLockElement, $('game'), 'Canvas pointer lock acquired');

  // === SEGMENT 1: ENTRY ROOM (pickup prerequisite, note-entry hold-E, latch, gauge-upper, target competition, pickup) ===
  walkTo(3.05, 4.75);
  // 1a. Aim at pickup BEFORE opening window latch -> must show blocked reason & reject E!
  lookAtPoint(3.05, 4.12, 3.65);
  assert.equal(window.__tideDiagnostics().interact, 'pickup', 'Should aim at pickup on desk');
  assert.equal(window.__tideDiagnostics().interactState.enabled, false, 'Pickup must be disabled in phase 0');
  assert($('promptSub').textContent.includes('窗扣'), 'Blocked reason must mention window latch');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().phase, 0, 'Pressing E on blocked pickup must not advance phase');

  // 1b. Test note-entry + hold E repeat for > 1.0s (Review Fix A!)
  walkTo(-1.1, 4.85);
  lookAtPoint(-1.85, 4.28, 4.85);
  assert.equal(window.__tideDiagnostics().interact, 'note-entry');
  exercisedTargets.add('note-entry');
  keyDown('KeyE', false);
  stepFrames(2);
  assert.equal($('documentPanel').hidden, false, 'note-entry should open');
  for (let i = 0; i < 65; i++) { keyDown('KeyE', true); stepFrames(1); } // 1.08s of key repeat!
  assert.equal($('documentPanel').hidden, false, 'note-entry MUST stay open during held E repeat!');
  const noteTime = window.__tideDiagnostics().time;
  $('language').value = 'en'; $('language').onchange();
  assert.equal($('documentPanel').hidden, false, 'Language switch keeps the document open');
  assert.equal(window.__tideDiagnostics().paused, true, 'Reading stays paused while switching language');
  assert.equal(window.__tideDiagnostics().time, noteTime, 'Language switch does not advance game time');
  assert(!/[\u3400-\u9fff]/.test($('documentTitle').textContent), 'Document title translated');
  $('language').value = 'zh-CN'; $('language').onchange();
  assert($('documentTitle').textContent.includes('封站交接单'), 'Document source restored in Chinese');
  keyUp('KeyE');
  tapKey('KeyE'); // non-repeat E closes note & re-requests pointer lock via resume()
  await flushResume();
  assert.equal($('documentPanel').hidden, true, 'Non-repeat E closes document');
  assert.equal(window.__tideDiagnostics().paused, false, 'Resumed after closing note-entry');
  assert.equal(document.pointerLockElement, $('game'), 'Pointer lock re-acquired after closing note');

  // 1c. Target competition & rapid turning between latch, gauge-upper, and pickup
  walkTo(3.55, 4.75);
  lookAtPoint(4.66, 4.35, 4.65);
  assert.equal(window.__tideDiagnostics().interact, 'latch', 'Aiming at latch selects latch');
  exercisedTargets.add('latch');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().phase, 1, 'Latch opens window -> phase 1');

  lookAtPoint(4.55, 4.25, 6.35);
  assert.equal(window.__tideDiagnostics().interact, 'gauge-upper', 'Aiming at gauge-upper selects gauge-upper');
  exercisedTargets.add('gauge-upper');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().observations['gauge-upper'], true);

  // Rapid turn to pickup on desk -> must immediately select pickup & pick it up on E!
  lookAtPoint(3.05, 4.12, 3.65);
  assert.equal(window.__tideDiagnostics().interact, 'pickup', 'Aiming at pickup selects pickup without gauge-upper theft');
  assert.equal(window.__tideDiagnostics().interactState.enabled, true);
  exercisedTargets.add('pickup');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().phase, 2, 'Picked up recorder -> phase 2');

  // Language is a display preference, never a new-game/continue operation.
  const languageBefore = window.__tideDiagnostics();
  const saveBeforeLanguage = JSON.stringify([...__store].filter(([key]) => key !== 'tide-language'));
  $('language').value = 'en'; $('language').onchange();
  const languageAfter = window.__tideDiagnostics();
  assert.equal(languageAfter.language, 'en');
  assert.equal(languageAfter.phase, languageBefore.phase);
  assert.equal(languageAfter.time, languageBefore.time);
  assert.equal(languageAfter.paused, languageBefore.paused);
  assert.equal(JSON.stringify(languageAfter.position), JSON.stringify(languageBefore.position));
  assert.equal(JSON.stringify([...__store].filter(([key]) => key !== 'tide-language')), saveBeforeLanguage, 'Language switch preserves checkpoint and numeric settings');
  assert($('objective').textContent.includes('Tutorial'), 'Live objective translates immediately');
  assert(!/[\u3400-\u9fff]/.test($('notice').textContent), 'Current notice translates from preserved source');
  $('language').value = 'zh-CN'; $('language').onchange();
  assert($('notice').textContent.includes('便携录放机'), 'Current notice translates back from preserved source');

  // === MOVEMENT POSTURE CHECKS: CapsLock Quiet Walk + Shift Hold-to-Sprint + Override + Blur Cleanup ===
  walkTo(0, 3.5);
  capsOn = true;
  tapKey('CapsLock');
  assert.equal(window.__tideDiagnostics().quietWalk, true);
  assert($('moveBadge').textContent.includes('轻步慢走'));
  lookAtPoint(0, 4.63, -5);
  const z0 = window.__tideDiagnostics().position.z;
  keyDown('KeyW'); stepFrames(30); // 0.5s quiet walk (~0.6m)
  const dzQuiet = z0 - window.__tideDiagnostics().position.z;
  // Hold ShiftLeft while CapsLock is ON -> Sprint must override Quiet Walk!
  keyDown('ShiftLeft'); stepFrames(30); // 0.5s sprint (~1.72m)
  assert.equal(window.__tideDiagnostics().moveMode, 'sprint');
  assert($('moveBadge').textContent.includes('奔跑'));
  const dzSprint = (z0 - dzQuiet) - window.__tideDiagnostics().position.z;
  assert(dzSprint > dzQuiet * 2.2, `Sprint (${dzSprint}) must override CapsLock quiet walk (${dzQuiet})`);
  keyUp('ShiftLeft'); stepFrames(2);
  assert($('moveBadge').textContent.includes('轻步慢走'), 'Releasing Shift restores CapsLock quiet walk badge');
  keyUp('KeyW');
  capsOn = false;
  tapKey('CapsLock');
  assert.equal(window.__tideDiagnostics().quietWalk, false);

  // Blur + PointerLock loss checks
  keyDown('ShiftLeft');
  dispatchWin('blur', {});
  stepFrames(2);
  assert.equal(window.__tideDiagnostics().paused, true, 'Blur pauses game');
  $('start').click(); await flushResume();
  assert.equal($('moveBadge').textContent, '常步', 'Blur cleared held ShiftLeft');
  assert.equal(document.pointerLockElement, $('game'), 'Pointer lock re-acquired after blur resume');

  document.pointerLockElement = null;
  dispatchDoc('pointerlockchange', {});
  assert.equal(window.__tideDiagnostics().paused, true, 'Losing acquired pointer lock pauses game');
  $('start').click(); await flushResume();
  assert.equal(document.pointerLockElement, $('game'), 'Pointer lock re-acquired after pointerlock loss resume');

  // Exercise the bridge, every pump/control-room action and the ending in English.
  $('language').value = 'en'; $('language').onchange();
  assert.equal(window.__tideDiagnostics().language, 'en');

  // === SEGMENT 2: BRIDGE TUTORIAL, NOTE-BRIDGE, GATE BLOCKED, TRIMMED CAPTURE, 2.60m RETRIEVAL ===
  walkTo(-1.0, -10.8);
  lookAtPoint(-2.84, 4.45, -10.8);
  assert.equal(window.__tideDiagnostics().interact, 'note-bridge');
  exercisedTargets.add('note-bridge');
  keyDown('KeyE', false); stepFrames(2);
  for (let i = 0; i < 65; i++) { keyDown('KeyE', true); stepFrames(1); }
  assert.equal($('documentPanel').hidden, false, 'note-bridge stays open under key repeat');
  keyUp('KeyE'); tapKey('Escape'); await flushResume();

  walkTo(0, -13.8);
  lookAtPoint(0, 3.85, -15.65);
  assert.equal(window.__tideDiagnostics().interact, 'gate');
  assert.equal(window.__tideDiagnostics().interactState.enabled, false);
  exercisedTargets.add('gate');
  tapKey('KeyE'); // blocked feedback

  walkTo(0, -6.2);
  lookAtPoint(0, 4.02, -7.0);
  assert.equal(window.__tideDiagnostics().interact, 'bell');
  exercisedTargets.add('bell');
  tapKey('KeyE'); // knock bell
  tapKey('KeyR'); // capture trimmed 6s clip
  assert(window.__tideDiagnostics().placementPreview !== null, 'Placement preview active when clip ready');

  walkTo(0, -12.0);
  lookAtPoint(0, 3.0, -14.0);
  tapKey('KeyQ'); // place device (~ z = -12.72)
  const devPos = window.__tideDiagnostics().device.pos;
  assert(devPos, 'Device placed on bridge');

  // Step back > 3.0m and verify countdown + immediate trimmed replay unlocks phase 3 in < 4.5s!
  walkTo(0, devPos.z + 3.6);
  stepFrames(Math.ceil(4.4 * 60));
  assert.equal(window.__tideDiagnostics().phase, 3, 'Phase 2 completed immediately after 4s countdown');

  // Test P0 ~2.60m horizontal retrieval distance!
  walkTo(devPos.x, devPos.z + 2.48);
  const actualHoriz = Math.hypot(window.__tideDiagnostics().position.x - devPos.x, window.__tideDiagnostics().position.z - devPos.z);
  assert(actualHoriz > 2.45 && actualHoriz <= 2.70, 'Positioned around ~2.60m: ' + actualHoriz);
  lookAtPoint(devPos.x, devPos.y + 0.16, devPos.z);
  assert.equal(window.__tideDiagnostics().interact, 'device', 'Device selectable at ~2.60m');
  exercisedTargets.add('device');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().device, null, 'Device successfully retrieved at ~2.60m!');

  // === SEGMENT 3: PUMP HALL (pump-listen, note-pump, gauge-lower, pipe, inlet, valve, power, south doorway, storage-denial recovery) ===
  walkTo(1.8, -17.8);
  lookAtPoint(2.05, 3.60, -18.50);
  assert.equal(window.__tideDiagnostics().interact, 'pump-listen');
  exercisedTargets.add('pump-listen');
  tapKey('KeyE');
  // Observe threat arrive at east pump from upper dry overlook
  stepFrames(260);
  assert.equal(window.__tideDiagnostics().observations.pumpConfirmed, true, 'Observed east pump sound rule confirmed');

  walkTo(-6.5, -17.5);
  walkTo(-9.0, -17.5);
  walkTo(-9.0, -26.5);
  lookAtPoint(-9.84, 4.28, -26.5);
  assert.equal(window.__tideDiagnostics().interact, 'note-pump');
  exercisedTargets.add('note-pump');
  keyDown('KeyE', false); stepFrames(2);
  for (let i = 0; i < 65; i++) { keyDown('KeyE', true); stepFrames(1); }
  assert.equal($('documentPanel').hidden, false, 'note-pump stays open under key repeat');
  keyUp('KeyE'); tapKey('KeyE'); await flushResume();

  // Descend dry stairs into Pump Hall bottom landing
  walkTo(-9.0, -17.5);
  walkTo(-6.5, -17.5);
  walkTo(-6.5, -29.4);

  // 1) West pipe: operate from lower west aisle x=-3.6 via (-3.6,-29.4), then return via (-3.6,-29.4)
  walkTo(-3.6, -29.4);
  walkTo(-3.6, -20.8);
  assert.equal(window.__tideDiagnostics().position.y, 0, 'Must stand on lower floor y=0 next to west pipe');
  lookAtPoint(-5.45, 1.1, -20.8);
  assert.equal(window.__tideDiagnostics().interact, 'pipe');
  exercisedTargets.add('pipe');
  tapKey('KeyE');
  tapKey('KeyR');
  walkTo(-3.6, -29.4);
  walkTo(-6.5, -30.5);
  tapKey('KeyQ'); // lure placed at (-6.5, -30.5)

  // Test valve blocked before inlet (approach via (-3.6,-29.4) -> (4.8,-29.8))
  walkTo(-3.6, -29.4);
  walkTo(4.8, -29.8);
  lookAtPoint(6.0, 1.2, -29.92);
  assert.equal(window.__tideDiagnostics().interact, 'valve');
  assert.equal(window.__tideDiagnostics().interactState.enabled, false, 'Valve blocked before inlet');
  tapKey('KeyE');

  // 2) Route around P-02 via (4.8,-26.2) -> (4.8,-22.0) -> (6.2,-20.8) for gauge-lower
  walkTo(4.8, -26.2);
  walkTo(4.8, -22.0);
  walkTo(6.2, -20.8);
  lookAtPoint(7.0, 1.22, -20.0);
  assert.equal(window.__tideDiagnostics().interact, 'gauge-lower');
  exercisedTargets.add('gauge-lower');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().observations['gauge-lower'], true);

  // 3) Low gauge -> inlet via (5.2,-22.2) -> (5.2,-21.6) -> (-3.6,-21.6), avoiding sump pit & P-01!
  walkTo(5.2, -22.2);
  walkTo(5.2, -21.6);
  walkTo(-3.6, -21.6);
  lookAtPoint(-4.5, 1.2, -21.92);
  assert.equal(window.__tideDiagnostics().interact, 'inlet');
  exercisedTargets.add('inlet');
  keyDown('KeyE'); stepFrames(130); keyUp('KeyE'); stepFrames(5); // ~2.16s -> locks notch 1!
  const partialInlet = window.__tideDiagnostics().inletProgress;
  assert(partialInlet > 1.9 && !window.__tideDiagnostics().inlet, 'Inlet partial detent retained');
  // Turn storage denial ON before finishing inlet to prove in-memory savedRun works!
  __storageThrow = true;
  keyDown('KeyE'); stepFrames(220); keyUp('KeyE'); stepFrames(2);
  assert.equal(window.__tideDiagnostics().inlet, true, 'Inlet closed!');

  // Retrieve lure on west side via (-3.6, -29.4), place lure on west side to draw threat west while closing East Valve!
  walkTo(-3.6, -29.4);
  if (window.__tideDiagnostics().device) {
    const dp = window.__tideDiagnostics().device.pos;
    walkTo(dp.x, dp.z + 1.3);
    lookAtPoint(dp.x, dp.y + 0.16, dp.z);
    tapKey('KeyE');
  }
  walkTo(-6.2, -29.5);
  tapKey('KeyQ'); // lure on west!

  walkTo(-3.6, -29.4);
  walkTo(4.8, -29.8);
  lookAtPoint(6.0, 1.2, -29.92);
  assert.equal(window.__tideDiagnostics().interact, 'valve');
  assert.equal(window.__tideDiagnostics().interactState.enabled, true);
  exercisedTargets.add('valve');
  keyDown('KeyE'); stepFrames(160); keyUp('KeyE'); stepFrames(4); // partial detent
  assert(window.__tideDiagnostics().valveProgress > 2.4 && !window.__tideDiagnostics().valve);
  keyDown('KeyE'); stepFrames(280); keyUp('KeyE'); stepFrames(2);
  assert.equal(window.__tideDiagnostics().valve, true, 'East relief valve closed!');

  // Retrieve west lure via (-3.6, -29.4), place lure on east side (4.2, -29.5), then check south-door & close West Power Switch!
  walkTo(-3.6, -29.4);
  if (window.__tideDiagnostics().device) {
    const dp = window.__tideDiagnostics().device.pos;
    walkTo(dp.x, dp.z + 1.3);
    lookAtPoint(dp.x, dp.y + 0.16, dp.z);
    tapKey('KeyE');
  }
  walkTo(4.2, -29.5);
  tapKey('KeyQ');

  // Verify closed south-door shutter BEFORE power: visible, blocks sight into control room, gives clear blocked feedback!
  walkTo(0, -34.2);
  lookAtPoint(0, 1.48, -35.85);
  assert.equal(window.__tideDiagnostics().interact, 'south-door', 'Closed south bulkhead shutter is targetable before power');
  assert.equal(window.__tideDiagnostics().interactState.enabled, false);
  exercisedTargets.add('south-door');
  tapKey('KeyE');

  walkTo(-4.8, -34.2);
  walkTo(-4.8, -32.2);
  lookAtPoint(-6.0, 1.18, -32.92);
  assert.equal(window.__tideDiagnostics().interact, 'power');
  exercisedTargets.add('power');
  // Hold 2.2s (>= 2.0s half detent), release, then finish!
  keyDown('KeyE'); stepFrames(135); keyUp('KeyE'); stepFrames(3);
  assert.equal(window.__tideDiagnostics().powerProgress, 2.0, 'Power half-detent locked at 2.0s');
  keyDown('KeyE'); stepFrames(130); keyUp('KeyE'); stepFrames(2);
  assert.equal(window.__tideDiagnostics().power, true, 'Control room power restored!');
  assert.equal(window.__tideDiagnostics().phase, 4);

  // 5) Intentional Self-Bait Death + #dangerAlert vs #prompt Separation + Storage-Denial Checkpoint Recovery!
  // Power automatically returned the recorder with the loud knock tape; walk to safe open floor (-3.6, -28.0) -> (0.8, -28.0),
  // press Q to drop the bait, aim directly at the placed device, and stay beside it until the threat arrives!
  walkTo(-4.8, -29.7);
  walkTo(0.8, -28.0);
  tapKey('KeyQ');
  const selfBaitPos = window.__tideDiagnostics().device.pos;
  assert(selfBaitPos, 'Self-bait device placed in open central floor');
  lookAtPoint(selfBaitPos.x, selfBaitPos.y + 0.16, selfBaitPos.z);
  let verifiedDangerAndPromptSeparate = false;
  for (let k = 0; k < 950 && !window.__tideDiagnostics().failed; k++) {
    stepFrames(1);
    const dNow = window.__tideDiagnostics();
    if (dNow.danger > 0.15 && !verifiedDangerAndPromptSeparate) {
      assert.equal($('dangerAlert').hidden, false, '#dangerAlert must show when danger > 0');
      assert.equal(dNow.interact, 'device', 'Device remains live target while danger banner is active');
      assert($('prompt').textContent.toLowerCase().includes('recorder'), '#prompt keeps the English live [E] target instead of being overwritten by danger!');
      verifiedDangerAndPromptSeparate = true;
    }
  }
  assert(verifiedDangerAndPromptSeparate, 'Verified #dangerAlert and #prompt separation under active danger');
  assert.equal(window.__tideDiagnostics().failed, true, 'Intentional self-bait death triggered');
  assert.equal(window.__tideDiagnostics().deathReason, 'self-bait', 'Death reason accurately classified as self-bait');
  assert($('menuText').innerHTML.includes('4-second countdown'), 'Actionable English self-bait death guidance displayed');
  assert(!/[\u3400-\u9fff]/.test($('menuText').innerHTML), 'Failure guidance is fully translated');
  $('checkpoint').click(); await flushResume();
  __storageThrow = false;
  assert.equal(window.__tideDiagnostics().failed, false, 'Recovered via in-memory savedRun despite storage denial!');
  assert.equal(document.pointerLockElement, $('game'), 'Pointer lock re-acquired after checkpoint resume');
  assert.equal(window.__tideDiagnostics().power, true, 'Power milestone preserved in memory checkpoint');
  assert.equal(window.__tideDiagnostics().position.z, -37.5, 'Restored safely at control room entry');

  // Verify South Bulkhead Doorway Wall/Jamb Collision Alignment (Review Fix #6)
  walkTo(0, -35.0);
  // Try walking east into steel jamb/wall at z = -36.0, x = 3.4 -> must NOT reach z < -35.6!
  walkTo(3.4, -35.0);
  lookAtPoint(3.4, 1.63, -37.5);
  keyDown('KeyW'); stepFrames(60); keyUp('KeyW');
  assert(window.__tideDiagnostics().position.z > -35.6, 'South bulkhead wall/jamb at x=3.4 blocks walking through wall!');
  // Now walk cleanly through the 5m doorway aperture at x = 1.6
  walkTo(1.6, -35.0);
  walkTo(1.6, -38.2);
  assert(window.__tideDiagnostics().position.z < -38.0, 'South doorway aperture passes cleanly');

  // === SEGMENT 4: CONTROL ROOM (terminal-pipe, machine start / busy / blocked-by-threat / lure / paper collection, exit, replay reset) ===
  walkTo(3.1, -40.8);
  lookAtPoint(4.10, 1.2, -40.8);
  assert.equal(window.__tideDiagnostics().interact, 'terminal-pipe');
  exercisedTargets.add('terminal-pipe');
  tapKey('KeyE');
  tapKey('KeyR');

  // Start Tide Chart Recorder (stand cleanly north of machine collider at [0, -43.3])
  walkTo(0, -43.3);
  lookAtPoint(0, 1.32, -44.55);
  assert.equal(window.__tideDiagnostics().interact, 'machine');
  exercisedTargets.add('machine');
  tapKey('KeyE'); // start motor -> phase 5
  assert.equal(window.__tideDiagnostics().phase, 5);

  // Check in-progress busy state (< 24s)
  stepFrames(60);
  lookAtPoint(0, 1.32, -44.55);
  assert.equal(window.__tideDiagnostics().interactState.busy, true, 'Machine reports busy while motorProgress < 24');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().paper, false);

  // Wait safely in NE corner while motor finishes 24s (threat gets drawn to motor at (0, -45)!)
  walkTo(4.2, -38.5);
  stepFrames(Math.ceil(24 * 60));
  assert(window.__tideDiagnostics().motorProgress >= 24, 'Motor finished 24s chart run');

  // Verify blocked-paper state while threat is right under machine (0, -45)!
  walkTo(0, -43.3);
  lookAtPoint(0, 1.32, -44.55);
  if (Math.hypot(window.__tideDiagnostics().threat.x, window.__tideDiagnostics().threat.z - (-45)) < 3.8) {
    assert.equal(window.__tideDiagnostics().interactState.enabled, false, 'Taking paper blocked while threat is at machine');
    tapKey('KeyE');
    assert.equal(window.__tideDiagnostics().paper, false);
  }

  // Place lure at far NE corner (3.8, -38.5) to pull threat away from machine!
  walkTo(3.8, -38.5);
  tapKey('KeyQ');
  walkTo(-3.5, -40.0);
  stepFrames(Math.ceil(7.5 * 60)); // 4s countdown + 3.5s pursuit away from machine

  // Now approach machine & collect paper!
  walkTo(0, -43.3);
  lookAtPoint(0, 1.32, -44.55);
  assert.equal(window.__tideDiagnostics().interact, 'machine');
  assert.equal(window.__tideDiagnostics().interactState.enabled, true, 'Paper collectible once threat lured away');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().paper, true, 'Collected final tide chart paper roll!');
  assert.equal(window.__tideDiagnostics().phase, 6);

  // 4) Final return via (0,-29.7) -> (-6.5,-29.7) -> stairs to avoid P-03 at (-2,-32)!
  walkTo(0, -38.0);
  walkTo(0, -29.7);
  walkTo(-6.5, -29.7);
  walkTo(-6.5, -17.5);
  walkTo(0, -17.5);
  walkTo(0, 4.65);
  walkTo(3.55, 4.65);
  lookAtPoint(4.66, 4.35, 4.65);
  assert.equal(window.__tideDiagnostics().interact, 'exit');
  exercisedTargets.add('exit');
  tapKey('KeyE');
  assert.equal(window.__tideDiagnostics().ended, true, 'Ending triggered at observation window!');
  stepFrames(Math.ceil(5.2 * 60));
  assert.equal($('menu').classList.contains('hidden'), false, 'Ending screen shown after 4.8s ocean pullback');

  // Click Restart & verify clean mechanical reset!
  $('restart').click(); await flushResume();
  const resetDiag = window.__tideDiagnostics();
  assert.equal(resetDiag.phase, 0);
  assert.equal(resetDiag.paper, false);
  assert.equal(resetDiag.inlet, false);
  assert.equal(resetDiag.valve, false);
  assert.equal(resetDiag.power, false);

  const expectedTargets = [
    'latch','pickup','note-entry','gauge-upper','bell','note-bridge','gate','south-door','device',
    'pump-listen','note-pump','gauge-lower','pipe','inlet','valve','power','terminal-pipe','machine','exit'
  ];
  for (const t of expectedTargets) {
    assert(exercisedTargets.has(t), 'Missing target coverage: ' + t);
  }
  console.log('ALL 19/19 INTERACTABLES + FULL EVENT-DRIVEN BUNDLE ROUTE + RESTART RESET VERIFIED:', [...exercisedTargets].join(', '));
})().catch(e => { print('E2E_ERR:', e, e?.stack); quit(1); });
"""

    full_script = dom_and_webgl_harness + "\n" + bundle_code + "\n" + driver_checks
    run_jsc(full_script, "dist-bundle-19-targets-full-event-route")

def verify_error_marker_guard():
    # Synthetic test: child prints ASYNC_ERR: and exits 0; harness MUST raise SystemExit with non-zero code!
    caught_code = None
    try:
        run_jsc('print("ASYNC_ERR: synthetic zero-exit failure");', 'synthetic-guard-probe')
    except SystemExit as exc:
        caught_code = exc.code
    assert caught_code is not None and caught_code != 0, f"Guard failed to return non-zero exit code: {caught_code}"
    print(f"=== PASS [harness-zero-exit-error-guard] (caught non-zero code={caught_code}) ===")

if __name__ == "__main__":
    verify_error_marker_guard()
    run_legacy_suites()
    run_bundle_e2e_suite()
    print("\nALL OFFLINE SUITES PASSED.")
