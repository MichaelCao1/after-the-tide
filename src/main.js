import * as THREE from 'three';
import './style.css';
import { Game, V, distance } from './game.js';
import { SAVE_KEY, milestone, makeSave, parseSave, loadCheckpoint, stages, stageNames } from './save.js';
import { GameAudio } from './audio.js';
import { createWorld } from './world.js';
import { pickBestInteractable } from './interaction.js';
import { t, getLanguage, setLanguage } from './i18n.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
// Keep authored source copy separate from the displayed language. Controls themselves
// are never replaced, so changing language preserves event handlers and saved progress.
const staticTranslations = [...document.querySelectorAll('[data-i18n]')]
  .map(el => ({ el, source: el.innerHTML.trim() }));
function renderStaticLanguage() {
  for (const { el, source } of staticTranslations) el.innerHTML = t(source);
  document.documentElement?.setAttribute?.('lang', getLanguage());
  document.title = t('退潮之后 · 第 07 号海岸潮汐观测站');
  canvas.setAttribute?.('aria-label', t('第一人称海岸观测站游戏画面'));
  $('language').value = getLanguage();
  $('menuSubtitle').textContent = getLanguage() === 'en'
    ? 'STATION 07 · COASTAL ARCHIVE' : 'AFTER THE TIDE';
}
renderStaticLanguage();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('menuText').textContent = t('无法启动 WebGL 2。请使用支持硬件加速的桌面浏览器。');
  $('start').disabled = true;
  throw e;
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, 0.06, 260);
camera.rotation.order = 'YXZ';

const world = createWorld(scene);
const idMap = {
  'pump-valve': 'valve',
  'power-switch': 'power',
  'recorder-machine': 'machine',
  'pickup-recorder': 'pickup'
};
world.interactables.forEach(i => { i.id = idMap[i.id] || i.id; });
if (!world.interactables.some(x => x.id === 'gate')) {
  world.interactables.push({ id: 'gate', pos: [0, 3.85, -15.65], label: '泵房检修栅门' });
}
world.threat.visible = false;

let paused = true;
let started = false;
let focused = true;
let hadPointerLock = false;
const keys = new Set();
let quietWalk = false; // Single consistent source from KeyboardEvent.getModifierState('CapsLock')
let last = performance.now();
let noticeUntil = 0;
let noticeSource = '';
let captionSource = null;
let captionUntil = 0;
let captionPriority = 0;
let resumeGeneration = 0;
let menuMode = 'title';
let interact = null;
let failedShown = false;
let endingShown = false;
let endingElapsed = 0;
let pulseUntil = 0;
let titleTime = 0;

const settings = { quality: 1, volume: 0.7, sensitivity: 1, brightness: 1, captions: true, reduce: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('tide-settings') || '{}'));
} catch {}

let game;
const audio = new GameAudio((text, pos, kind) => {
  if (!settings.captions || !game) return;
  const priority = ['threat', 'submerged', 'motor', 'pump', 'countdown', 'recorded', 'place', 'detent', 'breaker'].includes(kind) ? 2 : 1;
  if (game.time < captionUntil && priority < captionPriority) return;
  captionPriority = priority;
  let dir = '附近';
  if (pos) {
    const dx = pos.x - game.player.x;
    const dz = pos.z - game.player.z;
    const right = dx * Math.cos(game.yaw) - dz * Math.sin(game.yaw);
    const front = -dx * Math.sin(game.yaw) - dz * Math.cos(game.yaw);
    dir = Math.abs(right) > Math.abs(front) ? (right > 0 ? '右侧' : '左侧') : (front > 0 ? '前方' : '身后');
    if (pos.y < game.player.y - 1.7) dir = '楼板下方';
  }
  captionSource = { dir, text };
  $('caption').textContent = `〔${t(dir)}〕 ${t(text)}`;
  captionUntil = game.time + 3.0;
});

game = new Game(
  e => {
    audio.emit(e.type, e.pos, {
      strength: e.strength,
      replay: e.replay,
      occluded: e.pos.y < game.player.y - 1.8
    });
    if (['knock', 'pump', 'metal', 'splash', 'motor', 'threat', 'submerged', 'wheel'].includes(e.type)) {
      world.addRipple(e.pos, Math.min(1.4, e.strength * 0.5));
    }
  },
  (s, d) => {
    noticeSource = s;
    $('notice').textContent = t(s);
    noticeUntil = (game?.time || 0) + d;
  }
);
game.colliders = world.colliders;

