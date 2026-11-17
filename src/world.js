import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { t, getLanguage } from './i18n.js';

// Original procedural coastal hydrographic station (07号潮汐观测站).
// Room-scoped geometry batching, cached demand-sized label textures, 6 dynamically culled PointLights,
// separated interior/exterior water shaders, and full mechanical pose reset.
export function createWorld(scene) {
  let seed = 1771;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const root = new THREE.Group();
  scene.add(root);

  const colliders = [];
  const interactables = [];
  const roomBatches = new Map(); // key: `${roomId}::${mat.uuid}` -> { room, material, list }
  let activeRoom = 'entry';

  const color = x => new THREE.Color(x);

  function nextPow2(v) {
    let p = 64;
    while (p < v && p < 1024) p <<= 1;
    return p;
  }

  function canvasTex(draw, w = 512, h = w, srgb = true) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // Distinct architectural textures (board-formed concrete, jointed floor tiles, enamel steel, timber, hazard)
  const texConcrete = canvasTex((c, n) => {
    c.fillStyle = '#687169';
    c.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 64) {
      c.fillStyle = y % 128 === 0 ? 'rgba(255,252,240,0.03)' : 'rgba(18,26,24,0.04)';
      c.fillRect(0, y, n, 62);
      c.fillStyle = 'rgba(20,28,25,0.22)';
      c.fillRect(0, y, n, 2);
    }
    for (let j = 0; j < 70; j++) {
      const x = rnd() * n, y = rnd() * n, r = 18 + rnd() * 85;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rnd() > 0.45 ? 'rgba(28,38,34,0.09)' : 'rgba(195,202,188,0.05)');
      g.addColorStop(1, 'rgba(28,38,34,0)');
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 4000; i++) {
      const a = 0.02 + rnd() * 0.03;
      c.fillStyle = rnd() > 0.5 ? `rgba(240,242,232,${a})` : `rgba(14,22,21,${a})`;
      c.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2.2, 1 + rnd() * 2.2);
    }
  }, 512);
  texConcrete.wrapS = texConcrete.wrapT = THREE.RepeatWrapping;

  const texFloorTile = canvasTex((c, n) => {
    c.fillStyle = '#48514d';
    c.fillRect(0, 0, n, n);
    const step = n / 4;
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        const shade = (rnd() - 0.5) * 10;
        c.fillStyle = `rgb(${70 + shade},${79 + shade},${75 + shade})`;
        c.fillRect(gx * step + 2, gy * step + 2, step - 4, step - 4);
      }
    }
    c.strokeStyle = 'rgba(18,24,22,0.45)';
    c.lineWidth = 3;
    for (let i = 0; i <= n; i += step) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, n); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(n, i); c.stroke();
    }
    for (let i = 0; i < 55; i++) {
      c.fillStyle = `rgba(24,33,30,${0.04 + rnd() * 0.08})`;
      const x = rnd() * n, y = rnd() * n, r = 8 + rnd() * 34;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  }, 512);
  texFloorTile.wrapS = texFloorTile.wrapT = THREE.RepeatWrapping;

  const texEnamel = canvasTex((c, n) => {
    c.fillStyle = '#4f6c62';
    c.fillRect(0, 0, n, n);
    for (let i = 0; i < 45; i++) {
      const x = rnd() * n, y = rnd() * n, w = 6 + rnd() * 34, h = 2 + rnd() * 14;
      c.fillStyle = rnd() > 0.35 ? 'rgba(30,44,39,0.09)' : 'rgba(130,82,52,0.12)';
      c.fillRect(x, y, w, h);
    }
    c.strokeStyle = 'rgba(210,224,214,0.08)';
    c.lineWidth = 2;
    c.strokeRect(3, 3, n - 6, n - 6);
  }, 256);
  texEnamel.wrapS = texEnamel.wrapT = THREE.RepeatWrapping;

  const texWood = canvasTex((c, n) => {
    c.fillStyle = '#6c543b';
    c.fillRect(0, 0, n, n);
    for (let i = 0; i < 380; i++) {
      c.strokeStyle = rnd() > 0.5 ? 'rgba(24,16,10,0.11)' : 'rgba(214,185,140,0.07)';
      c.lineWidth = 0.6 + rnd() * 2.0;
      c.beginPath();
      const y = rnd() * n;
      c.moveTo(0, y);
      for (let x = 0; x <= n; x += 24) c.lineTo(x, y + Math.sin(x * 0.015 + y) * 1.8);
      c.stroke();
    }
  }, 256);

  const texHazard = canvasTex((c, n) => {
    c.fillStyle = '#c8a243';
    c.fillRect(0, 0, n, n);
    c.fillStyle = '#1d2421';
    for (let i = -n; i < n * 2; i += 64) {
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i + 32, 0); c.lineTo(i - 32, n); c.lineTo(i - 64, n);
      c.closePath();
      c.fill();
    }
  }, 256);
  texHazard.wrapS = texHazard.wrapT = THREE.RepeatWrapping;

  const texDialFace = canvasTex((c, n) => {
    c.fillStyle = '#202b27';
    c.fillRect(0, 0, n, n);
    c.fillStyle = '#dbd3b8';
    c.beginPath(); c.arc(n / 2, n / 2, n * 0.45, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#24352f';
    c.lineWidth = 4;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      c.beginPath();
      c.moveTo(n / 2 + Math.cos(a) * n * 0.31, n / 2 + Math.sin(a) * n * 0.31);
      c.lineTo(n / 2 + Math.cos(a) * n * 0.41, n / 2 + Math.sin(a) * n * 0.41);
      c.stroke();
    }
    c.strokeStyle = '#9e3828';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(n / 2, n / 2, n * 0.37, Math.PI * 1.85, Math.PI * 2.25);
    c.stroke();
  }, 128);

  const mat = {
    concrete: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.91, color: 0x9aa498, bumpMap: texConcrete, bumpScale: 0.014 }),
    plinth: new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.86, color: 0x454f4a, bumpMap: texConcrete, bumpScale: 0.012 }),
    floor: new THREE.MeshStandardMaterial({ map: texFloorTile, roughness: 0.72, metalness: 0.08, color: 0x7c8580, bumpMap: texFloorTile, bumpScale: 0.008 }),
    wetFloor: new THREE.MeshStandardMaterial({ map: texFloorTile, roughness: 0.28, metalness: 0.16, color: 0x45524e, bumpMap: texFloorTile, bumpScale: 0.006 }),
    paint: new THREE.MeshStandardMaterial({ map: texEnamel, color: 0x8ea398, roughness: 0.50, metalness: 0.30 }),
    cabinet: new THREE.MeshStandardMaterial({ map: texEnamel, color: 0x62776e, roughness: 0.46, metalness: 0.38 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22312f, roughness: 0.58, metalness: 0.62 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x48453e, roughness: 0.56, metalness: 0.76 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xb8beb2, roughness: 0.26, metalness: 0.88 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc59f52, roughness: 0.32, metalness: 0.82 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x8a482e, roughness: 0.82, metalness: 0.28 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xc9a347, roughness: 0.52, metalness: 0.28 }),
    hazard: new THREE.MeshStandardMaterial({ map: texHazard, roughness: 0.58, metalness: 0.2 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xd0c6a4, roughness: 0.92 }),
    dial: new THREE.MeshStandardMaterial({ map: texDialFace, roughness: 0.48 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141d1b, roughness: 0.68, metalness: 0.25 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x9b8970, map: texWood, roughness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1e2220, roughness: 0.94 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x232d2f, roughness: 0.96, flatShading: true }),
    bulbWarm: new THREE.MeshStandardMaterial({ color: 0xffe2b8, emissive: 0xffb969, emissiveIntensity: 2.5 }),
    bulbCold: new THREE.MeshStandardMaterial({ color: 0xd8eef2, emissive: 0x8ec4cf, emissiveIntensity: 2.2 })
  };

  function queueStatic(geom, m, matrix) {
    const key = `${activeRoom}::${m.uuid}`;
    let entry = roomBatches.get(key);
    if (!entry) {
      entry = { room: activeRoom, material: m, list: [] };
      roomBatches.set(key, entry);
    }
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.applyMatrix4(matrix);
    entry.list.push(g);
  }

  function mesh(geom, m, pos, parent = root, stat = true, rot = null) {
    if (stat && parent === root && !m.transparent) {
      const dummy = new THREE.Object3D();
      dummy.position.set(...pos);
      if (rot) dummy.rotation.set(...rot);
      dummy.updateMatrix();
      queueStatic(geom, m, dummy.matrix);
      return dummy;
    }
    const o = new THREE.Mesh(geom, m);
    o.position.set(...pos);
    if (rot) o.rotation.set(...rot);
    o.castShadow = !m.transparent;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }

  function applyMetreUV(g, pos, scale = 0.5) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      let u, v;
      if (ax > 0.5) { u = p.getZ(i) + pos[2]; v = p.getY(i) + pos[1]; }
      else if (ay > 0.5) { u = p.getX(i) + pos[0]; v = p.getZ(i) + pos[2]; }
      else { u = p.getX(i) + pos[0]; v = p.getY(i) + pos[1]; }
      uv.setXY(i, u * scale, v * scale);
    }
  }

  function box(w, h, d, pos, m = mat.concrete, parent = root, stat = true, rot = null) {
    const g = new THREE.BoxGeometry(w, h, d);
    if ([mat.concrete, mat.plinth, mat.floor, mat.wetFloor, mat.paint, mat.cabinet].includes(m)) {
      const sc = (m === mat.floor || m === mat.wetFloor) ? 0.5 : (m === mat.paint || m === mat.cabinet) ? 0.9 : 0.45;
      applyMetreUV(g, pos, sc);
    }
    return mesh(g, m, pos, parent, stat, rot);
  }

  function cyl(r, h, pos, m = mat.iron, parent = root, segments = 20, stat = true, rot = null, rTop = null) {
    if (typeof segments === 'boolean') {
      stat = segments;
      segments = 16;
    }
    const seg = Math.max(6, Number(segments) || 16);
    const topR = rTop === null ? r : rTop;
    return mesh(new THREE.CylinderGeometry(topR, r, h, seg), m, pos, parent, stat, rot);
  }

  function rounded(w, h, d, r, pos, m = mat.paint, parent = root, stat = true) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 4 });
    g.translate(0, 0, -d / 2);
    return mesh(g, m, pos, parent, stat);
  }

  function pipe(a, b, r = 0.055, m = mat.iron, parent = root, stat = true, segments = 16) {
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
    const v = bv.clone().sub(av);
    const len = v.length();
    if (len < 0.001) return null;
    const mid = av.clone().add(bv).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    const g = new THREE.CylinderGeometry(r, r, len, segments);
    if (stat && parent === root && !m.transparent) {
      const dummy = new THREE.Object3D();
      dummy.position.copy(mid);
      dummy.quaternion.copy(quat);
      dummy.updateMatrix();
      queueStatic(g, m, dummy.matrix);
      return dummy;
    }
    const o = new THREE.Mesh(g, m);
    o.position.copy(mid);
    o.quaternion.copy(quat);
    o.castShadow = !m.transparent;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }

  function flangePipe(a, b, r = 0.08, m = mat.rust, flangeStep = 2.8) {
    pipe(a, b, r, m);
    const av = new THREE.Vector3(...a), bv = new THREE.Vector3(...b);
    const dir = bv.clone().sub(av);
    const len = dir.length();
    const u = dir.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    for (let d = 0.35; d < len - 0.25; d += flangeStep) {
      const p = av.clone().addScaledVector(u, d);
      const fg = new THREE.CylinderGeometry(r * 1.48, r * 1.48, 0.055, 14);
      const dummy = new THREE.Object3D();
      dummy.position.copy(p);
      dummy.quaternion.copy(quat);
      dummy.updateMatrix();
      queueStatic(fg, mat.iron, dummy.matrix);
    }
  }

  function solid(w, h, d, pos, blocksSight = false) {
    colliders.push({
      blocksSight,
      minX: pos[0] - w / 2, maxX: pos[0] + w / 2,
      minY: pos[1] - h / 2, maxY: pos[1] + h / 2,
      minZ: pos[2] - d / 2, maxZ: pos[2] + d / 2
    });
  }

  function wall(w, h, d, pos, m = mat.concrete, collision = true) {
    box(w, h, d, pos, m);
    if (collision) solid(w, h, d, pos, true);
  }

  function slab(w, h, d, pos, m = mat.floor, blocksSight = true) {
    box(w, h, d, pos, m);
    if (blocksSight) {
      colliders.push({
        blocksSight: true,
        minX: pos[0] - w / 2, maxX: pos[0] + w / 2,
        minY: pos[1] - h / 2, maxY: pos[1] + h / 2,
        minZ: pos[2] - d / 2, maxZ: pos[2] + d / 2
      });
    }
  }

  // Keep each canvas/material stable: static batches retain these material references.
  // Switching language repaints the shared atlas entries instead of rebuilding the station.
  const labelMatCache = new Map();
  const labelDrawings = [];
  let labelLanguage = getLanguage();

  function drawLabel(c, W, H, source, bg, fg) {
    const lines = t(source, labelLanguage).split('\n');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = fg;
    const border = Math.max(2, Math.round(Math.min(W, H) * 0.025));
    c.lineWidth = border;
    c.strokeRect(border * 2, border * 2, W - border * 4, H - border * 4);
    c.fillStyle = fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const pad = border * 6;
    const family = 'Arial, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif';
    c.font = `600 100px ${family}`;
    // Browser font metrics keep longer English labels legible without clipping.
    // A deterministic fallback also supports the offline geometry-test canvas stub.
    const widthAt100 = line => {
      const measured = c.measureText?.(line)?.width;
      return Number.isFinite(measured) && measured > 0
        ? measured
        : [...line].reduce((n, char) => n + (/[^\u0000-\u00ff]/.test(char) ? 100 : 58), 0);
    };
    const widest = Math.max(1, ...lines.map(widthAt100));
    const font = Math.max(7, Math.min((H - pad) / (lines.length * 1.36), (W - pad) * 100 / widest));
    c.font = `600 ${font}px ${family}`;
    lines.forEach((line, i) => c.fillText(line, W / 2, H / 2 + (i - (lines.length - 1) / 2) * font * 1.36, W - pad));
  }

  function setLanguage() {
    const language = getLanguage();
    if (language === labelLanguage) return;
    labelLanguage = language;
    for (const { text, texture, bg, fg } of labelDrawings) {
      const c = texture.image;
      drawLabel(c.getContext('2d'), c.width, c.height, text, bg, fg);
      texture.needsUpdate = true;
    }
  }

  function label(text, w, h, pos, rot = 0, bg = '#cfc7a8', fg = '#243a32', parent = root, stat = true) {
    const cw = nextPow2(Math.min(512, Math.max(64, Math.round(w * 280))));
    const ch = nextPow2(Math.min(512, Math.max(64, Math.round(cw * (h / Math.max(0.05, w))))));
    const cacheKey = `${text}|${cw}x${ch}|${bg}|${fg}`;
    let m = labelMatCache.get(cacheKey);
    if (!m) {
      const tex = canvasTex((c, W, H) => drawLabel(c, W, H, text, bg, fg), cw, ch);
      labelDrawings.push({ text, texture: tex, bg, fg });
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.76 });
      labelMatCache.set(cacheKey, m);
    }
    return mesh(new THREE.PlaneGeometry(w, h), m, pos, parent, stat, [0, rot, 0]);
  }

  function dialGauge(pos, rotY = 0, r = 0.11, needleAngle = 0.6, parent = root, dynamicNeedle = false) {
    if (!dynamicNeedle && parent === root) {
      cyl(r, 0.045, pos, mat.brass, root, 16, true, [Math.PI / 2, rotY, 0]);
      const off = new THREE.Vector3(0, 0, 0.024).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      mesh(new THREE.PlaneGeometry(r * 1.5, r * 1.5), mat.dial, [pos[0] + off.x, pos[1] + off.y, pos[2] + off.z], root, true, [0, rotY, 0]);
      return null;
    }
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.y = rotY;
    parent.add(g);
    cyl(r, 0.045, [0, 0, 0], mat.brass, g, 16, false, [Math.PI / 2, 0, 0]);
    mesh(new THREE.PlaneGeometry(r * 1.5, r * 1.5), mat.dial, [0, 0, 0.024], g, false);
    const needle = new THREE.Group();
    needle.position.set(0, 0, 0.03);
    needle.rotation.z = needleAngle;
    box(0.012, r * 0.72, 0.008, [0, r * 0.24, 0], mat.rust, needle, false);
    g.add(needle);
    return { group: g, needle };
  }

  function fixtureVisual(pos, warm = true, drop = 0.36) {
    pipe([pos[0], pos[1] + drop, pos[2]], [pos[0], pos[1] + 0.06, pos[2]], 0.018, mat.dark);
    cyl(0.22, 0.11, [pos[0], pos[1] + 0.03, pos[2]], mat.dark, root, 16, true, null, 0.08);
    cyl(0.085, 0.11, [pos[0], pos[1] - 0.05, pos[2]], warm ? mat.bulbWarm : mat.bulbCold, root, 12, true);
    mesh(new THREE.TorusGeometry(0.17, 0.01, 6, 16), mat.iron, [pos[0], pos[1] - 0.06, pos[2]], root, true, [Math.PI / 2, 0, 0]);
  }

  function pendantLight(pos, warm = true, intensity = 24, distance = 13, drop = 0.36) {
    fixtureVisual(pos, warm, drop);
    const l = new THREE.PointLight(warm ? 0xffcb8c : 0xaad5df, intensity, distance, 1.85);
    l.position.set(pos[0], pos[1] - 0.18, pos[2]);
    root.add(l);
    return l;
  }

  function rail(a, b, y = 3.92, postStep = 1.7) {
    const h = 0.92;
    pipe([a[0], y, a[1]], [b[0], y, b[1]], 0.032, mat.dark);
    pipe([a[0], y - 0.44, a[1]], [b[0], y - 0.44, b[1]], 0.022, mat.iron);
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    box(0.025, 0.11, len, [(a[0] + b[0]) / 2, y - h + 0.06, (a[1] + b[1]) / 2], mat.yellow, root, true, [0, ang, 0]);
    const steps = Math.max(1, Math.round(len / postStep));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const px = a[0] + (b[0] - a[0]) * f;
      const pz = a[1] + (b[1] - a[1]) * f;
      pipe([px, y - h, pz], [px, y + 0.02, pz], 0.028, mat.dark);
    }
  }

  function grating(x, z, w, d, y = 3) {
    box(w, 0.14, 0.08, [x, y - 0.08, z - d / 2], mat.dark);
    box(w, 0.14, 0.08, [x, y - 0.08, z + d / 2], mat.dark);
    box(0.08, 0.14, d, [x - w / 2, y - 0.08, z], mat.dark);
    box(0.08, 0.14, d, [x + w / 2, y - 0.08, z], mat.dark);
    for (let i = -w / 2 + 0.10; i < w / 2; i += 0.18) box(0.032, 0.045, d, [x + i, y - 0.01, z], mat.silver);
    for (let i = -d / 2 + 0.25; i < d / 2; i += 0.90) box(w, 0.065, 0.04, [x, y - 0.02, z + i], mat.iron);
  }

  // Merge non-moving meshes inside interactive prop groups while leaving animated sub-groups untouched
  function batchStaticChildren(group, excludeSet = new Set()) {
    const byMat = new Map();
    for (const child of [...group.children]) {
      if (excludeSet.has(child) || !child.isMesh || child.material?.transparent) continue;
      child.updateMatrix();
      const src = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      src.applyMatrix4(child.matrix);
      const arr = byMat.get(child.material) || [];
      arr.push(src);
      byMat.set(child.material, arr);
      group.remove(child);
    }
    for (const [m, list] of byMat) {
      const merged = mergeGeometries(list, false);
      if (merged) {
        const combined = new THREE.Mesh(merged, m);
        combined.castShadow = true;
        combined.receiveShadow = true;
        group.add(combined);
      }
    }
  }

  // ============================================================================
  // SKY, ATMOSPHERE & GLOBAL DAWN SEA LIGHT
  // ============================================================================
  const skyGeo = new THREE.SphereGeometry(210, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vD;
      void main() {
        vD = position;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vD;
      void main() {
        vec3 d = normalize(vD);
        float h = smoothstep(-0.06, 0.58, d.y);
        vec3 horizon = mix(vec3(0.18, 0.25, 0.29), vec3(0.35, 0.45, 0.49), smoothstep(-0.3, 0.9, d.x));
        vec3 zenith = vec3(0.045, 0.08, 0.115);
        vec3 c = mix(horizon, zenith, pow(h, 0.78));
        float cloud = sin(d.x * 9.0 + d.z * 6.0 + sin(d.z * 17.0) * 0.4) * 0.5 + 0.5;
        c += cloud * 0.022 * smoothstep(0.02, 0.35, d.y) * (1.0 - smoothstep(0.35, 0.75, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  scene.background = color(0x1b282e);
  scene.fog = new THREE.FogExp2(0x1f2e34, 0.0135);

  const hemi = new THREE.HemisphereLight(0x94bccb, 0x1c2522, 0.62);
  scene.add(hemi);

  const dawn = new THREE.DirectionalLight(0xaad0df, 1.95);
  dawn.position.set(44, 17, 6);
  dawn.castShadow = true;
  dawn.shadow.mapSize.set(2048, 2048);
  dawn.shadow.camera.left = -34;
  dawn.shadow.camera.right = 34;
  dawn.shadow.camera.top = 34;
  dawn.shadow.camera.bottom = -34;
  dawn.shadow.camera.near = 1;
  dawn.shadow.camera.far = 115;
  dawn.shadow.normalBias = 0.04;
  dawn.target.position.set(0, 1, -18);
  scene.add(dawn, dawn.target);

  // ============================================================================
  // ROOM 1: ENTRY DUTY ROOM (01 / 入口值班室, x: -5..5, z: 0..10, y: 3)
  // ============================================================================
  activeRoom = 'entry';
  slab(10.4, 0.36, 10.4, [0, 2.82, 5], mat.floor, true);
  box(10.6, 0.26, 10.6, [0, 6.85, 5], mat.concrete);

  for (const z of [1.8, 5.0, 8.2]) box(10.0, 0.26, 0.28, [0, 6.60, z], mat.concrete);
  box(0.14, 0.26, 10.0, [-4.76, 3.13, 5.0], mat.plinth);
  box(9.8, 0.26, 0.14, [0, 3.13, 9.76], mat.plinth);
  box(0.14, 0.26, 9.8, [4.74, 3.13, 5.0], mat.plinth);

  wall(0.42, 3.8, 10.2, [-5.0, 4.85, 5.0]);
  wall(10.2, 3.8, 0.42, [0, 4.85, 10.0]);
  wall(3.45, 3.8, 0.42, [-3.28, 4.85, 0]);
  wall(3.45, 3.8, 0.42, [3.28, 4.85, 0]);
  wall(3.1, 0.95, 0.42, [0, 6.28, 0]);
  box(0.14, 2.85, 0.50, [-1.52, 4.42, 0], mat.dark);
  box(0.14, 2.85, 0.50, [1.52, 4.42, 0], mat.dark);
  box(3.2, 0.14, 0.52, [0, 5.82, 0], mat.dark);

  // Marine Watertight Entrance Door on North Wall (z=9.78)
  rounded(1.42, 2.28, 0.10, 0.14, [0, 4.22, 9.75], mat.cabinet);
  box(1.62, 2.44, 0.08, [0, 4.20, 9.80], mat.dark);
  cyl(0.22, 0.08, [0, 4.65, 9.70], mat.iron, root, 18, true, [Math.PI / 2, 0, 0]);
  cyl(0.16, 0.09, [0, 4.65, 9.69], mat.bulbCold, root, 16, true, [Math.PI / 2, 0, 0]);
  mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 18), mat.brass, [0.42, 4.15, 9.66]);
  box(1.7, 0.06, 0.28, [0, 3.03, 9.70], mat.hazard);
  label('站外海堤通道 · 封站前锁闭', 1.25, 0.22, [0, 5.62, 9.76], Math.PI, '#c8c0a2', '#263a33');

  // Coat rack, foul-weather oilskin & rubber waders near entrance
  box(1.1, 0.08, 0.12, [-2.45, 4.95, 9.68], mat.wood);
  for (const x of [-2.8, -2.45, -2.1]) pipe([x, 4.95, 9.68], [x, 4.86, 9.54], 0.015, mat.iron);
  cyl(0.16, 0.92, [-2.8, 4.35, 9.52], mat.yellow, root, 12, true, null, 0.09);
  box(0.85, 0.06, 0.44, [-2.45, 3.03, 9.42], mat.rubber);
  for (const bx of [-2.62, -2.38]) {
    cyl(0.075, 0.34, [bx, 3.20, 9.42], mat.rubber, root, 12);
    box(0.15, 0.09, 0.26, [bx, 3.06, 9.35], mat.rubber);
  }

  // East Observation Bay Window (x = 5, z = 0..10)
  wall(0.46, 1.12, 10.2, [5.0, 3.56, 5.0]);
  wall(0.46, 0.62, 10.2, [5.0, 6.46, 5.0]);
  for (const z of [0.15, 3.25, 6.65, 9.85]) wall(0.52, 2.18, 0.26, [5.0, 5.15, z]);
  box(0.76, 0.12, 9.9, [4.76, 4.14, 5.0], mat.paint);
  box(0.16, 0.08, 9.9, [4.95, 6.14, 5.0], mat.dark);
  box(0.16, 0.06, 9.9, [4.86, 4.22, 5.0], mat.dark);

  const saltTexture = canvasTex((c, n) => {
    c.clearRect(0, 0, n, n);
    const g = c.createLinearGradient(0, n, 0, 0);
    g.addColorStop(0, 'rgba(218,226,214,0.48)');
    g.addColorStop(0.28, 'rgba(195,212,208,0.12)');
    g.addColorStop(0.85, 'rgba(180,205,210,0.03)');
    g.addColorStop(1, 'rgba(205,220,222,0.22)');
    c.fillStyle = g;
    c.fillRect(0, 0, n, n);
    for (let i = 0; i < 380; i++) {
      c.fillStyle = `rgba(225,236,228,${0.03 + rnd() * 0.14})`;
      c.fillRect(rnd() * n, rnd() * n, 0.6 + rnd() * 1.8, 6 + rnd() * 48);
    }
  }, 256);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9ec0c4, map: saltTexture, transparent: true, opacity: 0.24,
    roughness: 0.16, metalness: 0.12, side: THREE.DoubleSide, depthWrite: false
  });
  mesh(new THREE.PlaneGeometry(2.9, 1.92), glassMat, [4.92, 5.18, 1.70], root, false, [0, -Math.PI / 2, 0]);
  mesh(new THREE.PlaneGeometry(2.95, 1.92), glassMat, [4.92, 5.18, 8.25], root, false, [0, -Math.PI / 2, 0]);

  // Animated Center Sliding Sash
  const slidingWin = new THREE.Group();
  slidingWin.position.set(4.86, 5.18, 4.95);
  root.add(slidingWin);
  const winGlass = mesh(new THREE.PlaneGeometry(3.15, 1.88), glassMat, [0, 0, 0], slidingWin, false, [0, -Math.PI / 2, 0]);
  box(0.07, 1.94, 0.07, [0, 0, -1.58], mat.dark, slidingWin, false);
  box(0.07, 1.94, 0.07, [0, 0, 1.58], mat.dark, slidingWin, false);
  box(0.07, 0.07, 3.22, [0, 0.94, 0], mat.dark, slidingWin, false);
  box(0.07, 0.07, 3.22, [0, -0.94, 0], mat.dark, slidingWin, false);
  batchStaticChildren(slidingWin, new Set([winGlass]));

  // Animated Brass Window Latch
  const latch = new THREE.Group();
  latch.position.set(4.68, 4.34, 4.65);
  root.add(latch);
  rounded(0.09, 0.34, 0.06, 0.02, [0, 0, 0], mat.dark, latch, false);
  const latchHandle = new THREE.Group();
  latchHandle.position.set(-0.04, 0.06, 0);
  latch.add(latchHandle);
  cyl(0.032, 0.07, [0, 0, 0], mat.brass, latchHandle, 14, false, [0, 0, Math.PI / 2]);
  pipe([0, 0, 0], [-0.04, 0, -0.22], 0.026, mat.brass, latchHandle, false);
  cyl(0.034, 0.06, [-0.04, 0, -0.23], mat.rubber, latchHandle, 14, false, [Math.PI / 2, 0, 0]);
  batchStaticChildren(latchHandle);
  batchStaticChildren(latch, new Set([latchHandle]));

  interactables.push({ id: 'latch', pos: [4.66, 4.35, 4.65], mesh: latch, label: '拨开值班窗扣' });
  interactables.push({ id: 'exit', pos: [4.66, 4.35, 4.65], mesh: latch, label: '对照外海水位尺 · 封站交接' });

  const upperPlate = label('外海水位尺 / 观测点\n退潮核对位', 0.72, 0.19, [4.62, 4.23, 6.35], -Math.PI / 2, '#d5ccb0', '#243a32', root, false);
  interactables.push({ id: 'gauge-upper', pos: [4.55, 4.25, 6.35], mesh: upperPlate, label: '观察外海水位尺' });

  // Duty Desk, Pedestal Drawers, Gooseneck Work Lamp Visual, Field Intercom & Chair
  solid(2.35, 0.98, 1.08, [2.85, 3.49, 3.65]);
  box(2.38, 0.09, 1.10, [2.85, 3.96, 3.65], mat.wood);
  box(2.30, 0.04, 1.02, [2.85, 3.90, 3.65], mat.dark);
  box(0.62, 0.84, 0.96, [2.05, 3.46, 3.65], mat.cabinet);
  for (const dy of [3.26, 3.52, 3.76]) {
    box(0.54, 0.20, 0.03, [2.05, dy, 4.14], mat.paint);
    box(0.16, 0.025, 0.04, [2.05, dy, 4.17], mat.silver);
  }
  for (const z of [3.20, 4.10]) box(0.065, 0.88, 0.065, [3.88, 3.45, z], mat.dark);
  pipe([2.36, 3.22, 3.22], [3.88, 3.22, 3.22], 0.022, mat.dark);

  // Gooseneck work lamp (emissive bulb + shared entry warm light keeps fragment light count low!)
  cyl(0.14, 0.04, [2.22, 4.02, 3.32], mat.dark, root, 16);
  pipe([2.22, 4.04, 3.32], [2.35, 4.46, 3.42], 0.016, mat.brass);
  pipe([2.35, 4.46, 3.42], [2.68, 4.52, 3.56], 0.016, mat.brass);
  mesh(new THREE.ConeGeometry(0.15, 0.18, 16, 1, true), mat.cabinet, [2.74, 4.46, 3.60], root, true, [0, 0, -0.35]);
  mesh(new THREE.SphereGeometry(0.044, 10, 8), mat.bulbWarm, [2.74, 4.42, 3.60]);

  box(0.56, 0.018, 0.38, [2.18, 4.015, 3.78], mat.paper);
  const deskLabel = label('07 号站值班日志\n04:00 外海退潮 · 待取末卷', 0.50, 0.18, [2.18, 4.028, 3.78], 0, '#d8d0b5', '#2a3b34', root, false);
  deskLabel.rotation.set(-Math.PI / 2, 0, 0);
  rounded(0.28, 0.16, 0.22, 0.03, [3.72, 4.08, 3.38], mat.dark);
  pipe([3.58, 4.18, 3.38], [3.86, 4.18, 3.38], 0.026, mat.black);
  cyl(0.048, 0.11, [2.56, 4.06, 3.92], mat.paper, root, 14);

  // Duty Swivel Chair (tucked into right kneehole of duty desk so spawn -> window/recorder aisle is wide open)
  solid(0.52, 0.92, 0.46, [3.15, 3.46, 4.02]);
  cyl(0.04, 0.44, [3.15, 3.24, 4.02], mat.iron, root, 12);
  for (let a = 0; a < 5; a++) {
    const ang = (a * Math.PI * 2) / 5;
    pipe([3.15, 3.05, 4.02], [3.15 + Math.cos(ang) * 0.24, 3.03, 4.02 + Math.sin(ang) * 0.24], 0.02, mat.dark);
  }
  rounded(0.45, 0.07, 0.42, 0.05, [3.15, 3.48, 4.02], mat.rubber);
  box(0.42, 0.34, 0.06, [3.12, 3.78, 4.22], mat.rubber, root, true, [0, 0.16, 0]);

  // West Wall Hydrographic Filing Cabinets, Locker & Instruments
  solid(0.76, 2.05, 1.35, [-4.40, 4.02, 7.55]);
  box(0.74, 2.02, 1.32, [-4.40, 4.01, 7.55], mat.cabinet);
  box(0.03, 1.86, 0.58, [-4.02, 4.02, 7.22], mat.paint);
  box(0.03, 1.86, 0.58, [-4.02, 4.02, 7.88], mat.paint);

  solid(0.82, 1.36, 1.85, [-4.36, 3.68, 4.85]);
  box(0.80, 1.34, 1.82, [-4.36, 3.67, 4.85], mat.paint);
  for (const y of [3.24, 3.56, 3.88, 4.18]) {
    box(0.03, 0.24, 1.68, [-3.95, y, 4.85], mat.cabinet);
    for (const z of [4.35, 5.35]) box(0.04, 0.03, 0.18, [-3.92, y, z], mat.silver);
  }
  for (const [tz, r] of [[4.25, 0.055], [4.40, 0.05], [4.54, 0.055]]) {
    cyl(r, 0.68, [-4.35, 4.41, tz], mat.paper, root, 14, true, [0, 0, Math.PI / 2]);
  }
  dialGauge([-4.75, 5.25, 6.25], Math.PI / 2, 0.20);
  dialGauge([-4.75, 5.25, 3.55], Math.PI / 2, 0.16);
  label('海岸 07 号潮汐观测站\n水文档案柜 · 1984—2026', 2.2, 0.42, [-4.76, 5.35, 4.85], Math.PI / 2, '#cbc3a6', '#253931');

  rounded(0.56, 0.74, 0.18, 0.04, [-2.35, 4.65, 0.30], mat.cabinet);
  label('廊桥及泵房馈电\n主干线 →', 0.48, 0.18, [-2.35, 4.72, 0.41], 0, '#d2c9ab', '#283d34');
  pipe([-2.35, 4.28, 0.28], [-2.35, 3.04, 0.28], 0.032, mat.dark);
  box(2.8, 0.028, 0.22, [1.4, 3.014, 2.4], mat.rubber, root, true, [0, -0.48, 0]);
  box(0.24, 0.028, 2.6, [0.1, 3.014, 0.9], mat.rubber);
  label('观潮廊桥 / 下层泵房 ↓\n保持安静 · 注意脚下声响', 1.45, 0.42, [2.65, 4.85, 0.24], 0, '#cfc6a6', '#283b33');

  // Light #1: Entry Room Warm Work Light (positioned to illuminate Desk Recorder, Window Latch & Room!)
  const entryLamp = pendantLight([2.15, 6.32, 4.35], true, 30, 14, 0.42);

  // ============================================================================
  // PORTABLE TAPE RECORDER
  // ============================================================================
  function buildRecorderMesh() {
    const g = new THREE.Group();
    rounded(0.46, 0.18, 0.30, 0.03, [0, 0, 0], mat.dark, g, false);
    box(0.40, 0.015, 0.23, [0, 0.098, 0], mat.paint, g, false);
    box(0.30, 0.012, 0.14, [0, 0.106, -0.025], mat.black, g, false);
    const reels = [];
    for (const x of [-0.085, 0.085]) {
      const reelGroup = new THREE.Group();
      reelGroup.position.set(x, 0.118, -0.025);
      g.add(reelGroup);
      cyl(0.056, 0.014, [0, 0, 0], mat.silver, reelGroup, 18, false);
      cyl(0.042, 0.016, [0, 0.001, 0], mat.black, reelGroup, 14, false);
      for (let a = 0; a < 3; a++) {
        const an = a * 2.094;
        box(0.011, 0.018, 0.046, [Math.sin(an) * 0.024, 0.003, Math.cos(an) * 0.024], mat.dark, reelGroup, false, [0, an, 0]);
      }
      batchStaticChildren(reelGroup);
      reels.push(reelGroup);
    }
    for (let i = 0; i < 4; i++) {
      box(0.042, 0.024, 0.048, [-0.11 + i * 0.062, 0.108, 0.088], i === 0 ? mat.rust : mat.paper, g, false);
    }
    pipe([-0.19, 0.04, -0.16], [0.19, 0.04, -0.16], 0.016, mat.silver, g, false);
    pipe([-0.19, -0.03, -0.12], [-0.19, 0.04, -0.16], 0.016, mat.silver, g, false);
    pipe([0.19, -0.03, -0.12], [0.19, 0.04, -0.16], 0.016, mat.silver, g, false);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x7ec878 });
    const led = mesh(new THREE.SphereGeometry(0.018, 10, 8), ledMat, [0.165, 0.112, 0.085], g, false);
    batchStaticChildren(g, new Set([...reels, led]));
    return { group: g, reels, led, ledMat };
  }

  const deskRecObj = buildRecorderMesh();
  const recorder = deskRecObj.group;
  recorder.position.set(3.05, 4.10, 3.65);
  recorder.rotation.y = -0.24;
  root.add(recorder);
  interactables.push({ id: 'pickup-recorder', pos: [3.05, 4.12, 3.65], mesh: recorder, label: '拿起便携录放机' });

  const portableObj = buildRecorderMesh();
  const portable = portableObj.group;
  portable.visible = false;
  scene.add(portable);

  // Placement Preview + Tutorial 3m Ring (using TorusGeometry for 100% bundle compatibility!)
  const placementPreview = new THREE.Group();
  placementPreview.visible = false;
  scene.add(placementPreview);
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xd8c88a, transparent: true, opacity: 0.30, wireframe: true });
  const ghostBox = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.30), ghostMat);
  ghostBox.position.y = 0.09;
  placementPreview.add(ghostBox);
  const ghostRingMat = new THREE.MeshBasicMaterial({ color: 0xe3cf8e, transparent: true, opacity: 0.50, depthWrite: false });
  const ghostRing = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.014, 6, 32), ghostRingMat);
  ghostRing.rotation.x = Math.PI / 2;
  ghostRing.position.y = 0.025;
  placementPreview.add(ghostRing);

  const tutRangeRingMat = new THREE.MeshBasicMaterial({ color: 0x8cc2c8, transparent: true, opacity: 0.25, depthWrite: false });
  const tutRangeRing = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.02, 6, 56), tutRangeRingMat);
  tutRangeRing.rotation.x = Math.PI / 2;
  tutRangeRing.position.y = 0.028;
  tutRangeRing.visible = false;
  scene.add(tutRangeRing);

  function note(id, text, pos, rot = 0, withStand = false) {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.y = rot;
    root.add(g);
    box(0.62, 0.78, 0.028, [0, 0, 0], mat.wood, g, false);
    const lbl = label(text, 0.54, 0.70, [0, 0, 0.018], 0, '#cfc7ab', '#2c3d35', g, false);
    if (withStand) {
      pipe([0, -1.25, -0.02], [0, -0.38, -0.02], 0.032, mat.dark, g, false);
      cyl(0.22, 0.04, [0, -1.25, -0.02], mat.dark, g, 16, false);
      solid(0.42, 1.35, 0.42, [pos[0], pos[1] - 0.6, pos[2]]);
    }
    batchStaticChildren(g, new Set([lbl]));
    interactables.push({ id, pos, mesh: g, label: '阅读站内留存记录' });
    return g;
  }
  note('note-entry', '交接单\n末卷记录 / 07\n切勿遗留', [-1.85, 4.28, 4.85], 0.32, true);

  // ============================================================================
  // EXTERIOR COASTLINE, PIER PILINGS, BREAKWATER, BEACON & BATCHED TIDE STAFF
  // ============================================================================
  activeRoom = 'exterior';
  box(58, 1.2, 120, [34, -1.9, -14], mat.rock);
  for (let z = -50; z <= 14; z += 6.5) {
    box(0.85, 8.2, 0.85, [6.2, -1.0, z], mat.concrete);
    box(0.92, 1.6, 0.92, [6.2, -0.4, z], mat.plinth);
    if (z % 13 === 0) box(0.75, 7.0, 0.75, [12.4, -1.6, z], mat.concrete);
  }
  box(4.2, 3.6, 86, [44, 0.2, -18], mat.rock);
  for (let i = 0; i < 18; i++) {
    const rz = -62 + i * 7.2 + (rnd() - 0.5) * 3;
    const rx = 56 + rnd() * 38;
    const rh = 3.5 + rnd() * 9.5;
    const rw = 8 + rnd() * 16;
    mesh(new THREE.ConeGeometry(rw * 0.55, rh, 6), mat.rock, [rx, rh * 0.35 - 1.2, rz], root, true, [0, rnd() * 3, 0]);
  }
  const beaconPos = [78, 0, -32];
  cyl(0.9, 11.5, [beaconPos[0], 5.2, beaconPos[2]], mat.dark, root, 8, true, null, 0.45);
  cyl(0.75, 0.35, [beaconPos[0], 11.1, beaconPos[2]], mat.rust, root, 12);
  const beaconBulbMat = new THREE.MeshBasicMaterial({ color: 0xffc66d });
  const beaconGlow = mesh(new THREE.SphereGeometry(0.38, 10, 8), beaconBulbMat, [beaconPos[0], 11.55, beaconPos[2]], root, false);

  // Exterior Tide Staff (`gauge` at [16, 0, -1]): ALL 90 ticks & 18 cached 64px digits merged by material!
  const gauge = new THREE.Group();
  gauge.position.set(16, 0, -1);
  root.add(gauge);
  box(0.50, 9.2, 0.16, [0, 3.1, 0], mat.paper, gauge, false);
  for (const face of [1, -1]) {
    for (let i = 0; i < 45; i++) {
      box(i % 5 === 0 ? 0.34 : 0.18, 0.028, 0.02, [-0.05 * face, -1.3 + i * 0.2, 0.09 * face], mat.black, gauge, false);
      if (i % 5 === 0) {
        label((i / 5).toFixed(0), 0.15, 0.19, [0.13 * face, -1.28 + i * 0.2, 0.105 * face], face === 1 ? 0 : Math.PI, '#dcd4b6', '#1e312b', gauge, false);
      }
    }
  }
  pipe([-0.36, -2, 0], [-0.36, 8.1, 0], 0.055, mat.rust, gauge, false);
  pipe([0.36, -2, 0], [0.36, 8.1, 0], 0.055, mat.rust, gauge, false);
  label('水 位', 0.50, 0.26, [0, 7.85, 0.1], 0, '#dcd4b6', '#1e312b', gauge, false);
  batchStaticChildren(gauge); // collapses ~112 draw calls into just 12 tiny merged meshes with 64x64 reused textures!

  // ============================================================================
  // ROOM 2: OBSERVATION BRIDGE (02 / 观潮廊桥, x: -3..3, z: -16..0, y: 3)
  // ============================================================================
  activeRoom = 'bridge';
  slab(6.1, 0.26, 16.0, [0, 2.87, -8.0], mat.floor, true);
  box(6.4, 0.20, 16.2, [0, 6.48, -8.0], mat.concrete);
  wall(0.38, 3.6, 16.0, [-3.08, 4.72, -8.0]);
  box(0.14, 0.24, 16.0, [-2.82, 3.12, -8.0], mat.plinth);

  for (let z = -1.2; z >= -15.2; z -= 3.4) {
    box(0.18, 3.45, 0.18, [2.95, 4.70, z], mat.dark);
    box(0.16, 3.45, 0.18, [-2.82, 4.70, z], mat.dark);
    box(6.1, 0.18, 0.20, [0, 6.32, z], mat.dark);
    pipe([2.92, 5.75, z], [2.35, 6.30, z], 0.028, mat.iron);
    pipe([-2.78, 5.75, z], [-2.22, 6.30, z], 0.028, mat.iron);
  }
  rail([2.82, -0.1], [2.82, -15.8], 3.94, 1.7);
  flangePipe([-2.70, 5.55, -0.3], [-2.70, 5.55, -15.7], 0.075, mat.rust, 2.8);
  pipe([-2.74, 4.15, -0.3], [-2.74, 4.15, -15.7], 0.032, mat.dark);
  box(0.22, 0.024, 15.6, [0.1, 3.012, -8.0], mat.rubber);

  label('02 / 观潮廊桥', 1.7, 0.36, [-2.86, 5.05, -3.2], Math.PI / 2);
  label('声学联络试验段\n敲钟 → R 录音 → Q 放置诱饵', 1.65, 0.46, [-2.86, 4.65, -7.0], Math.PI / 2, '#d3cab0', '#243a32');
  note('note-bridge', '声学联络须知\n录下 · 放远\n退开三米听回放', [-2.84, 4.45, -10.8], Math.PI / 2);

  const bellMount = new THREE.Group();
  bellMount.position.set(0, 4.12, -7.0);
  root.add(bellMount);
  pipe([0, 2.18, 0], [0, 0.28, 0], 0.032, mat.dark, bellMount, false);
  box(0.28, 0.06, 0.10, [0, 0.28, 0], mat.iron, bellMount, false);
  const bellBody = new THREE.Group();
  bellBody.position.set(0, 0.24, 0);
  bellMount.add(bellBody);
  cyl(0.21, 0.24, [0, -0.14, 0], mat.brass, bellBody, 20, false, null, 0.10);
  mesh(new THREE.TorusGeometry(0.21, 0.022, 8, 20), mat.brass, [0, -0.25, 0], bellBody, false, [Math.PI / 2, 0, 0]);
  mesh(new THREE.SphereGeometry(0.042, 10, 8), mat.iron, [0, -0.28, 0], bellBody, false);
  batchStaticChildren(bellBody);
  batchStaticChildren(bellMount, new Set([bellBody]));
  interactables.push({ id: 'bell', pos: [0, 4.02, -7.0], mesh: bellMount, label: '敲击检修悬钟' });

  // Light #2: Bridge Pendant Light (plus emissive-only fixture near gate)
  const bridgeLamp = pendantLight([0, 6.22, -7.2], true, 20, 12, 0.18);
  fixtureVisual([0, 6.22, -13.8], false, 0.18);

  const gate = new THREE.Group();
  gate.position.set(-2.82, 3.0, -15.65);
  root.add(gate);
  for (const y of [0.18, 1.12]) pipe([0, y, 0], [5.62, y, 0], 0.042, mat.paint, gate, false);
  box(5.62, 0.12, 0.05, [2.81, 0.65, 0], mat.hazard, gate, false);
  for (let x = 0; x <= 5.62; x += 0.38) pipe([x, 0.18, 0], [x, 1.12, 0], 0.02, mat.iron, gate, false);
  label('完成声学回放测试后通行', 2.2, 0.26, [2.81, 0.92, 0.04], 0, '#cfc5a4', '#2c3e35', gate, false);
  batchStaticChildren(gate);

  // ============================================================================
  // ROOM 3: TWO-LEVEL PUMP HALL (03 / 下层泵房, x: -10..10, z: -36..-16, y: 3 & 0)
  // ============================================================================
  activeRoom = 'pump';
  box(13.25, 0.32, 20.0, [-3.375, -0.18, -26.0], mat.wetFloor);
  box(5.35, 0.32, 20.0, [7.325, -0.18, -26.0], mat.wetFloor);
  box(1.4, 0.32, 3.65, [3.95, -0.18, -17.825], mat.wetFloor);
  box(1.4, 0.32, 15.0, [3.95, -0.18, -28.5], mat.wetFloor);
  box(1.4, 0.25, 1.35, [3.95, -3.12, -20.325], mat.dark);
  for (const x of [3.2, 4.7]) box(0.12, 3.0, 1.45, [x, -1.5, -20.325], mat.concrete);
  for (const z of [-19.6, -21.05]) box(1.5, 3.0, 0.12, [3.95, -1.5, z], mat.concrete);

  wall(0.46, 7.2, 20.2, [-10.2, 3.35, -26.0]);
  wall(0.46, 7.2, 20.2, [10.2, 3.35, -26.0]);
  wall(7.0, 7.2, 0.46, [-6.5, 3.35, -16.0]);
  wall(7.0, 0.72, 0.46, [6.5, 0.22, -16.0]);
  wall(7.0, 0.65, 0.46, [6.5, 6.42, -16.0]);
  box(0.32, 5.6, 0.34, [9.8, 3.35, -16.0], mat.dark);
  for (const x of [4.8, 7.4]) box(0.14, 5.5, 0.22, [x, 3.35, -16.0], mat.dark);

  // Aligned South Bulkhead Wall & Watertight Doorway Frame (clear aperture x: -2.52..+2.52, jambs ±2.52..±2.80, walls ±2.80..±10.10)
  wall(7.3, 7.2, 0.48, [-6.45, 3.35, -36.0]);
  wall(7.3, 7.2, 0.48, [6.45, 3.35, -36.0]);
  wall(5.6, 4.15, 0.48, [0, 5.025, -36.0]);
  box(0.28, 2.96, 0.64, [-2.66, 1.48, -36.0], mat.dark);
  solid(0.28, 2.96, 0.64, [-2.66, 1.48, -36.0], true);
  box(0.28, 2.96, 0.64, [2.66, 1.48, -36.0], mat.dark);
  solid(0.28, 2.96, 0.64, [2.66, 1.48, -36.0], true);
  box(5.60, 0.26, 0.66, [0, 2.98, -36.0], mat.hazard);
  box(20.6, 0.28, 20.4, [0, 6.95, -26.0], mat.concrete);

  // Unbatched Animated South Armored Watertight Bulkhead Shutter (closed before power, lifts into lintel housing on power!)
  const southDoor = new THREE.Group();
  southDoor.position.set(0, 0, -36.0);
  root.add(southDoor);
  box(5.06, 2.92, 0.16, [0, 1.48, 0], mat.cabinet, southDoor, false);
  box(5.06, 0.22, 0.20, [0, 0.14, 0], mat.hazard, southDoor, false);
  for (const ry of [0.62, 1.24, 1.86, 2.48]) {
    box(5.02, 0.09, 0.22, [0, ry, 0], mat.dark, southDoor, false);
  }
  for (const rx of [-1.65, 0, 1.65]) {
    box(0.10, 2.84, 0.20, [rx, 1.48, 0], mat.iron, southDoor, false);
  }
  label('末端自记控制室 · 水密闸门\n断电闭锁（西侧合闸送电后升起）', 2.15, 0.38, [0, 1.56, 0.12], 0, '#cfc5a4', '#233830', southDoor, false);
  batchStaticChildren(southDoor);
  const southDoorCollider = {
    doorSightOnly: true,
    blocksSight: true,
    minX: -2.52, maxX: 2.52,
    minY: 0, maxY: 2.95,
    minZ: -36.16, maxZ: -35.84
  };
  colliders.push(southDoorCollider);
  interactables.push({ id: 'south-door', pos: [0, 1.48, -35.85], mesh: southDoor, label: '末端控制室水密闸门' });

  // Clear-span steel roof trusses (no center column obstructing entry sightline)
  for (const z of [-20.4, -25.8, -31.2]) {
    box(19.6, 0.34, 0.28, [0, 6.52, z], mat.dark);
    box(19.2, 0.16, 0.18, [0, 5.78, z], mat.iron);
    for (let x = -8.0; x <= 8.0; x += 2.66) {
      pipe([x, 5.78, z], [x, 6.52, z], 0.04, mat.dark);
      if (x < 7.5) pipe([x, 5.78, z], [x + 2.66, 6.52, z], 0.032, mat.iron);
    }
    for (const x of [-9.96, 9.96]) {
      box(0.28, 6.8, 0.44, [x, 3.3, z], mat.concrete);
      solid(0.28, 6.8, 0.44, [x, 3.3, z], true);
      pipe([x > 0 ? 9.82 : -9.82, 5.15, z], [x > 0 ? 8.85 : -8.85, 5.78, z], 0.045, mat.dark);
    }
  }

  grating(0, -17.5, 19.8, 3.0, 3.0);
  grating(-9.1, -27.5, 1.8, 17.0, 3.0);
  rail([-4.95, -19.0], [9.75, -19.0], 3.84, 2.1);
  rail([-8.15, -29.0], [-8.15, -35.6], 3.88, 1.8);

  for (let i = 0; i < 20; i++) {
    const z = -19.25 - i * 0.5, y = 3.0 - (i + 1) * 0.15;
    box(2.96, 0.12, 0.48, [-6.5, y - 0.06, z], mat.iron);
    box(2.94, 0.025, 0.065, [-6.5, y + 0.005, z - 0.21], mat.yellow);
  }
  pipe([-8.02, 3.0, -19.0], [-8.02, 0.0, -29.0], 0.075, mat.dark);
  pipe([-4.98, 3.0, -19.0], [-4.98, 0.0, -29.0], 0.075, mat.dark);
  pipe([-8.05, 3.92, -19.0], [-8.05, 0.96, -29.0], 0.036, mat.yellow);
  pipe([-4.95, 3.92, -19.0], [-4.95, 0.96, -29.0], 0.036, mat.yellow);
  for (let s = 0; s <= 5; s++) {
    const f = s / 5, z = -19.0 - f * 10.0, y = 3.0 - f * 3.0;
    pipe([-8.05, y, z], [-8.05, y + 0.94, z], 0.028, mat.dark);
    pipe([-4.95, y, z], [-4.95, y + 0.94, z], 0.028, mat.dark);
  }
  label('↑ 干燥安全退路 / 上层步道', 1.45, 0.28, [-6.5, 2.35, -29.2], Math.PI, '#dcd09e', '#1f332c');

  for (const x of [3.65, 4.25]) pipe([x, -3.0, -20.3], [x, 3.82, -20.3], 0.042, mat.yellow);
  for (let y = -2.9; y < 3.75; y += 0.32) pipe([3.65, y, -20.3], [4.25, y, -20.3], 0.028, mat.yellow);
  solid(1.5, 0.55, 1.45, [3.95, 0.2, -20.325]);

  pipe([7.0, 0, -20.0], [7.0, 1.18, -20.0], 0.032, mat.dark);
  const lowerPlate = label('外海水位尺 / 低位复核点', 0.82, 0.22, [7.0, 1.24, -20.0], 0, '#d5ccb0', '#243a32', root, false);
  interactables.push({ id: 'gauge-lower', pos: [7.0, 1.22, -20.0], mesh: lowerPlate, label: '从低位复核外海水位尺' });

  const testGroup = new THREE.Group();
  testGroup.position.set(2.05, 3.48, -18.55);
  root.add(testGroup);
  pipe([0, -0.48, 0], [0, 0, 0], 0.045, mat.dark, testGroup, false);
  rounded(0.32, 0.36, 0.14, 0.03, [0, 0.12, 0], mat.cabinet, testGroup, false);
  cyl(0.055, 0.045, [0, 0.15, 0.085], mat.rust, testGroup, 16, false, [Math.PI / 2, 0, 0]);
  label('东泵试鸣\n观察水纹', 0.26, 0.11, [0, 0.01, 0.078], 0, '#d4ccb0', '#233830', testGroup, false);
  batchStaticChildren(testGroup);
  interactables.push({ id: 'pump-listen', pos: [2.05, 3.60, -18.50], mesh: testGroup, label: '短按东侧检修泵试鸣' });

  for (const x of [-9.68, 9.68]) {
    flangePipe([x, 0.82, -16.8], [x, 0.82, -35.4], 0.145, mat.rust, 2.8);
    flangePipe([x, 4.72, -16.8], [x, 4.72, -35.4], 0.095, mat.paint, 3.4);
  }
  flangePipe([-9.65, 4.72, -23.0], [9.65, 4.72, -23.0], 0.11, mat.paint, 3.2);

  // Three Distinct Industrial Pump Assemblies
  {
    const px = -2.0, pz = -23.0;
    solid(1.5, 1.5, 1.7, [px, 0.75, pz]);
    box(1.54, 0.28, 1.74, [px, 0.14, pz], mat.plinth);
    cyl(0.54, 0.42, [px, 0.82, pz + 0.42], mat.iron, root, 22, true, [Math.PI / 2, 0, 0]);
    cyl(0.22, 0.34, [px, 0.78, pz + 0.02], mat.yellow, root, 14, true, [Math.PI / 2, 0, 0]);
    cyl(0.42, 0.78, [px, 0.78, pz - 0.44], mat.cabinet, root, 20, true, [Math.PI / 2, 0, 0]);
    box(0.32, 0.24, 0.28, [px + 0.32, 1.16, pz - 0.42], mat.dark);
    flangePipe([px, 0.82, pz + 0.65], [px, 0.82, pz + 1.05], 0.16, mat.rust, 0.4);
    pipe([px, 0.82, pz + 1.05], [px, 0.05, pz + 1.05], 0.16, mat.rust);
    flangePipe([px + 0.24, 1.15, pz + 0.42], [px + 0.24, 4.72, pz + 0.42], 0.11, mat.paint, 1.8);
    dialGauge([px + 0.36, 1.65, pz + 0.42], 0, 0.10);
    label('主排水泵 P-01\n停机检修', 0.62, 0.22, [px, 1.32, pz - 0.42], 0, '#cbc2a4', '#273830');
  }

  let eastPumpBeaconMat;
  {
    const px = 6.5, pz = -24.0;
    solid(1.5, 1.5, 1.7, [px, 0.75, pz]);
    box(1.56, 0.30, 1.76, [px, 0.15, pz], mat.plinth);
    cyl(0.38, 1.18, [px - 0.32, 0.86, pz - 0.22], mat.paint, root, 20);
    cyl(0.38, 1.18, [px + 0.32, 0.86, pz - 0.22], mat.paint, root, 20);
    mesh(new THREE.SphereGeometry(0.38, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.paint, [px - 0.32, 1.44, pz - 0.22]);
    mesh(new THREE.SphereGeometry(0.38, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.paint, [px + 0.32, 1.44, pz - 0.22]);
    cyl(0.34, 0.92, [px, 0.68, pz + 0.46], mat.iron, root, 18, true, [0, 0, Math.PI / 2]);
    flangePipe([px + 0.32, 1.15, pz - 0.22], [9.65, 0.82, pz - 0.22], 0.13, mat.rust, 1.5);
    flangePipe([px - 0.32, 1.55, pz - 0.22], [px - 0.32, 4.72, -23.0], 0.10, mat.paint, 1.6);
    dialGauge([px, 1.38, pz + 0.12], -0.4, 0.13);
    pipe([px, 1.45, pz + 0.35], [px, 1.82, pz + 0.35], 0.022, mat.dark);
    eastPumpBeaconMat = new THREE.MeshStandardMaterial({ color: 0xe69b3e, emissive: 0xd97d24, emissiveIntensity: 2.2 });
    mesh(new THREE.SphereGeometry(0.065, 10, 8), eastPumpBeaconMat, [px, 1.88, pz + 0.35], root, false);
    label('辅泵 P-02 · 残压脉动\n自动间歇排气', 0.72, 0.24, [px, 1.05, pz + 0.52], 0, '#d5c79d', '#2b392e');
  }

  {
    const px = -2.0, pz = -32.0;
    solid(1.5, 1.5, 1.7, [px, 0.75, pz]);
    box(1.52, 0.26, 1.72, [px, 0.13, pz], mat.plinth);
    cyl(0.52, 0.56, [px, 0.54, pz], mat.iron, root, 20);
    cyl(0.09, 0.65, [px, 0.96, pz], mat.silver, root, 14);
    cyl(0.36, 0.08, [px, 0.86, pz], mat.brass, root, 16);
    cyl(0.48, 0.16, [px + 0.52, 0.42, pz + 0.55], mat.paint, root, 18, true, [0.85, 0.2, 0.3]);
    pipe([px, 5.78, -31.2], [px, 2.05, pz], 0.016, mat.iron);
    box(0.24, 0.28, 0.18, [px, 5.55, -31.2], mat.yellow);
    label('备用泵 P-03\n已拆解封存', 0.60, 0.22, [px, 0.62, pz + 0.58], 0, '#c2baa0', '#2b382e');
  }

  // Pump Hall Animated Controls
  // 1) West Inlet Isolation Valve (`inlet`)
  solid(0.58, 1.55, 0.48, [-4.5, 0.78, -22.22]);
  const inlet = new THREE.Group();
  inlet.position.set(-4.5, 1.2, -22.0);
  root.add(inlet);
  pipe([0, -1.2, -0.20], [0, 3.52, -0.20], 0.125, mat.rust, inlet, false);
  rounded(0.68, 0.84, 0.20, 0.05, [0, 0, -0.14], mat.cabinet, inlet, false);
  const inletGauge = dialGauge([0.24, 0.26, -0.02], 0, 0.095, 1.1, inlet, true);
  batchStaticChildren(inletGauge.group, new Set([inletGauge.needle]));
  const inletStem = cyl(0.028, 0.24, [0, 0, 0.02], mat.brass, inlet, 12, false, [Math.PI / 2, 0, 0]);
  const inletWheelGroup = new THREE.Group();
  inletWheelGroup.position.set(0, 0, 0.11);
  inlet.add(inletWheelGroup);
  mesh(new THREE.TorusGeometry(0.30, 0.042, 8, 24), mat.yellow, [0, 0, 0], inletWheelGroup, false);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    pipe([0, 0, 0], [Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0], 0.022, mat.silver, inletWheelGroup, false);
  }
  cyl(0.06, 0.07, [0, 0, 0], mat.iron, inletWheelGroup, 12, false, [Math.PI / 2, 0, 0]);
  batchStaticChildren(inletWheelGroup);
  label('① 西侧进水隔离阀\n止回三档 · 先关此阀', 0.96, 0.30, [0, 0.68, -0.02], 0, '#dcd0a4', '#223b31', inlet, false);
  batchStaticChildren(inlet, new Set([inletGauge.group, inletStem, inletWheelGroup]));
  interactables.push({ id: 'inlet', pos: [-4.5, 1.2, -21.92], mesh: inlet, label: '关闭进水隔离阀' });

  // 2) East Relief Bypass Valve (`pump-valve` -> `valve`)
  solid(0.58, 1.55, 0.48, [6.0, 0.78, -30.24]);
  const valve = new THREE.Group();
  valve.position.set(6.0, 1.05, -30.0);
  root.add(valve);
  pipe([0, -1.05, -0.20], [0, 1.25, -0.20], 0.13, mat.rust, valve, false);
  pipe([0, 0.85, -0.20], [3.65, 0.85, -0.20], 0.11, mat.rust, valve, false);
  cyl(0.20, 0.28, [0, 0.15, -0.10], mat.iron, valve, 16, false, [Math.PI / 2, 0, 0]);
  const valveGauge = dialGauge([-0.26, 0.42, -0.04], 0, 0.10, 1.25, valve, true);
  batchStaticChildren(valveGauge.group, new Set([valveGauge.needle]));
  const valveWheelGroup = new THREE.Group();
  valveWheelGroup.position.set(0, 0.15, 0.10);
  valve.add(valveWheelGroup);
  mesh(new THREE.TorusGeometry(0.36, 0.044, 8, 24), mat.rust, [0, 0, 0], valveWheelGroup, false);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    pipe([0, 0, 0], [Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0], 0.024, mat.iron, valveWheelGroup, false);
  }
  cyl(0.065, 0.07, [0, 0, 0], mat.brass, valveWheelGroup, 12, false, [Math.PI / 2, 0, 0]);
  batchStaticChildren(valveWheelGroup);
  label('② 东侧泄压旁通阀\n隔离进水后泄压', 0.92, 0.30, [0, 0.74, -0.02], 0, '#d5cba8', '#263a31', valve, false);
  batchStaticChildren(valve, new Set([valveGauge.group, valveWheelGroup]));
  interactables.push({ id: 'pump-valve', pos: [6.0, 1.2, -29.92], mesh: valve, label: '关闭泄压旁通阀' });

  // 3) West Control Room Power Switch (`power-switch` -> `power`)
  solid(0.82, 1.75, 0.42, [-6.0, 0.88, -33.24]);
  const power = new THREE.Group();
  power.position.set(-6.0, 1.0, -33.0);
  root.add(power);
  pipe([-0.22, -1.0, -0.18], [-0.22, 0.2, -0.18], 0.04, mat.dark, power, false);
  pipe([0.22, 0.8, -0.16], [0.22, 2.8, -0.16], 0.036, mat.dark, power, false);
  rounded(0.82, 1.16, 0.24, 0.05, [0, 0.26, -0.12], mat.cabinet, power, false);
  label('③ 末端控制室供电\n隔离开关', 0.62, 0.26, [0, 0.60, 0.02], 0, '#d9cfb2', '#243a31', power, false);
  const powerPilotMat = new THREE.MeshStandardMaterial({ color: 0xb83e2c, emissive: 0xc43622, emissiveIntensity: 1.8 });
  const powerPilotMesh = mesh(new THREE.SphereGeometry(0.038, 10, 8), powerPilotMat, [-0.24, 0.36, 0.02], power, false);
  const pwrGauge = dialGauge([0.20, 0.34, 0.01], 0, 0.085, -0.8, power, true);
  batchStaticChildren(pwrGauge.group, new Set([pwrGauge.needle]));
  const powerLever = new THREE.Group();
  powerLever.position.set(0, 0.04, 0.02);
  powerLever.rotation.x = -0.58;
  power.add(powerLever);
  cyl(0.055, 0.08, [0, 0, 0], mat.iron, powerLever, 12, false, [0, 0, Math.PI / 2]);
  box(0.055, 0.32, 0.055, [0, 0.15, 0.06], mat.silver, powerLever, false);
  cyl(0.042, 0.14, [0, 0.30, 0.08], mat.rust, powerLever, 12, false, [0, 0, Math.PI / 2]);
  batchStaticChildren(powerLever);
  batchStaticChildren(power, new Set([powerPilotMesh, pwrGauge.group, powerLever]));
  interactables.push({ id: 'power-switch', pos: [-6.0, 1.18, -32.92], mesh: power, label: '合上控制室供电开关' });

  // Metallic Acoustic Knock Pipes (cached base X, non-cumulative vibration!)
  const kpSpecs = [
    { id: 'pipe', pos: [-5.45, 1.1, -20.8], room: 'pump', label: '敲击西侧检修管' },
    { id: 'terminal-pipe', pos: [4.10, 1.2, -40.8], room: 'control', label: '敲击控制室回流管' }
  ];
  const knockPipes = [];
  const kpBaseX = kpSpecs.map(s => s.pos[0]);
  for (const sp of kpSpecs) {
    activeRoom = sp.room;
    const g = new THREE.Group();
    g.position.set(...sp.pos);
    root.add(g);
    pipe([0, -1.1, 0], [0, 1.5, 0], 0.105, mat.brass, g, false);
    for (const y of [-0.55, 0.65]) {
      cyl(0.16, 0.07, [0, y, 0], mat.iron, g, 16, false);
      box(0.30, 0.07, 0.22, [0, y, -0.14], mat.dark, g, false);
    }
    label('传声敲击管', 0.68, 0.20, [0, 0.35, 0.13], 0, '#d4c9a6', '#283b32', g, false);
    batchStaticChildren(g);
    knockPipes.push(g);
    interactables.push({ id: sp.id, pos: [...sp.pos], mesh: g, label: sp.label });
  }

  activeRoom = 'pump';
  note('note-pump', '泵房操作顺序\n① 西侧进水阀\n② 东侧泄压阀\n③ 西侧合电闸', [-9.84, 4.28, -26.5], Math.PI / 2);
  label('03 / 下层排水泵房', 2.5, 0.46, [0, 5.25, -16.28], Math.PI);
  label('涉水慢行 · 留意波纹方向', 1.9, 0.36, [9.92, 2.35, -24.5], -Math.PI / 2);

  // Lights #3 & #4: Warm Stair/West-Inlet Safety Lamp + Cool Overhead Pump Hall Lamp
  // (Wall bulkhead sconces use emissive bulbs without adding extra per-fragment PointLights!)
  const stairLamp = pendantLight([-6.2, 5.4, -22.2], true, 28, 15, 0.28);
  const pumpLamp = pendantLight([2.2, 6.2, -26.8], false, 48, 22, 0.22);
  for (const [x, y, z] of [[-9.82, 4.15, -24.5], [-9.82, 2.15, -28.8], [9.82, 3.45, -30.5]]) {
    const rotY = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    box(0.32, 0.56, 0.10, [x, y, z], mat.dark, root, true, [0, rotY, 0]);
    box(0.20, 0.38, 0.13, [x + (x < 0 ? 0.03 : -0.03), y, z], mat.bulbWarm, root, true, [0, rotY, 0]);
  }

  const dampTex = canvasTex((c, n) => {
    c.clearRect(0, 0, n, n);
    const g = c.createLinearGradient(0, 0, 0, n);
    g.addColorStop(0, 'rgba(18,28,22,0)');
    g.addColorStop(0.42, 'rgba(20,30,22,0.16)');
    g.addColorStop(0.82, 'rgba(15,24,19,0.58)');
    g.addColorStop(1, 'rgba(10,18,15,0.85)');
    c.fillStyle = g;
    c.fillRect(0, 0, n, n);
    for (let i = 0; i < 110; i++) {
      c.fillStyle = `rgba(48,56,36,${0.05 + rnd() * 0.14})`;
      c.fillRect(rnd() * n, n * 0.4 + rnd() * n * 0.6, 3 + rnd() * 11, 18 + rnd() * 150);
    }
  }, 256);
  const dampMat = new THREE.MeshStandardMaterial({
    map: dampTex, transparent: true, depthWrite: false, roughness: 0.52,
    polygonOffset: true, polygonOffsetFactor: -1
  });
  for (const x of [-9.95, 9.95]) {
    mesh(new THREE.PlaneGeometry(19.7, 1.75), dampMat, [x, 0.72, -26.0], root, false, [0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]);
  }

  // Light #5: South Bulkhead Status Beacon (culled when unpowered!)
  const emergency = new THREE.PointLight(0xd94b2b, 0, 12, 2);
  emergency.position.set(0, 3.25, -35.4);
  emergency.visible = false;
  root.add(emergency);
  const emergencyMat = new THREE.MeshStandardMaterial({ color: 0x5c241b, emissive: 0xd94322, emissiveIntensity: 0.15 });
  mesh(new THREE.SphereGeometry(0.11, 10, 8), emergencyMat, [0, 3.32, -35.6], root, false);

  // ============================================================================
  // ROOM 4: TERMINAL CONTROL ROOM (04 / 末端控制室, x: -6..6, z: -50..-36, y: 0)
  // ============================================================================
  activeRoom = 'control';
  box(12.2, 0.30, 14.2, [0, -0.16, -43.0], mat.wetFloor);
  wall(0.42, 4.0, 14.2, [-6.15, 1.90, -43.0]);
  wall(0.42, 4.0, 14.2, [6.15, 1.90, -43.0]);
  wall(12.4, 1.22, 0.42, [0, 0.56, -50.0]);
  wall(12.4, 0.72, 0.42, [0, 3.58, -50.0]);
  wall(12.4, 2.1, 0.42, [0, 2.15, -50.25], mat.dark);
  for (let x = -4.5; x <= 4.5; x += 3.0) box(0.18, 2.1, 0.32, [x, 2.12, -49.9], mat.iron);
  box(12.6, 0.24, 14.4, [0, 3.92, -43.0], mat.concrete);
  for (const z of [-39.0, -43.0, -47.0]) box(12.0, 0.22, 0.24, [0, 3.72, z], mat.dark);

  label('04 / 末端自记控制室', 2.3, 0.40, [0, 3.32, -36.32], 0);

  // Stilling-Well Column & Animated Float Pulley
  solid(0.76, 3.8, 0.76, [-2.55, 1.9, -45.2]);
  cyl(0.34, 3.85, [-2.55, 1.88, -45.2], mat.cabinet, root, 20);
  for (const y of [0.55, 1.65, 2.75]) cyl(0.38, 0.07, [-2.55, y, -45.2], mat.iron, root, 20);
  label('07 测潮静水井\n连通海床引水管', 0.62, 0.24, [-2.55, 2.15, -44.82], 0, '#cfc6a8', '#253930');
  const wellPulley = new THREE.Group();
  wellPulley.position.set(-2.20, 1.62, -45.0);
  root.add(wellPulley);
  mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 18), mat.brass, [0, 0, 0], wellPulley, false);
  pipe([-0.11, 0, 0], [0.11, 0, 0], 0.014, mat.silver, wellPulley, false, 8);
  batchStaticChildren(wellPulley);
  pipe([-2.20, 1.74, -45.0], [-1.32, 1.18, -45.0], 0.008, mat.silver);

  const scopeTraceTex = canvasTex((c, n) => {
    c.fillStyle = '#0c1c18';
    c.fillRect(0, 0, n, n);
    c.strokeStyle = 'rgba(72,140,115,0.25)';
    c.lineWidth = 2;
    for (let i = 0; i <= n; i += n / 8) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, n); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(n, i); c.stroke();
    }
    c.strokeStyle = '#6ad49f';
    c.lineWidth = 4;
    c.beginPath();
    for (let x = 0; x < n; x++) {
      const y = n * 0.5 + Math.sin(x * 0.07) * 28 * Math.exp(-Math.pow((x - n * 0.5) / 70, 2));
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }, 128);
  const scopeMat = new THREE.MeshBasicMaterial({ map: scopeTraceTex });

  for (const x of [-4.6, 4.6]) {
    solid(1.24, 2.24, 0.68, [x, 1.12, -47.2]);
    rounded(1.22, 2.22, 0.64, 0.05, [x, 1.11, -47.2], mat.cabinet);
    mesh(new THREE.PlaneGeometry(0.46, 0.34), scopeMat, [x - 0.22, 1.56, -46.86]);
    dialGauge([x + 0.28, 1.56, -46.87], 0, 0.13);
    for (const y of [0.65, 1.08]) {
      label(x < 0 ? '声呐水听阵列 / CH-1' : '静水井浮子遥测 / 07', 0.88, 0.20, [x, y, -46.87], 0, '#bcc8b4', '#22362d');
      for (let n = 0; n < 4; n++) cyl(0.032, 0.03, [x - 0.30 + n * 0.20, y - 0.18, -46.86], mat.black, root, 10, true, [Math.PI / 2, 0, 0]);
    }
  }

  // Light #6: Control Room & Tide Chart Recorder Calibrated Warm Light (crisp ink contrast, zero overexposure!)
  const controlLamp = pendantLight([-0.22, 3.25, -44.3], true, 24, 13, 0.35);

  // Hero Instrument: 07 Tide Chart Recorder (`machine`)
  solid(2.7, 1.2, 1.4, [0, 0.6, -45.0]);
  const machine = new THREE.Group();
  machine.position.set(0, 0.9, -45.0);
  root.add(machine);

  box(2.72, 0.12, 1.42, [0, -0.05, 0], mat.cabinet, machine, false);
  for (const x of [-1.18, 1.18]) {
    for (const z of [-0.52, 0.52]) box(0.09, 0.86, 0.09, [x, -0.53, z], mat.dark, machine, false);
  }
  pipe([-1.18, -0.68, 0.52], [1.18, -0.68, 0.52], 0.028, mat.dark, machine, false);
  rounded(2.46, 0.82, 0.26, 0.05, [0, 0.38, -0.58], mat.paint, machine, false);

  const chartTexture = canvasTex((c, n) => {
    c.fillStyle = '#c2b596';
    c.fillRect(0, 0, n, n);
    for (let i = 0; i <= n; i += n / 32) {
      c.strokeStyle = i % (n / 8) === 0 ? '#8c6b58' : '#aa9c7f';
      c.lineWidth = i % (n / 8) === 0 ? 1.8 : 0.7;
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i, n);
      c.moveTo(0, i); c.lineTo(n, i);
      c.stroke();
    }
    c.save();
    c.setLineDash([10, 8]);
    c.strokeStyle = '#8b3729';
    c.lineWidth = 2.2;
    c.beginPath();
    for (let y = 0; y < n; y += 4) {
      const x = n * 0.36 - 55 * Math.cos((y / n) * Math.PI);
      if (y === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.restore();

    c.strokeStyle = '#122429';
    c.lineWidth = 3.8;
    c.beginPath();
    for (let y = 0; y < n; y++) {
      const f = y / n;
      const x = n * 0.44 + 86 * f + 24 * Math.sin(y * 0.032) + 7 * Math.sin(y * 0.19);
      if (y === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = '#20352e';
    c.font = 'bold 16px monospace';
    c.fillText('STA-07 / TIDAL RECORD / 04:00-04:17', 20, 26);
  }, 512);
  chartTexture.wrapS = chartTexture.wrapT = THREE.RepeatWrapping;

  const paperMat = new THREE.MeshStandardMaterial({ map: chartTexture, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
  const platen = box(2.02, 0.045, 0.90, [0, 0.388, 0.04], mat.dark, machine, false);
  platen.rotation.x = 0.164;
  const chart = mesh(new THREE.PlaneGeometry(1.91, 0.893), paperMat, [0, 0.418, 0.04], machine, false);
  chart.rotation.x = -Math.PI / 2 + 0.164;

  const rolls = [];
  let collectibleRoll = null;
  for (const [idx, [z, y, r]] of [[-0.4, 0.405, 0.085], [0.48, 0.245, 0.105]].entries()) {
    const roll = cyl(r, 1.92, [0, y, z], mat.paper, machine, 32, false, [0, 0, Math.PI / 2]);
    rolls.push(roll);
    if (idx === 1) collectibleRoll = roll;
    pipe([-1.23, y, z], [1.23, y, z], 0.027, mat.silver, machine, false);
    for (const x of [-1.05, 1.05]) {
      cyl(r + 0.035, 0.025, [x, y, z], mat.dark, machine, 20, false, [0, 0, Math.PI / 2]);
      cyl(0.055, 0.055, [x * 1.065, y, z], mat.silver, machine, 16, false, [0, 0, Math.PI / 2]);
      rounded(0.13, y + 0.05, 0.13, 0.02, [x, y / 2 - 0.015, z], mat.paint, machine, false);
    }
  }
  pipe([-1.12, 0.435, 0.37], [1.12, 0.435, 0.37], 0.018, mat.silver, machine, false);
  for (const x of [-0.79, 0, 0.79]) {
    const tyre = cyl(0.07, 0.09, [x, 0.435, 0.37], mat.rubber, machine, 20, false, [0, 0, Math.PI / 2]);
    rolls.push(tyre);
    pipe([x, 0.45, 0.37], [x, 0.53, 0.21], 0.012, mat.silver, machine, false);
  }
  for (const x of [-1.15, 1.15]) pipe([x, 0.23, 0.43], [x, 0.435, 0.37], 0.025, mat.dark, machine, false);

  pipe([-0.94, 0.59, -0.25], [0.94, 0.59, -0.25], 0.021, mat.silver, machine, false);
  for (const x of [-0.94, 0.94]) pipe([x, 0.48, -0.25], [x, 0.59, -0.25], 0.025, mat.dark, machine, false);
  const penArm = new THREE.Group();
  penArm.position.set(0, 0.59, -0.25);
  machine.add(penArm);
  rounded(0.16, 0.09, 0.10, 0.015, [0, 0, 0], mat.dark, penArm, false);
  pipe([0, 0, 0], [0, -0.10, 0.28], 0.013, mat.brass, penArm, false);
  cyl(0.035, 0.065, [0, -0.09, 0.28], mat.dark, penArm, 16, false);
  pipe([0, -0.10, 0.28], [0, -0.168, 0.30], 0.008, mat.rust, penArm, false);
  batchStaticChildren(penArm);

  for (const x of [-0.99, 0.99]) pipe([x, 0.49, -0.39], [x, 0.345, 0.49], 0.012, mat.silver, machine, false);
  box(2.05, 0.018, 0.08, [0, 0.16, 0.61], mat.brass, machine, false);

  const toggle = box(0.065, 0.26, 0.065, [1.0, 0.60, -0.38], mat.rust, machine, false);
  toggle.rotation.x = -0.5;
  rounded(0.17, 0.33, 0.035, 0.045, [1.0, 0.59, -0.405], mat.dark, machine, false);
  label('海岸潮汐自记仪 / 07\n连续走纸 · 严禁空转', 1.25, 0.25, [0, 0.65, -0.435], 0, '#d3c8aa', '#213b31', machine, false);

  // Shielded task lamp fixture on machine (visual bulb glow; lit cleanly by controlLamp above!)
  pipe([-1.15, 0.05, -0.50], [-1.15, 1.15, -0.50], 0.026, mat.dark, machine, false);
  pipe([-1.15, 1.15, -0.50], [-0.65, 1.15, -0.15], 0.026, mat.dark, machine, false);
  mesh(new THREE.ConeGeometry(0.17, 0.16, 18, 1, true), mat.cabinet, [-0.65, 1.13, -0.15], machine, false);
  mesh(new THREE.SphereGeometry(0.05, 10, 8), mat.bulbWarm, [-0.65, 1.06, -0.15], machine, false);

  rounded(0.36, 0.42, 0.38, 0.05, [1.05, 0.18, -0.12], mat.dark, machine, false);
  const drum = cyl(0.18, 0.23, [-1.34, 0.22, -0.39], mat.brass, machine, 20, false, [0, 0, Math.PI / 2]);
  rolls.push(drum);
  const lampBulb = mesh(
    new THREE.SphereGeometry(0.036, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x567a4e, emissive: 0x458032, emissiveIntensity: 0.6 }),
    [-0.95, 0.61, -0.40],
    machine,
    false
  );
  batchStaticChildren(machine, new Set([...rolls, chart, penArm, toggle, lampBulb]));
  interactables.push({ id: 'recorder-machine', pos: [0, 1.32, -44.55], mesh: machine, label: '启动 07 号潮汐自记仪' });

  // ============================================================================
  // SEPARATED INTERIOR FLOODWATER & EXTERIOR DAWN OCEAN SHADERS
  // ============================================================================
  const rings = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
  let ringIndex = 0, elapsed = 0;

  const uniforms = {
    uTime: { value: 0 },
    uRings: { value: rings },
    uTint: { value: color(0x091618) },
    uPower: { value: 0 },
    uQuality: { value: 1 }
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vP;
      varying vec3 vW;
      void main() {
        vP = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec4 uRings[8];
      uniform vec3 uTint;
      uniform float uPower;
      uniform float uQuality;
      varying vec3 vP;
      varying vec3 vW;

      float boxDist(vec2 p, vec2 c, vec2 b) {
        vec2 d = abs(p - c) - b;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }

      void main() {
        vec2 p = vW.xz;
        float ringGlow = 0.0;
        vec2 ringGrad = vec2(0.0);
        for (int i = 0; i < 8; i++) {
          float age = uTime - uRings[i].z;
          if (age >= 0.0 && age < 9.0) {
            vec2 dp = p - uRings[i].xy;
            float r = length(dp) + 0.001;
            float env = exp(-age * 0.52) * uRings[i].w;
            float crest = exp(-pow((r - age * 1.45) * 4.6, 2.0));
            float train = sin(r * 18.0 - age * 21.0) * exp(-pow((r - age * 1.45) * 2.2, 2.0));
            ringGlow += crest * env;
            ringGrad += (dp / r) * train * env * 0.085;
          }
        }

        vec3 n = normalize(vec3(
          cos(p.x * 2.3 + uTime * 0.65) * 0.032 + ringGrad.x,
          1.0,
          sin(p.y * 1.9 - uTime * 0.48) * 0.032 + ringGrad.y
        ));

        vec3 v = normalize(cameraPosition - vW);
        vec3 refl = reflect(-v, n);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.4);

        vec3 envRefl = vec3(0.04, 0.075, 0.09);
        if (uQuality > 0.5) {
          float ceilHitT = max(0.1, (6.5 - vW.y) / max(0.08, refl.y));
          vec2 hitXZ = p + refl.xz * ceilHitT;
          float trussBand = smoothstep(0.35, 0.75, abs(fract((hitXZ.y + 20.4) / 5.4) - 0.5) * 2.0);
          envRefl *= 0.65 + 0.35 * trussBand;

          float eastWindow = 1.0 - smoothstep(2.0, 18.0, length(hitXZ - vec2(8.5, -17.0)));
          envRefl += vec3(0.14, 0.22, 0.26) * eastWindow;

          float coolPool = exp(-length(hitXZ - vec2(2.2, -26.8)) * 0.18);
          float warmStair = exp(-length(hitXZ - vec2(-6.2, -22.2)) * 0.20) + exp(-length(hitXZ - vec2(8.5, -30.5)) * 0.26);
          float ctrlPool = exp(-length(hitXZ - vec2(-0.2, -44.3)) * 0.22);
          float emergPool = exp(-length(hitXZ - vec2(0.0, -35.4)) * 0.28) * uPower;
          envRefl += vec3(0.16, 0.26, 0.30) * coolPool
                   + vec3(0.30, 0.19, 0.09) * warmStair
                   + vec3(0.24, 0.18, 0.10) * ctrlPool
                   + vec3(0.32, 0.07, 0.04) * emergPool;
        }

        float wallD = (p.y > -36.0)
          ? min(10.0 - abs(p.x), min(abs(p.y - (-16.0)), abs(p.y - (-36.0))))
          : min(6.0 - abs(p.x), min(abs(p.y - (-36.0)), abs(p.y - (-50.0))));
        float obstD = min(
          min(boxDist(p, vec2(-2.0, -23.0), vec2(0.82, 0.92)), boxDist(p, vec2(6.5, -24.0), vec2(0.82, 0.92))),
          min(boxDist(p, vec2(-2.0, -32.0), vec2(0.82, 0.92)), boxDist(p, vec2(-6.5, -24.5), vec2(1.55, 4.8)))
        );
        float edgeD = min(wallD, obstD);
        float meniscus = exp(-max(0.0, edgeD) * 7.5);
        float shallowDark = smoothstep(0.0, 0.55, edgeD);

        vec3 baseCol = uTint * (0.68 + 0.32 * shallowDark);
        vec3 c = mix(baseCol, envRefl, 0.32 + fres * 0.58);
        c += vec3(0.18, 0.27, 0.25) * meniscus * 0.38;
        c += vec3(0.24, 0.36, 0.33) * min(1.3, ringGlow);

        float alpha = clamp(0.86 + meniscus * 0.10 + ringGlow * 0.08, 0.0, 0.96);
        gl_FragColor = vec4(c, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });

  const oceanUniforms = { uTime: { value: 0 } };
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    transparent: false,
    vertexShader: `
      uniform float uTime;
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += sin(w.x * 0.16 + uTime * 0.75) * 0.12 + cos(w.z * 0.11 - uTime * 0.52) * 0.08;
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float swell = sin(p.x * 0.26 + uTime * 0.85 + sin(p.y * 0.14) * 1.4) * 0.5 + 0.5;
        float chop = sin(p.x * 1.3 - p.y * 0.9 + uTime * 1.5) * 0.5 + 0.5;
        vec3 n = normalize(vec3(cos(p.x * 0.26 + uTime * 0.85) * 0.14, 1.0, sin(p.y * 0.21 - uTime * 0.6) * 0.09));
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 deep = vec3(0.055, 0.105, 0.135);
        vec3 skyRefl = vec3(0.24, 0.34, 0.39);
        vec3 c = mix(deep, skyRefl, fres * 0.78 + swell * 0.12);
        float staffFoam = exp(-length(p - vec2(16.0, -1.0)) * 0.85) * (0.5 + 0.5 * chop);
        float pierFoam = exp(-abs(p.x - 6.2) * 1.2) * step(-52.0, p.y) * step(p.y, 16.0) * chop * 0.35;
        c += vec3(0.32, 0.39, 0.40) * (staffFoam * 0.55 + pierFoam);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });

  const water = mesh(new THREE.PlaneGeometry(19.8, 19.9, 1, 1), waterMat, [0, 0.22, -26.0], root, false, [-Math.PI / 2, 0, 0]);
  const controlWater = mesh(new THREE.PlaneGeometry(11.9, 13.8, 1, 1), waterMat, [0, 0.12, -43.0], root, false, [-Math.PI / 2, 0, 0]);
  const ocean = mesh(new THREE.PlaneGeometry(250, 250, 36, 36), oceanMat, [105, -0.75, -24.0], root, false, [-Math.PI / 2, 0, 0]);
  ocean.castShadow = false;
  water.castShadow = false;
  controlWater.castShadow = false;

  const threat = new THREE.Group();
  threat.visible = false;
  threat.position.set(4, 0.22, -24);
  root.add(threat);
  const shadow = mesh(
    new THREE.SphereGeometry(0.88, 20, 10),
    new THREE.MeshBasicMaterial({ color: 0x030a09, transparent: true, opacity: 0.78, depthWrite: false }),
    [0, -0.09, 0],
    threat,
    false
  );
  shadow.scale.set(1.15, 0.08, 2.05);
  const wake = mesh(
    new THREE.TorusGeometry(0.92, 0.022, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0x8cb4ab, transparent: true, opacity: 0.42, depthWrite: false }),
    [0, 0.016, 0],
    threat,
    false,
    [Math.PI / 2, 0, 0]
  );
  wake.scale.set(1, 1.45, 1);
  const outerWake = mesh(
    new THREE.TorusGeometry(1.45, 0.012, 6, 40),
    new THREE.MeshBasicMaterial({ color: 0x678f87, transparent: true, opacity: 0.22, depthWrite: false }),
    [0, 0.012, 0],
    threat,
    false,
    [Math.PI / 2, 0, 0]
  );

  // Room-scoped static geometry merging
  const roomGroups = new Map();
  for (const rName of ['entry', 'bridge', 'pump', 'control', 'exterior']) {
    const g = new THREE.Group();
    g.name = `room-${rName}`;
    root.add(g);
    roomGroups.set(rName, g);
  }
  for (const { room, material, list } of roomBatches.values()) {
    if (!list.length) continue;
    const targetGroup = roomGroups.get(room) || root;
    try {
      const merged = mergeGeometries(list, false);
      if (merged) {
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const m = new THREE.Mesh(merged, material);
        m.castShadow = !material.transparent && room !== 'exterior';
        m.receiveShadow = true;
        targetGroup.add(m);
      }
    } catch (e) {
      console.warn('Room geometry batch fallback:', room, e);
      for (const geo of list) targetGroup.add(new THREE.Mesh(geo, material));
    }
  }

  // ============================================================================
  // COMPLETE INITIAL POSE SNAPSHOT & RESET
  // ============================================================================
  const initialRollRotations = rolls.map(r => r.quaternion.clone());
  const initialPenPosition = penArm.position.clone();
  const initialWellPulleyQuat = wellPulley.quaternion.clone();
  const initialDeskReelQuats = deskRecObj.reels.map(r => r.quaternion.clone());
  const initialPortableReelQuats = portableObj.reels.map(r => r.quaternion.clone());

  let bellSwing = 0;
  let pipeVibe = 0;
  let lastActionSeen = -1;

  function reset() {
    elapsed = 0;
    ringIndex = 0;
    bellSwing = 0;
    pipeVibe = 0;
    lastActionSeen = -1;
    uniforms.uTime.value = 0;
    uniforms.uPower.value = 0;
    oceanUniforms.uTime.value = 0;
    rings.forEach(r => r.set(0, 0, -100, 0));

    rolls.forEach((r, i) => r.quaternion.copy(initialRollRotations[i]));
    penArm.position.copy(initialPenPosition);
    wellPulley.quaternion.copy(initialWellPulleyQuat);
    deskRecObj.reels.forEach((r, i) => r.quaternion.copy(initialDeskReelQuats[i]));
    portableObj.reels.forEach((r, i) => r.quaternion.copy(initialPortableReelQuats[i]));
    knockPipes.forEach((kp, idx) => { kp.position.x = kpBaseX[idx]; });

    chartTexture.offset.set(0, 0);
    if (collectibleRoll) collectibleRoll.visible = true;
    chart.visible = true;

    latchHandle.rotation.set(0, 0, 0);
    slidingWin.position.z = 4.95;
    bellBody.rotation.set(0, 0, 0);
    gate.rotation.y = 0;
    southDoor.position.y = 0;
    southDoorCollider.minY = 0;
    southDoorCollider.maxY = 2.95;
    inletWheelGroup.rotation.z = 0;
    inletStem.position.z = 0.02;
    inletGauge.needle.rotation.z = 1.1;
    valveWheelGroup.rotation.z = 0;
    valveGauge.needle.rotation.z = 1.25;
    powerLever.rotation.x = -0.58;
    pwrGauge.needle.rotation.z = -0.8;
    powerPilotMat.color.setHex(0xb83e2c);
    powerPilotMat.emissive.setHex(0xc43622);
    eastPumpBeaconMat.emissiveIntensity = 2.2;

    ocean.position.y = -0.75;
    toggle.rotation.x = -0.5;
    lampBulb.material.emissiveIntensity = 0.6;
    controlLamp.intensity = 24;
    emergency.intensity = 0;
    emergency.visible = false;
    emergencyMat.emissiveIntensity = 0.15;
    entryLamp.visible = true;
    bridgeLamp.visible = true;
    stairLamp.visible = false;
    pumpLamp.visible = false;
    controlLamp.visible = false;
    placementPreview.visible = false;
    tutRangeRing.visible = false;
  }

  function addRipple(pos, strength = 1) {
    rings[ringIndex].set(pos.x ?? pos[0], pos.z ?? pos[2], elapsed, strength);
    ringIndex = (ringIndex + 1) % rings.length;
  }

  function update(dt, state = {}) {
    elapsed += dt;
    const lowQ = state.quality === 0;
    uniforms.uTime.value = elapsed;
    oceanUniforms.uTime.value = elapsed;
    uniforms.uQuality.value = lowQ ? 0 : 1;

    // Dynamic zone-based PointLight culling to minimize per-fragment PBR light evaluations
    const pz = state.player?.z ?? 5;
    const isPowered = !!(state.power || state.powered);
    entryLamp.visible = pz > -16;
    bridgeLamp.visible = !lowQ && pz > -24 && pz < 6;
    stairLamp.visible = pz < -8 && pz > -40;
    pumpLamp.visible = pz < -10;
    emergency.visible = isPowered && pz < -16;
    emergency.intensity = emergency.visible ? 14 : 0;
    controlLamp.visible = pz < -24;

    const fb = state.lastActionFeedback;
    if (fb && fb.time !== lastActionSeen) {
      lastActionSeen = fb.time;
      if (fb.id === 'bell') bellSwing = 0.36;
      if (fb.id === 'pipe' || fb.id === 'terminal-pipe') pipeVibe = 0.024;
    }

    const winOpen = (state.phase ?? 0) >= 1;
    const targetLatchRot = winOpen ? -Math.PI * 0.48 : 0;
    const targetWinZ = winOpen ? 5.92 : 4.95;
    latchHandle.rotation.x = dt === 0 ? targetLatchRot : THREE.MathUtils.damp(latchHandle.rotation.x, targetLatchRot, 8, dt);
    slidingWin.position.z = dt === 0 ? targetWinZ : THREE.MathUtils.damp(slidingWin.position.z, targetWinZ, 4.5, dt);

    if (Math.abs(bellSwing) > 0.001) {
      bellSwing *= Math.pow(0.22, dt);
      bellBody.rotation.z = Math.sin(elapsed * 13.5) * bellSwing;
    } else {
      bellBody.rotation.z = 0;
    }

    if (pipeVibe > 0.0005) {
      pipeVibe *= Math.pow(0.08, dt);
      const offset = Math.sin(elapsed * 48) * pipeVibe * 0.15;
      knockPipes.forEach((kp, idx) => { kp.position.x = kpBaseX[idx] + offset; });
    } else {
      knockPipes.forEach((kp, idx) => { kp.position.x = kpBaseX[idx]; });
    }

    const targetGateRot = (state.phase ?? 0) >= 3 ? -Math.PI * 0.52 : 0;
    gate.rotation.y = dt === 0 ? targetGateRot : THREE.MathUtils.damp(gate.rotation.y, targetGateRot, 3.4, dt);
    const doorOpen = isPowered && !!state.valve;
    const targetDoorY = doorOpen ? 2.88 : 0;
    southDoor.position.y = dt === 0 ? targetDoorY : THREE.MathUtils.damp(southDoor.position.y, targetDoorY, 3.2, dt);
    southDoorCollider.minY = southDoor.position.y;
    southDoorCollider.maxY = southDoor.position.y + 2.95;

    const inProg = state.inlet ? 5.5 : (state.inletProgress || 0);
    inletWheelGroup.rotation.z = -inProg * 2.25;
    inletStem.position.z = 0.02 + (inProg / 5.5) * 0.08;
    inletGauge.needle.rotation.z = 1.1 - (inProg / 5.5) * 1.85;

    const valProg = state.valve ? 7.0 : (state.valveProgress || 0);
    valveWheelGroup.rotation.z = -valProg * 2.15;
    valveGauge.needle.rotation.z = 1.25 - (valProg / 7.0) * 2.05;
    eastPumpBeaconMat.emissiveIntensity = state.valve ? 0.05 : (1.5 + Math.sin(elapsed * 4.5) * 0.8);

    const pwrProg = isPowered ? 4.0 : (state.powerProgress || 0);
    const targetLeverRot = isPowered ? 0.58 : (-0.58 + (pwrProg / 4.0) * 0.95);
    powerLever.rotation.x = THREE.MathUtils.damp(powerLever.rotation.x, targetLeverRot, 10, dt);
    pwrGauge.needle.rotation.z = isPowered ? 0.85 : -0.8;
    if (isPowered) {
      powerPilotMat.color.setHex(0x6ec97a);
      powerPilotMat.emissive.setHex(0x4cb85b);
    } else {
      powerPilotMat.color.setHex(0xb83e2c);
      powerPilotMat.emissive.setHex(0xc43622);
    }

    const running = !!(state.motorRunning || state.motor || state.motorActive);
    if (running) {
      chartTexture.offset.y -= dt * 0.048;
      rolls.forEach(r => r.rotateY(dt * 1.85));
      wellPulley.rotation.z += dt * 1.2;
      penArm.position.x = Math.sin(elapsed * 0.85) * 0.32 + Math.sin(elapsed * 18) * 0.008;
      toggle.rotation.x = 0.5;
    } else {
      toggle.rotation.x = -0.5;
    }
    if (collectibleRoll) collectibleRoll.visible = !state.paper;
    chart.visible = !state.paper;
    lampBulb.material.emissiveIntensity = running ? 2.8 : 0.5;

    const flickering = state.flickerUntil && (state.time || 0) < state.flickerUntil;
    controlLamp.intensity = flickering ? (7 + Math.sin(elapsed * 43) * 6) : 24;

    const isReplaying = !!(state.device && state.time >= state.device.at && !state.device.done);
    const isCountdown = !!(state.device && state.time < state.device.at);
    if (isReplaying) {
      portableObj.reels.forEach(r => { r.rotation.y -= dt * 3.8; });
      portableObj.ledMat.color.setHex(Math.sin(elapsed * 10) > 0 ? 0xf2b84b : 0xd95338);
    } else if (isCountdown) {
      portableObj.ledMat.color.setHex(Math.sin(elapsed * 16) > 0 ? 0xe8c96b : 0x3b4a3e);
    } else {
      portableObj.ledMat.color.setHex(0x7ec878);
    }
    deskRecObj.ledMat.color.setHex(0x7ec878);

    if (state.placementPreview && !state.paused) {
      placementPreview.visible = true;
      placementPreview.position.set(state.placementPreview.x, state.placementPreview.y, state.placementPreview.z);
      placementPreview.rotation.y = state.yaw || 0;
      ghostRing.scale.setScalar(1 + Math.sin(elapsed * 3.5) * 0.05);
    } else {
      placementPreview.visible = false;
    }

    if (state.device && state.phase === 2 && !state.device.done) {
      tutRangeRing.visible = true;
      tutRangeRing.position.set(state.device.pos.x, state.device.pos.y + 0.028, state.device.pos.z);
    } else {
      tutRangeRing.visible = false;
    }

    ocean.position.y = THREE.MathUtils.damp(ocean.position.y, state.ended ? -2.15 : -0.75, 1.0, dt);
    const y = state.waterLevel ?? (0.18 + (isPowered ? 0.12 : 0));
    water.position.y = y;
    controlWater.position.y = Math.max(0.05, y - 0.08);
    threat.position.y = y + 0.022;
    uniforms.uPower.value = isPowered ? 1 : 0;
    emergencyMat.emissiveIntensity = isPowered ? 2.2 : 0.15;

    const beaconPulse = Math.pow(Math.max(0, Math.sin(elapsed * 1.05)), 8);
    beaconBulbMat.color.setRGB(0.35 + 0.65 * beaconPulse, 0.25 + 0.52 * beaconPulse, 0.12 + 0.28 * beaconPulse);
    beaconGlow.scale.setScalar(0.85 + beaconPulse * 0.55);

    wake.scale.set(1 + Math.sin(elapsed * 2.6) * 0.08, 1.45 + Math.cos(elapsed * 2.2) * 0.08, 1);
    outerWake.scale.setScalar(1 + Math.cos(elapsed * 1.9) * 0.10);
  }

  return {
    root,
    update,
    reset,
    setLanguage,
    southDoor,
    recorder,
    portable,
    threat,
    water,
    interactables,
    colliders,
    addRipple,
    machine,
    penArm,
    rolls,
    gauge,
    lights: { entryLamp, bridgeLamp, stairLamp, pumpLamp, controlLamp, emergency },
    fixedViews: {
      entry: { pos: [1.35, 4.63, 5.45], look: [4.2, 4.35, 4.1] },
      bridge: { pos: [0.25, 4.63, -2.2], look: [0.4, 4.15, -11.5] },
      pump: { pos: [0.85, 4.63, -16.9], look: [1.4, 1.15, -26.5] },
      machine: { pos: [0.65, 1.63, -43.55], look: [0, 1.15, -45.0] }
    }
  };
}
