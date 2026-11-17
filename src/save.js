// Only bounded, explicitly selected JSON data is persisted. No executable state.
import { V } from './game.js';

export const SAVE_KEY = 'after-the-tide-checkpoint-v1';
export const stages = ['window', 'recorder', 'learned', 'inlet', 'valve', 'power', 'paper'];
export const stageNames = [
  '值班窗已开启',
  '已取得录放机',
  '已掌握声源诱导',
  '进水阀已隔离',
  '泄压阀已关闭',
  '控制室已通电',
  '记录纸已取出'
];

export function milestone(g) {
  return g.ended ? null
    : g.paper ? 'paper'
    : g.power ? 'power'
    : g.valve ? 'valve'
    : g.inlet ? 'inlet'
    : g.learned ? 'learned'
    : g.hasRecorder ? 'recorder'
    : g.phase >= 1 ? 'window'
    : null;
}

export function makeSave(g) {
  const stage = milestone(g);
  return stage ? {
    version: 1,
    stage,
    time: g.time,
    stats: { ...g.stats },
    clip: g.clip.map(e => ({ time: e.time, type: e.type, strength: e.strength }))
  } : null;
}

export function parseSave(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 30000) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1 || !stages.includes(s.stage) || !Number.isFinite(s.time) || s.time < 0 || s.time > 864000) return null;
    const stats = {};
    for (const k of ['events', 'replays', 'deaths', 'walked']) {
      const n = s.stats?.[k];
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return null;
      stats[k] = n;
    }
    if (!Array.isArray(s.clip) || s.clip.length > 200) return null;
    const types = ['concrete', 'metal', 'splash', 'knock', 'pump', 'motor', 'relay'];
    const clip = s.clip.map(e => {
      if (!e || !types.includes(e.type) || !Number.isFinite(e.time) || e.time < 0 || e.time > 5.85 || !Number.isFinite(e.strength) || e.strength < 0 || e.strength > 10) {
        throw Error('invalid clip');
      }
      return { time: e.time, type: e.type, strength: e.strength };
    });
    return { version: 1, stage: s.stage, time: s.time, stats, clip };
  } catch {
    return null;
  }
}

export function loadCheckpoint(g, s) {
  // Revalidate even caller-provided objects; restore at a known safe landing, never in a chase.
  const valid = parseSave(JSON.stringify(s));
  if (!valid) return false;
  const n = stages.indexOf(valid.stage);
  g.reset();
  g.time = valid.time;
  g.stats = { ...valid.stats };
  g.phase = 1;
  g.anomalyArmed = true;
  g.anomalyDone = n >= 2;
  g.player = V(0, 3, 6);
  if (n >= 1) {
    g.hasRecorder = true;
    g.phase = 2;
    g.checkpoint = 1;
  }
  if (n >= 2) {
    g.phase = 3;
    g.learned = true;
    g.tutorialReplay = true;
    g.player = V(-6.5, 3, -17.5);
  }
  if (n >= 3) {
    g.inlet = true;
    g.inletProgress = 5.5;
  }
  if (n >= 4) {
    g.valve = true;
    g.valveProgress = 7.0;
  }
  if (n >= 5) {
    g.power = true;
    g.powerProgress = 4.0;
    g.phase = 4;
    g.checkpoint = 2;
    g.player = V(0, 0, -37.5);
  }
  if (n >= 6) {
    g.paper = true;
    g.motorProgress = 24;
    g.phase = 6;
  }
  g.clip = valid.clip;
  if (g.clip.length) {
    const maxT = Math.max(...g.clip.map(c => c.time));
    g.clipDuration = 6;
  }
  g.device = null;
  g.threat = { ...V(6, 0.2, -27), target: V(7, 0, -25), until: g.time, mode: '巡游', score: 0 };
  g.notice('已继续上次值班。回到安全检查点；已完成设备姿态保留，录放机已收回随身。', 8);
  return true;
}