let savedRun = null;
let lastSavedStage = null;
let storageFailed = false;
try {
  savedRun = parseSave(localStorage.getItem(SAVE_KEY));
} catch {
  storageFailed = true;
}

function refreshSaveUI() {
  $('continue').hidden = menuMode !== 'title' || !savedRun;
  $('saveStatus').textContent = storageFailed
    ? t('当前浏览器环境限制本地存储；本页内仍可使用安全检查点恢复。')
    : savedRun
      ? `${t('自动存档就绪')} · ${t(stageNames[stages.indexOf(savedRun.stage)])}`
      : t('完成关键阀门、供电与取纸操作时自动保存进度。');
}

function saveMilestone() {
  if (!started || game.failed) return;
  const stage = milestone(game);
  if (stage === lastSavedStage) return;
  lastSavedStage = stage;
  const data = stage ? makeSave(game) : null;
  // Always update in-memory checkpoint BEFORE storage write so storage denial never loses session checkpoint!
  savedRun = data;
  try {
    if (data) {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(SAVE_KEY);
    }
  } catch {
    if (!storageFailed) game.notice('浏览器无法写入本地存档，请勿关闭标签页；内存检查点仍有效。', 7);
    storageFailed = true;
  }
}

function discardSave() {
  savedRun = null;
  lastSavedStage = null;
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}
refreshSaveUI();

function currentRoomKey() {
  if (game.player.z > 0) return 'entry';
  if (game.player.z > -16) return 'bridge';
  if (game.player.z > -36) return 'pump';
  return 'control';
}

function locationLabel() {
  if (game.player.z > 0) return '01 / 入口值班室';
  if (game.player.z > -16) return '02 / 观潮廊桥';
  if (game.player.z > -36) return game.player.y > 1.5 ? '03 / 泵房上层步道' : '03 / 下层积水泵房';
  return '04 / 末端自记控制室';
}

function currentObjective() {
  switch (game.phase) {
    case 0:
      return '拨开东侧值班窗的窗扣（E），核对外海水位。';
    case 1:
      return '从值班桌上拿起便携录放机（E）。';
    case 2: {
      if (!game.clip.length) return '教学 1/3 · 走上廊桥敲击悬钟（E），立即按 R 录下声音。';
      if (!game.device) return '教学 2/3 · 走到廊桥南端栅门前，按 Q 将录放机放在地面。';
      const dist = distance(game.device.pos, game.player);
      if (dist <= 3.0) return `教学 3/3 · 退后离开录放机至少 3 米（当前 ${dist.toFixed(1)} 米）。`;
      return '教学 3/3 · 保持安静，等待 4 秒倒计时结束并听见回放。';
    }
    case 3:
      if (!game.inlet) return '下至泵房关闭 ① 西侧进水隔离阀（按住 E，三档自动锁止）。';
      if (!game.valve) return '用录放机诱开水下声源，前往东侧关闭 ② 泄压旁通阀（按住 E）。';
      return '返回泵房西侧电箱，合上 ③ 控制室供电开关（按住 E）。';
    case 4:
      return '穿过南侧防水门进入控制室。备好一段录音诱饵，再启动自记仪。';
    case 5:
      if (game.motorProgress < 24) {
        return `自记仪走纸中（${Math.ceil(24 - game.motorProgress)}s）· 在远处放置诱饵引开水下声源。`;
      }
      return '走纸已完成！确认水下声源远离机器后，按 E 取走记录纸。';
    case 6:
      return '沿原路返回入口值班窗（E），核对水位尺完成封站交接。';
    default:
      return '';
  }
}

const documents = {
  'note-entry': [
    '最后一班 / 封站交接单',
    '04:00，外海大退潮。去末端控制室取回 07 号潮汐自记仪上的最后一卷记录纸，核对窗外水位尺后即可封站。',
    '李师傅把声学联络用的便携磁带机留在了值班桌上。按 R 保存刚过去 6 秒内的声响，按 Q 放在地面——4 秒后它会在原地循环回放。',
    '交接补注：下层积水不通外海。听见水里有东西跟着你时，开启 Caps Lock 轻步慢走，千万别在浅水里奔跑。'
  ],
  'note-bridge': [
    '声学联络 / 廊桥试验规程',
    '站内检修停电期间，依靠敲击悬钟与传声管联络。钢格栅和积水会把大声响传遍整座下层泵房。',
    '磁带录好后可反复使用：敲钟 → 按 R 录音 → 走到目标点按 Q 放下 → 退开 3 米以上。靠近地面机器对准按 E 即可收回。',
    '背面铅笔字：如果楼板下面比你多走了一步，先停下来听清楚它的方向。'
  ],
  'note-pump': [
    '排水泵房 / 手动隔离与送电顺序',
    '① 先到西侧关闭进水隔离手轮。 ② 再到东侧关闭泄压旁通手轮。 ③ 最后回西侧电箱合上控制室供电开关。',
    '东侧辅泵 P-02 每隔数秒会残压排气发声，可先在干燥步道上观察水纹如何追随声源，再把录放机布置在相反一侧调虎离山。',
    '两只手轮均装有止回棘爪，每转满一档自动卡死，松手绝不回退。听见水声逼近立刻松手退回西侧干燥楼梯，安全后再继续。'
  ]
};

let noteOpen = false;
let openDocumentId = null;

function clearHeldInputs() {
  keys.clear();
  if (game) game.updateHold('', 0);
}

function showDocument(id) {
  const d = documents[id];
  if (!d) return;
  resumeGeneration++;
  noteOpen = true;
  paused = true;
  hadPointerLock = false;
  clearHeldInputs();
  audio.setPaused(true);
  document.exitPointerLock?.();
  openDocumentId = id;
  renderDocumentCopy();
  $('documentPanel').hidden = false;
  $('closeDocument').focus();
}

function renderDocumentCopy() {
  const copy = documents[openDocumentId];
  if (!copy) return;
  $('documentTitle').textContent = t(copy[0]);
  $('documentText').replaceChildren(...copy.slice(1).map(source => {
    const p = document.createElement('p');
    p.textContent = t(source);
    return p;
  }));
}

$('closeDocument').onclick = () => {
  noteOpen = false;
  openDocumentId = null;
  $('documentPanel').hidden = true;
  resume();
};

function deathGuidanceHtml(reason) {
  const tips = {
    'self-bait': '你留在了正在回放的录放机旁。<br><small>应对方法：按 Q 放下录放机后，趁 4 秒倒计时迅速撤离原位，让水下声源扑向机器而非你。</small>',
    sprint: '涉水奔跑激起了剧烈水花，直接暴露了你的位置。<br><small>应对方法：在下层积水区松开 Shift，按 Caps Lock 切换轻步慢走，或退上西侧干燥楼梯。</small>',
    hold: '持续转动机械的金属声将它引到了脚边。<br><small>应对方法：阀门每满一档会自动锁住不回退。看见水纹逼近时立刻松开 E 退回干燥楼梯，或先在远处放诱饵。</small>',
    machine: '走纸电机正吸引着水下声源守在机器下方。<br><small>应对方法：先在控制室东侧回流管敲击录音，把录放机放在远离自记仪的一角，等水纹移开再去取纸。</small>',
    water: '水下声源循着声响追上了你。<br><small>应对方法：西侧钢楼梯与上层格栅是绝对安全的干燥高处；用 Q 放置回放诱饵可调开它。</small>'
  };
  return tips[reason] || tips.water;
}

function showMenu(mode) {
  resumeGeneration++;
  noteOpen = false;
  $('documentPanel').hidden = true;
  paused = true;
  hadPointerLock = false;
  menuMode = mode;
  refreshSaveUI();
  clearHeldInputs();
  audio.setPaused(true);
  document.exitPointerLock?.();
  $('menu').classList.remove('hidden');
  $('hud').style.opacity = mode === 'pause' ? '0.35' : '0';
  $('start').hidden = mode === 'death' || mode === 'ending';
  $('checkpoint').hidden = mode !== 'death';
  $('restart').hidden = mode === 'title';
  renderMenuCopy();
}

// Copy-only rendering deliberately avoids showMenu(): no pause, input, audio or
// checkpoint state changes are needed when selecting another language.
function renderMenuCopy() {
  const mode = menuMode;
  $('start').textContent = t(mode === 'pause' ? '继续值班' : '进入观测站');

  if (mode === 'title') {
    $('menuText').innerHTML = t('凌晨四点，封站前最后一次交接。<br>外海的潮水已经退尽，站里的积水却还在往上涨。');
  } else if (mode === 'pause') {
    $('menuText').innerHTML = t('值班已暂停。<br><small>环境声音、磁带倒计时与水下移动均已冻结。</small>');
  } else if (mode === 'death') {
    $('menuText').innerHTML = t(deathGuidanceHtml(game.deathReason));
  } else if (mode === 'ending') {
    $('menuText').innerHTML = t('04:17 · 最后一卷潮汐记录已封存<br><br>自记仪纸带上的水线一路向上，从未随海潮回落。<br>值班窗外，退潮后的水位尺早已露出全部刻痕。<br>尺子背面，传来了湿重的一步。<br><br><small>《退潮之后》 · 感谢完成第 07 号站最后一次值班</small>');
  }
}

async function resume() {
  const attempt = ++resumeGeneration;
  if (document.hidden || innerWidth < 900 || innerHeight < 560) {
    if (started) showMenu('pause');
    return;
  }
  if (!started) {
    started = true;
    game.notice('先拨开东侧值班窗的窗扣（对准按 E）。鼠标或方向键可环顾。', 7);
  }
  try {
    const ok = await audio.unlock();
    if (!ok) {
      settings.captions = true;
      $('captions').checked = true;
      game.notice('当前环境音频受限，已自动开启方向字幕；水面波纹同样指示声源位置。', 7);
    }
  } catch (err) {
    settings.captions = true;
    $('captions').checked = true;
    console.warn('Audio unlock skipped:', err);
  }
  if (attempt !== resumeGeneration || document.hidden || innerWidth < 900 || innerHeight < 560) {
    audio.setPaused(true);
    if (!noteOpen && menuMode !== 'death' && menuMode !== 'ending') showMenu('pause');
    return;
  }
  audio.setVolume(settings.volume);
  audio.setPaused(false);
  paused = false;
  focused = true;
  $('menu').classList.add('hidden');
  $('hud').style.opacity = '1';
  last = performance.now();
  try {
    await canvas.requestPointerLock?.();
    if (document.pointerLockElement === canvas) hadPointerLock = true;
  } catch {}
}

function clearRunFeedback() {
  audio.stop();
  world.reset();
  captionUntil = 0;
  captionPriority = 0;
  noticeUntil = 0;
  noticeSource = '';
  captionSource = null;
  interact = null;
  $('caption').textContent = '';
  $('prompt').textContent = '';
  $('promptSub').textContent = '';
  $('dangerAlert').hidden = true;
  clearHeldInputs();
}

$('continue').onclick = () => {
  if (!savedRun) return;
  clearRunFeedback();
  if (loadCheckpoint(game, savedRun)) {
    started = true;
    failedShown = false;
    endingShown = false;
    endingElapsed = 0;
    lastSavedStage = milestone(game);
    resume();
  }
};

$('start').onclick = () => {
  if (!started) {
    discardSave();
    refreshSaveUI();
  }
  resume();
};

$('checkpoint').onclick = () => {
  clearRunFeedback();
  const deaths = game.stats.deaths + 1;
  if (savedRun && loadCheckpoint(game, savedRun)) {
    game.stats.deaths = deaths;
    lastSavedStage = milestone(game);
  } else {
    game.restore();
  }
  failedShown = false;
  endingShown = false;
  endingElapsed = 0;
  resume();
};

$('restart').onclick = () => {
  clearRunFeedback();
  discardSave();
  game.reset();
  failedShown = false;
  endingShown = false;
  endingElapsed = 0;
  resume();
};

function applyQuality() {
  renderer.setPixelRatio(settings.quality === 0 ? 0.68 : Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = settings.quality !== 0;
  scene.traverse(o => {
    if (o.material) {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.needsUpdate = true;
    }
  });
  renderer.setSize(innerWidth, innerHeight);
}
applyQuality();

for (const id of Object.keys(settings)) {
  if (id === 'language') continue; // Locale values are strings, not numeric settings.
  const el = $(id);
  if (!el) continue;
  if (el.type === 'checkbox') el.checked = settings[id];
  else el.value = settings[id];
  el.oninput = () => {
    settings[id] = el.type === 'checkbox' ? el.checked : Number(el.value);
    audio.setVolume(settings.volume);
    if (id === 'quality') applyQuality();
    renderer.toneMappingExposure = 1.08 * settings.brightness;
    try { localStorage.setItem('tide-settings', JSON.stringify(settings)); } catch {}
  };
}
renderer.toneMappingExposure = 1.08 * settings.brightness;

$('language').onchange = () => {
  setLanguage($('language').value);
  renderStaticLanguage();
  renderMenuCopy();
  refreshSaveUI();
  if (noteOpen) renderDocumentCopy();
  world.setLanguage?.();
  updateHud(performance.now());
};

function syncCapsLock(e) {
  if (e && typeof e.getModifierState === 'function') {
    quietWalk = !!e.getModifierState('CapsLock');
  }
}

addEventListener('keydown', e => {
  syncCapsLock(e);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (noteOpen && (e.code === 'Escape' || e.code === 'KeyE')) {
    if (!e.repeat) $('closeDocument').click();
    return;
  }
  if (e.code === 'Escape') {
    if (!paused && !e.repeat) showMenu('pause');
    return;
  }
  if (paused) return;
  keys.add(e.code);
  if (e.repeat) return;

  if (e.code === 'KeyR') {
    if (game.capture()) pulseUntil = performance.now() + 220;
    return;
  }
  if (e.code === 'KeyQ') {
    if (game.place()) pulseUntil = performance.now() + 220;
    return;
  }
  if (e.code === 'KeyE') {
    interact = pickBestInteractable(game, world.interactables, world.colliders, interact?.id || null);
    if (!interact) return;
    if (interact.state.mode === 'doc' && documents[interact.id]) {
      showDocument(interact.id);
    } else {
      const ok = game.act(interact.id, false);
      if (ok) pulseUntil = performance.now() + 220;
    }
  }
});

addEventListener('keyup', e => {
  syncCapsLock(e);
  keys.delete(e.code);
});

addEventListener('mousemove', e => {
  if (paused || document.pointerLockElement !== canvas) return;
  game.yaw -= e.movementX * 0.002 * settings.sensitivity;
  game.pitch = Math.max(-1.35, Math.min(1.35, game.pitch + e.movementY * 0.002 * settings.sensitivity));
});

canvas.addEventListener('click', () => {
  if (started && !paused && !document.pointerLockElement) {
    canvas.requestPointerLock?.().catch(() => {});
  }
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    hadPointerLock = true;
  } else if (hadPointerLock) {
    hadPointerLock = false;
    clearHeldInputs();
    if (started && !paused && !noteOpen) showMenu('pause');
  }
});

addEventListener('blur', () => {
  resumeGeneration++;
  focused = false;
  clearHeldInputs();
  if (started && !paused) showMenu('pause');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resumeGeneration++;
    clearHeldInputs();
    if (started && !paused) showMenu('pause');
  }
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (started && !paused && (innerWidth < 900 || innerHeight < 560)) showMenu('pause');
});

const flashlight = new THREE.SpotLight('#d8e6df', 4.8, 18, 0.52, 0.78, 1.45);
flashlight.castShadow = false;
scene.add(flashlight, flashlight.target);

const perf = [];
const roomPerf = { entry: [], bridge: [], pump: [], control: [] };
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Number(sorted[idx].toFixed(2));
}
function roomMetrics() {
  const out = {};
  for (const [k, list] of Object.entries(roomPerf)) {
    out[k] = list.length
      ? { samples: list.length, medianMs: percentile(list, 0.5), p95Ms: percentile(list, 0.95) }
      : { samples: 0, medianMs: 0, p95Ms: percentile(list, 0.95) };
  }
  return out;
}

let frameCount = 0;
let qa = null;
if (new URLSearchParams(location.search).has('qa')) {
  qa = document.createElement('pre');
  qa.id = 'qa';
  qa.style = 'position:absolute;right:12px;top:12px;font:11px/1.35 monospace;color:#dfece8;background:rgba(6,13,15,.82);padding:8px 10px;border:1px solid #48635d;pointer-events:none;z-index:5';
  document.body.append(qa);
}

function updateHud(now) {
  $('location').textContent = t(locationLabel());
  $('objective').textContent = t(currentObjective());

  const ch = $('crosshair');
  const pr = $('prompt');
  const ps = $('promptSub');
  const holdBar = $('hold');
  const holdFill = $('holdFill');
  const holdTicks = $('holdTicks');

  if (!paused && interact) {
    const st = interact.state;
    const activelyHolding = game.holding === interact.id && game.hold > 0;
    ch.className = activelyHolding
      ? 'holding'
      : now < pulseUntil
        ? 'focus pulse'
        : st.enabled
          ? 'focus'
          : st.completed
            ? ''
            : 'blocked';

    if (st.enabled) {
      const actionTag = st.mode === 'hold' ? '[ 按住 E ]' : '[ E ]';
      pr.textContent = `${t(actionTag)} ${t(st.label)}`;
      pr.className = '';
      ps.textContent = t(st.sublabel || '');
      ps.className = '';
    } else if (st.completed) {
      pr.textContent = t(st.label);
      pr.className = 'is-completed';
      ps.textContent = t(st.sublabel || '');
      ps.className = '';
    } else {
      pr.textContent = t(st.label);
      pr.className = 'is-blocked';
      ps.textContent = t(st.blockedReason || st.sublabel || '');
      ps.className = 'reason';
    }

    if (st.mode === 'hold' && st.holdTotal > 0) {
      const liveVal = activelyHolding ? game.hold : st.progress;
      holdBar.style.display = 'block';
      holdFill.style.width = `${Math.min(100, (liveVal / st.holdTotal) * 100)}%`;
      const notches = interact.id === 'power' ? [50] : [33.3, 66.6];
      holdTicks.innerHTML = notches.map(n => `<b style="left:${n}%"></b>`).join('');
    } else {
      holdBar.style.display = 'none';
    }
  } else {
    ch.className = now < pulseUntil ? 'pulse' : '';
    pr.textContent = '';
    ps.textContent = '';
    if (game.hold > 0) {
      const tot = game.holding === 'inlet' ? 5.5 : game.holding === 'valve' ? 7 : 4;
      holdBar.style.display = 'block';
      holdFill.style.width = `${Math.min(100, (game.hold / tot) * 100)}%`;
    } else {
      holdBar.style.display = 'none';
    }
  }

  const da = $('dangerAlert');
  if (!paused && game.danger > 0) {
    da.hidden = false;
    da.className = '';
    da.textContent = t('水纹就在脚下！立刻松手并退向干燥楼梯！');
  } else if (!paused && game.proximity > 0.25) {
    da.hidden = false;
    da.className = 'warn';
    da.textContent = t('水下声源正在靠近 —— 开启 Caps Lock 轻步慢走或布置诱饵');
  } else {
    da.hidden = true;
  }

  const sprinting = !paused && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const badge = $('moveBadge');
  if (sprinting) {
    badge.textContent = t('奔跑发声 [Shift]');
    badge.className = 'badge sprint';
  } else if (quietWalk) {
    badge.textContent = t('轻步慢走 [Caps]');
    badge.className = 'badge quiet';
  } else {
    badge.textContent = t('常步');
    badge.className = 'badge';
  }

  const tf = $('tapeFill');
  const tb = $('tapeBlips');
  const rs = $('recStatus');
  if (!game.hasRecorder) {
    $('recTitle').textContent = 'STATION 07 · SHIFT';
    tf.style.width = '0%';
    tb.innerHTML = '';
    rs.textContent = t('WASD 移动 · Shift 奔跑 · Caps 轻步 · E 交互');
  } else {
    $('recTitle').textContent = 'PORTABLE TAPE · 06s';
    const d = game.device;
    const loopLen = d?.loopLen || game.clipDuration || 6;
    tb.innerHTML = game.clip
      .map(c => `<i style="left:${Math.min(96, (c.time / loopLen) * 100)}%"></i>`)
      .join('');
    if (d) {
      if (game.time < d.at) {
        const rem = Math.max(0, d.at - game.time);
        tf.style.width = `${((4 - rem) / 4) * 100}%`;
        rs.textContent = t(`倒计时 ${rem.toFixed(1)}s 后原地回放 · 趁现在离开`);
      } else if (!d.done) {
        const rem = Math.max(0, d.end - game.time);
        const cyc = ((game.time - d.at) % loopLen) / loopLen;
        tf.style.width = `${cyc * 100}%`;
        rs.textContent = t(`正在原地回放（余 ${Math.ceil(rem)}s）· 靠近按 E 取回`);
      } else {
        tf.style.width = '100%';
        rs.textContent = t('回放已结束 · 磁带保留，走近对准按 E 取回');
      }
    } else if (game.clip.length) {
      tf.style.width = '100%';
      rs.textContent = t(`磁带就绪（${game.clip.length} 处声响）· Q 放下诱饵 / R 重录`);
    } else {
      tf.style.width = '0%';
      rs.textContent = t('空白磁带 · 敲击金属或走动后按 R 录下 6 秒');
    }
  }

  const noticeText = game.time <= noticeUntil ? t(noticeSource) : '';
  const captionText = game.time <= captionUntil && settings.captions && captionSource
    ? `〔${t(captionSource.dir)}〕 ${t(captionSource.text)}` : '';
  // Avoid retriggering live-region announcements for unchanged copy every frame.
  if ($('notice').textContent !== noticeText) $('notice').textContent = noticeText;
  if ($('caption').textContent !== captionText) $('caption').textContent = captionText;

  const vigAmt = Math.max(game.danger, game.proximity * 0.45);
  $('vignette').style.boxShadow = vigAmt > 0.02
    ? `inset 0 0 ${45 + vigAmt * 55}px rgba(148, 62, 46, ${Math.min(0.75, 0.25 + vigAmt * 0.5)})`
    : 'none';
}

function animate(now) {
  requestAnimationFrame(animate);
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(Math.max(raw, 0), 0.05);

  if (!paused && focused) {
    if (keys.has('ArrowLeft')) game.yaw += dt * 1.45;
    if (keys.has('ArrowRight')) game.yaw -= dt * 1.45;
    if (keys.has('ArrowUp')) game.pitch -= dt * 0.95;
    if (keys.has('ArrowDown')) game.pitch += dt * 0.95;
    game.pitch = Math.max(-1.35, Math.min(1.35, game.pitch));

    const fw = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const rt = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const moveMode = sprinting ? 'sprint' : quietWalk ? 'quiet' : 'normal';

    game.move(
      -Math.sin(game.yaw) * fw + Math.cos(game.yaw) * rt,
      -Math.cos(game.yaw) * fw - Math.sin(game.yaw) * rt,
      dt,
      moveMode
    );
    game.tick(dt);

    interact = pickBestInteractable(game, world.interactables, world.colliders, interact?.id || null);
    const holdTarget = keys.has('KeyE') && interact && interact.state.enabled && interact.state.mode === 'hold'
      ? interact.id
      : '';
    game.updateHold(holdTarget, dt);
    saveMilestone();

    if (game.failed && !failedShown) {
      failedShown = true;
      showMenu('death');
    }
    if (game.ended && !endingShown) {
      endingElapsed += dt;
      if (endingElapsed >= 4.8) {
        endingShown = true;
        showMenu('ending');
      }
    }
  }

  if (!started && menuMode === 'title') {
    titleTime += dt;
    camera.position.set(1.55 + Math.sin(titleTime * 0.25) * 0.08, 4.66, 5.25 + Math.cos(titleTime * 0.2) * 0.08);
    camera.lookAt(8.5, 4.25, 2.2);
    flashlight.intensity = 1.6;
  } else {
    const bobAmp = game.moveMode === 'sprint' ? 0.028 : game.moveMode === 'quiet' ? 0.008 : 0.016;
    const bob = (settings.reduce || paused) ? 0 : Math.sin(game.stats.walked * 7.2) * bobAmp;
    camera.position.set(game.player.x, game.player.y + 1.63 + bob, game.player.z);
    camera.rotation.set(-game.pitch, game.yaw, 0);
    flashlight.intensity = 4.8;
  }

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  flashlight.position.copy(camera.position);
  flashlight.target.position.copy(camera.position).add(fwd.clone().multiplyScalar(5.5));

  audio.listener(camera.position, fwd);
  audio.update(paused ? 0 : dt, {
    windowOpen: game.phase >= 1,
    pumpActive: started && !game.valve,
    pumpPos: V(7, 0, -25),
    motorActive: game.motor,
    motorPos: V(0, 1, -45),
    threatActive: game.phase >= 3 && !paused,
    threatPos: game.threat
  });

  const placementPreview = !paused ? game.getPlacementPreview() : null;
  world.update(paused && started ? 0 : dt, {
    ...game,
    paused,
    quality: settings.quality,
    placementPreview,
    time: game.time,
    power: game.power,
    powered: game.power,
    motorActive: game.motor,
    motorRunning: game.motor,
    motorProgress: game.motorProgress,
    waterLevel: 0.22 + Math.min(0.26, game.time * 0.00055),
    ended: game.ended,
    hasRecorder: game.hasRecorder
  });

  world.recorder.visible = !game.hasRecorder;
  world.portable.visible = !!game.device;
  if (game.device) {
    world.portable.position.set(game.device.pos.x, game.device.pos.y + 0.10, game.device.pos.z);
  }
  world.threat.visible = game.phase >= 3;
  world.threat.position.set(game.threat.x, world.water.position.y + 0.022, game.threat.z);

  updateHud(now);
  renderer.render(scene, camera);

  if (!paused && raw > 0 && raw < 0.5) {
    const ms = raw * 1000;
    perf.push(ms);
    if (perf.length > 360) perf.shift();
    const rk = currentRoomKey();
    roomPerf[rk].push(ms);
    if (roomPerf[rk].length > 240) roomPerf[rk].shift();
  }

  if (qa && frameCount++ % 15 === 0) {
    qa.textContent = JSON.stringify({
      phase: game.phase,
      room: currentRoomKey(),
      pos: { x: +game.player.x.toFixed(2), y: +game.player.y.toFixed(2), z: +game.player.z.toFixed(2) },
      moveMode: game.moveMode,
      quietWalk,
      interact: interact ? { id: interact.id, enabled: interact.state.enabled, label: interact.state.label } : null,
      clip: game.clip.length,
      device: game.device ? { at: +game.device.at.toFixed(1), end: +game.device.end.toFixed(1), pos: game.device.pos } : null,
      inlet: game.inlet,
      valve: game.valve,
      power: game.power,
      motorProgress: +game.motorProgress.toFixed(1),
      paper: game.paper,
      danger: +game.danger.toFixed(2),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      medianMs: percentile(perf, 0.5),
      p95Ms: percentile(perf, 0.95)
    }, null, 1);
  }
}

window.__tideDiagnostics = () => ({
  version: '0.5.1',
  language: getLanguage(),
  phase: game.phase,
  room: currentRoomKey(),
  position: { ...game.player },
  yaw: game.yaw,
  pitch: game.pitch,
  moveMode: game.moveMode,
  quietWalk,
  time: game.time,
  interact: interact?.id || null,
  interactState: interact?.state || null,
  failed: game.failed,
  danger: game.danger,
  proximity: game.proximity,
  deathReason: game.deathReason,
  ended: game.ended,
  holding: game.holding,
  hold: game.hold,
  inletProgress: game.inletProgress,
  valveProgress: game.valveProgress,
  powerProgress: game.powerProgress,
  observations: { ...game.observations },
  inlet: game.inlet,
  valve: game.valve,
  power: game.power,
  paper: game.paper,
  motorProgress: game.motorProgress,
  placementPreview: game.getPlacementPreview(),
  machinePose: {
    pen: world.penArm.position.toArray(),
    rolls: world.rolls.map(r => r.quaternion.toArray())
  },
  quality: settings.quality,
  resolution: [canvas.width, canvas.height],
  renderInfo: {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles
  },
  threat: { ...game.threat, target: { ...game.threat.target } },
  device: game.device ? { pos: { ...game.device.pos }, at: game.device.at, end: game.device.end, done: !!game.device.done } : null,
  stats: { ...game.stats },
  paused,
  renderer: renderer.getContext().getParameter(renderer.getContext().RENDERER),
  frameStats: {
    samples: perf.length,
    medianMs: percentile(perf, 0.5),
    p95Ms: percentile(perf, 0.95),
    byRoom: roomMetrics()
  },
  frameTimes: [...perf]
});

showMenu('title');
requestAnimationFrame(animate);
